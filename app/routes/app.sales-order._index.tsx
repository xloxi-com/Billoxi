import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type {
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  cachedClientLoader,
  createAppPageClientCache,
} from "../client-page-cache";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { renderEmbeddedRouteError } from "../embedded-route-error";
import { planHasCapability, smtpReadyForPlan, getShopPlanIdForGating } from "../plan-access";
import { useAppPlan } from "../use-app-plan";
import { usePlanUpgradeModal } from "../components/plan-lock";
import type { PlanId } from "../plan-features";
import {
  adminFulfillmentStatusLabel,
  adminIndexColumnLabel,
  adminListTabLabel,
  adminPageHeading,
  adminPaymentStatusLabel,
  adminTf,
  type AdminUiLanguage,
} from "../admin-i18n";

import { useAdminI18n } from "../admin-i18n-context";
import {
  AppProvider,
  Avatar,
  Badge,
  Banner,
  Box,
  Button,
  ChoiceList,
  EmptySearchResult,
  Icon,
  IndexFilters,
  IndexFiltersMode,
  IndexTable,
  InlineStack,
  Card,
  Link,
  Modal,
  Text,
  TextField,
  BlockStack,
  Tooltip,
  useIndexResourceState,
  useSetIndexFiltersMode,
} from "@shopify/polaris";
import type { IndexFiltersProps, TabProps } from "@shopify/polaris";
import {
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  EmailIcon,
  ImportIcon,
  MinusCircleIcon,
  NoteIcon,
  PrintIcon,
} from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";
import salesOrdersStyles from "../sales-orders.css?url";

import {
  CREDIT_NOTE_INDEX_COLUMNS,
  DRAFT_INDEX_COLUMNS,
  INVOICE_INDEX_COLUMNS,
  PACKING_SLIP_INDEX_COLUMNS,
  RETURN_INDEX_COLUMNS,
  SALES_ORDER_INDEX_COLUMNS,
  useIndexColumns,
} from "../components/index-columns-menu";

import { requireAdminAuth } from "../shopify-context.server";
import {
  DEFAULT_SALES_ORDER_TEMPLATE_ID,
  SALES_ORDER_TEMPLATE_STORAGE_KEY,
  resolveSalesOrderTemplateId,
  toOrderGid,
} from "../sales-order-ids";
import {
  getInvoicedOrderGids,
  markOrderInvoiced,
  unmarkOrdersInvoiced,
} from "../order-invoice-status.server";
import {
  markOrderDraft,
  unmarkOrdersDraft,
} from "../order-invoice-draft-status.server";
import {
  markOrderPackingSlip,
  unmarkOrdersPackingSlip,
} from "../order-packing-slip-status.server";
import {
  markOrderReturn,
  unmarkOrdersReturn,
} from "../order-return-status.server";
import {
  markOrderCreditNote,
  unmarkOrdersCreditNote,
  voidOrdersCreditNote,
  getCreditNoteOrderGids,
} from "../order-credit-note-status.server";
import {
  invalidateSalesOrdersCache,
  loadSalesOrdersPage,
  parseSalesOrdersSearchParams,
  salesOrdersListMayHaveChanged,
  type SalesOrderRow,
} from "../sales-orders.server";
import { loadSelectedTemplateForShop, loadSmtpSettingsForShop } from "../shop-settings.server";
import { isSmtpReadyForSend, SMTP_REQUIRED_NOTICE } from "../smtp-settings";
import {
  INVOICED_VIEW_INDEX,
  INVOICE_LIST_VIEWS,
  DRAFT_LIST_VIEWS,
  CREDIT_NOTE_LIST_VIEWS,
  PACKING_SLIP_LIST_VIEWS,
  RETURN_LIST_VIEWS,
  SALES_ORDER_VIEWS,
} from "../sales-orders";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: salesOrdersStyles },
];

function getSelectedTemplateId(fallback?: string | null) {
  return resolveSalesOrderTemplateId(
    fallback ||
      window.localStorage.getItem(SALES_ORDER_TEMPLATE_STORAGE_KEY) ||
      DEFAULT_SALES_ORDER_TEMPLATE_ID,
  );
}

function ListEmptyState({
  heading,
  description,
  initials,
  action,
}: {
  heading: string;
  description: string;
  initials: string;
  action?: { content: string; onAction: () => void };
}) {
  return (
    <Box paddingBlock="800">
      <BlockStack gap="400" inlineAlign="center">
        <Avatar size="xl" initials={initials} name={heading} />
        <BlockStack gap="200" inlineAlign="center">
          <Text as="h2" variant="headingMd">
            {heading}
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            {description}
          </Text>
        </BlockStack>
        {action ? (
          <Button variant="primary" onClick={action.onAction}>
            {action.content}
          </Button>
        ) : null}
      </BlockStack>
    </Box>
  );
}

function documentStatusDisplay(
  order: SalesOrderRow,
  listMode: "invoice" | "credit-note",
  language: AdminUiLanguage | string | null | undefined,
): {
  label: string;
  tone: SalesOrderRow["paymentTone"];
  progress: SalesOrderRow["paymentProgress"];
} {
  // Credit-note void is an app lifecycle status — only on the CN list.
  // Never override invoice status with a voided credit note.
  if (listMode === "credit-note" && order.creditNoteVoided) {
    return {
      label: adminPaymentStatusLabel(language, "VOIDED"),
      tone: undefined,
      progress: "complete",
    };
  }

  const key = (order.paymentStatusKey || "").toUpperCase();

  if (key === "PAID") {
    return {
      label: adminPaymentStatusLabel(language, "PAID"),
      tone: "success",
      progress: "complete",
    };
  }
  if (key === "VOIDED") {
    return {
      label: adminPaymentStatusLabel(language, "VOIDED"),
      tone: undefined,
      progress: "complete",
    };
  }
  if (key === "REFUNDED") {
    return {
      label: adminPaymentStatusLabel(language, "REFUNDED"),
      tone: undefined,
      progress: "complete",
    };
  }
  if (key === "PARTIALLY_REFUNDED") {
    return {
      label: adminPaymentStatusLabel(language, "PARTIALLY_REFUNDED"),
      tone: "warning",
      progress: "partiallyComplete",
    };
  }
  if (key === "PARTIALLY_PAID") {
    return {
      label: adminPaymentStatusLabel(language, "PARTIALLY_PAID"),
      tone: "warning",
      progress: "partiallyComplete",
    };
  }
  if (key === "AUTHORIZED") {
    return {
      label: adminPaymentStatusLabel(language, "AUTHORIZED"),
      tone: "attention",
      progress: "partiallyComplete",
    };
  }
  if (key === "EXPIRED") {
    return {
      label: adminPaymentStatusLabel(language, "EXPIRED"),
      tone: "critical",
      progress: "incomplete",
    };
  }

  // PENDING / UNPAID / unknown unpaid — overdue only after the invoice day.
  const startIso = order.invoicedAt || order.createdAt;
  const startMs = new Date(startIso).getTime();
  const days = Number.isFinite(startMs)
    ? Math.max(0, Math.floor((Date.now() - startMs) / 86_400_000))
    : 0;

  if (days <= 0) {
    return {
      label: adminPaymentStatusLabel(language, "UNPAID"),
      tone: "attention",
      progress: "incomplete",
    };
  }

  return {
    label:
      days === 1
        ? adminTf(language, "status.overdueByOneDay", {})
        : adminTf(language, "status.overdueByDays", { days: String(days) }),
    tone: "warning",
    progress: "incomplete",
  };
}

const SORTABLE_COLUMN_IDS = new Set([
  "document",
  "reference",
  "date",
  "total",
  "balanceDue",
]);

/** Shopify Admin Orders-style defaults: Order ↑, Date ↓ */
const COLUMN_DEFAULT_DIRECTION: Record<string, "ascending" | "descending"> = {
  document: "ascending",
  reference: "ascending",
  date: "descending",
  total: "descending",
  balanceDue: "descending",
};

function headingSortKey(columnId: string): string | null {
  switch (columnId) {
    case "document":
      return "order";
    case "reference":
      return "reference";
    case "date":
      return "date";
    case "total":
      return "total";
    case "balanceDue":
      return "balance";
    default:
      return null;
  }
}

const SEARCH_DEBOUNCE_MS = 250;

type BulkConfirmAction =
  | "invoice"
  | "packing-slip"
  | "return"
  | "credit-note"
  | "save-as-draft"
  | "finalize-draft"
  | "email"
  | "download"
  | "delete-invoice"
  | "delete-credit-note"
  | "delete-packing-slip"
  | "delete-return"
  | "delete-draft"
  | "void-credit-note";

const BULK_CONFIRM_COPY: Record<
  BulkConfirmAction,
  { title: string; message: string; confirm: string }
> = {
  invoice: {
    title: "Convert to invoice?",
    message: "Are you sure you want to convert this sales order to an invoice?",
    confirm: "Yes",
  },
  "packing-slip": {
    title: "Convert to packing slip?",
    message:
      "Are you sure you want to convert this sales order to a packing slip?",
    confirm: "Convert",
  },
  return: {
    title: "Convert to return?",
    message: "Are you sure you want to convert this sales order to a return?",
    confirm: "Convert",
  },
  "credit-note": {
    title: "Create credit note?",
    message:
      "Are you sure you want to create a credit note from this invoice?",
    confirm: "Create",
  },
  "save-as-draft": {
    title: "Save as draft?",
    message: "Are you sure you want to save this sales order as a draft invoice?",
    confirm: "Save draft",
  },
  "finalize-draft": {
    title: "Convert to invoice?",
    message:
      "Are you sure you want to convert this draft to an invoice? The draft will be replaced by the invoice.",
    confirm: "Yes",
  },
  email: {
    title: "Send email?",
    message: "Are you sure you want to open an email draft for this order?",
    confirm: "Send",
  },
  download: {
    title: "Download PDF?",
    message: "Are you sure you want to download the selected sales order PDF?",
    confirm: "Download",
  },
  "delete-invoice": {
    title: "Delete invoice?",
    message:
      "Are you sure you want to delete the selected invoice? The sales order will stay; only the invoice record is removed. Invoices with a credit note cannot be deleted until the credit note is deleted first.",
    confirm: "Delete",
  },
  "delete-credit-note": {
    title: "Delete credit note?",
    message:
      "Are you sure you want to delete the selected credit note? The invoice and sales order will stay.",
    confirm: "Delete",
  },
  "delete-packing-slip": {
    title: "Delete packing slip?",
    message:
      "Are you sure you want to delete the selected packing slip? The sales order will stay.",
    confirm: "Delete",
  },
  "delete-return": {
    title: "Delete return?",
    message:
      "Are you sure you want to delete the selected return? The sales order will stay.",
    confirm: "Delete",
  },
  "delete-draft": {
    title: "Delete draft?",
    message:
      "Are you sure you want to delete the selected draft? The sales order will stay; only the draft record is removed.",
    confirm: "Delete",
  },
  "void-credit-note": {
    title: "Void credit note?",
    message:
      "Void this credit note? It stays in the list as voided and can be deleted later.",
    confirm: "Void",
  },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await requireAdminAuth(request);
  const url = new URL(request.url);
  const params = parseSalesOrdersSearchParams(url);
  const [shopSelectedTemplateId, smtpSettings, planId] = await Promise.all([
    loadSelectedTemplateForShop(session.shop, "sales-order"),
    loadSmtpSettingsForShop(session.shop),
    getShopPlanIdForGating(billing),
  ]);
  const selectedTemplateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId,
  );
  const page = await loadSalesOrdersPage(
    admin,
    session.shop,
    params,
    selectedTemplateId,
  );
  return {
    ...page,
    selectedTemplateId,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    smtpReady: smtpReadyForPlan(planId, isSmtpReadyForSend(smtpSettings)),
    listMode: "sales-order" as
      | "sales-order"
      | "invoice"
      | "credit-note"
      | "packing-slip"
      | "return"
      | "draft",
    pageHeading: "Sales Orders",
    invoiceTemplateId: null as string | null,
    creditNoteTemplateId: null as string | null,
    packingSlipTemplateId: null as string | null,
    returnTemplateId: null as string | null,
    shopDomain: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    scopeError: null as string | null,
  };
};

const salesOrderListCache = createAppPageClientCache();

export async function clientLoader(args: ClientLoaderFunctionArgs) {
  return cachedClientLoader(salesOrderListCache, args);
}

