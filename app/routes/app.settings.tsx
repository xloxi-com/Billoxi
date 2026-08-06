import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdminAuth } from "../shopify-context.server";
import {
  formatNumberSeriesNextPreview,
  formatNumberSeriesValue,
  normalizeNumberSeries,
  NUMBER_SERIES_MODULES,
  numberingFromSeries,
  parseNumberSeriesDigits,
  resolveNumberSeriesNextSequence,
  widenStartingNumberPad,
  type NumberSeriesEntry,
  type NumberSeriesMap,
  type NumberSeriesModuleId,
} from "../number-series";
import {
  getInvoiceNumberDigitWidth,
  getLastInvoiceAllocatedSequence,
} from "../order-invoice-status.server";
import {
  normalizeSmtpSettings,
  type SmtpEncryption,
  type SmtpSettings,
} from "../smtp-settings";
import {
  createStoreCustomField,
  normalizeStoreDetails,
  type StoreCustomField,
  type StoreDetails,
} from "../store-details";
import {
  loadNumberSeriesForShop,
  loadSelectedTemplateForShop,
  loadSmtpSettingsForShop,
  loadStoreDetailsForShop,
  resetStoreDetailsFromShopify,
  saveNumberSeriesForShop,
  saveSmtpSettingsForShop,
  saveStoreDetailsForShop,
} from "../shop-settings.server";
import {
  backfillSalesOrderDocumentNumbers,
  fetchAllOrderGidsOldestFirst,
  getLastAllocatedSequence,
  getNumberBackfillUndoStatus,
  revertLastSalesOrderNumberBackfill,
  syncNumberCounter,
  validateStartingNumber,
} from "../sales-order-number.server";
import { resolveSalesOrderTemplateId } from "../sales-order-document";
import { invalidateSalesOrdersCache } from "../sales-orders.server";
import "../settings.css";

type SettingsSection = "store-details" | "number-series" | "smtp";

const settingsMenu: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: "store" | "order" | "email";
}> = [
  {
    id: "store-details",
    label: "Store details",
    description: "Organization info shown on document headers.",
    icon: "store",
  },
  {
    id: "number-series",
    label: "Transaction numbers",
    description: "Prefix and starting numbers for each document module.",
    icon: "order",
  },
  {
    id: "smtp",
    label: "SMTP",
    description: "Outgoing email for invoices and documents.",
    icon: "email",
  },
];

function fieldValue(event: Event): string {
  const target = (event.currentTarget ?? event.target) as
    | HTMLInputElement
    | null;
  return target?.value ?? "";
}

function fieldChecked(event: Event): boolean {
  const target = event.currentTarget as HTMLInputElement | null;
  return Boolean(target?.checked);
}

/** Keep Space inside inputs from being stolen by parent/admin shortcuts. */
function stopInputShortcutPropagation(
  event: ReactKeyboardEvent<HTMLElement>,
) {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const tag = target.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  ) {
    event.stopPropagation();
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const [
    selectedSalesOrderTemplateIdRaw,
    storeDetails,
    smtpSettings,
    numberSeries,
    numberBackfillUndo,
  ] = await Promise.all([
    loadSelectedTemplateForShop(session.shop, "sales-order"),
    loadStoreDetailsForShop(session.shop, admin),
    loadSmtpSettingsForShop(session.shop),
    loadNumberSeriesForShop(session.shop),
    getNumberBackfillUndoStatus(session.shop),
  ]);
  const selectedSalesOrderTemplateId = resolveSalesOrderTemplateId(
    selectedSalesOrderTemplateIdRaw,
  );
  const [lastAllocatedSequence, lastInvoiceSequence, invoiceDigitWidth] =
    await Promise.all([
      getLastAllocatedSequence(session.shop, selectedSalesOrderTemplateId),
      getLastInvoiceAllocatedSequence(session.shop),
      getInvoiceNumberDigitWidth(session.shop),
    ]);
  const lastAllocatedByModule: Record<NumberSeriesModuleId, number | null> = {
    "sales-order": lastAllocatedSequence,
    invoice: lastInvoiceSequence,
    "credit-note": null,
    "packing-slip": null,
  };
  return {
    storeDetails,
    smtpSettings,
    numberSeries,
    lastAllocatedSequence,
    lastAllocatedByModule,
    invoiceDigitWidth,
    numberBackfillUndo,
  };
}

export function shouldRevalidate({
  formMethod,
}: {
  formMethod?: string | null;
}) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  return false;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reset") {
    const storeDetails = await resetStoreDetailsFromShopify(
      session.shop,
      admin,
    );
    return { saved: true, section: "store-details" as const, storeDetails };
  }

  if (intent === "save-smtp") {
    const raw = formData.get("smtpSettings");
    if (typeof raw !== "string") {
      return Response.json(
        { saved: false, error: "SMTP settings are required." },
        { status: 400 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { saved: false, error: "Invalid SMTP settings." },
        { status: 400 },
      );
    }

    const smtpSettings = normalizeSmtpSettings(parsed);
    if (smtpSettings.enabled && !smtpSettings.host) {
      return Response.json(
        { saved: false, error: "SMTP host is required when SMTP is enabled." },
        { status: 400 },
      );
    }

    const saved = await saveSmtpSettingsForShop(session.shop, smtpSettings);
    return { saved: true, section: "smtp" as const, smtpSettings: saved };
  }

  if (intent === "save-number-series") {
    const raw = formData.get("numberSeries");
    if (typeof raw !== "string") {
      return Response.json(
        { saved: false, error: "Number series settings are required." },
        { status: 400 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { saved: false, error: "Invalid number series settings." },
        { status: 400 },
      );
    }

    const numberSeries = normalizeNumberSeries(parsed);
    const previous = await loadNumberSeriesForShop(session.shop);
    const selectedTemplateId = resolveSalesOrderTemplateId(
      await loadSelectedTemplateForShop(session.shop, "sales-order"),
    );
    const numbering = numberingFromSeries(numberSeries["sales-order"]);
    const previousNumbering = numberingFromSeries(previous["sales-order"]);
    const numberingError = await validateStartingNumber(
      session.shop,
      selectedTemplateId,
      numbering,
      previousNumbering,
    );
    if (numberingError) {
      return Response.json(
        { saved: false, error: numberingError },
        { status: 400 },
      );
    }

    const saved = await saveNumberSeriesForShop(session.shop, numberSeries);
    await syncNumberCounter(
      session.shop,
      selectedTemplateId,
      numbering,
      saved["sales-order"].nextSequence,
    );
    const [lastAllocatedSequence, lastInvoiceSequence, invoiceDigitWidth] =
      await Promise.all([
        getLastAllocatedSequence(session.shop, selectedTemplateId),
        getLastInvoiceAllocatedSequence(session.shop),
        getInvoiceNumberDigitWidth(session.shop),
      ]);
    return {
      saved: true,
      section: "number-series" as const,
      numberSeries: saved,
      lastAllocatedSequence,
      lastAllocatedByModule: {
        "sales-order": lastAllocatedSequence,
        invoice: lastInvoiceSequence,
        "credit-note": null,
        "packing-slip": null,
      } satisfies Record<NumberSeriesModuleId, number | null>,
      invoiceDigitWidth,
    };
  }

  if (intent === "backfill-numbers") {
    const numberSeries = await loadNumberSeriesForShop(session.shop);
    const selectedTemplateId = resolveSalesOrderTemplateId(
      await loadSelectedTemplateForShop(session.shop, "sales-order"),
    );
    try {
      const orderGids = await fetchAllOrderGidsOldestFirst(admin);
      const result = await backfillSalesOrderDocumentNumbers(
        session.shop,
        selectedTemplateId,
        numberingFromSeries(numberSeries["sales-order"]),
        orderGids,
      );
      invalidateSalesOrdersCache(session.shop);
      return {
        backfilled: true,
        assigned: result.assigned,
        skipped: result.skipped,
        lastNumber: result.lastNumber,
        lastAllocatedSequence: result.lastAllocatedSequence,
        canUndo: result.canUndo,
      };
    } catch (error) {
      return Response.json(
        {
          backfilled: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to assign numbers to existing orders.",
        },
        { status: 400 },
      );
    }
  }

  if (intent === "revert-backfill-numbers") {
    try {
      const result = await revertLastSalesOrderNumberBackfill(session.shop);
      if (!result.ok) {
        return Response.json(
          {
            revertedBackfill: false,
            error: result.error,
            invoicedCount: result.invoicedCount,
            canUndo: false,
          },
          { status: 400 },
        );
      }
      invalidateSalesOrdersCache(session.shop);
      return {
        revertedBackfill: true,
        reverted: result.reverted,
        lastAllocatedSequence: result.lastAllocatedSequence,
        canUndo: false,
      };
    } catch (error) {
      return Response.json(
        {
          revertedBackfill: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to undo the last number assignment.",
        },
        { status: 400 },
      );
    }
  }

  const raw = formData.get("storeDetails");
  if (typeof raw !== "string") {
    return Response.json(
      { saved: false, error: "Store details are required." },
      { status: 400 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json(
      { saved: false, error: "Invalid store details." },
      { status: 400 },
    );
  }

  const storeDetails = normalizeStoreDetails(parsed);
  if (!storeDetails.name) {
    return Response.json(
      { saved: false, error: "Store name is required." },
      { status: 400 },
    );
  }

  const saved = await saveStoreDetailsForShop(session.shop, storeDetails);
  return { saved: true, section: "store-details" as const, storeDetails: saved };
}

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const initialSection: SettingsSection =
    requestedSection === "number-series" ||
    requestedSection === "smtp" ||
    requestedSection === "store-details"
      ? requestedSection
      : "store-details";
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(initialSection);
  const [storeDetails, setStoreDetails] = useState<StoreDetails>(
    data.storeDetails,
  );
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings>(
    data.smtpSettings,
  );
  const [numberSeries, setNumberSeries] = useState<NumberSeriesMap>(
    data.numberSeries,
  );
  const [savedStoreDetails, setSavedStoreDetails] = useState<StoreDetails>(
    data.storeDetails,
  );
  const [savedSmtpSettings, setSavedSmtpSettings] = useState<SmtpSettings>(
    data.smtpSettings,
  );
  const [savedNumberSeries, setSavedNumberSeries] = useState<NumberSeriesMap>(
    data.numberSeries,
  );
  const [lastAllocatedSequence, setLastAllocatedSequence] = useState<
    number | null
  >(data.lastAllocatedSequence);
  const [lastAllocatedByModule, setLastAllocatedByModule] = useState<
    Record<NumberSeriesModuleId, number | null>
  >(data.lastAllocatedByModule);
  const [invoiceDigitWidth, setInvoiceDigitWidth] = useState(
    data.invoiceDigitWidth,
  );
  const [previewDrafts, setPreviewDrafts] = useState<
    Partial<Record<NumberSeriesModuleId, string>>
  >({});
  const [backfillUndo, setBackfillUndo] = useState<{
    assignedCount: number;
    assignedAt: string;
    canUndo: boolean;
    invoicedCount: number;
  } | null>(data.numberBackfillUndo);
  const [isStoreDirty, setIsStoreDirty] = useState(false);
  const [isSmtpDirty, setIsSmtpDirty] = useState(false);
  const [isNumberSeriesDirty, setIsNumberSeriesDirty] = useState(false);
  const [isEditingSeries, setIsEditingSeries] = useState(false);
  const [draggingFieldIndex, setDraggingFieldIndex] = useState<number | null>(
    null,
  );
  const [dragOverFieldIndex, setDragOverFieldIndex] = useState<number | null>(
    null,
  );
  const handledFetcherDataRef = useRef<unknown>(null);
  const isSaving = fetcher.state !== "idle";
  const isDirty =
    activeSection === "store-details"
      ? isStoreDirty
      : activeSection === "smtp"
        ? isSmtpDirty
        : isNumberSeriesDirty;
  const activeItem =
    settingsMenu.find((item) => item.id === activeSection) ?? settingsMenu[0];

  useEffect(() => {
    setStoreDetails(data.storeDetails);
    setSavedStoreDetails(data.storeDetails);
    setIsStoreDirty(false);
  }, [data.storeDetails]);

  useEffect(() => {
    setSmtpSettings(data.smtpSettings);
    setSavedSmtpSettings(data.smtpSettings);
    setIsSmtpDirty(false);
  }, [data.smtpSettings]);

  useEffect(() => {
    setNumberSeries(data.numberSeries);
    setSavedNumberSeries(data.numberSeries);
    setLastAllocatedSequence(data.lastAllocatedSequence);
    setLastAllocatedByModule(data.lastAllocatedByModule);
    setInvoiceDigitWidth(data.invoiceDigitWidth);
    setBackfillUndo(data.numberBackfillUndo);
    setIsNumberSeriesDirty(false);
    setIsEditingSeries(false);
  }, [
    data.numberSeries,
    data.lastAllocatedSequence,
    data.lastAllocatedByModule,
    data.invoiceDigitWidth,
    data.numberBackfillUndo,
  ]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (handledFetcherDataRef.current === fetcher.data) return;
    handledFetcherDataRef.current = fetcher.data;

    if ("backfilled" in fetcher.data && fetcher.data.backfilled) {
      if (
        "lastAllocatedSequence" in fetcher.data &&
        (typeof fetcher.data.lastAllocatedSequence === "number" ||
          fetcher.data.lastAllocatedSequence === null)
      ) {
        const nextLast = fetcher.data.lastAllocatedSequence;
        setLastAllocatedSequence(nextLast);
        setLastAllocatedByModule((current) => ({
          ...current,
          "sales-order": nextLast,
        }));
      }
      const assigned =
        "assigned" in fetcher.data ? Number(fetcher.data.assigned) : 0;
      if (assigned > 0 && "canUndo" in fetcher.data && fetcher.data.canUndo) {
        setBackfillUndo({
          assignedCount: assigned,
          assignedAt: new Date().toISOString(),
          canUndo: true,
          invoicedCount: 0,
        });
      }
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(
          assigned > 0
            ? `Assigned ${assigned} sales order number${assigned === 1 ? "" : "s"}`
            : "All existing orders already have numbers",
        );
      }
      return;
    }

    if ("revertedBackfill" in fetcher.data) {
      if (fetcher.data.revertedBackfill) {
        if (
          "lastAllocatedSequence" in fetcher.data &&
          (typeof fetcher.data.lastAllocatedSequence === "number" ||
            fetcher.data.lastAllocatedSequence === null)
        ) {
          const nextLast = fetcher.data.lastAllocatedSequence;
          setLastAllocatedSequence(nextLast);
          setLastAllocatedByModule((current) => ({
            ...current,
            "sales-order": nextLast,
          }));
        }
        setBackfillUndo(null);
        if (typeof shopify !== "undefined" && shopify.toast) {
          const reverted =
            "reverted" in fetcher.data ? Number(fetcher.data.reverted) : 0;
          shopify.toast.show(
            reverted > 0
              ? `Reverted ${reverted} sales order number${reverted === 1 ? "" : "s"}`
              : "Nothing to undo",
          );
        }
      } else if (
        typeof shopify !== "undefined" &&
        shopify.toast &&
        "error" in fetcher.data &&
        typeof fetcher.data.error === "string"
      ) {
        shopify.toast.show(fetcher.data.error, { isError: true });
        if (
          "invoicedCount" in fetcher.data &&
          typeof fetcher.data.invoicedCount === "number"
        ) {
          const invoicedCount = fetcher.data.invoicedCount;
          setBackfillUndo((current) =>
            current
              ? { ...current, canUndo: false, invoicedCount }
              : current,
          );
        }
      }
      return;
    }

    if (!("saved" in fetcher.data) || !fetcher.data.saved) {
      return;
    }

    if ("storeDetails" in fetcher.data && fetcher.data.storeDetails) {
      setStoreDetails(fetcher.data.storeDetails);
      setSavedStoreDetails(fetcher.data.storeDetails);
      setIsStoreDirty(false);
    }

    if ("smtpSettings" in fetcher.data && fetcher.data.smtpSettings) {
      setSmtpSettings(fetcher.data.smtpSettings);
      setSavedSmtpSettings(fetcher.data.smtpSettings);
      setIsSmtpDirty(false);
    }

    if ("numberSeries" in fetcher.data && fetcher.data.numberSeries) {
      setNumberSeries(fetcher.data.numberSeries);
      setSavedNumberSeries(fetcher.data.numberSeries);
      setIsNumberSeriesDirty(false);
      setIsEditingSeries(false);
      setPreviewDrafts({});
      if (
        "lastAllocatedByModule" in fetcher.data &&
        fetcher.data.lastAllocatedByModule
      ) {
        setLastAllocatedByModule(
          fetcher.data.lastAllocatedByModule as Record<
            NumberSeriesModuleId,
            number | null
          >,
        );
      }
      if (
        "lastAllocatedSequence" in fetcher.data &&
        (typeof fetcher.data.lastAllocatedSequence === "number" ||
          fetcher.data.lastAllocatedSequence === null)
      ) {
        setLastAllocatedSequence(fetcher.data.lastAllocatedSequence);
      }
      if (
        "invoiceDigitWidth" in fetcher.data &&
        typeof fetcher.data.invoiceDigitWidth === "number"
      ) {
        setInvoiceDigitWidth(fetcher.data.invoiceDigitWidth);
      }
    }

    if (typeof shopify !== "undefined" && shopify.toast) {
      shopify.toast.show(
        fetcher.data.section === "smtp"
          ? "SMTP settings saved"
          : fetcher.data.section === "number-series"
            ? "Transaction numbers saved"
            : fetcher.data.section === "store-details" &&
                "storeDetails" in fetcher.data
              ? "Store details saved"
              : "Settings saved",
      );
    }
  }, [fetcher.state, fetcher.data]);

  const updateField = (
    key: Exclude<keyof StoreDetails, "customFields">,
    value: string,
  ) => {
    setStoreDetails((current) => ({ ...current, [key]: value }));
    setIsStoreDirty(true);
  };

  const updateSmtpField = <K extends keyof SmtpSettings>(
    key: K,
    value: SmtpSettings[K],
  ) => {
    setSmtpSettings((current) => ({ ...current, [key]: value }));
    setIsSmtpDirty(true);
  };

  const updateSeriesEntry = (
    moduleId: NumberSeriesModuleId,
    updates: Partial<NumberSeriesEntry>,
  ) => {
    setNumberSeries((current) => ({
      ...current,
      [moduleId]: {
        ...current[moduleId],
        ...updates,
        ...(updates.startingNumber != null
          ? {
              startingNumber: String(updates.startingNumber).replace(/\D/g, ""),
            }
          : {}),
      },
    }));
    setIsNumberSeriesDirty(true);
  };

  const applyPreviewDraft = (moduleId: NumberSeriesModuleId, raw: string) => {
    setPreviewDrafts((current) => ({ ...current, [moduleId]: raw }));
    setIsNumberSeriesDirty(true);
    const entry = numberSeries[moduleId];
    const parsed =
      parseNumberSeriesDigits(raw.trim(), entry) ||
      parseNumberSeriesDigits(
        `${entry.prefix}${raw.trim()}${entry.suffix ?? ""}`,
        entry,
      );
    if (!parsed) return;

    const last = lastAllocatedByModule[moduleId] ?? null;
    const startAt = Number.parseInt(entry.startingNumber, 10);
    const start = Number.isFinite(startAt) && startAt >= 0 ? startAt : 1;
    const minNext = last == null ? start : last + 1;
    const nextSequence = Math.max(minNext, parsed.sequence);
    const width = Math.max(
      parsed.digitWidth,
      moduleId === "invoice" ? invoiceDigitWidth : 0,
      entry.startingNumber.length,
    );
    const startingNumber = widenStartingNumberPad(entry.startingNumber, width);
    if (moduleId === "invoice") {
      setInvoiceDigitWidth((prev) => Math.max(prev, width));
    }
    setNumberSeries((current) => ({
      ...current,
      [moduleId]: {
        ...current[moduleId],
        nextSequence,
        startingNumber,
      },
    }));
  };

  const commitPreviewDraft = (moduleId: NumberSeriesModuleId) => {
    setPreviewDrafts((current) => ({
      ...current,
      [moduleId]: previewForModule(moduleId),
    }));
  };

  const updateCustomField = (
    id: string,
    updates: Partial<Pick<StoreCustomField, "label" | "value">>,
  ) => {
    setStoreDetails((current) => ({
      ...current,
      customFields: current.customFields.map((field) =>
        field.id === id ? { ...field, ...updates } : field,
      ),
    }));
    setIsStoreDirty(true);
  };

  const addCustomField = () => {
    setStoreDetails((current) => ({
      ...current,
      customFields: [...current.customFields, createStoreCustomField()],
    }));
    setIsStoreDirty(true);
  };

  const removeCustomField = (id: string) => {
    setStoreDetails((current) => ({
      ...current,
      customFields: current.customFields.filter((field) => field.id !== id),
    }));
    setIsStoreDirty(true);
  };

  const moveCustomField = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= storeDetails.customFields.length ||
      toIndex >= storeDetails.customFields.length
    ) {
      return;
    }

    setStoreDetails((current) => {
      const next = [...current.customFields];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...current, customFields: next };
    });
    setIsStoreDirty(true);
  };

  const save = () => {
    if (activeSection === "smtp") {
      fetcher.submit(
        {
          intent: "save-smtp",
          smtpSettings: JSON.stringify(smtpSettings),
        },
        { method: "post" },
      );
      return;
    }

    if (activeSection === "number-series") {
      fetcher.submit(
        {
          intent: "save-number-series",
          numberSeries: JSON.stringify(numberSeries),
        },
        { method: "post" },
      );
      return;
    }

    fetcher.submit(
      {
        intent: "save-store-details",
        storeDetails: JSON.stringify(storeDetails),
      },
      { method: "post" },
    );
  };

  const discard = () => {
    if (activeSection === "smtp") {
      setSmtpSettings(savedSmtpSettings);
      setIsSmtpDirty(false);
      return;
    }
    if (activeSection === "number-series") {
      setNumberSeries(savedNumberSeries);
      setIsNumberSeriesDirty(false);
      setIsEditingSeries(false);
      setPreviewDrafts({});
      setInvoiceDigitWidth(data.invoiceDigitWidth);
      return;
    }
    setStoreDetails(savedStoreDetails);
    setIsStoreDirty(false);
  };

  const resetFromShopify = () => {
    fetcher.submit({ intent: "reset" }, { method: "post" });
  };

  const backfillExistingOrderNumbers = () => {
    fetcher.submit({ intent: "backfill-numbers" }, { method: "post" });
  };

  const revertLastBackfill = () => {
    fetcher.submit({ intent: "revert-backfill-numbers" }, { method: "post" });
  };

  const switchSection = (section: SettingsSection) => {
    if (isDirty && section !== activeSection) {
      discard();
    }
    setActiveSection(section);
    if (section !== "number-series") {
      setIsEditingSeries(false);
    }
  };

  const salesOrderNextNumber = formatNumberSeriesValue(
    numberSeries["sales-order"],
    resolveNumberSeriesNextSequence(
      numberSeries["sales-order"],
      lastAllocatedSequence,
    ),
  );

  const previewForModule = (moduleId: NumberSeriesModuleId) => {
    const entry = numberSeries[moduleId];
    const last = lastAllocatedByModule[moduleId] ?? null;
    if (moduleId === "invoice") {
      const padded = {
        ...entry,
        startingNumber: widenStartingNumberPad(
          entry.startingNumber,
          Math.max(invoiceDigitWidth, entry.startingNumber.length),
        ),
      };
      return formatNumberSeriesNextPreview(padded, last);
    }
    return formatNumberSeriesNextPreview(entry, last);
  };

  const beginEditingSeries = () => {
    const drafts: Partial<Record<NumberSeriesModuleId, string>> = {};
    for (const module of NUMBER_SERIES_MODULES) {
      drafts[module.id] = previewForModule(module.id);
    }
    setPreviewDrafts(drafts);
    setIsEditingSeries(true);
  };

  return (
    <>
      <SaveBar id="settings-save-bar" open={isDirty} discardConfirmation>
        <button
          variant="primary"
          onClick={save}
          disabled={!isDirty || isSaving || undefined}
          loading={isSaving || undefined}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button onClick={discard} disabled={isSaving || undefined}>
          Discard
        </button>
      </SaveBar>

      <s-page heading="Settings" inlineSize="base">
        {activeSection === "store-details" ? (
          <s-button
            slot="secondary-actions"
            disabled={isSaving || undefined}
            onClick={resetFromShopify}
          >
            Load from Shopify store
          </s-button>
        ) : null}

        <div
          className="settings-page"
          onKeyDown={stopInputShortcutPropagation}
        >
          <s-stack direction="block" gap="base">
            {fetcher.data && "error" in fetcher.data && fetcher.data.error ? (
              <s-banner tone="critical" heading="Could not save">
                {String(fetcher.data.error)}
              </s-banner>
            ) : null}

            <div className="settings-layout">
              <aside className="settings-sidebar">
                <s-box
                  border="base"
                  borderRadius="base"
                  overflow="hidden"
                  background="base"
                >
                  <nav aria-label="Settings sections">
                    {settingsMenu.map((item, index) => {
                      const isActive = item.id === activeSection;
                      return (
                        <div key={item.id}>
                          {index > 0 ? <s-divider /> : null}
                          <s-clickable
                            accessibilityLabel={`Open ${item.label}`}
                            background={isActive ? "subdued" : "transparent"}
                            padding="small"
                            onClick={() => switchSection(item.id)}
                          >
                            <s-stack
                              direction="inline"
                              gap="small"
                              alignItems="center"
                            >
                              <s-icon
                                type={item.icon}
                                tone={isActive ? "auto" : "neutral"}
                              />
                              <s-text type={isActive ? "strong" : undefined}>
                                {item.label}
                              </s-text>
                            </s-stack>
                          </s-clickable>
                        </div>
                      );
                    })}
                  </nav>
                </s-box>
              </aside>

              <div className="settings-content">
            {activeSection === "store-details" ? (
                <s-section heading="Store details">
                  <s-stack direction="block" gap="base">
                    <s-paragraph color="subdued">
                      {activeItem.description}
                    </s-paragraph>

                    <s-text-field
                      label="Store / organization name"
                      value={storeDetails.name}
                      onInput={(event) =>
                        updateField("name", fieldValue(event))
                      }
                      autocomplete="organization"
                    />

                    <s-text-area
                      label="Address"
                      value={storeDetails.address}
                      rows={4}
                      onInput={(event) =>
                        updateField("address", fieldValue(event))
                      }
                      autocomplete="street-address"
                      details="Type the full address. Use a new line for each address line."
                    />

                    <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                      <s-text-field
                        label="Phone"
                        value={storeDetails.phone}
                        onInput={(event) =>
                          updateField("phone", fieldValue(event))
                        }
                        autocomplete="off"
                      />
                      <s-email-field
                        label="Email"
                        value={storeDetails.email}
                        onInput={(event) =>
                          updateField("email", fieldValue(event))
                        }
                        autocomplete="email"
                      />
                    </s-grid>

                    <s-text-field
                      label="Website"
                      value={storeDetails.website}
                      onInput={(event) =>
                        updateField("website", fieldValue(event))
                      }
                      autocomplete="off"
                      details="Shown on document headers as Website: www.your-site.com"
                    />

                    <s-divider />

                    <s-stack
                      direction="inline"
                      gap="base"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <s-heading>Custom fields</s-heading>
                      <s-button
                        variant="secondary"
                        onClick={addCustomField}
                      >
                        Add field
                      </s-button>
                    </s-stack>

                    {storeDetails.customFields.length === 0 ? (
                      <s-paragraph color="subdued">
                        No custom fields yet.
                      </s-paragraph>
                    ) : (
                      <s-stack direction="block" gap="small">
                        <s-paragraph color="subdued">
                          Drag to reorder fields.
                        </s-paragraph>
                        <s-box
                          border="base"
                          borderRadius="base"
                          overflow="hidden"
                        >
                          <s-stack direction="block" gap="none">
                            {storeDetails.customFields.map((field, index) => {
                              const isDragging = draggingFieldIndex === index;
                              const isDropTarget =
                                dragOverFieldIndex === index &&
                                draggingFieldIndex !== index;
                              const isLast =
                                index ===
                                storeDetails.customFields.length - 1;

                              return (
                                <div
                                  key={field.id}
                                  className={[
                                    "settings-custom-field",
                                    isDragging
                                      ? "settings-custom-field--dragging"
                                      : "",
                                    isDropTarget
                                      ? "settings-custom-field--drop-target"
                                      : "",
                                    isLast
                                      ? "settings-custom-field--last"
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  onDragOver={(event) => {
                                    event.preventDefault();
                                    if (dragOverFieldIndex !== index) {
                                      setDragOverFieldIndex(index);
                                    }
                                  }}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    if (draggingFieldIndex !== null) {
                                      moveCustomField(
                                        draggingFieldIndex,
                                        index,
                                      );
                                    }
                                    setDraggingFieldIndex(null);
                                    setDragOverFieldIndex(null);
                                  }}
                                >
                                  <s-grid
                                    gridTemplateColumns="auto 1fr 1fr auto"
                                    gap="small"
                                    alignItems="center"
                                  >
                                    <div
                                      className="settings__drag-handle"
                                      draggable
                                      role="button"
                                      tabIndex={0}
                                      aria-label={`Drag to reorder ${field.label || "custom field"}`}
                                      onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed =
                                          "move";
                                        event.dataTransfer.setData(
                                          "text/plain",
                                          String(index),
                                        );
                                        setDraggingFieldIndex(index);
                                      }}
                                      onDragEnd={() => {
                                        setDraggingFieldIndex(null);
                                        setDragOverFieldIndex(null);
                                      }}
                                    >
                                      <s-icon
                                        type="drag-handle"
                                        tone="neutral"
                                      />
                                    </div>
                                    <s-text-field
                                      label="Label"
                                      labelAccessibilityVisibility="exclusive"
                                      value={field.label}
                                      placeholder="Label"
                                      onInput={(event) =>
                                        updateCustomField(field.id, {
                                          label: fieldValue(event),
                                        })
                                      }
                                      autocomplete="off"
                                    />
                                    <s-text-field
                                      label="Text"
                                      labelAccessibilityVisibility="exclusive"
                                      value={field.value}
                                      placeholder="Text"
                                      onInput={(event) =>
                                        updateCustomField(field.id, {
                                          value: fieldValue(event),
                                        })
                                      }
                                      autocomplete="off"
                                    />
                                    <s-button
                                      variant="tertiary"
                                      tone="critical"
                                      onClick={() =>
                                        removeCustomField(field.id)
                                      }
                                    >
                                      Remove
                                    </s-button>
                                  </s-grid>
                                </div>
                              );
                            })}
                          </s-stack>
                        </s-box>
                      </s-stack>
                    )}

                    {isStoreDirty ? (
                      <s-paragraph color="subdued">
                        Unsaved changes
                      </s-paragraph>
                    ) : null}
                  </s-stack>
                </s-section>
              ) : activeSection === "number-series" ? (
                <s-section heading="Transaction numbers">
                  <s-stack direction="block" gap="base">
                    <s-stack
                      direction="inline"
                      gap="base"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <s-paragraph color="subdued">
                        {activeItem.description}
                      </s-paragraph>
                      {isEditingSeries ? (
                        <s-button
                          variant="secondary"
                          onClick={() => {
                            setNumberSeries(savedNumberSeries);
                            setIsNumberSeriesDirty(false);
                            setIsEditingSeries(false);
                            setPreviewDrafts({});
                            setInvoiceDigitWidth(data.invoiceDigitWidth);
                          }}
                          disabled={isSaving || undefined}
                        >
                          Cancel
                        </s-button>
                      ) : (
                        <s-button
                          variant="secondary"
                          icon="edit"
                          onClick={beginEditingSeries}
                        >
                          Edit
                        </s-button>
                      )}
                    </s-stack>

                    <s-box
                      border="base"
                      borderRadius="base"
                      overflow="hidden"
                      background="base"
                    >
                      <s-table>
                        <s-table-header-row>
                          <s-table-header listSlot="primary">
                            Module
                          </s-table-header>
                          <s-table-header>Prefix</s-table-header>
                          <s-table-header>
                            Starting number
                          </s-table-header>
                          <s-table-header>Preview</s-table-header>
                        </s-table-header-row>
                        <s-table-body>
                          {NUMBER_SERIES_MODULES.map((module) => {
                            const entry = numberSeries[module.id];
                            return (
                              <s-table-row key={module.id}>
                                <s-table-cell>
                                  <s-text type="strong">{module.label}</s-text>
                                </s-table-cell>
                                <s-table-cell>
                                  {isEditingSeries ? (
                                    <s-text-field
                                      label="Prefix"
                                      labelAccessibilityVisibility="exclusive"
                                      value={entry.prefix}
                                      onInput={(event) =>
                                        updateSeriesEntry(module.id, {
                                          prefix: fieldValue(event),
                                        })
                                      }
                                      autocomplete="off"
                                    />
                                  ) : (
                                    entry.prefix || "—"
                                  )}
                                </s-table-cell>
                                <s-table-cell>
                                  {isEditingSeries ? (
                                    <s-text-field
                                      label="Starting number"
                                      labelAccessibilityVisibility="exclusive"
                                      value={entry.startingNumber}
                                      onInput={(event) =>
                                        updateSeriesEntry(module.id, {
                                          startingNumber: fieldValue(event),
                                        })
                                      }
                                      autocomplete="off"
                                    />
                                  ) : (
                                    entry.startingNumber
                                  )}
                                </s-table-cell>
                                <s-table-cell>
                                  {isEditingSeries ? (
                                    <s-text-field
                                      label="Preview / next number"
                                      labelAccessibilityVisibility="exclusive"
                                      value={
                                        previewDrafts[module.id] ??
                                        previewForModule(module.id)
                                      }
                                      onInput={(event) =>
                                        applyPreviewDraft(
                                          module.id,
                                          fieldValue(event),
                                        )
                                      }
                                      onBlur={() =>
                                        commitPreviewDraft(module.id)
                                      }
                                      autocomplete="off"
                                    />
                                  ) : (
                                    <s-text type="strong">
                                      {previewForModule(module.id)}
                                    </s-text>
                                  )}
                                </s-table-cell>
                              </s-table-row>
                            );
                          })}
                        </s-table-body>
                      </s-table>
                    </s-box>

                    {!isEditingSeries ? (
                      <s-banner tone="info" heading="Transaction number">
                        <s-stack direction="block" gap="small">
                          <s-paragraph>
                            Assign numbers to existing Shopify orders (oldest
                            first) using the saved Sales Order series. Orders
                            that already have a number are skipped. Next number:{" "}
                            <s-text type="strong">{salesOrderNextNumber}</s-text>
                          </s-paragraph>
                          <s-stack direction="inline" gap="small">
                            <s-button
                              variant="secondary"
                              commandFor="assign-numbers-modal"
                              command="--show"
                              loading={
                                (isSaving &&
                                  fetcher.formData?.get("intent") ===
                                    "backfill-numbers") ||
                                undefined
                              }
                              disabled={
                                isNumberSeriesDirty || isSaving || undefined
                              }
                            >
                              Assign to existing orders
                            </s-button>
                            {backfillUndo ? (
                              <s-button
                                variant="tertiary"
                                tone="critical"
                                commandFor={
                                  backfillUndo.canUndo
                                    ? "revert-numbers-modal"
                                    : undefined
                                }
                                command={
                                  backfillUndo.canUndo ? "--show" : undefined
                                }
                                loading={
                                  (isSaving &&
                                    fetcher.formData?.get("intent") ===
                                      "revert-backfill-numbers") ||
                                  undefined
                                }
                                disabled={
                                  !backfillUndo.canUndo || isSaving || undefined
                                }
                              >
                                Undo last assign
                              </s-button>
                            ) : null}
                          </s-stack>
                          {backfillUndo ? (
                            <s-paragraph color="subdued">
                              {backfillUndo.canUndo
                                ? `Last assign added ${backfillUndo.assignedCount} number${backfillUndo.assignedCount === 1 ? "" : "s"}. You can undo that run once.`
                                : `Undo is disabled: ${backfillUndo.invoicedCount} order${backfillUndo.invoicedCount === 1 ? "" : "s"} from the last assign ${backfillUndo.invoicedCount === 1 ? "was" : "were"} converted to invoice. Delete ${backfillUndo.invoicedCount === 1 ? "that invoice" : "those invoices"} to enable undo again.`}
                            </s-paragraph>
                          ) : null}
                        </s-stack>
                      </s-banner>
                    ) : null}

                    <s-modal
                      id="assign-numbers-modal"
                      heading="Assign numbers to existing orders?"
                    >
                      <s-paragraph>
                        Numbers will be assigned to Shopify orders oldest first,
                        starting from{" "}
                        <s-text type="strong">{salesOrderNextNumber}</s-text>.
                        Orders that already have a number are skipped. You can
                        undo the last assign if needed.
                      </s-paragraph>
                      <s-button
                        slot="secondary-actions"
                        commandFor="assign-numbers-modal"
                        command="--hide"
                        disabled={isSaving || undefined}
                      >
                        Cancel
                      </s-button>
                      <s-button
                        slot="primary-action"
                        variant="primary"
                        commandFor="assign-numbers-modal"
                        command="--hide"
                        loading={
                          (isSaving &&
                            fetcher.formData?.get("intent") ===
                              "backfill-numbers") ||
                          undefined
                        }
                        disabled={isSaving || undefined}
                        onClick={backfillExistingOrderNumbers}
                      >
                        Assign numbers
                      </s-button>
                    </s-modal>

                    <s-modal
                      id="revert-numbers-modal"
                      heading="Undo last number assign?"
                    >
                      <s-paragraph>
                        This removes the{" "}
                        <s-text type="strong">
                          {backfillUndo?.assignedCount ?? 0}
                        </s-text>{" "}
                        sales order number
                        {(backfillUndo?.assignedCount ?? 0) === 1 ? "" : "s"}{" "}
                        from the last “Assign to existing orders” run. Numbers
                        assigned earlier or from normal use are kept.
                      </s-paragraph>
                      {!backfillUndo?.canUndo ? (
                        <s-paragraph>
                          Undo is currently blocked because{" "}
                          {backfillUndo?.invoicedCount ?? 0} of those orders
                          {(backfillUndo?.invoicedCount ?? 0) === 1
                            ? " has"
                            : " have"}{" "}
                          an invoice. Delete the invoice
                          {(backfillUndo?.invoicedCount ?? 0) === 1
                            ? ""
                            : "s"}{" "}
                          first.
                        </s-paragraph>
                      ) : null}
                      <s-button
                        slot="secondary-actions"
                        commandFor="revert-numbers-modal"
                        command="--hide"
                        disabled={isSaving || undefined}
                      >
                        Cancel
                      </s-button>
                      <s-button
                        slot="primary-action"
                        variant="primary"
                        tone="critical"
                        commandFor="revert-numbers-modal"
                        command="--hide"
                        loading={
                          (isSaving &&
                            fetcher.formData?.get("intent") ===
                              "revert-backfill-numbers") ||
                          undefined
                        }
                        disabled={
                          !backfillUndo?.canUndo || isSaving || undefined
                        }
                        onClick={revertLastBackfill}
                      >
                        Undo assign
                      </s-button>
                    </s-modal>

                    {isNumberSeriesDirty ? (
                      <s-paragraph color="subdued">
                        Unsaved changes
                      </s-paragraph>
                    ) : null}
                  </s-stack>
                </s-section>
              ) : (
                <s-section heading="SMTP">
                  <s-stack direction="block" gap="base">
                    <s-paragraph color="subdued">
                      {activeItem.description}
                    </s-paragraph>

                    <s-switch
                      label="Enable SMTP"
                      checked={smtpSettings.enabled || undefined}
                      onChange={(event) =>
                        updateSmtpField("enabled", fieldChecked(event))
                      }
                    />

                    <s-grid gridTemplateColumns="2fr 1fr" gap="small">
                      <s-text-field
                        label="SMTP host"
                        value={smtpSettings.host}
                        placeholder="smtp.example.com"
                        disabled={!smtpSettings.enabled || undefined}
                        onInput={(event) =>
                          updateSmtpField("host", fieldValue(event))
                        }
                        autocomplete="off"
                      />
                      <s-text-field
                        label="Port"
                        value={smtpSettings.port}
                        placeholder="587"
                        disabled={!smtpSettings.enabled || undefined}
                        onInput={(event) =>
                          updateSmtpField("port", fieldValue(event))
                        }
                        autocomplete="off"
                      />
                    </s-grid>

                    <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                      <s-text-field
                        label="Username"
                        value={smtpSettings.username}
                        disabled={!smtpSettings.enabled || undefined}
                        onInput={(event) =>
                          updateSmtpField("username", fieldValue(event))
                        }
                        autocomplete="off"
                      />
                      <s-password-field
                        label="Password"
                        value={smtpSettings.password}
                        disabled={!smtpSettings.enabled || undefined}
                        onInput={(event) =>
                          updateSmtpField("password", fieldValue(event))
                        }
                        autocomplete="off"
                      />
                    </s-grid>

                    <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                      <s-text-field
                        label="From name"
                        value={smtpSettings.fromName}
                        disabled={!smtpSettings.enabled || undefined}
                        onInput={(event) =>
                          updateSmtpField("fromName", fieldValue(event))
                        }
                        autocomplete="off"
                      />
                      <s-email-field
                        label="From email"
                        value={smtpSettings.fromEmail}
                        disabled={!smtpSettings.enabled || undefined}
                        onInput={(event) =>
                          updateSmtpField("fromEmail", fieldValue(event))
                        }
                        autocomplete="email"
                      />
                    </s-grid>

                    <s-select
                      label="Encryption"
                      value={smtpSettings.encryption}
                      disabled={!smtpSettings.enabled || undefined}
                      onChange={(event) =>
                        updateSmtpField(
                          "encryption",
                          fieldValue(event) as SmtpEncryption,
                        )
                      }
                    >
                      <s-option value="tls">TLS</s-option>
                      <s-option value="ssl">SSL</s-option>
                      <s-option value="none">None</s-option>
                    </s-select>

                    {isSmtpDirty ? (
                      <s-paragraph color="subdued">
                        Unsaved changes
                      </s-paragraph>
                    ) : null}
                  </s-stack>
                </s-section>
              )}
              </div>
            </div>
          </s-stack>
        </div>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