export function shouldRevalidate({
  formMethod,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: {
  formMethod?: string | null;
  currentUrl: URL;
  nextUrl: URL;
  defaultShouldRevalidate: boolean;
}) {
  if (formMethod && formMethod.toUpperCase() !== "GET") {
    salesOrderListCache.bust();
    return true;
  }
  if (currentUrl.search !== nextUrl.search) return true;
  // Allow useRevalidator() / background poll to refresh the list.
  return defaultShouldRevalidate;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (
    intent !== "convert-to-invoice" &&
    intent !== "convert-to-packing-slip" &&
    intent !== "convert-to-return" &&
    intent !== "create-credit-note" &&
    intent !== "save-as-draft" &&
    intent !== "finalize-draft" &&
    intent !== "delete-invoice" &&
    intent !== "delete-credit-note" &&
    intent !== "delete-packing-slip" &&
    intent !== "delete-return" &&
    intent !== "delete-draft" &&
    intent !== "void-credit-note" &&
    intent !== "reload-list"
  ) {
    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }

  if (intent === "reload-list") {
    // Cheap watermark check — skip full GraphQL list reload when nothing changed.
    const changed = await salesOrdersListMayHaveChanged(admin, session.shop);
    if (changed) invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "reload" as const,
      changed,
    });
  }

  const orderIds = formData
    .getAll("orderIds")
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (orderIds.length === 0) {
    return Response.json(
      { ok: false, error: "No orders selected" },
      { status: 400 },
    );
  }

  let invoiceNumbers: Record<string, string> | undefined;
  let packingSlipNumbers: Record<string, string> | undefined;
  let returnNumbers: Record<string, string> | undefined;

  if (intent === "convert-to-invoice") {
    invoiceNumbers = {};
    await Promise.all(
      orderIds.map(async (orderId) => {
        const gid = toOrderGid(orderId);
        const documentNumber = await markOrderInvoiced(session.shop, gid);
        invoiceNumbers![orderId] = documentNumber;
        invoiceNumbers![gid] = documentNumber;
      }),
    );
    invalidateSalesOrdersCache(session.shop);
  }

  if (intent === "convert-to-packing-slip") {
    packingSlipNumbers = {};
    await Promise.all(
      orderIds.map(async (orderId) => {
        const gid = toOrderGid(orderId);
        const documentNumber = await markOrderPackingSlip(session.shop, gid);
        packingSlipNumbers![orderId] = documentNumber;
        packingSlipNumbers![gid] = documentNumber;
      }),
    );
    invalidateSalesOrdersCache(session.shop);
  }

  if (intent === "convert-to-return") {
    returnNumbers = {};
    await Promise.all(
      orderIds.map(async (orderId) => {
        const gid = toOrderGid(orderId);
        const documentNumber = await markOrderReturn(session.shop, gid);
        returnNumbers![orderId] = documentNumber;
        returnNumbers![gid] = documentNumber;
      }),
    );
    invalidateSalesOrdersCache(session.shop);
  }

  if (intent === "create-credit-note") {
    const creditNoteNumbers: Record<string, string> = {};
    const reason = String(formData.get("reason") || "").trim();
    try {
      await Promise.all(
        orderIds.map(async (orderId) => {
          const gid = toOrderGid(orderId);
          const documentNumber = await markOrderCreditNote(session.shop, gid, {
            reason,
          });
          creditNoteNumbers[orderId] = documentNumber;
          creditNoteNumbers[gid] = documentNumber;
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create credit note";
      return Response.json({ ok: false, error: message }, { status: 400 });
    }
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      converted: orderIds.length,
      document: "credit-note" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
      creditNoteNumbers,
      reason,
    });
  }

  if (intent === "delete-invoice") {
    const gids = orderIds.map((orderId) => toOrderGid(orderId));
    const creditNoteGids = await getCreditNoteOrderGids(session.shop, gids);
    if (creditNoteGids.size > 0) {
      return Response.json(
        {
          ok: false,
          error:
            "Delete the credit note first. Invoices with a credit note cannot be deleted.",
        },
        { status: 400 },
      );
    }
    const deleted = await unmarkOrdersInvoiced(session.shop, gids);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-invoice" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
    });
  }

  if (intent === "delete-credit-note") {
    const deleted = await unmarkOrdersCreditNote(
      session.shop,
      orderIds.map((orderId) => toOrderGid(orderId)),
    );
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-credit-note" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
    });
  }

  if (intent === "delete-packing-slip") {
    const deleted = await unmarkOrdersPackingSlip(
      session.shop,
      orderIds.map((orderId) => toOrderGid(orderId)),
    );
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-packing-slip" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
    });
  }

  if (intent === "delete-return") {
    const deleted = await unmarkOrdersReturn(
      session.shop,
      orderIds.map((orderId) => toOrderGid(orderId)),
    );
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-return" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
    });
  }

  if (intent === "void-credit-note") {
    const voided = await voidOrdersCreditNote(
      session.shop,
      orderIds.map((orderId) => toOrderGid(orderId)),
    );
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      voided,
      document: "void-credit-note" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
    });
  }

  if (intent === "save-as-draft") {
    const draftNumbers: Record<string, string> = {};
    const gids = orderIds.map((orderId) => toOrderGid(orderId));
    const invoicedGids = await getInvoicedOrderGids(session.shop, gids);
    for (const orderId of orderIds) {
      const gid = toOrderGid(orderId);
      if (invoicedGids.has(gid)) {
        return Response.json(
          {
            ok: false,
            error: "Already invoiced orders cannot be saved as draft",
          },
          { status: 400 },
        );
      }
    }
    await Promise.all(
      orderIds.map(async (orderId) => {
        const gid = toOrderGid(orderId);
        const documentNumber = await markOrderDraft(session.shop, gid);
        draftNumbers[orderId] = documentNumber;
        draftNumbers[gid] = documentNumber;
      }),
    );
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      converted: orderIds.length,
      document: "draft" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
      draftNumbers,
    });
  }

  if (intent === "finalize-draft") {
    invoiceNumbers = {};
    await Promise.all(
      orderIds.map(async (orderId) => {
        const gid = toOrderGid(orderId);
        const documentNumber = await markOrderInvoiced(session.shop, gid);
        invoiceNumbers![orderId] = documentNumber;
        invoiceNumbers![gid] = documentNumber;
      }),
    );
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      converted: orderIds.length,
      document: "finalize-draft" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
      invoiceNumbers,
    });
  }

  if (intent === "delete-draft") {
    const deleted = await unmarkOrdersDraft(
      session.shop,
      orderIds.map((orderId) => toOrderGid(orderId)),
    );
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-draft" as const,
      orderId: orderIds[0] ?? null,
      orderIds,
    });
  }

  return Response.json({
    ok: true,
    converted: orderIds.length,
    document:
      intent === "convert-to-packing-slip"
        ? "packing-slip"
        : intent === "convert-to-return"
          ? "return"
          : "invoice",
    orderId: orderIds[0] ?? null,
    orderIds,
    ...(invoiceNumbers ? { invoiceNumbers } : {}),
    ...(packingSlipNumbers ? { packingSlipNumbers } : {}),
    ...(returnNumbers ? { returnNumbers } : {}),
  });
};

export const headers: HeadersFunction = (headersArgs) => {
  const headers = boundary.headers(headersArgs);
  headers.set("Cache-Control", "private, no-store");
  return headers;
};

const PENDING_INVOICES_KEY = "billoxi:pending-invoices";
const INVOICE_LIST_BUST_KEY = "billoxi:invoice-list-bust";

function readPendingInvoices(): SalesOrderRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(PENDING_INVOICES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SalesOrderRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingInvoices(rows: SalesOrderRow[]) {
  if (typeof window === "undefined") return;
  if (rows.length === 0) {
    window.sessionStorage.removeItem(PENDING_INVOICES_KEY);
    return;
  }
  window.sessionStorage.setItem(PENDING_INVOICES_KEY, JSON.stringify(rows));
}

function pushPendingInvoices(rows: SalesOrderRow[]) {
  if (rows.length === 0) return;
  const byId = new Map(readPendingInvoices().map((row) => [row.id, row]));
  for (const row of rows) byId.set(row.id, row);
  writePendingInvoices([...byId.values()]);
  window.sessionStorage.setItem(INVOICE_LIST_BUST_KEY, "1");
}

function removePendingInvoices(orderIds: Iterable<string>) {
  const remove = new Set(orderIds);
  writePendingInvoices(readPendingInvoices().filter((row) => !remove.has(row.id)));
}

function mergeInvoiceOrders(
  loaded: SalesOrderRow[],
  pending: SalesOrderRow[],
): SalesOrderRow[] {
  if (pending.length === 0) return loaded;
  const loadedIds = new Set(loaded.map((row) => row.id));
  const extras = pending.filter((row) => !loadedIds.has(row.id));
  return extras.length === 0 ? loaded : [...extras, ...loaded];
}

function ListPerfHelpers({
  listMode,
  busy,
  onChanged,
  resolvePath,
}: {
  listMode: string;
  busy: boolean;
  onChanged: () => void;
  resolvePath: (orderGid: string) => string;
}) {
  const pollFetcher = useFetcher<typeof action>();
  const prefetchFetcher = useFetcher();
  const handledPollDataRef = useRef<unknown>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const submitRef = useRef(pollFetcher.submit);
  submitRef.current = pollFetcher.submit;
  const prefetchStateRef = useRef(prefetchFetcher.state);
  prefetchStateRef.current = prefetchFetcher.state;
  const loadRef = useRef(prefetchFetcher.load);
  loadRef.current = prefetchFetcher.load;
  const lastPrefetchPathRef = useRef("");
  const resolvePathRef = useRef(resolvePath);
  resolvePathRef.current = resolvePath;

  useEffect(() => {
    if (listMode !== "sales-order") return;

    const POLL_MS = 45_000;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busyRef.current) return;
      const formData = new FormData();
      formData.set("intent", "reload-list");
      submitRef.current(formData, { method: "post" });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [listMode]);

  useEffect(() => {
    if (pollFetcher.state !== "idle" || !pollFetcher.data) return;
    if (handledPollDataRef.current === pollFetcher.data) return;
    handledPollDataRef.current = pollFetcher.data;
    const result = pollFetcher.data as {
      ok?: boolean;
      document?: string;
      changed?: boolean;
    };
    if (result.ok && result.document === "reload" && result.changed !== false) {
      onChanged();
    }
  }, [pollFetcher.data, pollFetcher.state, onChanged]);

  useEffect(() => {
    const root = document.querySelector(".sales-orders-page");
    if (!root) return;
    let hoverTimer: number | null = null;
    const clearHoverTimer = () => {
      if (hoverTimer != null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
      }
    };
    const onOver = (event: Event) => {
      const row = (event.target as HTMLElement | null)?.closest?.("tr[id]");
      const orderId = row?.getAttribute("id");
      if (!orderId) {
        clearHoverTimer();
        return;
      }
      const path = resolvePathRef.current(orderId);
      if (!path || lastPrefetchPathRef.current === path) return;
      if (prefetchStateRef.current !== "idle") return;
      clearHoverTimer();
      // Delay so scrolling the table does not fan out heavy detail loaders.
      hoverTimer = window.setTimeout(() => {
        hoverTimer = null;
        if (prefetchStateRef.current !== "idle") return;
        if (lastPrefetchPathRef.current === path) return;
        lastPrefetchPathRef.current = path;
        loadRef.current(path);
      }, 280);
    };
    const onLeave = (event: Event) => {
      const next = (event as PointerEvent).relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      clearHoverTimer();
    };
    root.addEventListener("pointerover", onOver);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      clearHoverTimer();
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return null;
}

export default function SalesOrderPage() {
  const data = useLoaderData<typeof loader>();
  const { language, t } = useAdminI18n();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const { currentPlanId } = useAppPlan();
  const { guard: planGuard, modal: planUpgradeModal } =
    usePlanUpgradeModal(currentPlanId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [, startTransition] = useTransition();
  const [queryValue, setQueryValue] = useState(data.query);
  const isInvoiceList = data.listMode === "invoice";
  const isCreditNoteList = data.listMode === "credit-note";
  const isPackingSlipList = data.listMode === "packing-slip";
  const isReturnList = data.listMode === "return";
  const isDraftList = data.listMode === "draft";
  const pageHeading = adminPageHeading(language, data.listMode);
  const isDocumentList =
    isInvoiceList ||
    isCreditNoteList ||
    isPackingSlipList ||
    isReturnList ||
    isDraftList;
  const indexColumns = useMemo(() => {
    const base = isReturnList
      ? RETURN_INDEX_COLUMNS
      : isPackingSlipList
        ? PACKING_SLIP_INDEX_COLUMNS
        : isCreditNoteList
          ? CREDIT_NOTE_INDEX_COLUMNS
          : isDraftList
            ? DRAFT_INDEX_COLUMNS
            : isInvoiceList
              ? INVOICE_INDEX_COLUMNS
              : SALES_ORDER_INDEX_COLUMNS;
    return base.map((col) => ({
      ...col,
      label: adminIndexColumnLabel(language, data.listMode, col.id),
    }));
  }, [
    data.listMode,
    isCreditNoteList,
    isDraftList,
    isInvoiceList,
    isPackingSlipList,
    isReturnList,
    language,
  ]);

  const columnsStorageKey = isReturnList
    ? "billoxi.index-columns.return"
    : isPackingSlipList
      ? "billoxi.index-columns.packing-slip"
      : isCreditNoteList
        ? "billoxi.index-columns.credit-note"
        : isDraftList
          ? "billoxi:draft-index-columns"
          : isInvoiceList
            ? "billoxi.index-columns.invoice"
            : "billoxi.index-columns.sales-order";
  const { visibleColumns, menu: columnsMenu } = useIndexColumns(
    columnsStorageKey,
    indexColumns,
  );
  const [columnsMountNode, setColumnsMountNode] =
    useState<HTMLElement | null>(null);
  const { mode, setMode } = useSetIndexFiltersMode(
    data.query || data.paymentStatus || data.fulfillmentStatus
      ? IndexFiltersMode.Filtering
      : IndexFiltersMode.Default,
  );
  const [orders, setOrders] = useState(() =>
    isInvoiceList
      ? mergeInvoiceOrders(data.orders, readPendingInvoices())
      : data.orders,
  );
  const pageRef = useRef<HTMLDivElement>(null);
  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(orders);

  // Polaris Tabs/BulkActions only remasure on window resize; admin iframe
  // often paints with width 0 first ("More views" / missing bulk buttons).
  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;

    let frame = 0;
    const remeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        // Second tick — bulk measurer sometimes still has width 0 on first paint.
        window.setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, 50);
      });
    };

    const observer = new ResizeObserver(remeasure);
    observer.observe(node);
    remeasure();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selectedResources.length]);

  useEffect(() => {
    let frame = 0;
    const findMount = () => {
      const actionWrap = document.querySelector(
        ".sales-orders-page .Polaris-IndexFilters__ActionWrap",
      );
      if (!(actionWrap instanceof HTMLElement)) {
        frame = window.requestAnimationFrame(findMount);
        return;
      }

      let host = actionWrap.querySelector(
        ".sales-orders-columns-mount-host",
      );
      if (!(host instanceof HTMLElement)) {
        host = document.createElement("div");
        host.className = "sales-orders-columns-mount-host";
        const last = actionWrap.lastElementChild;
        if (last) actionWrap.insertBefore(host, last);
        else actionWrap.appendChild(host);
      }
      setColumnsMountNode(host);
    };
    findMount();
    return () => window.cancelAnimationFrame(frame);
  }, [isInvoiceList, isCreditNoteList, isDraftList, mode]);

  useEffect(() => {
    if (isInvoiceList) {
      const pending = readPendingInvoices();
      const loadedIds = new Set(data.orders.map((row) => row.id));
      const stillPending = pending.filter((row) => !loadedIds.has(row.id));
      writePendingInvoices(stillPending);
      setOrders(mergeInvoiceOrders(data.orders, stillPending));
      return;
    }
    setOrders(data.orders);
  }, [data.orders, isInvoiceList]);

  useEffect(() => {
    if (!isInvoiceList) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(INVOICE_LIST_BUST_KEY) !== "1") return;
    window.sessionStorage.removeItem(INVOICE_LIST_BUST_KEY);
    revalidator.revalidate();
  }, [isInvoiceList, revalidator]);

  useEffect(() => {
    const localTemplate = window.localStorage.getItem(
      SALES_ORDER_TEMPLATE_STORAGE_KEY,
    );
    const resolvedLocal = resolveSalesOrderTemplateId(localTemplate);

    // If Templates "Active" existed only in the browser, persist it for this shop.
    if (
      !data.hasSelectedTemplate &&
      localTemplate &&
      resolvedLocal !== DEFAULT_SALES_ORDER_TEMPLATE_ID
    ) {
      window.localStorage.setItem(
        SALES_ORDER_TEMPLATE_STORAGE_KEY,
        resolvedLocal,
      );
      const formData = new FormData();
      formData.set("intent", "select-template");
      formData.set("documentType", "sales-order");
      formData.set("templateId", resolvedLocal);
      void fetch("/app/templates", { method: "POST", body: formData }).then(
        (response) => {
          if (response.ok) revalidator.revalidate();
        },
      );
      return;
    }

    window.localStorage.setItem(
      SALES_ORDER_TEMPLATE_STORAGE_KEY,
      data.selectedTemplateId,
    );
  }, [data.hasSelectedTemplate, data.selectedTemplateId, revalidator]);

  const availableViews = data.availableViews?.length
    ? data.availableViews
    : [0];
  const visibleViews = useMemo(
    () =>
      availableViews
        .map((viewIndex) => ({
          viewIndex,
          ...SALES_ORDER_VIEWS[viewIndex],
        }))
        .filter((view) => Boolean(view.label)),
    [availableViews],
  );

  const convertFetcher = useFetcher<typeof action>();
  const sendFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    to?: string;
    attachedPdf?: boolean;
  }>();
  const isConverting = convertFetcher.state !== "idle";
  const isSendingEmail = sendFetcher.state !== "idle";
  const handledConvertDataRef = useRef<unknown>(null);
  const handledSendDataRef = useRef<unknown>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [quickActionOrderId, setQuickActionOrderId] = useState<string | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<BulkConfirmAction | null>(
    null,
  );
  const [creditReason, setCreditReason] = useState("");

  const isBusy =
    isConverting ||
    isDownloadingZip ||
    isSendingEmail ||
    Boolean(quickActionOrderId);

  const handleListChanged = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

  const resolveOrderPath = useCallback((orderGid: string) => {
    const numericId = orderGid.includes("/")
      ? orderGid.split("/").pop() || orderGid
      : orderGid;
    if (isCreditNoteList) {
      const params = new URLSearchParams({
        template:
          data.creditNoteTemplateId || "credit-standard",
      });
      return `/app/credit-note/${encodeURIComponent(numericId)}?${params.toString()}`;
    }
    if (isPackingSlipList) {
      const params = new URLSearchParams({
        template:
          data.packingSlipTemplateId || "packing-standard",
      });
      return `/app/packing-slip/${encodeURIComponent(numericId)}?${params.toString()}`;
    }
    if (isReturnList) {
      const params = new URLSearchParams({
        template: data.returnTemplateId || "return-professional",
      });
      return `/app/return/${encodeURIComponent(numericId)}?${params.toString()}`;
    }
    if (isDraftList) {
      const params = new URLSearchParams({
        template:
          data.invoiceTemplateId || "draft-professional",
      });
      return `/app/draft/${encodeURIComponent(numericId)}?${params.toString()}`;
    }
    if (isInvoiceList) {
      const params = new URLSearchParams({
        template:
          data.invoiceTemplateId || "invoice-professional",
      });
      return `/app/invoice/${encodeURIComponent(numericId)}?${params.toString()}`;
    }
    const params = new URLSearchParams({
      template: getSelectedTemplateId(
        data.hasSelectedTemplate ? data.selectedTemplateId : null,
      ),
    });
    return `/app/sales-order/${encodeURIComponent(numericId)}?${params.toString()}`;
  }, [
    data.creditNoteTemplateId,
    data.hasSelectedTemplate,
    data.invoiceTemplateId,
    data.packingSlipTemplateId,
    data.returnTemplateId,
    data.selectedTemplateId,
    isCreditNoteList,
    isDraftList,
    isInvoiceList,
    isPackingSlipList,
    isReturnList,
  ]);

  const openOrderDocument = useCallback(
    (orderGid: string) => {
      navigate(resolveOrderPath(orderGid));
    },
    [navigate, resolveOrderPath],
  );

  const activeTemplateId = useCallback(() => {
    if (isCreditNoteList) {
      return data.creditNoteTemplateId || "credit-standard";
    }
    if (isPackingSlipList) {
      return data.packingSlipTemplateId || "packing-standard";
    }
    if (isReturnList) {
      return data.returnTemplateId || "return-professional";
    }
    if (isInvoiceList || isDraftList) {
      return data.invoiceTemplateId || (isDraftList ? "draft-professional" : "invoice-professional");
    }
    return getSelectedTemplateId(
      data.hasSelectedTemplate ? data.selectedTemplateId : null,
    );
  }, [
    data.creditNoteTemplateId,
    data.hasSelectedTemplate,
    data.invoiceTemplateId,
    data.packingSlipTemplateId,
    data.returnTemplateId,
    data.selectedTemplateId,
    isCreditNoteList,
    isDraftList,
    isInvoiceList,
    isPackingSlipList,
    isReturnList,
  ]);

  const activeDocumentKind = isDraftList
    ? "draft"
    : isInvoiceList
      ? "invoice"
      : isCreditNoteList
        ? "credit-note"
        : isPackingSlipList
          ? "packing-slip"
          : isReturnList
            ? "return"
            : "sales-order";

  const runQuickDownload = useCallback(
    async (orderId: string) => {
      if (isBusy) return;
      setQuickActionOrderId(orderId);
      try {
        const { downloadSalesOrderDomPdfFromList } = await import(
          "../sales-order-dom-export.client"
        );
        await downloadSalesOrderDomPdfFromList({
          orderId,
          templateId: activeTemplateId(),
          documentKind: activeDocumentKind,
        });
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show("PDF downloaded");
        }
      } catch (error) {
        console.error("Quick PDF download failed:", error);
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(
            error instanceof Error ? error.message : "Failed to download PDF",
            { isError: true },
          );
        }
      } finally {
        setQuickActionOrderId(null);
      }
    },
    [activeDocumentKind, activeTemplateId, isBusy, orders],
  );

  const runQuickPrint = useCallback(
    async (orderId: string) => {
      if (isBusy) return;
      setQuickActionOrderId(orderId);
      try {
        const { printSalesOrderDomPdfFromList } = await import(
          "../sales-order-dom-export.client"
        );
        await printSalesOrderDomPdfFromList({
          orderId,
          templateId: activeTemplateId(),
          documentKind: activeDocumentKind,
        });
      } catch (error) {
        console.error("Quick PDF print failed:", error);
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(
            error instanceof Error ? error.message : "Failed to print PDF",
            { isError: true },
          );
        }
      } finally {
        setQuickActionOrderId(null);
      }
    },
    [activeDocumentKind, activeTemplateId, isBusy, orders],
  );

  const runQuickSend = useCallback(
    async (order: {
      id: string;
      name: string;
      email: string;
      total: string;
      customer: string;
      invoiceNumber?: string;
      salesOrderNumber?: string;
      creditNoteNumber?: string;
      packingSlipNumber?: string;
      returnNumber?: string;
      draftNumber?: string;
    }) => {
      const email = order.email.trim();
      if (!email) {
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show("No customer email on this order", {
            isError: true,
          });
        }
        return;
      }
      if (!data.smtpReady) {
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(SMTP_REQUIRED_NOTICE, { isError: true });
        }
        return;
      }
      if (isBusy) return;

      const documentKind = isCreditNoteList
        ? "credit-note"
        : isPackingSlipList
          ? "packing-slip"
          : isReturnList
            ? "return"
            : isDraftList
              ? "draft"
              : isInvoiceList
                ? "invoice"
                : "sales-order";
      const docName = isCreditNoteList
        ? order.creditNoteNumber || order.name
        : isPackingSlipList
          ? order.packingSlipNumber || order.name
          : isReturnList
            ? order.returnNumber || order.name
            : isDraftList
              ? order.draftNumber || order.name
              : isInvoiceList
                ? order.invoiceNumber || order.salesOrderNumber || order.name
                : order.salesOrderNumber || order.name;

      setQuickActionOrderId(order.id);
      try {
        const { buildSalesOrderDomPdfBlobFromList } = await import(
          "../sales-order-dom-export.client"
        );
        const { blob, fileName } = await buildSalesOrderDomPdfBlobFromList({
          orderId: order.id,
          templateId: activeTemplateId(),
          documentKind,
        });

        const formData = new FormData();
        formData.set("orderId", order.id);
        formData.set("documentKind", documentKind);
        formData.set("toEmail", email);
        formData.set("documentNumber", docName);
        formData.set("orderName", order.name);
        formData.set("customerName", order.customer || "");
        formData.set("total", order.total);
        formData.set("currency", "");
        formData.set("templateId", activeTemplateId());
        formData.append(
          "pdf",
          new File([blob], fileName, { type: "application/pdf" }),
        );

        sendFetcher.submit(formData, {
          method: "post",
          action: "/app/send-document-email",
          encType: "multipart/form-data",
        });
      } catch (error) {
        console.error("Email PDF prepare failed:", error);
        setQuickActionOrderId(null);
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show("Could not prepare PDF for email", {
            isError: true,
          });
        }
      }
    },
    [
      activeTemplateId,
      data.smtpReady,
      isBusy,
      isCreditNoteList,
      isDraftList,
      isInvoiceList,
      isPackingSlipList,
      isReturnList,
      sendFetcher,
    ],
  );

  useEffect(() => {
    if (sendFetcher.state !== "idle") return;
    if (quickActionOrderId && sendFetcher.data) {
      setQuickActionOrderId(null);
    }
    if (!sendFetcher.data) return;
    if (handledSendDataRef.current === sendFetcher.data) return;
    handledSendDataRef.current = sendFetcher.data;

    const result = sendFetcher.data;
    if (!result.ok) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(result.error || "Failed to send email", {
          isError: true,
        });
      }
      return;
    }

    if (typeof shopify !== "undefined" && shopify.toast) {
      shopify.toast.show(
        result.attachedPdf
          ? `Email sent to ${result.to} with PDF attached`
          : `Email sent to ${result.to}`,
      );
    }
    const emailedOrderId =
      typeof result.orderId === "string" ? result.orderId : "";
    if (emailedOrderId) {
      setOrders((prev) =>
        prev.map((row) =>
          row.id === emailedOrderId ? { ...row, emailed: true } : row,
        ),
      );
    }
  }, [quickActionOrderId, sendFetcher.data, sendFetcher.state]);

  const handleConvertToInvoice = useCallback(() => {
    if (selectedResources.length !== 1 || isConverting) return;
    const order = orders.find((row) => row.id === selectedResources[0]);
    const status = order?.paymentStatus.toLowerCase() ?? "";
    if (status === "voided" || status.includes("cancel")) return;
    const formData = new FormData();
    formData.set("intent", "convert-to-invoice");
    formData.append("orderIds", selectedResources[0]!);
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, orders, selectedResources]);

  const handleConvertToPackingSlip = useCallback(() => {
    if (selectedResources.length !== 1 || isConverting) return;
    const order = orders.find((row) => row.id === selectedResources[0]);
    const status = order?.paymentStatus.toLowerCase() ?? "";
    if (status === "voided" || status.includes("cancel")) return;
    const formData = new FormData();
    formData.set("intent", "convert-to-packing-slip");
    formData.append("orderIds", selectedResources[0]!);
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, orders, selectedResources]);

  const handleConvertToReturn = useCallback(() => {
    if (selectedResources.length !== 1 || isConverting) return;
    const order = orders.find((row) => row.id === selectedResources[0]);
    if (!order || order.returnSlip) return;
    const key = (order.paymentStatusKey || "").toUpperCase();
    if (key !== "REFUNDED" && key !== "PARTIALLY_REFUNDED") return;
    const status = order.paymentStatus.toLowerCase();
    if (status === "voided" || status.includes("cancel")) return;
    const formData = new FormData();
    formData.set("intent", "convert-to-return");
    formData.append("orderIds", selectedResources[0]!);
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, orders, selectedResources]);

  const handleCreateCreditNote = useCallback(() => {
    if (selectedResources.length !== 1 || isConverting) return;
    const order = orders.find((row) => row.id === selectedResources[0]);
    if (!order) return;
    if (order.creditNote && !order.creditNoteVoided) return;
    const status = order.paymentStatus.toLowerCase();
    if (status === "voided" || status.includes("cancel")) return;
    const formData = new FormData();
    formData.set("intent", "create-credit-note");
    formData.append("orderIds", selectedResources[0]!);
    if (creditReason.trim()) formData.set("reason", creditReason.trim());
    convertFetcher.submit(formData, { method: "post" });
    setCreditReason("");
  }, [
    convertFetcher,
    creditReason,
    isConverting,
    orders,
    selectedResources,
  ]);

  const handleDeleteInvoices = useCallback(() => {
    if (selectedResources.length === 0 || isConverting) return;
    const blocked = selectedResources.some((id) => {
      const order = orders.find((row) => row.id === id);
      return Boolean(order?.creditNote);
    });
    if (blocked) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(
          "Delete the credit note first. Invoices with a credit note cannot be deleted.",
          { isError: true },
        );
      }
      return;
    }
    const formData = new FormData();
    formData.set("intent", "delete-invoice");
    for (const orderId of selectedResources) {
      formData.append("orderIds", orderId);
    }
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, orders, selectedResources]);

  const handleDeleteCreditNotes = useCallback(() => {
    if (selectedResources.length === 0 || isConverting) return;
    const formData = new FormData();
    formData.set("intent", "delete-credit-note");
    for (const orderId of selectedResources) {
      formData.append("orderIds", orderId);
    }
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, selectedResources]);

  const handleDeletePackingSlips = useCallback(() => {
    if (selectedResources.length === 0 || isConverting) return;
    const formData = new FormData();
    formData.set("intent", "delete-packing-slip");
    for (const orderId of selectedResources) {
      formData.append("orderIds", orderId);
    }
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, selectedResources]);

  const handleDeleteReturns = useCallback(() => {
    if (selectedResources.length === 0 || isConverting) return;
    const formData = new FormData();
    formData.set("intent", "delete-return");
    for (const orderId of selectedResources) {
      formData.append("orderIds", orderId);
    }
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, selectedResources]);

  const handleVoidCreditNotes = useCallback(() => {
    if (selectedResources.length === 0 || isConverting) return;
    const formData = new FormData();
    formData.set("intent", "void-credit-note");
    for (const orderId of selectedResources) {
      formData.append("orderIds", orderId);
    }
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, selectedResources]);

  const handleSaveAsDraft = useCallback(() => {
    if (selectedResources.length !== 1 || isConverting) return;
    const order = orders.find((row) => row.id === selectedResources[0]);
    if (!order) return;
    const status = order.paymentStatus.toLowerCase();
    if (status === "voided" || status.includes("cancel")) return;
    if (order.invoiced || order.draft) return;
    const formData = new FormData();
    formData.set("intent", "save-as-draft");
    formData.append("orderIds", selectedResources[0]!);
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, orders, selectedResources]);

  const handleFinalizeDraft = useCallback(() => {
    if (selectedResources.length !== 1 || isConverting) return;
    const order = orders.find((row) => row.id === selectedResources[0]);
    const status = order?.paymentStatus.toLowerCase() ?? "";
    if (status === "voided" || status.includes("cancel")) return;
    const formData = new FormData();
    formData.set("intent", "finalize-draft");
    formData.append("orderIds", selectedResources[0]!);
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, orders, selectedResources]);

  const handleDeleteDrafts = useCallback(() => {
    if (selectedResources.length === 0 || isConverting) return;
    const formData = new FormData();
    formData.set("intent", "delete-draft");
    for (const orderId of selectedResources) {
      formData.append("orderIds", orderId);
    }
    convertFetcher.submit(formData, { method: "post" });
  }, [convertFetcher, isConverting, selectedResources]);

  const handleBulkDownloadPdf = useCallback(async () => {
    if (selectedResources.length === 0 || isBusy) return;
    if (selectedResources.length === 1) {
      await runQuickDownload(selectedResources[0]!);
      return;
    }

    setIsDownloadingZip(true);
    try {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(
          `Preparing ${selectedResources.length} PDFs…`,
        );
      }
      const { downloadSalesOrdersDomPdfZipFromList } = await import(
        "../sales-order-dom-export.client"
      );
      const { count } = await downloadSalesOrdersDomPdfZipFromList({
        orderIds: selectedResources,
        templateId: activeTemplateId(),
        documentKind: activeDocumentKind,
        onProgress: (done, total) => {
          if (done === 0 || done === total) return;
          if (typeof shopify !== "undefined" && shopify.toast && done % 3 === 0) {
            shopify.toast.show(`Building PDFs ${done}/${total}…`);
          }
        },
      });

      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(`Downloaded ${count} PDFs as zip`);
      }
    } catch (error) {
      console.error("Bulk PDF zip download failed:", error);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(
          error instanceof Error ? error.message : "Failed to download PDF zip",
          { isError: true },
        );
      }
    } finally {
      setIsDownloadingZip(false);
    }
  }, [
    activeDocumentKind,
    activeTemplateId,
    isBusy,
    runQuickDownload,
    selectedResources,
  ]);

  const handleBulkSendEmail = useCallback(() => {
    if (selectedResources.length === 0) return;
    if (selectedResources.length > 1) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show("Select one order to send email", { isError: true });
      }
      return;
    }
    const order = orders.find((row) => row.id === selectedResources[0]);
    if (!order) return;
    const status = order.paymentStatus.toLowerCase();
    if (status === "voided" || status.includes("cancel")) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show("Cannot email a voided order", { isError: true });
      }
      return;
    }
    runQuickSend(order);
  }, [orders, runQuickSend, selectedResources]);

  const downloadPdfLabel =
    selectedResources.length <= 1 ? "Download PDF" : "Download zip";

  const confirmCopy = confirmAction
    ? {
        ...BULK_CONFIRM_COPY[confirmAction],
        message:
          confirmAction === "download" && selectedResources.length > 1
            ? `Are you sure you want to download ${selectedResources.length} ${
                isCreditNoteList
                  ? "credit note"
                  : isPackingSlipList
                    ? "packing slip"
                    : isReturnList
                      ? "return"
                      : isDraftList
                        ? "draft"
                        : isInvoiceList
                          ? "invoice"
                          : "sales order"
              } PDFs as a zip?`
            : confirmAction === "download" && isCreditNoteList
              ? "Are you sure you want to download the selected credit note PDF?"
              : confirmAction === "download" && isPackingSlipList
                ? "Are you sure you want to download the selected packing slip PDF?"
                : confirmAction === "download" && isReturnList
                  ? "Are you sure you want to download the selected return PDF?"
                  : confirmAction === "download" && isDraftList
                    ? "Are you sure you want to download the selected draft PDF?"
                    : confirmAction === "download" && isInvoiceList
                      ? "Are you sure you want to download the selected invoice PDF?"
                      : confirmAction === "email" && isCreditNoteList
                        ? "Are you sure you want to open an email draft for this credit note?"
                        : confirmAction === "email" && isPackingSlipList
                          ? "Are you sure you want to open an email draft for this packing slip?"
                          : confirmAction === "email" && isReturnList
                            ? "Are you sure you want to open an email draft for this return?"
                            : confirmAction === "email" && isDraftList
                              ? "Are you sure you want to open an email draft for this draft invoice?"
                              : confirmAction === "email" && isInvoiceList
                                ? "Are you sure you want to open an email draft for this invoice?"
                                : confirmAction === "delete-invoice" &&
                                    selectedResources.length > 1
                                  ? `Are you sure you want to delete ${selectedResources.length} invoices? Sales orders will stay; only the invoice records are removed.`
                                  : confirmAction === "delete-credit-note" &&
                                      selectedResources.length > 1
                                    ? `Are you sure you want to delete ${selectedResources.length} credit notes? Invoices and sales orders will stay.`
                                    : confirmAction === "delete-packing-slip" &&
                                        selectedResources.length > 1
                                      ? `Are you sure you want to delete ${selectedResources.length} packing slips? Sales orders will stay.`
                                      : confirmAction === "delete-return" &&
                                          selectedResources.length > 1
                                        ? `Are you sure you want to delete ${selectedResources.length} returns? Sales orders will stay.`
                                        : confirmAction === "delete-draft" &&
                                            selectedResources.length > 1
                                          ? `Are you sure you want to delete ${selectedResources.length} drafts? Sales orders will stay.`
                                          : BULK_CONFIRM_COPY[confirmAction].message,
        confirm:
          confirmAction === "download" && selectedResources.length > 1
            ? "Download zip"
            : BULK_CONFIRM_COPY[confirmAction].confirm,
      }
    : null;

  const handleConfirmBulkAction = useCallback(() => {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;
    if (action === "invoice") handleConvertToInvoice();
    else if (action === "packing-slip") handleConvertToPackingSlip();
    else if (action === "return") handleConvertToReturn();
    else if (action === "credit-note") handleCreateCreditNote();
    else if (action === "save-as-draft") handleSaveAsDraft();
    else if (action === "finalize-draft") handleFinalizeDraft();
    else if (action === "email") handleBulkSendEmail();
    else if (action === "delete-invoice") handleDeleteInvoices();
    else if (action === "delete-credit-note") handleDeleteCreditNotes();
    else if (action === "delete-packing-slip") handleDeletePackingSlips();
    else if (action === "delete-return") handleDeleteReturns();
    else if (action === "delete-draft") handleDeleteDrafts();
    else if (action === "void-credit-note") handleVoidCreditNotes();
    else void handleBulkDownloadPdf();
  }, [
    confirmAction,
    handleBulkDownloadPdf,
    handleBulkSendEmail,
    handleConvertToInvoice,
    handleConvertToPackingSlip,
    handleConvertToReturn,
    handleCreateCreditNote,
    handleDeleteCreditNotes,
    handleDeleteDrafts,
    handleDeleteInvoices,
    handleDeletePackingSlips,
    handleDeleteReturns,
    handleFinalizeDraft,
    handleSaveAsDraft,
    handleVoidCreditNotes,
  ]);

  const selectedOrders = useMemo(
    () => orders.filter((order) => selectedResources.includes(order.id)),
    [orders, selectedResources],
  );
  const selectedOrder =
    selectedResources.length === 1 ? selectedOrders[0] : undefined;
  const hasCancelledSelected = selectedOrders.some((order) => {
    const status = order.paymentStatus.toLowerCase();
    return status === "voided" || status.includes("cancel");
  });
  const canConvertToInvoice =
    !isInvoiceList &&
    !isPackingSlipList &&
    !isReturnList &&
    !isCreditNoteList &&
    !isDraftList &&
    selectedResources.length === 1 &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    !selectedOrder!.invoiced;
  const canConvertToPackingSlip =
    !isInvoiceList &&
    !isPackingSlipList &&
    !isReturnList &&
    !isCreditNoteList &&
    !isDraftList &&
    selectedResources.length === 1 &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    !selectedOrder!.packingSlip;
  const selectedPaymentKey = (
    selectedOrder?.paymentStatusKey || ""
  ).toUpperCase();
  const canConvertToReturn =
    !isInvoiceList &&
    !isPackingSlipList &&
    !isReturnList &&
    !isCreditNoteList &&
    !isDraftList &&
    selectedResources.length === 1 &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    !selectedOrder!.returnSlip &&
    (selectedPaymentKey === "REFUNDED" ||
      selectedPaymentKey === "PARTIALLY_REFUNDED");
  const canSaveAsDraft =
    !isInvoiceList &&
    !isPackingSlipList &&
    !isReturnList &&
    !isCreditNoteList &&
    !isDraftList &&
    selectedResources.length === 1 &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    !selectedOrder!.invoiced &&
    !selectedOrder!.draft;
  const canFinalizeDraft =
    isDraftList &&
    selectedResources.length === 1 &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected;
  const canDeleteDraft = isDraftList && selectedResources.length > 0;
  const canCreateCreditNote =
    isInvoiceList &&
    selectedResources.length === 1 &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    (!selectedOrder!.creditNote || selectedOrder!.creditNoteVoided);
  const canDeleteInvoice =
    isInvoiceList &&
    selectedResources.length > 0 &&
    selectedOrders.every((order) => !order.creditNote);
  const canVoidCreditNote =
    isCreditNoteList &&
    selectedResources.length > 0 &&
    selectedOrders.some((order) => order.creditNote && !order.creditNoteVoided);
  const canSendEmail = !hasCancelledSelected;

  const promotedBulkActions = useMemo(() => {
    if (selectedResources.length === 0) return [];

    const isBulkSelection = selectedResources.length > 1;
    const bulkLocked =
      isBulkSelection && !planHasCapability(currentPlanId, "bulkActions");
    const wrapBulk = (run: () => void) => () => {
      if (isBulkSelection) {
        planGuard("bulkActions", run);
        return;
      }
      run();
    };

    const actions: Array<{
      content: string;
      onAction: () => void;
      disabled?: boolean;
      destructive?: boolean;
    }> = [];

    if (isCreditNoteList) {
      actions.push({
        content: bulkLocked
          ? `${t("list.actionSendEmail")} (PREMIUM)`
          : t("list.actionSendEmail"),
        onAction: wrapBulk(() => setConfirmAction("email")),
        disabled: isBusy || !canSendEmail,
      });
      actions.push({
        content: bulkLocked
          ? `${downloadPdfLabel} (PREMIUM)`
          : downloadPdfLabel,
        onAction: wrapBulk(() => setConfirmAction("download")),
        disabled: isBusy,
      });
      actions.push({
        content: "Void",
        onAction: () => setConfirmAction("void-credit-note"),
        disabled: isBusy || !canVoidCreditNote,
      });
      actions.push({
        content: t("common.delete"),
        onAction: () => setConfirmAction("delete-credit-note"),
        disabled: isBusy,
        destructive: true,
      });
      return actions;
    }

    if (isPackingSlipList) {
      actions.push({
        content: bulkLocked
          ? `${t("list.actionSendEmail")} (PREMIUM)`
          : t("list.actionSendEmail"),
        onAction: wrapBulk(() => setConfirmAction("email")),
        disabled: isBusy || !canSendEmail,
      });
      actions.push({
        content: bulkLocked
          ? `${downloadPdfLabel} (PREMIUM)`
          : downloadPdfLabel,
        onAction: wrapBulk(() => setConfirmAction("download")),
        disabled: isBusy,
      });
      actions.push({
        content: t("common.delete"),
        onAction: () => setConfirmAction("delete-packing-slip"),
        disabled: isBusy,
        destructive: true,
      });
      return actions;
    }

    if (isReturnList) {
      actions.push({
        content: bulkLocked
          ? `${t("list.actionSendEmail")} (PREMIUM)`
          : t("list.actionSendEmail"),
        onAction: wrapBulk(() => setConfirmAction("email")),
        disabled: isBusy || !canSendEmail,
      });
      actions.push({
        content: bulkLocked
          ? `${downloadPdfLabel} (PREMIUM)`
          : downloadPdfLabel,
        onAction: wrapBulk(() => setConfirmAction("download")),
        disabled: isBusy,
      });
      actions.push({
        content: t("common.delete"),
        onAction: () => setConfirmAction("delete-return"),
        disabled: isBusy,
        destructive: true,
      });
      return actions;
    }

    if (isDraftList) {
      actions.push({
        content: "Open in Shopify",
        onAction: () => {
          const order = selectedOrders[0];
          if (order) openOrderDocument(order.id);
        },
        disabled: isBusy || selectedResources.length !== 1,
      });
      return actions;
    }

    if (!isInvoiceList) {
      actions.push({
        content: bulkLocked
          ? `${t("detail.convertToInvoice")} (PREMIUM)`
          : t("detail.convertToInvoice"),
        onAction: wrapBulk(() => setConfirmAction("invoice")),
        disabled: isBusy || !canConvertToInvoice,
      });
      actions.push({
        content: bulkLocked
          ? `${t("detail.convertToPackingSlip")} (PREMIUM)`
          : t("detail.convertToPackingSlip"),
        onAction: wrapBulk(() => setConfirmAction("packing-slip")),
        disabled: isBusy || !canConvertToPackingSlip,
      });
      if (canConvertToReturn) {
        actions.push({
          content: bulkLocked
            ? `${t("detail.convertToReturn")} (PREMIUM)`
            : t("detail.convertToReturn"),
          onAction: wrapBulk(() => setConfirmAction("return")),
          disabled: isBusy,
        });
      }
      actions.push({
        content: bulkLocked
          ? `${t("list.actionSendEmail")} (PREMIUM)`
          : t("list.actionSendEmail"),
        onAction: wrapBulk(() => setConfirmAction("email")),
        disabled: isBusy || !canSendEmail,
      });
      actions.push({
        content: bulkLocked
          ? `${downloadPdfLabel} (PREMIUM)`
          : downloadPdfLabel,
        onAction: wrapBulk(() => setConfirmAction("download")),
        disabled: isBusy,
      });
      return actions;
    }

    actions.push({
      content: bulkLocked
        ? "Create credit note (PREMIUM)"
        : "Create credit note",
      onAction: wrapBulk(() => setConfirmAction("credit-note")),
      disabled: isBusy || !canCreateCreditNote,
    });
    actions.push({
      content: bulkLocked
        ? `${t("list.actionSendEmail")} (PREMIUM)`
        : t("list.actionSendEmail"),
      onAction: wrapBulk(() => setConfirmAction("email")),
      disabled: isBusy || !canSendEmail,
    });
    actions.push({
      content: bulkLocked
        ? `${downloadPdfLabel} (PREMIUM)`
        : downloadPdfLabel,
      onAction: wrapBulk(() => setConfirmAction("download")),
      disabled: isBusy,
    });
    actions.push({
      content: t("common.delete"),
      onAction: () => setConfirmAction("delete-invoice"),
      disabled: isBusy || !canDeleteInvoice,
      destructive: true,
    });

    return actions;
  }, [
    canCreateCreditNote,
    canConvertToInvoice,
    canConvertToPackingSlip,
    canConvertToReturn,
    canDeleteDraft,
    canDeleteInvoice,
    canFinalizeDraft,
    canSaveAsDraft,
    canSendEmail,
    canVoidCreditNote,
    currentPlanId,
    downloadPdfLabel,
    isBusy,
    isCreditNoteList,
    isDraftList,
    isInvoiceList,
    isPackingSlipList,
    isReturnList,
    openOrderDocument,
    planGuard,
    selectedOrders,
    selectedResources.length,
    t,
  ]);

  useEffect(() => {
    if (convertFetcher.state !== "idle" || !convertFetcher.data) return;
    if (handledConvertDataRef.current === convertFetcher.data) return;
    handledConvertDataRef.current = convertFetcher.data;

    const result = convertFetcher.data as {
      ok?: boolean;
      converted?: number;
      deleted?: number;
      document?:
        | "invoice"
        | "packing-slip"
        | "return"
        | "credit-note"
        | "draft"
        | "finalize-draft"
        | "delete-invoice"
        | "delete-credit-note"
        | "delete-packing-slip"
        | "delete-return"
        | "delete-draft"
        | "void-credit-note"
        | "reload";
      orderId?: string | null;
      orderIds?: string[];
      invoiceNumbers?: Record<string, string>;
      packingSlipNumbers?: Record<string, string>;
      returnNumbers?: Record<string, string>;
      creditNoteNumbers?: Record<string, string>;
      draftNumbers?: Record<string, string>;
      reason?: string;
      voided?: number;
      error?: string;
    };
    if (!result.ok) {
      if (result.error && typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(String(result.error), { isError: true });
      }
      return;
    }

    if (result.document === "reload") {
      revalidator.revalidate();
      return;
    }

    if (typeof shopify !== "undefined" && shopify.toast) {
      if (result.document === "delete-invoice") {
        const count = result.deleted ?? 1;
        shopify.toast.show(
          count > 1 ? `Deleted ${count} invoices` : "Invoice deleted",
        );
      } else if (result.document === "delete-credit-note") {
        const count = result.deleted ?? 1;
        shopify.toast.show(
          count > 1
            ? `Deleted ${count} credit notes`
            : "Credit note deleted",
        );
      } else if (result.document === "delete-packing-slip") {
        const count = result.deleted ?? 1;
        shopify.toast.show(
          count > 1
            ? `Deleted ${count} packing slips`
            : "Packing slip deleted",
        );
      } else if (result.document === "delete-return") {
        const count = result.deleted ?? 1;
        shopify.toast.show(
          count > 1 ? `Deleted ${count} returns` : "Return deleted",
        );
      } else if (result.document === "delete-draft") {
        const count = result.deleted ?? 1;
        shopify.toast.show(
          count > 1 ? `Deleted ${count} drafts` : "Draft deleted",
        );
      } else if (result.document === "void-credit-note") {
        const count = result.voided ?? 1;
        shopify.toast.show(
          count > 1 ? `Voided ${count} credit notes` : "Credit note voided",
        );
      } else if (result.document === "packing-slip") {
        shopify.toast.show("Converted to packing slip");
      } else if (result.document === "return") {
        shopify.toast.show("Converted to return");
      } else if (result.document === "credit-note") {
        shopify.toast.show("Credit note created");
      } else if (result.document === "draft") {
        shopify.toast.show("Saved as draft");
      } else if (result.document === "finalize-draft") {
        shopify.toast.show("Converted to invoice");
      } else {
        shopify.toast.show("Converted to invoice");
      }
    }

    const patchedIds = new Set(
      (result.orderIds?.length
        ? result.orderIds
        : result.orderId
          ? [result.orderId]
          : []
      ).map(String),
    );

    if (patchedIds.size > 0) {
      if (result.document === "delete-invoice") {
        removePendingInvoices(patchedIds);
        setOrders((prev) =>
          isInvoiceList
            ? prev.filter((order) => !patchedIds.has(order.id))
            : prev.map((order) =>
                patchedIds.has(order.id)
                  ? { ...order, invoiced: false, invoicedAt: null, invoiceNumber: "" }
                  : order,
              ),
        );
        clearSelection();
      } else if (result.document === "delete-credit-note") {
        setOrders((prev) =>
          isCreditNoteList
            ? prev.filter((order) => !patchedIds.has(order.id))
            : prev.map((order) =>
                patchedIds.has(order.id)
                  ? {
                      ...order,
                      creditNote: false,
                      creditNoteNumber: "",
                      creditNoteAt: null,
                      creditNoteReason: "",
                      creditNoteVoided: false,
                    }
                  : order,
              ),
        );
        clearSelection();
      } else if (result.document === "delete-packing-slip") {
        setOrders((prev) =>
          isPackingSlipList
            ? prev.filter((order) => !patchedIds.has(order.id))
            : prev.map((order) =>
                patchedIds.has(order.id)
                  ? { ...order, packingSlip: false, packingSlipNumber: "" }
                  : order,
              ),
        );
        clearSelection();
      } else if (result.document === "delete-return") {
        setOrders((prev) =>
          isReturnList
            ? prev.filter((order) => !patchedIds.has(order.id))
            : prev.map((order) =>
                patchedIds.has(order.id)
                  ? {
                      ...order,
                      returnSlip: false,
                      returnNumber: "",
                      returnedAt: null,
                    }
                  : order,
              ),
        );
        clearSelection();
      } else if (result.document === "delete-draft") {
        setOrders((prev) =>
          isDraftList
            ? prev.filter((order) => !patchedIds.has(order.id))
            : prev.map((order) =>
                patchedIds.has(order.id)
                  ? {
                      ...order,
                      draft: false,
                      draftNumber: "",
                      draftedAt: null,
                    }
                  : order,
              ),
        );
        clearSelection();
      } else if (result.document === "void-credit-note") {
        setOrders((prev) =>
          prev.map((order) =>
            patchedIds.has(order.id)
              ? { ...order, creditNoteVoided: true }
              : order,
          ),
        );
        clearSelection();
      } else if (result.document === "packing-slip") {
        const packingSlipNumbers = result.packingSlipNumbers || {};
        setOrders((prev) =>
          prev.map((order) =>
            patchedIds.has(order.id)
              ? {
                  ...order,
                  packingSlip: true,
                  packingSlipNumber:
                    packingSlipNumbers[order.id] ||
                    order.packingSlipNumber ||
                    "",
                }
              : order,
          ),
        );
      } else if (result.document === "return") {
        const returnNumbers = result.returnNumbers || {};
        setOrders((prev) =>
          prev.map((order) =>
            patchedIds.has(order.id)
              ? {
                  ...order,
                  returnSlip: true,
                  returnNumber:
                    returnNumbers[order.id] || order.returnNumber || "",
                }
              : order,
          ),
        );
      } else if (result.document === "credit-note") {
        const creditNoteNumbers = result.creditNoteNumbers || {};
        const creditNoteAt = new Date().toISOString();
        setOrders((prev) =>
          prev.map((order) =>
            patchedIds.has(order.id)
              ? {
                  ...order,
                  creditNote: true,
                  creditNoteAt,
                  creditNoteVoided: false,
                  creditNoteReason: result.reason || order.creditNoteReason || "",
                  creditNoteNumber:
                    creditNoteNumbers[order.id] ||
                    order.creditNoteNumber ||
                    "",
                }
              : order,
          ),
        );
        clearSelection();
      } else if (result.document === "draft") {
        const draftNumbers = result.draftNumbers || {};
        const draftedAt = new Date().toISOString();
        setOrders((prev) =>
          prev.map((order) =>
            patchedIds.has(order.id)
              ? {
                  ...order,
                  draft: true,
                  draftedAt,
                  draftNumber:
                    draftNumbers[order.id] || order.draftNumber || "",
                }
              : order,
          ),
        );
        clearSelection();
      } else if (
        result.document === "invoice" ||
        result.document === "finalize-draft"
      ) {
        const invoicedAt = new Date().toISOString();
        const invoiceNumbers = result.invoiceNumbers || {};
        const invoiceDateLabel = new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(invoicedAt));
        if (result.document === "finalize-draft" && isDraftList) {
          setOrders((prev) =>
            prev.filter((order) => !patchedIds.has(order.id)),
          );
          clearSelection();
        } else {
          const pendingRows = orders
            .filter((order) => patchedIds.has(order.id))
            .map((order) => ({
              ...order,
              invoiced: true,
              invoicedAt: order.invoicedAt || invoicedAt,
              // Invoice list Date column uses invoice (convert) date.
              date: order.invoicedAt ? order.date : invoiceDateLabel,
              invoiceNumber:
                invoiceNumbers[order.id] || order.invoiceNumber || "",
              draft: false,
              draftNumber: "",
              draftedAt: null,
            }));
          pushPendingInvoices(pendingRows);
          setOrders((prev) =>
            prev.map((order) => {
              if (!patchedIds.has(order.id)) return order;
              const invoiceNumber =
                invoiceNumbers[order.id] || order.invoiceNumber || "";
              return {
                ...order,
                invoiced: true,
                invoicedAt: order.invoicedAt || invoicedAt,
                invoiceNumber,
                draft: false,
                draftNumber: "",
                draftedAt: null,
              };
            }),
          );
        }
      }
    }
  }, [
    clearSelection,
    convertFetcher.data,
    convertFetcher.state,
    isCreditNoteList,
    isDraftList,
    isInvoiceList,
    isPackingSlipList,
    isReturnList,
    orders,
    revalidator,
  ]);

  useEffect(() => {
    setQueryValue(data.query);
  }, [data.query]);

  const handleReload = useCallback(() => {
    if (isBusy || convertFetcher.state !== "idle") return;
    if (typeof window !== "undefined" && isInvoiceList) {
      writePendingInvoices([]);
      window.sessionStorage.removeItem(INVOICE_LIST_BUST_KEY);
    }
    clearSelection();
    const formData = new FormData();
    formData.set("intent", "reload-list");
    convertFetcher.submit(formData, { method: "post" });
  }, [clearSelection, convertFetcher, isBusy, isInvoiceList]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams);
        params.delete("after");
        params.delete("before");
        params.delete("fresh");

        Object.entries(updates).forEach(([key, value]) => {
          if (value) {
            params.set(key, value);
          } else {
            params.delete(key);
          }
        });

        setSearchParams(params, { replace: true, preventScrollReset: true });
      });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (queryValue.trim() === data.query) return;

    const timeout = window.setTimeout(() => {
      updateParams({ q: queryValue.trim() });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [data.query, queryValue, updateParams]);

  const goToPreviousPage = () => {
    if (!data.pageInfo.startCursor) return;
    startTransition(() => {
      const params = new URLSearchParams(searchParams);
      params.delete("after");
      params.delete("fresh");
      params.set("before", data.pageInfo.startCursor!);
      setSearchParams(params, { replace: true, preventScrollReset: true });
    });
  };

  const goToNextPage = () => {
    if (!data.pageInfo.endCursor) return;
    startTransition(() => {
      const params = new URLSearchParams(searchParams);
      params.delete("before");
      params.delete("fresh");
      params.set("after", data.pageInfo.endCursor!);
      setSearchParams(params, { replace: true, preventScrollReset: true });
    });
  };

  const tabs: TabProps[] = useMemo(() => {
    if (isReturnList) {
      return RETURN_LIST_VIEWS.map((view, index) => ({
        content: adminListTabLabel(language, view.id),
        index,
        onAction: () => {},
        id: `return-${view.id}`,
        isLocked: true,
        actions: [],
      }));
    }
    if (isPackingSlipList) {
      return PACKING_SLIP_LIST_VIEWS.map((view, index) => ({
        content: adminListTabLabel(language, view.id),
        index,
        onAction: () => {},
        id: `packing-slip-${view.id}`,
        isLocked: true,
        actions: [],
      }));
    }
    if (isCreditNoteList) {
      return CREDIT_NOTE_LIST_VIEWS.map((view, index) => ({
        content: adminListTabLabel(language, view.id),
        index,
        onAction: () => {},
        id: `credit-note-${view.id}`,
        isLocked: true,
        actions: [],
      }));
    }
    if (isDraftList) {
      return DRAFT_LIST_VIEWS.map((view, index) => ({
        content: adminListTabLabel(language, view.id),
        index,
        onAction: () => {},
        id: `draft-${view.id}`,
        isLocked: true,
        actions: [],
      }));
    }
    if (isInvoiceList) {
      return INVOICE_LIST_VIEWS.map((view, index) => ({
        content: adminListTabLabel(language, view.id),
        index,
        onAction: () => {},
        id: `invoice-${view.id}`,
        isLocked: true,
        actions: [],
      }));
    }
    return visibleViews.map((view, index) => ({
      content: adminListTabLabel(language, view.id),
      index,
      onAction: () => {},
      id: `${view.id}-${view.viewIndex}`,
      // Keep every view tab in the bar (not collapsed into "More views").
      isLocked: true,
      actions: [],
    }));
  }, [
    isCreditNoteList,
    isDraftList,
    isInvoiceList,
    isPackingSlipList,
    isReturnList,
    language,
    visibleViews,
  ]);

  const selectedTab = isReturnList
    ? 0
    : isPackingSlipList
    ? Math.max(
        0,
        PACKING_SLIP_LIST_VIEWS.findIndex(
          (view) => view.fulfillment === (data.fulfillmentStatus || ""),
        ),
      )
    : isDocumentList
      ? Math.max(
          0,
          (isCreditNoteList
            ? CREDIT_NOTE_LIST_VIEWS
            : isDraftList
              ? DRAFT_LIST_VIEWS
              : INVOICE_LIST_VIEWS
          ).findIndex((view) => view.payment === (data.paymentStatus || "")),
        )
      : Math.max(
          0,
          visibleViews.findIndex((view) => view.viewIndex === data.selectedView),
        );

  const handlePaymentStatusChange = useCallback(
    (value: string[]) => {
      if (isDocumentList) {
        updateParams({
          view: isInvoiceList
            ? String(INVOICED_VIEW_INDEX >= 0 ? INVOICED_VIEW_INDEX : 4)
            : "",
          payment: value[0] ?? "",
        });
        return;
      }
      updateParams({ view: "", payment: value[0] ?? "" });
    },
    [isDocumentList, isInvoiceList, updateParams],
  );
  const handleFulfillmentStatusChange = useCallback(
    (value: string[]) => {
      updateParams({ view: "", fulfillment: value[0] ?? "" });
    },
    [updateParams],
  );
  const handlePaymentStatusRemove = useCallback(() => {
    updateParams({ payment: "" });
  }, [updateParams]);
  const handleFulfillmentStatusRemove = useCallback(() => {
    updateParams({ fulfillment: "" });
  }, [updateParams]);
  const handleInvoicedFilterChange = useCallback(
    (value: string[]) => {
      updateParams({ invoiced: value[0] ?? "" });
    },
    [updateParams],
  );
  const handlePackingFilterChange = useCallback(
    (value: string[]) => {
      updateParams({ packing: value[0] ?? "" });
    },
    [updateParams],
  );
  const handleReturnFilterChange = useCallback(
    (value: string[]) => {
      updateParams({ return: value[0] ?? "" });
    },
    [updateParams],
  );
  const handleCreditFilterChange = useCallback(
    (value: string[]) => {
      updateParams({ credit: value[0] ?? "" });
    },
    [updateParams],
  );
  const handleInvoicedFilterRemove = useCallback(() => {
    updateParams({ invoiced: "" });
  }, [updateParams]);
  const handlePackingFilterRemove = useCallback(() => {
    updateParams({ packing: "" });
  }, [updateParams]);
  const handleReturnFilterRemove = useCallback(() => {
    updateParams({ return: "" });
  }, [updateParams]);
  const handleCreditFilterRemove = useCallback(() => {
    updateParams({ credit: "" });
  }, [updateParams]);
  const handleQueryValueRemove = useCallback(() => {
    setQueryValue("");
    updateParams({ q: "" });
  }, [updateParams]);
  const handleFiltersClearAll = useCallback(() => {
    setQueryValue("");
    updateParams({
      q: "",
      view: isInvoiceList
        ? String(INVOICED_VIEW_INDEX >= 0 ? INVOICED_VIEW_INDEX : 4)
        : "",
      payment: "",
      fulfillment: "",
      invoiced: "",
      packing: "",
      return: "",
      credit: "",
      sort: "",
    });
  }, [isInvoiceList, updateParams]);
  const handleFiltersCancel = useCallback(() => {
    setQueryValue(data.query);
    setMode(IndexFiltersMode.Default);
  }, [data.query, setMode]);

  const filters: IndexFiltersProps["filters"] = useMemo(() => {
    const paymentFilter = {
      key: "paymentStatus",
      label: isDocumentList ? "Status" : "Payment status",
      filter: (
        <ChoiceList
          title={isDocumentList ? "Status" : "Payment status"}
          titleHidden
          choices={
            isDraftList
              ? [
                  { label: "Open", value: "open" },
                  { label: "Invoice sent", value: "invoice_sent" },
                  { label: "Completed", value: "completed" },
                ]
              : [
                  { label: "Paid", value: "paid" },
                  { label: "Pending", value: "pending" },
                  { label: "Partially paid", value: "partially_paid" },
                  { label: "Refunded", value: "refunded" },
                  { label: "Voided", value: "voided" },
                ]
          }
          selected={data.paymentStatus ? [data.paymentStatus] : []}
          onChange={handlePaymentStatusChange}
        />
      ),
      shortcut: true,
    };

    const fulfillmentFilter = {
      key: "fulfillmentStatus",
      label: "Fulfillment status",
      filter: (
        <ChoiceList
          title="Fulfillment status"
          titleHidden
          choices={[
            { label: "Fulfilled", value: "fulfilled" },
            { label: "Unfulfilled", value: "unfulfilled" },
            { label: "Partially fulfilled", value: "partially_fulfilled" },
          ]}
          selected={data.fulfillmentStatus ? [data.fulfillmentStatus] : []}
          onChange={handleFulfillmentStatusChange}
        />
      ),
      shortcut: true,
    };

    const yesNoChoices = [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ];
    const invoicedFilter = {
      key: "invoiced",
      label: "Invoiced",
      filter: (
        <ChoiceList
          title="Invoiced"
          titleHidden
          choices={yesNoChoices}
          selected={data.invoicedFilter ? [data.invoicedFilter] : []}
          onChange={handleInvoicedFilterChange}
        />
      ),
    };
    const packingSlipFilter = {
      key: "packingSlip",
      label: "Packing slip",
      filter: (
        <ChoiceList
          title="Packing slip"
          titleHidden
          choices={yesNoChoices}
          selected={data.packingSlipFilter ? [data.packingSlipFilter] : []}
          onChange={handlePackingFilterChange}
        />
      ),
    };
    const returnFilter = {
      key: "returnSlip",
      label: "Return",
      filter: (
        <ChoiceList
          title="Return"
          titleHidden
          choices={yesNoChoices}
          selected={data.returnFilter ? [data.returnFilter] : []}
          onChange={handleReturnFilterChange}
        />
      ),
    };
    const creditNoteFilter = {
      key: "creditNote",
      label: "Credit note",
      filter: (
        <ChoiceList
          title="Credit note"
          titleHidden
          choices={yesNoChoices}
          selected={data.creditNoteFilter ? [data.creditNoteFilter] : []}
          onChange={handleCreditFilterChange}
        />
      ),
    };

    if (isReturnList) return [fulfillmentFilter];
    if (isPackingSlipList) return [fulfillmentFilter];
    if (isInvoiceList || isCreditNoteList || isDraftList) return [paymentFilter];

    return [
      paymentFilter,
      fulfillmentFilter,
      invoicedFilter,
      packingSlipFilter,
      returnFilter,
      creditNoteFilter,
    ];
  }, [
    data.creditNoteFilter,
    data.fulfillmentStatus,
    data.invoicedFilter,
    data.packingSlipFilter,
    data.paymentStatus,
    data.returnFilter,
    handleCreditFilterChange,
    handleFulfillmentStatusChange,
    handleInvoicedFilterChange,
    handlePackingFilterChange,
    handlePaymentStatusChange,
    handleReturnFilterChange,
    isCreditNoteList,
    isDocumentList,
    isDraftList,
    isInvoiceList,
    isPackingSlipList,
    isReturnList,
  ]);

  const appliedFilters: IndexFiltersProps["appliedFilters"] = [];
  if (!isPackingSlipList && !isReturnList && data.paymentStatus) {
    appliedFilters.push({
      key: "paymentStatus",
      label: `${isDocumentList ? "Status" : "Payment status"} is ${data.paymentStatus.replaceAll("_", " ")}`,
      onRemove: handlePaymentStatusRemove,
    });
  }
  if (
    (isPackingSlipList || isReturnList || !isDocumentList) &&
    data.fulfillmentStatus
  ) {
    appliedFilters.push({
      key: "fulfillmentStatus",
      label: `Fulfillment status is ${data.fulfillmentStatus.replaceAll("_", " ")}`,
      onRemove: handleFulfillmentStatusRemove,
    });
  }
  if (!isDocumentList && data.invoicedFilter) {
    appliedFilters.push({
      key: "invoiced",
      label: `Invoiced is ${data.invoicedFilter === "yes" ? "Yes" : "No"}`,
      onRemove: handleInvoicedFilterRemove,
    });
  }
  if (!isDocumentList && data.packingSlipFilter) {
    appliedFilters.push({
      key: "packingSlip",
      label: `Packing slip is ${data.packingSlipFilter === "yes" ? "Yes" : "No"}`,
      onRemove: handlePackingFilterRemove,
    });
  }
  if (!isDocumentList && data.returnFilter) {
    appliedFilters.push({
      key: "returnSlip",
      label: `Return is ${data.returnFilter === "yes" ? "Yes" : "No"}`,
      onRemove: handleReturnFilterRemove,
    });
  }
  if (!isDocumentList && data.creditNoteFilter) {
    appliedFilters.push({
      key: "creditNote",
      label: `Credit note is ${data.creditNoteFilter === "yes" ? "Yes" : "No"}`,
      onRemove: handleCreditFilterRemove,
    });
  }

  const hasActiveFilters = Boolean(
    data.query ||
      data.paymentStatus ||
      data.fulfillmentStatus ||
      data.invoicedFilter ||
      data.packingSlipFilter ||
      data.returnFilter ||
      data.creditNoteFilter,
  );

  const emptyStateMarkup = hasActiveFilters ? (
    <EmptySearchResult
      title={
        isPackingSlipList
          ? t("list.emptyNoPackingSlipsFound")
          : isReturnList
            ? t("list.emptyNoReturnsFound")
            : isCreditNoteList
              ? t("list.emptyNoCreditNotesFound")
              : isDraftList
                ? t("list.emptyNoDraftsFound")
                : isInvoiceList
                  ? t("list.emptyNoInvoicesFound")
                  : t("list.emptyNoOrdersFound")
      }
      description={t("list.emptyFilterTry")}
      withIllustration
    />
  ) : isPackingSlipList ? (
    <ListEmptyState
      heading={t("list.emptyNoPackingSlipsYet")}
      description={t("list.emptyNoPackingSlipsYetDesc")}
      initials="PS"
      action={{
        content: t("list.goToSalesOrders"),
        onAction: () => navigate("/app/sales-order"),
      }}
    />
  ) : isReturnList ? (
    <ListEmptyState
      heading={t("list.emptyNoReturnsYet")}
      description={t("list.emptyNoReturnsYetDesc")}
      initials="RT"
      action={{
        content: t("list.goToSalesOrders"),
        onAction: () => navigate("/app/sales-order"),
      }}
    />
  ) : isCreditNoteList ? (
    <ListEmptyState
      heading={t("list.emptyNoCreditNotesYet")}
      description={t("list.emptyNoCreditNotesYetDesc")}
      initials="CN"
      action={{
        content: t("list.goToInvoice"),
        onAction: () => navigate("/app/invoice"),
      }}
    />
  ) : isDraftList ? (
    <ListEmptyState
      heading={t("list.emptyNoDraftsYet")}
      description={t("list.emptyNoDraftsYetDesc")}
      initials="DR"
      action={{
        content: t("list.createInShopify"),
        onAction: () => {
          const shop =
            "shopDomain" in data && typeof data.shopDomain === "string"
              ? data.shopDomain
              : "";
          const handle = shop.replace(/\.myshopify\.com$/i, "");
          if (handle) {
            window.open(
              `https://admin.shopify.com/store/${handle}/draft_orders/new`,
              "_top",
            );
          }
        },
      }}
    />
  ) : isInvoiceList ? (
    <ListEmptyState
      heading={t("list.emptyNoInvoicesYet")}
      description={t("list.emptyNoInvoicesYetDesc")}
      initials="IN"
      action={{
        content: t("list.goToSalesOrders"),
        onAction: () => navigate("/app/sales-order"),
      }}
    />
  ) : (
    <ListEmptyState
      heading={t("list.emptyNoOrdersYet")}
      description={t("list.emptyNoOrdersYetDesc")}
      initials="SO"
    />
  );

  const rowMarkup = orders.map((order, index) => {
    const invoiceStatus =
      isInvoiceList || isCreditNoteList
        ? documentStatusDisplay(
            order,
            isCreditNoteList ? "credit-note" : "invoice",
            language,
          )
        : null;

    const cells = visibleColumns.map((col) => {
      switch (col.id) {
        case "document":
          return (
            <IndexTable.Cell key={col.id}>
              <Link
                dataPrimaryLink
                monochrome
                removeUnderline
                onClick={() => openOrderDocument(order.id)}
              >
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {isCreditNoteList
                    ? order.creditNoteNumber || "—"
                    : isPackingSlipList
                      ? order.packingSlipNumber || "—"
                      : isReturnList
                        ? order.returnNumber || "—"
                        : isDraftList
                          ? order.draftNumber || "—"
                          : isInvoiceList
                            ? order.invoiceNumber || order.salesOrderNumber || "—"
                            : order.salesOrderNumber || "—"}
                </Text>
              </Link>
            </IndexTable.Cell>
          );
        case "reference":
          return (
            <IndexTable.Cell key={col.id}>
              <Text as="span" variant="bodyMd" tone="subdued">
                {isCreditNoteList
                  ? order.invoiceNumber || order.salesOrderNumber || "—"
                  : isPackingSlipList || isReturnList || isDraftList
                    ? order.name || "—"
                    : isInvoiceList
                      ? order.salesOrderNumber || "—"
                      : order.name}
              </Text>
            </IndexTable.Cell>
          );
        case "shopifyOrderNumber":
          return (
            <IndexTable.Cell key={col.id}>
              <Text
                as="span"
                variant="bodyMd"
                tone={order.name ? undefined : "subdued"}
              >
                {order.name || "—"}
              </Text>
            </IndexTable.Cell>
          );
        case "salesOrderNumber":
          return (
            <IndexTable.Cell key={col.id}>
              <Text
                as="span"
                variant="bodyMd"
                tone={order.salesOrderNumber ? undefined : "subdued"}
              >
                {order.salesOrderNumber || "—"}
              </Text>
            </IndexTable.Cell>
          );
        case "invoiceNumber":
          return (
            <IndexTable.Cell key={col.id}>
              <Text
                as="span"
                variant="bodyMd"
                tone={order.invoiceNumber ? undefined : "subdued"}
              >
                {order.invoiceNumber || "—"}
              </Text>
            </IndexTable.Cell>
          );
        case "date":
          return (
            <IndexTable.Cell key={col.id}>
              <Text as="span" variant="bodyMd">
                {order.date}
              </Text>
            </IndexTable.Cell>
          );
        case "company":
          return (
            <IndexTable.Cell key={col.id}>
              <Text
                as="span"
                variant="bodyMd"
                tone={order.company?.trim() && order.company !== "—" ? undefined : "subdued"}
              >
                {order.company?.trim() || "—"}
              </Text>
            </IndexTable.Cell>
          );
        case "customer":
          return (
            <IndexTable.Cell key={col.id}>
              <Text as="span" variant="bodyMd">
                {order.customer}
              </Text>
            </IndexTable.Cell>
          );
        case "total":
          return (
            <IndexTable.Cell key={col.id}>
              <Text as="span" variant="bodyMd" alignment="end" numeric>
                {order.total}
              </Text>
            </IndexTable.Cell>
          );
        case "balanceDue":
          return (
            <IndexTable.Cell key={col.id}>
              <Text as="span" variant="bodyMd" alignment="end" numeric>
                {order.balanceDue}
              </Text>
            </IndexTable.Cell>
          );
        case "paymentStatus":
          return (
            <IndexTable.Cell key={col.id}>
              <div style={{ paddingInlineStart: 16 }}>
                {invoiceStatus ? (
                  <Badge
                    tone={invoiceStatus.tone}
                    progress={invoiceStatus.progress}
                  >
                    {invoiceStatus.label}
                  </Badge>
                ) : (
                  <Badge
                    tone={order.paymentTone}
                    progress={order.paymentProgress}
                  >
                    {adminPaymentStatusLabel(
                      language,
                      order.paymentStatusKey || order.paymentStatus,
                    )}
                  </Badge>
                )}
              </div>
            </IndexTable.Cell>
          );
        case "fulfillmentStatus":
          return (
            <IndexTable.Cell key={col.id}>
              <Badge
                tone={order.fulfillmentTone}
                progress={order.fulfillmentProgress}
              >
                {adminFulfillmentStatusLabel(
                  language,
                  order.fulfillmentStatus,
                )}
              </Badge>
            </IndexTable.Cell>
          );
        case "invoiced":
          return (
            <IndexTable.Cell key={col.id}>
              <InlineStack align="center" blockAlign="center">
                <Tooltip
                  content={
                    order.invoiced
                      ? t("col.invoiced")
                      : t("status.notInvoiced")
                  }
                >
                  <span>
                    <Icon
                      source={
                        order.invoiced ? CheckCircleIcon : MinusCircleIcon
                      }
                      tone={order.invoiced ? "success" : "subdued"}
                      accessibilityLabel={
                        order.invoiced
                          ? t("col.invoiced")
                          : t("status.notInvoiced")
                      }
                    />
                  </span>
                </Tooltip>
              </InlineStack>
            </IndexTable.Cell>
          );
        case "packingSlip":
          return (
            <IndexTable.Cell key={col.id}>
              <InlineStack align="center" blockAlign="center">
                <Tooltip
                  content={
                    order.packingSlip
                      ? t("status.packingSlipCreated")
                      : t("status.noPackingSlip")
                  }
                >
                  <span>
                    <Icon
                      source={
                        order.packingSlip ? CheckCircleIcon : MinusCircleIcon
                      }
                      tone={order.packingSlip ? "info" : "subdued"}
                      accessibilityLabel={
                        order.packingSlip
                          ? t("status.packingSlipCreated")
                          : t("status.noPackingSlip")
                      }
                    />
                  </span>
                </Tooltip>
              </InlineStack>
            </IndexTable.Cell>
          );
        case "creditNote": {
          const hasCreditNote = Boolean(order.creditNote);
          const voided = Boolean(order.creditNoteVoided);
          const tooltipBase = !hasCreditNote
            ? t("status.noCreditNote")
            : voided
              ? t("status.creditNoteVoided")
              : t("status.creditNoteCreated");
          const tooltip =
            hasCreditNote && order.creditNoteNumber
              ? `${tooltipBase} (${order.creditNoteNumber})`
              : tooltipBase;
          return (
            <IndexTable.Cell key={col.id}>
              <InlineStack align="center" blockAlign="center">
                <Tooltip content={tooltip}>
                  <span>
                    <Icon
                      source={
                        hasCreditNote ? CheckCircleIcon : MinusCircleIcon
                      }
                      tone={
                        !hasCreditNote
                          ? "subdued"
                          : voided
                            ? "critical"
                            : "success"
                      }
                      accessibilityLabel={tooltip}
                    />
                  </span>
                </Tooltip>
              </InlineStack>
            </IndexTable.Cell>
          );
        }
        case "returnSlip":
          return (
            <IndexTable.Cell key={col.id}>
              <InlineStack align="center" blockAlign="center">
                <Tooltip
                  content={
                    order.returnSlip
                      ? order.returnNumber
                        ? `${t("status.returnCreated")} (${order.returnNumber})`
                        : t("status.returnCreated")
                      : t("status.noReturn")
                  }
                >
                  <span>
                    <Icon
                      source={
                        order.returnSlip ? CheckCircleIcon : MinusCircleIcon
                      }
                      tone={order.returnSlip ? "success" : "subdued"}
                      accessibilityLabel={
                        order.returnSlip
                          ? t("status.returnCreated")
                          : t("status.noReturn")
                      }
                    />
                  </span>
                </Tooltip>
              </InlineStack>
            </IndexTable.Cell>
          );
        case "reason": {
          const reason = order.creditNoteReason?.trim() || "";
          return (
            <IndexTable.Cell key={col.id}>
              <InlineStack align="center" blockAlign="center">
                <Tooltip
                  content={reason || "No reason"}
                  dismissOnMouseOut
                >
                  <span>
                    <Button
                      icon={NoteIcon}
                      variant="tertiary"
                      accessibilityLabel={
                        reason ? "Credit note reason" : "No reason"
                      }
                    />
                  </span>
                </Tooltip>
              </InlineStack>
            </IndexTable.Cell>
          );
        }
        case "actions": {
          const docLabel = isCreditNoteList
            ? order.creditNoteNumber || order.name
            : isDraftList
              ? order.draftNumber || order.name
              : isInvoiceList
                ? order.invoiceNumber || order.name
                : order.salesOrderNumber || order.name;
          return (
            <IndexTable.Cell key={col.id}>
              <div
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <InlineStack align="center" gap="100" wrap={false}>
                  <Tooltip content={t("list.actionPrint")}>
                    <Button
                      icon={PrintIcon}
                      variant="tertiary"
                      accessibilityLabel={`Print ${docLabel}`}
                      disabled={isBusy}
                      onClick={() => {
                        void runQuickPrint(order.id);
                      }}
                    />
                  </Tooltip>
                  <Tooltip content={t("list.actionDownloadPdf")}>
                    <Button
                      icon={ImportIcon}
                      variant="tertiary"
                      accessibilityLabel={`Download ${docLabel}`}
                      disabled={isBusy}
                      onClick={() => {
                        void runQuickDownload(order.id);
                      }}
                    />
                  </Tooltip>
                  <Tooltip
                    content={
                      order.emailed
                        ? t("list.actionEmailSent")
                        : t("list.actionSendEmail")
                    }
                  >                    <span
                      className={
                        order.emailed ? "sales-orders-action-done" : undefined
                      }
                    >
                      <Button
                        icon={EmailIcon}
                        variant="tertiary"
                        tone={order.emailed ? "success" : undefined}
                        accessibilityLabel={`Send ${docLabel}`}
                        disabled={isBusy}
                        onClick={() => runQuickSend(order)}
                      />
                    </span>
                  </Tooltip>
                </InlineStack>
              </div>
            </IndexTable.Cell>
          );
        }
        default:
          return null;
      }
    });

    return (
      <IndexTable.Row
        id={order.id}
        key={order.id}
        selected={selectedResources.includes(order.id)}
        position={index}
        onClick={() => openOrderDocument(order.id)}
      >
        {cells}
      </IndexTable.Row>
    );
  });

  const columnsMenuPortal =
    columnsMountNode != null
      ? createPortal(
          <span className="sales-orders-columns-mount">{columnsMenu}</span>,
          columnsMountNode,
        )
      : null;

  const activeSortKey = data.sortSelected.replace(/ (asc|desc)$/, "");
  const sortDirection = data.sortSelected.endsWith(" asc")
    ? ("ascending" as const)
    : ("descending" as const);

  const handleHeadingSortClick = useCallback(
    (columnId: string) => {
      const sortKey = headingSortKey(columnId);
      if (!sortKey) return;
      const currentKey = data.sortSelected.replace(/ (asc|desc)$/, "");
      const currentDir = data.sortSelected.endsWith(" asc") ? "asc" : "desc";
      if (currentKey === sortKey) {
        updateParams({
          sort: `${sortKey} ${currentDir === "asc" ? "desc" : "asc"}`,
        });
        return;
      }
      const fallback =
        COLUMN_DEFAULT_DIRECTION[columnId] === "ascending" ? "asc" : "desc";
      updateParams({ sort: `${sortKey} ${fallback}` });
    },
    [data.sortSelected, updateParams],
  );

  const tableHeadings = visibleColumns.map((col) => {
    const sortable = SORTABLE_COLUMN_IDS.has(col.id);
    const title = sortable ? (
      <button
        type="button"
        className="sales-orders-sort-heading"
        onClick={() => handleHeadingSortClick(col.id)}
      >
        {col.label}
        <span className="sales-orders-sort-caret" aria-hidden>
          <Icon
            source={
              (headingSortKey(col.id) === activeSortKey
                ? sortDirection
                : COLUMN_DEFAULT_DIRECTION[col.id] ?? "descending") ===
              "ascending"
                ? CaretUpIcon
                : CaretDownIcon
            }
            tone="subdued"
          />
        </span>
      </button>
    ) : (
      col.label
    );

    switch (col.id) {
      case "total":
      case "balanceDue":
        return {
          id: col.id,
          title,
          alignment: "end" as const,
        };
      case "paymentStatus":
        return {
          id: col.id,
          title: (
            <span style={{ display: "inline-block", paddingInlineStart: 16 }}>
              {col.label}
            </span>
          ),
        };
      case "invoiced":
      case "packingSlip":
      case "creditNote":
      case "returnSlip":
      case "reason":
      case "actions":
        return { title: col.label, alignment: "center" as const };
      default:
        return sortable
          ? { id: col.id, title }
          : { title: col.label };
    }
  });

  return (
    <AppProvider i18n={enTranslations}>
      <ListPerfHelpers
        listMode={data.listMode}
        busy={isBusy || revalidator.state !== "idle"}
        onChanged={handleListChanged}
        resolvePath={resolveOrderPath}
      />
      <s-page heading={pageHeading} inlineSize="large">
        <s-button
          slot="secondary-actions"
          variant="secondary"
          icon="refresh"
          disabled={isBusy || revalidator.state !== "idle" || undefined}
          onClick={handleReload}
        >
          {t("list.reload")}
        </s-button>
        <div className="sales-orders-page" ref={pageRef}>
        {columnsMenuPortal}
        {(isDraftList || isReturnList) && data.scopeError ? (
          <div style={{ marginBottom: 16 }}>
            <Banner
              title={
                isReturnList
                  ? "Returns permission needed"
                  : "Draft orders permission needed"
              }
              tone="warning"
              action={{
                content: "Open app preview",
                onAction: () => {
                  const apiKey =
                    "apiKey" in data && typeof data.apiKey === "string"
                      ? data.apiKey
                      : "";
                  const shop =
                    "shopDomain" in data && typeof data.shopDomain === "string"
                      ? data.shopDomain
                      : "";
                  const handle = shop.replace(/\.myshopify\.com$/i, "") || "billoxi";
                  const clientId = apiKey || "565c4664a7b842ddeabe5a2dbea1b308";
                  // Use Admin app preview URL (oauth/install often just bounces to Home).
                  window.open(
                    `https://admin.shopify.com/store/${handle}/apps/${clientId}`,
                    "_top",
                  );
                },
              }}
            >
              <p>{data.scopeError}</p>
              <p>
                Manual: terminal-ல <code>p</code> press பண்ணி App preview open
                பண்ணுங்க, அல்லது Apps → Billoxi uninstall செஞ்சு மறுபடி install.
              </p>
            </Banner>
          </div>
        ) : null}
        <Modal
          open={confirmAction !== null}
          onClose={() => setConfirmAction(null)}
          title={confirmCopy?.title ?? "Are you sure?"}
          primaryAction={{
            content: confirmCopy?.confirm ?? "Confirm",
            destructive:
              confirmAction === "delete-invoice" ||
              confirmAction === "delete-credit-note" ||
              confirmAction === "delete-packing-slip" ||
              confirmAction === "delete-return" ||
              confirmAction === "delete-draft" ||
              confirmAction === "void-credit-note",
            onAction: handleConfirmBulkAction,
          }}
          secondaryActions={[
            {
              content:
                confirmAction === "invoice" || confirmAction === "finalize-draft"
                  ? "No"
                  : "Cancel",
              onAction: () => {
                setConfirmAction(null);
                setCreditReason("");
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p">
                {confirmCopy?.message ?? "Are you sure you want to continue?"}
              </Text>
              {confirmAction === "credit-note" ? (
                <TextField
                  label="Reason"
                  value={creditReason}
                  onChange={setCreditReason}
                  autoComplete="off"
                  placeholder="Return, overcharge, goodwill…"
                  helpText="Shown on the credit note notes section."
                />
              ) : null}
            </BlockStack>
          </Modal.Section>
        </Modal>
        <Card padding="0">
          <IndexFilters
            queryValue={queryValue}
            queryPlaceholder={
              isCreditNoteList
                ? "Search credit notes"
                : isPackingSlipList
                  ? "Search packing slips"
                  : isReturnList
                    ? "Search returns"
                    : isDraftList
                      ? "Search drafts"
                      : isInvoiceList
                        ? "Search invoices"
                        : "Search orders"
            }
            onQueryChange={setQueryValue}
            onQueryClear={handleQueryValueRemove}
            cancelAction={{
              onAction: handleFiltersCancel,
              disabled: false,
              loading: false,
            }}
            tabs={tabs}
            selected={selectedTab}
            onSelect={(index) => {
              if (isReturnList) {
                const fulfillment =
                  RETURN_LIST_VIEWS[index]?.fulfillment ?? "";
                updateParams({ fulfillment });
                return;
              }
              if (isPackingSlipList) {
                const fulfillment =
                  PACKING_SLIP_LIST_VIEWS[index]?.fulfillment ?? "";
                updateParams({ fulfillment });
                return;
              }
              if (isCreditNoteList) {
                const payment = CREDIT_NOTE_LIST_VIEWS[index]?.payment ?? "";
                updateParams({ payment });
                return;
              }
              if (isDraftList) {
                const payment = DRAFT_LIST_VIEWS[index]?.payment ?? "";
                updateParams({ payment });
                return;
              }
              if (isInvoiceList) {
                const payment = INVOICE_LIST_VIEWS[index]?.payment ?? "";
                updateParams({
                  view: String(
                    INVOICED_VIEW_INDEX >= 0 ? INVOICED_VIEW_INDEX : 4,
                  ),
                  payment,
                });
                return;
              }
              const viewIndex = visibleViews[index]?.viewIndex ?? 0;
              updateParams({
                view: viewIndex === 0 ? "" : String(viewIndex),
                payment: "",
                fulfillment: "",
              });
            }}
            canCreateNewView={false}
            filters={filters}
            appliedFilters={appliedFilters}
            onClearAll={handleFiltersClearAll}
            mode={mode}
            setMode={setMode}
            loading={
              revalidator.state !== "idle" || convertFetcher.state !== "idle"
            }
          />
          <IndexTable
            resourceName={
              isCreditNoteList
                ? { singular: "credit note", plural: "credit notes" }
                : isPackingSlipList
                  ? { singular: "packing slip", plural: "packing slips" }
                  : isReturnList
                    ? { singular: "return", plural: "returns" }
                    : isDraftList
                      ? { singular: "draft", plural: "drafts" }
                      : isInvoiceList
                        ? { singular: "invoice", plural: "invoices" }
                        : { singular: "order", plural: "orders" }
            }
            itemCount={orders.length}
            selectedItemsCount={
              allResourcesSelected ? "All" : selectedResources.length
            }
            onSelectionChange={handleSelectionChange}
            promotedBulkActions={promotedBulkActions}
            headings={tableHeadings}
            pagination={{
              hasPrevious: data.pageInfo.hasPreviousPage,
              hasNext: data.pageInfo.hasNextPage,
              onPrevious: goToPreviousPage,
              onNext: goToNextPage,
            }}
            emptyState={emptyStateMarkup}
            loading={false}
          >
            {rowMarkup}
          </IndexTable>
        </Card>
        </div>
      </s-page>
      {planUpgradeModal}
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:sales-order-list-reload");
}
