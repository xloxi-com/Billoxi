import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  AppProvider,
  Modal,
  RadioButton,
  Text,
  TextField,
  BlockStack,
  Box,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { SalesOrderLiveDocument } from "../components/sales-order-live-document";
import { requireAdminAuth } from "../shopify-context.server";
import {
  fetchSalesOrderDocument,
  fetchSalesOrderList,
  loadDocumentTemplateSettings,
  loadSalesOrderTemplateSettings,
} from "../sales-order-document.server";
import {
  allocateSalesOrderDocumentNumber,
  getSalesOrderDocumentDetails,
  updateSalesOrderDocumentDetails,
} from "../sales-order-number.server";
import {
  DEFAULT_INVOICE_TEMPLATE_ID,
  findTemplatePreset,
  formatOrderDate,
  paperPaddingCss,
  resolveSalesOrderTemplateId,
  SALES_ORDER_TEMPLATE_STORAGE_KEY,
  toOrderGid,
} from "../sales-order-document";
import {
  loadSelectedTemplateForShop,
  saveNumberSeriesEntryMode,
  loadNumberSeriesEntryForShop,
} from "../shop-settings.server";
import {
  ensureInvoiceDocumentNumbers,
  getInvoicedMetaByOrderGids,
  markOrderInvoiced,
  unmarkOrdersInvoiced,
  updateInvoiceDocumentDetails,
} from "../order-invoice-status.server";
import { markOrderPackingSlip } from "../order-packing-slip-status.server";
import { invalidateSalesOrdersCache } from "../sales-orders.server";
import { PaperScaleFrame } from "../components/paper-scale-frame";
import "../template-editor.css";
import "../sales-order-document.css";

type DocumentMode = "sales-order" | "invoice";

function resolveDocumentMode(requestUrl: string): DocumentMode {
  try {
    const pathname = new URL(requestUrl).pathname;
    return pathname.includes("/app/invoice/") ? "invoice" : "sales-order";
  } catch {
    return "sales-order";
  }
}

function resolveInvoiceTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("invoice-")) {
    return value;
  }
  return DEFAULT_INVOICE_TEMPLATE_ID;
}

function resolveDocumentFontFamily(value: string | undefined): string {
  if (!value) return "Inter, system-ui, sans-serif";
  return value;
}

function fieldValue(event: Event): string {
  const target = event.currentTarget as { value?: string } | null;
  return typeof target?.value === "string" ? target.value : "";
}

function toDateInputValue(iso: string | undefined | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatStatus(status: string | null) {
  if (!status) return "—";
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function paymentBadgeTone(
  status: string | null,
): "success" | "warning" | "critical" | "info" | "neutral" {
  switch ((status || "").toUpperCase()) {
    case "PAID":
      return "success";
    case "PARTIALLY_PAID":
    case "PARTIALLY_REFUNDED":
      return "warning";
    case "REFUNDED":
      return "critical";
    case "VOIDED":
      return "critical";
    case "AUTHORIZED":
    case "PENDING":
      return "warning";
    case "EXPIRED":
      return "critical";
    default:
      return "neutral";
  }
}

function formatMoney(amount: string, currencyCode: string) {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${currencyCode} ${amount}`;
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const orderId = params.orderId;
  if (!orderId) {
    throw new Response("Order not found", { status: 404 });
  }

  const documentMode = resolveDocumentMode(request.url);
  const isInvoice = documentMode === "invoice";
  const url = new URL(request.url);

  const [shopSelectedTemplateId, shopSelectedSalesOrderTemplateId] =
    await Promise.all([
      loadSelectedTemplateForShop(
        session.shop,
        isInvoice ? "invoice" : "sales-order",
      ),
      isInvoice
        ? loadSelectedTemplateForShop(session.shop, "sales-order")
        : Promise.resolve(null),
    ]);

  // Shop Active template wins over a stale ?template= query (e.g. after
  // switching Classic on Templates while an old Studio URL is still open).
  const templateId = isInvoice
    ? resolveInvoiceTemplateId(
        shopSelectedTemplateId || url.searchParams.get("template"),
      )
    : resolveSalesOrderTemplateId(
        shopSelectedTemplateId || url.searchParams.get("template"),
      );
  const orderGid = toOrderGid(decodeURIComponent(orderId));

  // Sidebar list still uses sales-order template ids for SO document numbers.
  const salesOrderTemplateId = isInvoice
    ? resolveSalesOrderTemplateId(shopSelectedSalesOrderTemplateId)
    : templateId;

  const [order, template, salesOrders, numberSeries] = await Promise.all([
    fetchSalesOrderDocument(admin, orderGid),
    isInvoice
      ? loadDocumentTemplateSettings(
          session.shop,
          "invoice",
          templateId,
          admin,
        )
      : loadSalesOrderTemplateSettings(session.shop, templateId, admin),
    fetchSalesOrderList(admin, {
      shop: session.shop,
      templateId: salesOrderTemplateId,
    }),
    loadNumberSeriesEntryForShop(
      session.shop,
      isInvoice ? "invoice" : "sales-order",
    ),
  ]);

  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  let documentNumber: string;
  let referenceNumber: string | undefined;
  let documentDate: string | undefined;
  let invoiceCustomerNote: string | null = null;
  let invoiceTerms: string | null = null;
  let sidebarOrders = salesOrders;

  if (isInvoice) {
    const invoiceMeta = await getInvoicedMetaByOrderGids(
      session.shop,
      salesOrders.map((item) => item.id),
    );
    sidebarOrders = salesOrders.filter((item) => invoiceMeta.has(item.id));
    const currentMeta = invoiceMeta.get(order.id);
    const ensured =
      currentMeta && !currentMeta.documentNumber
        ? await ensureInvoiceDocumentNumbers(session.shop, [order.id])
        : new Map<string, string>();
    documentNumber =
      currentMeta?.documentNumber ||
      ensured.get(order.id) ||
      order.name;
    documentDate =
      currentMeta?.invoicedAt?.toISOString() || order.createdAt;
    invoiceCustomerNote = currentMeta?.customerNote ?? null;
    invoiceTerms = currentMeta?.terms ?? null;

    const existingSalesOrderNumber = salesOrders.find(
      (item) => item.id === order.id,
    )?.documentNumber;
    if (existingSalesOrderNumber) {
      referenceNumber = existingSalesOrderNumber;
    } else {
      const salesOrderSettings = await loadSalesOrderTemplateSettings(
        session.shop,
        salesOrderTemplateId,
        admin,
      );
      referenceNumber = await allocateSalesOrderDocumentNumber(
        session.shop,
        salesOrderTemplateId,
        order.id,
        salesOrderSettings.settings.numbering,
      );
    }

    sidebarOrders = sidebarOrders.map((item) => {
      const meta = invoiceMeta.get(item.id);
      return {
        ...item,
        documentNumber:
          meta?.documentNumber ||
          (item.id === order.id ? documentNumber : item.documentNumber),
        // Sidebar date follows editable invoice date.
        createdAt: meta?.invoicedAt?.toISOString() || item.createdAt,
      };
    });
  } else {
    documentNumber = await allocateSalesOrderDocumentNumber(
      session.shop,
      template.templateId,
      order.id,
      template.settings.numbering,
    );
    const soDetails = await getSalesOrderDocumentDetails(
      session.shop,
      template.templateId,
      order.id,
    );
    documentDate =
      soDetails?.documentDate?.toISOString() || order.createdAt;
    invoiceCustomerNote = soDetails?.customerNote ?? null;
    invoiceTerms = soDetails?.terms ?? null;
  }

  return {
    documentMode,
    order: {
      ...order,
      documentNumber,
      ...(referenceNumber ? { referenceNumber } : {}),
      ...(documentDate ? { documentDate } : {}),
    },
    salesOrders: sidebarOrders,
    templateId: template.templateId,
    templateName: template.templateName,
    settings: template.settings,
    storeDetails: template.storeDetails,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    invoiceEntryMode: (numberSeries?.entryMode === "manual"
      ? "manual"
      : "auto") as "auto" | "manual",
    invoiceCustomerNote,
    invoiceTerms,
    // Status ribbons (Invoiced / Confirmed / Voided) are for admin app staff only (never included in print/PDF).
    isAdmin: true,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await requireAdminAuth(request);
  const orderId = params.orderId;
  if (!orderId) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const orderGid = toOrderGid(decodeURIComponent(orderId));

  if (
    intent === "set-invoice-entry-mode" ||
    intent === "set-sales-order-entry-mode"
  ) {
    const mode = String(formData.get("entryMode") || "");
    if (mode !== "auto" && mode !== "manual") {
      return Response.json(
        { ok: false, error: "Invalid number entry mode" },
        { status: 400 },
      );
    }
    const moduleId =
      intent === "set-sales-order-entry-mode" ? "sales-order" : "invoice";
    await saveNumberSeriesEntryMode(session.shop, moduleId, mode);
    return Response.json({
      ok: true,
      document: "document-entry-mode" as const,
      moduleId,
      entryMode: mode,
    });
  }

  if (intent === "convert-to-invoice") {
    await markOrderInvoiced(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "invoice" as const,
    });
  }

  if (intent === "convert-to-packing-slip") {
    await markOrderPackingSlip(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "packing-slip" as const,
    });
  }

  if (intent === "delete-invoice") {
    const deleted = await unmarkOrdersInvoiced(session.shop, [orderGid]);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-invoice" as const,
    });
  }

  if (intent === "update-invoice-details") {
    const documentNumber = String(formData.get("documentNumber") || "").trim();
    const invoiceDateRaw = String(formData.get("invoiceDate") || "").trim();
    const customerNote = String(formData.get("customerNote") || "");
    const terms = String(formData.get("terms") || "");
    if (!documentNumber) {
      return Response.json(
        { ok: false, error: "Invoice number is required" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDateRaw)) {
      return Response.json(
        { ok: false, error: "Invoice date is required" },
        { status: 400 },
      );
    }
    const invoicedAt = new Date(`${invoiceDateRaw}T12:00:00.000Z`);
    if (Number.isNaN(invoicedAt.getTime())) {
      return Response.json(
        { ok: false, error: "Invalid invoice date" },
        { status: 400 },
      );
    }

    const result = await updateInvoiceDocumentDetails(session.shop, orderGid, {
      documentNumber,
      invoicedAt,
      customerNote,
      terms,
    });
    if (!result.ok) {
      return Response.json(
        { ok: false, error: result.error },
        { status: 400 },
      );
    }
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "update-invoice" as const,
      documentNumber,
      invoiceDate: invoiceDateRaw,
    });
  }

  if (intent === "update-sales-order-details") {
    const documentNumber = String(formData.get("documentNumber") || "").trim();
    const orderDateRaw = String(formData.get("orderDate") || "").trim();
    const customerNote = String(formData.get("customerNote") || "");
    const terms = String(formData.get("terms") || "");
    const templateId = resolveSalesOrderTemplateId(
      String(formData.get("templateId") || "") ||
        (await loadSelectedTemplateForShop(session.shop, "sales-order")),
    );
    if (!documentNumber) {
      return Response.json(
        { ok: false, error: "Sales order number is required" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDateRaw)) {
      return Response.json(
        { ok: false, error: "Order date is required" },
        { status: 400 },
      );
    }
    const documentDate = new Date(`${orderDateRaw}T12:00:00.000Z`);
    if (Number.isNaN(documentDate.getTime())) {
      return Response.json(
        { ok: false, error: "Invalid order date" },
        { status: 400 },
      );
    }

    const result = await updateSalesOrderDocumentDetails(
      session.shop,
      templateId,
      orderGid,
      {
        documentNumber,
        documentDate,
        customerNote,
        terms,
      },
    );
    if (!result.ok) {
      return Response.json(
        { ok: false, error: result.error },
        { status: 400 },
      );
    }
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "update-sales-order" as const,
      documentNumber,
      orderDate: orderDateRaw,
    });
  }

  return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function SalesOrderDocumentPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const convertFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    document?: string;
    moduleId?: string;
    entryMode?: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const paperRef = useRef<HTMLDivElement>(null);
  const actionRanRef = useRef(false);
  const handledConvertDataRef = useRef<unknown>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const isConverting = convertFetcher.state !== "idle";
  const isInvoice = data.documentMode === "invoice";
  const listPath = isInvoice ? "/app/invoice" : "/app/sales-order";
  const documentBasePath = isInvoice ? "/app/invoice" : "/app/sales-order";
  const templateQuery = useMemo(
    () => `?template=${encodeURIComponent(data.templateId)}`,
    [data.templateId],
  );
  const [editInvoiceNumber, setEditInvoiceNumber] = useState(
    data.order.documentNumber || "",
  );
  const [editInvoiceDate, setEditInvoiceDate] = useState(
    toDateInputValue(data.order.documentDate || data.order.createdAt),
  );
  const [editCustomerNote, setEditCustomerNote] = useState(
    data.invoiceCustomerNote ?? data.settings.notes ?? "",
  );
  const [editTerms, setEditTerms] = useState(
    data.invoiceTerms ?? data.settings.terms ?? "",
  );
  const [invoiceEntryMode, setInvoiceEntryMode] = useState<"auto" | "manual">(
    data.invoiceEntryMode ?? "auto",
  );
  const [numberPrefOpen, setNumberPrefOpen] = useState(false);
  const [numberPrefChoice, setNumberPrefChoice] = useState<
    "continue-auto" | "manual" | "once"
  >("once");
  const [invoiceEditOpen, setInvoiceEditOpen] = useState(false);
  const [deleteInvoiceOpen, setDeleteInvoiceOpen] = useState(false);
  const numberPrefHandledRef = useRef(false);
  const originalInvoiceNumber = data.order.documentNumber || "";

  useEffect(() => {
    setEditInvoiceNumber(data.order.documentNumber || "");
    setEditInvoiceDate(
      toDateInputValue(data.order.documentDate || data.order.createdAt),
    );
    setEditCustomerNote(
      data.invoiceCustomerNote ?? data.settings.notes ?? "",
    );
    setEditTerms(data.invoiceTerms ?? data.settings.terms ?? "");
    setInvoiceEntryMode(data.invoiceEntryMode ?? "auto");
    numberPrefHandledRef.current = false;
    setInvoiceEditOpen(false);
  }, [
    data.invoiceCustomerNote,
    data.invoiceEntryMode,
    data.invoiceTerms,
    data.order.createdAt,
    data.order.documentDate,
    data.order.documentNumber,
    data.order.id,
    data.settings.notes,
    data.settings.terms,
  ]);

  const previewOrder = useMemo(() => {
    if (!invoiceEditOpen) return data.order;
    const dateIso = editInvoiceDate
      ? `${editInvoiceDate}T12:00:00.000Z`
      : data.order.documentDate || data.order.createdAt;
    return {
      ...data.order,
      documentNumber: editInvoiceNumber.trim() || data.order.documentNumber,
      documentDate: dateIso,
    };
  }, [
    data.order,
    editInvoiceDate,
    editInvoiceNumber,
    invoiceEditOpen,
  ]);

  const previewSettings = useMemo(() => {
    if (invoiceEditOpen) {
      return {
        ...data.settings,
        notes: editCustomerNote,
        terms: editTerms,
      };
    }
    return {
      ...data.settings,
      notes: data.invoiceCustomerNote ?? data.settings.notes,
      terms: data.invoiceTerms ?? data.settings.terms,
    };
  }, [
    data.invoiceCustomerNote,
    data.invoiceTerms,
    data.settings,
    editCustomerNote,
    editTerms,
    invoiceEditOpen,
  ]);

  const savedCustomerNote =
    data.invoiceCustomerNote ?? data.settings.notes ?? "";
  const savedTerms = data.invoiceTerms ?? data.settings.terms ?? "";

  const invoiceDetailsDirty =
    invoiceEditOpen &&
    (editInvoiceNumber.trim() !== (data.order.documentNumber || "").trim() ||
      editInvoiceDate !==
        toDateInputValue(data.order.documentDate || data.order.createdAt) ||
      editCustomerNote !== savedCustomerNote ||
      editTerms !== savedTerms);

  const maybePromptNumberPref = useCallback(() => {
    if (numberPrefHandledRef.current || numberPrefOpen) {
      return false;
    }
    if (editInvoiceNumber.trim() === originalInvoiceNumber.trim()) {
      return false;
    }
    setNumberPrefChoice(invoiceEntryMode === "manual" ? "manual" : "once");
    setNumberPrefOpen(true);
    return true;
  }, [
    editInvoiceNumber,
    invoiceEntryMode,
    numberPrefOpen,
    originalInvoiceNumber,
  ]);

  const handleInvoiceNumberInput = useCallback((event: Event) => {
    setEditInvoiceNumber(fieldValue(event));
    // Allow the 3 preference options again after another number edit.
    numberPrefHandledRef.current = false;
  }, []);

  const handleInvoiceNumberBlur = useCallback(() => {
    maybePromptNumberPref();
  }, [maybePromptNumberPref]);

  const closeNumberPrefModal = useCallback((revert: boolean) => {
    setNumberPrefOpen(false);
    if (revert) {
      setEditInvoiceNumber(originalInvoiceNumber);
      numberPrefHandledRef.current = false;
    } else {
      numberPrefHandledRef.current = true;
    }
  }, [originalInvoiceNumber]);

  const confirmNumberPref = useCallback(() => {
    if (numberPrefChoice === "continue-auto") {
      if (invoiceEntryMode !== "auto") {
        const formData = new FormData();
        formData.set(
          "intent",
          isInvoice ? "set-invoice-entry-mode" : "set-sales-order-entry-mode",
        );
        formData.set("entryMode", "auto");
        convertFetcher.submit(formData, { method: "post" });
        setInvoiceEntryMode("auto");
      }
      closeNumberPrefModal(true);
      return;
    }

    if (numberPrefChoice === "manual") {
      if (!editInvoiceNumber.trim()) {
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(
            isInvoice
              ? "Enter an invoice number"
              : "Enter a sales order number",
            { isError: true },
          );
        }
        return;
      }
      if (invoiceEntryMode !== "manual") {
        const formData = new FormData();
        formData.set(
          "intent",
          isInvoice ? "set-invoice-entry-mode" : "set-sales-order-entry-mode",
        );
        formData.set("entryMode", "manual");
        convertFetcher.submit(formData, { method: "post" });
        setInvoiceEntryMode("manual");
      }
      closeNumberPrefModal(false);
      return;
    }

    // once: keep this edited number, stay on / switch to auto for future documents
    if (invoiceEntryMode !== "auto") {
      const formData = new FormData();
      formData.set(
        "intent",
        isInvoice ? "set-invoice-entry-mode" : "set-sales-order-entry-mode",
      );
      formData.set("entryMode", "auto");
      convertFetcher.submit(formData, { method: "post" });
      setInvoiceEntryMode("auto");
    }
    closeNumberPrefModal(false);
  }, [
    closeNumberPrefModal,
    convertFetcher,
    editInvoiceNumber,
    invoiceEntryMode,
    isInvoice,
    numberPrefChoice,
  ]);

  const closeInvoiceEdit = useCallback(() => {
    setEditInvoiceNumber(data.order.documentNumber || "");
    setEditInvoiceDate(
      toDateInputValue(data.order.documentDate || data.order.createdAt),
    );
    setEditCustomerNote(
      data.invoiceCustomerNote ?? data.settings.notes ?? "",
    );
    setEditTerms(data.invoiceTerms ?? data.settings.terms ?? "");
    numberPrefHandledRef.current = false;
    setNumberPrefOpen(false);
    setInvoiceEditOpen(false);
  }, [
    data.invoiceCustomerNote,
    data.invoiceTerms,
    data.order.createdAt,
    data.order.documentDate,
    data.order.documentNumber,
    data.settings.notes,
    data.settings.terms,
  ]);

  const requestCloseInvoiceEdit = useCallback(() => {
    // Click-outside / dismiss: if number changed, show the 3 preference options first.
    if (maybePromptNumberPref()) return;
    closeInvoiceEdit();
  }, [closeInvoiceEdit, maybePromptNumberPref]);

  const openInvoiceEdit = useCallback(() => {
    setEditInvoiceNumber(data.order.documentNumber || "");
    setEditInvoiceDate(
      toDateInputValue(data.order.documentDate || data.order.createdAt),
    );
    setEditCustomerNote(
      data.invoiceCustomerNote ?? data.settings.notes ?? "",
    );
    setEditTerms(data.invoiceTerms ?? data.settings.terms ?? "");
    numberPrefHandledRef.current = false;
    setInvoiceEditOpen(true);
  }, [
    data.invoiceCustomerNote,
    data.invoiceTerms,
    data.order.createdAt,
    data.order.documentDate,
    data.order.documentNumber,
    data.settings.notes,
    data.settings.terms,
  ]);

  const handleSaveInvoiceDetails = useCallback(() => {
    if (!invoiceEditOpen || isConverting) return;
    if (maybePromptNumberPref()) return;
    const formData = new FormData();
    if (isInvoice) {
      formData.set("intent", "update-invoice-details");
      formData.set("documentNumber", editInvoiceNumber.trim());
      formData.set("invoiceDate", editInvoiceDate);
      formData.set("customerNote", editCustomerNote);
      formData.set("terms", editTerms);
    } else {
      formData.set("intent", "update-sales-order-details");
      formData.set("templateId", data.templateId);
      formData.set("documentNumber", editInvoiceNumber.trim());
      formData.set("orderDate", editInvoiceDate);
      formData.set("customerNote", editCustomerNote);
      formData.set("terms", editTerms);
    }
    convertFetcher.submit(formData, { method: "post" });
  }, [
    convertFetcher,
    data.templateId,
    editCustomerNote,
    editInvoiceDate,
    editInvoiceNumber,
    editTerms,
    invoiceEditOpen,
    isConverting,
    isInvoice,
    maybePromptNumberPref,
  ]);

  useEffect(() => {
    if (isInvoice) {
      if (searchParams.get("template") !== data.templateId) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("template", data.templateId);
            return next;
          },
          { replace: true },
        );
      }
      return;
    }

    const localTemplate = window.localStorage.getItem(
      SALES_ORDER_TEMPLATE_STORAGE_KEY,
    );
    const resolvedLocal = resolveSalesOrderTemplateId(localTemplate);

    if (
      !data.hasSelectedTemplate &&
      localTemplate &&
      resolvedLocal !== data.templateId
    ) {
      const formData = new FormData();
      formData.set("intent", "select-template");
      formData.set("documentType", "sales-order");
      formData.set("templateId", resolvedLocal);
      void fetch("/app/templates", { method: "POST", body: formData }).then(
        (response) => {
          if (!response.ok) return;
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set("template", resolvedLocal);
              return next;
            },
            { replace: true },
          );
        },
      );
      return;
    }

    window.localStorage.setItem(
      SALES_ORDER_TEMPLATE_STORAGE_KEY,
      data.templateId,
    );
    if (searchParams.get("template") !== data.templateId) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("template", data.templateId);
          return next;
        },
        { replace: true },
      );
    }
  }, [
    data.hasSelectedTemplate,
    data.templateId,
    isInvoice,
    searchParams,
    setSearchParams,
  ]);

  const openOrder = useCallback(
    (orderGid: string) => {
      const numericId = orderGid.includes("/")
        ? orderGid.split("/").pop() || orderGid
        : orderGid;
      navigate(
        `${documentBasePath}/${encodeURIComponent(numericId)}${templateQuery}`,
      );
    },
    [documentBasePath, navigate, templateQuery],
  );

  const handlePrint = useCallback(async () => {
    if (isPrinting || isDownloading) return;
    const paper = paperRef.current;
    if (!paper) return;

    setIsPrinting(true);
    try {
      const { printSalesOrderDomVectorPdf } = await import(
        "../sales-order-pdf"
      );
      await printSalesOrderDomVectorPdf(paper, {
        paperSize: data.settings.paperSize,
        orientation: data.settings.orientation,
        backgroundColor: data.settings.backgroundColor,
        fontFamily: resolveDocumentFontFamily(data.settings.fontFamily),
        margins: data.settings.margins,
      });
    } catch (error) {
      console.error("Print failed:", error);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show("Print failed", { isError: true });
      }
    } finally {
      setIsPrinting(false);
    }
  }, [data.settings, isDownloading, isPrinting]);

  const handleDownload = useCallback(async () => {
    if (isDownloading || isPrinting) return;
    const paper = paperRef.current;
    if (!paper) return;

    setIsDownloading(true);
    try {
      const { downloadSalesOrderDomVectorPdf } = await import(
        "../sales-order-pdf"
      );
      await downloadSalesOrderDomVectorPdf(
        paper,
        {
          paperSize: data.settings.paperSize,
          orientation: data.settings.orientation,
          backgroundColor: data.settings.backgroundColor,
          fontFamily: resolveDocumentFontFamily(data.settings.fontFamily),
          margins: data.settings.margins,
        },
        previewOrder.documentNumber || data.order.name,
        isInvoice ? "invoice" : "sales-order",
      );

      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show("PDF downloaded");
      }
    } catch (error) {
      console.error("PDF download failed:", error);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show("PDF download failed", { isError: true });
      }
    } finally {
      setIsDownloading(false);
    }
  }, [
    data.order.name,
    data.settings,
    isDownloading,
    isInvoice,
    isPrinting,
    previewOrder.documentNumber,
  ]);

  const handleSend = useCallback(() => {
    const email = data.order.email || data.order.billing.email;
    if (!email) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show("No customer email on this order", { isError: true });
      }
      return;
    }

    const label = isInvoice ? "Invoice" : "Sales Order";
    const docNo = data.order.documentNumber || data.order.name;
    const subject = encodeURIComponent(`${label} ${docNo}`);
    const body = encodeURIComponent(
      `Please find ${label.toLowerCase()} ${docNo} attached.\n\nTotal: ${data.order.currencyCode} ${data.order.total}`,
    );
    window.open(
      `mailto:${email}?subject=${subject}&body=${body}`,
      "_blank",
      "noopener,noreferrer",
    );
    if (typeof shopify !== "undefined" && shopify.toast) {
      shopify.toast.show(`Email draft opened for ${email}`);
    }
  }, [data.order, isInvoice]);

  const [queuedAction, setQueuedAction] = useState<
    "print" | "download" | "send" | null
  >(null);

  useEffect(() => {
    actionRanRef.current = false;
    setQueuedAction(null);
  }, [data.order.id]);

  // Deep-link from Sales Orders list action icons (?action=print|download|send).
  useEffect(() => {
    const action = searchParams.get("action");
    if (!action || actionRanRef.current) return;
    if (action !== "print" && action !== "download" && action !== "send") return;

    actionRanRef.current = true;
    setQueuedAction(action);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("action");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!queuedAction) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 80;
    let retryTimer = 0;
    const action = queuedAction;

    const documentReady = (paper: HTMLDivElement | null) => {
      if (!paper) return false;
      const live = paper.querySelector(".live-document");
      if (!live || paper.offsetHeight <= 40) return false;
      const images = Array.from(paper.querySelectorAll("img"));
      if (images.some((img) => !img.complete)) return false;
      return true;
    };

    const runWhenReady = () => {
      if (cancelled) return;
      attempts += 1;
      const paper = paperRef.current;
      if (!documentReady(paper) && attempts < maxAttempts) {
        retryTimer = window.setTimeout(runWhenReady, 100);
        return;
      }

      const start = () => {
        if (cancelled) return;
        // Clear before invoke so handler state updates don't re-trigger this effect.
        setQueuedAction(null);
        if (action === "print") void handlePrint();
        else if (action === "download") void handleDownload();
        else handleSend();
      };

      if (typeof document !== "undefined" && document.fonts?.ready) {
        void document.fonts.ready.then(start).catch(start);
        return;
      }
      start();
    };

    const timer = window.setTimeout(runWhenReady, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [queuedAction, handleDownload, handlePrint, handleSend]);

  const activeListItem = data.salesOrders.find(
    (item) => item.id === data.order.id,
  );
  const paymentStatus = activeListItem?.paymentStatus ?? null;
  const paymentLabel = formatStatus(paymentStatus);
  const paymentStatusKey = (paymentStatus || "").toLowerCase();
  const isCancelledOrder =
    paymentStatusKey === "voided" || paymentStatusKey.includes("cancel");
  const alreadyInvoiced = Boolean(activeListItem?.invoiced);
  const isPaidOrder = paymentStatusKey === "paid";
  const showVoidedBadge = data.isAdmin && isCancelledOrder;
  const showInvoicedBadge =
    data.isAdmin && alreadyInvoiced && !isCancelledOrder && !isInvoice;
  const showConfirmedBadge =
    data.isAdmin && isPaidOrder && !isCancelledOrder && !alreadyInvoiced;

  const handleConvertToInvoice = useCallback(() => {
    if (isConverting || isCancelledOrder) return;
    convertFetcher.submit(
      { intent: "convert-to-invoice" },
      { method: "post" },
    );
  }, [convertFetcher, isCancelledOrder, isConverting]);

  const handleConvertToPackingSlip = useCallback(() => {
    if (isConverting || isCancelledOrder) return;
    convertFetcher.submit(
      { intent: "convert-to-packing-slip" },
      { method: "post" },
    );
  }, [convertFetcher, isCancelledOrder, isConverting]);

  const handleDeleteInvoice = useCallback(() => {
    if (!isInvoice || isConverting) return;
    setDeleteInvoiceOpen(false);
    convertFetcher.submit({ intent: "delete-invoice" }, { method: "post" });
  }, [convertFetcher, isConverting, isInvoice]);

  useEffect(() => {
    if (convertFetcher.state !== "idle" || !convertFetcher.data) return;
    if (handledConvertDataRef.current === convertFetcher.data) return;
    handledConvertDataRef.current = convertFetcher.data;

    const result = convertFetcher.data;
    if (!("ok" in result) || !result.ok) {
      if (
        "error" in result &&
        result.error &&
        typeof shopify !== "undefined" &&
        shopify.toast
      ) {
        shopify.toast.show(String(result.error), { isError: true });
      }
      return;
    }

    if (typeof shopify !== "undefined" && shopify.toast) {
      if (result.document === "update-invoice") {
        shopify.toast.show("Invoice details saved");
        setInvoiceEditOpen(false);
      } else if (result.document === "update-sales-order") {
        shopify.toast.show("Sales order details saved");
        setInvoiceEditOpen(false);
      } else if (result.document === "delete-invoice") {
        shopify.toast.show("Invoice deleted");
        navigate(listPath);
        return;
      } else if (result.document === "document-entry-mode") {
        const isSo = result.moduleId === "sales-order";
        shopify.toast.show(
          result.entryMode === "manual"
            ? `${isSo ? "Sales order" : "Invoice"} numbers set to manual entry`
            : `${isSo ? "Sales order" : "Invoice"} numbers set to auto-generate`,
        );
      } else if (result.document === "invoice-entry-mode") {
        shopify.toast.show(
          result.entryMode === "manual"
            ? "Invoice numbers set to manual entry"
            : "Invoice numbers set to auto-generate",
        );
      } else if (result.document === "packing-slip") {
        shopify.toast.show("Converted to packing slip");
      } else if (result.document === "invoice") {
        shopify.toast.show("Converted to invoice");
      }
    }
    if (
      result.document !== "document-entry-mode" &&
      result.document !== "invoice-entry-mode"
    ) {
      revalidator.revalidate();
    }
  }, [
    convertFetcher.data,
    convertFetcher.state,
    listPath,
    navigate,
    revalidator,
  ]);

  return (
    <s-page
      heading={previewOrder.documentNumber || data.order.name}
      inlineSize="large"
    >
      <s-link slot="breadcrumb-actions" href={listPath}>
        {isInvoice ? "Invoice" : "Sales Orders"}
      </s-link>
      {paymentStatus ? (
        <s-badge slot="accessory" tone={paymentBadgeTone(paymentStatus)}>
          {paymentLabel}
        </s-badge>
      ) : null}
      <s-button
        slot="primary-action"
        variant="primary"
        icon="download"
        loading={isDownloading || undefined}
        disabled={isConverting || undefined}
        onClick={() => {
          void handleDownload();
        }}
      >
        {isDownloading ? "Downloading…" : "Download"}
      </s-button>
      <s-button
        slot="secondary-actions"
        icon="edit"
        disabled={isConverting || undefined}
        onClick={openInvoiceEdit}
      >
        Edit
      </s-button>
      {!isCancelledOrder ? (
        <>
          {!isInvoice && !alreadyInvoiced ? (
            <s-button
              slot="secondary-actions"
              loading={
                (isConverting &&
                  convertFetcher.formData?.get("intent") ===
                    "convert-to-invoice") ||
                undefined
              }
              disabled={isConverting || undefined}
              onClick={handleConvertToInvoice}
            >
              Convert to invoice
            </s-button>
          ) : null}
          {!isInvoice && !activeListItem?.packingSlip ? (
            <s-button
              slot="secondary-actions"
              loading={
                (isConverting &&
                  convertFetcher.formData?.get("intent") ===
                    "convert-to-packing-slip") ||
                undefined
              }
              disabled={isConverting || undefined}
              onClick={handleConvertToPackingSlip}
            >
              Convert to packing slip
            </s-button>
          ) : null}
        </>
      ) : null}
      <s-button
        slot="secondary-actions"
        icon="email"
        disabled={isConverting || isCancelledOrder || undefined}
        onClick={handleSend}
      >
        Send Email
      </s-button>
      <s-button
        slot="secondary-actions"
        icon="print"
        loading={isPrinting || undefined}
        disabled={isConverting || undefined}
        onClick={() => {
          void handlePrint();
        }}
      >
        {isPrinting ? "Preparing…" : "Print"}
      </s-button>
      {isInvoice ? (
        <s-button
          slot="secondary-actions"
          icon="delete"
          tone="critical"
          loading={
            (isConverting &&
              convertFetcher.formData?.get("intent") === "delete-invoice") ||
            undefined
          }
          disabled={isConverting || undefined}
          onClick={() => setDeleteInvoiceOpen(true)}
        >
          Delete
        </s-button>
      ) : null}

      <div className="sales-order-document-page">
        <s-grid
          gridTemplateColumns="minmax(340px, 400px) minmax(0, 1fr)"
          gap="small-200"
          alignItems="start"
        >
          <aside className="sales-order-document-sidebar no-print">
            <s-section heading={isInvoice ? "Invoices" : "Sales orders"}>
              <s-button
                slot="secondary-actions"
                variant="tertiary"
                href={listPath}
              >
                View all
              </s-button>
              <div className="sales-order-document-sidebar__list">
                <s-box
                  border="base"
                  borderRadius="base"
                  overflow="hidden"
                  background="base"
                >
                  {data.salesOrders.map((item, index) => {
                    const isActive = item.id === data.order.id;
                    const salesOrderLabel =
                      item.documentNumber || item.name;
                    return (
                      <div key={item.id}>
                        {index > 0 ? (
                          <s-box paddingInline="small">
                            <s-divider />
                          </s-box>
                        ) : null}
                        <s-clickable
                          accessibilityLabel={`Open ${salesOrderLabel}`}
                          background={isActive ? "subdued" : "transparent"}
                          padding="small"
                          onClick={() => {
                            if (!isActive) openOrder(item.id);
                          }}
                        >
                          <div
                            className={
                              isActive
                                ? "sales-order-sidebar-item sales-order-sidebar-item--active"
                                : "sales-order-sidebar-item"
                            }
                          >
                            <s-stack direction="block" gap="small-200">
                              <s-grid
                                gridTemplateColumns="1fr auto"
                                gap="small"
                                alignItems="start"
                              >
                                <span className="sales-order-sidebar-customer">
                                  {item.customer}
                                </span>
                                <s-text type="strong">
                                  {formatMoney(item.total, item.currencyCode)}
                                </s-text>
                              </s-grid>
                              <s-stack
                                direction="inline"
                                gap="small-200"
                                alignItems="center"
                              >
                                <s-text color="subdued">
                                  {salesOrderLabel}
                                </s-text>
                                <s-text color="subdued">·</s-text>
                                <s-text color="subdued">
                                  {formatOrderDate(item.createdAt)}
                                </s-text>
                              </s-stack>
                              <s-stack
                              direction="inline"
                              gap="small-200"
                              alignItems="center"
                            >
                              {item.paymentStatus ? (
                                <s-badge
                                  tone={paymentBadgeTone(item.paymentStatus)}
                                >
                                  {formatStatus(item.paymentStatus)}
                                </s-badge>
                              ) : null}
                              {!isInvoice ? (
                                <span
                                  className={
                                    item.invoiced
                                      ? "sales-order-sidebar-dot sales-order-sidebar-dot--invoiced"
                                      : "sales-order-sidebar-dot"
                                  }
                                  role="img"
                                  aria-label={
                                    item.invoiced
                                      ? "Invoiced"
                                      : "Not invoiced"
                                  }
                                  title={
                                    item.invoiced
                                      ? "Invoiced"
                                      : "Not invoiced"
                                  }
                                />
                              ) : null}
                            </s-stack>
                            </s-stack>
                          </div>
                        </s-clickable>
                      </div>
                    );
                  })}
                </s-box>
              </div>
            </s-section>
          </aside>

          <div className="sales-order-document-stage">
            <PaperScaleFrame>
              <div
                ref={paperRef}
                className={`template-editor__paper template-editor__paper--${data.settings.orientation} template-editor__paper--${data.settings.paperSize.toLowerCase()}`}
                style={{
                  backgroundColor: data.settings.backgroundColor,
                  fontFamily: resolveDocumentFontFamily(
                    data.settings.fontFamily,
                  ),
                  padding: paperPaddingCss(data.settings.margins),
                }}
              >
                {showVoidedBadge ? (
                  <div
                    className="sales-order-status-ribbon sales-order-status-ribbon--voided no-print"
                    aria-label="Voided"
                  >
                    <span>Voided</span>
                  </div>
                ) : showInvoicedBadge ? (
                  <div
                    className="sales-order-status-ribbon sales-order-status-ribbon--invoiced no-print"
                    aria-label="Invoiced"
                  >
                    <span>Invoiced</span>
                  </div>
                ) : showConfirmedBadge ? (
                  <div
                    className="sales-order-status-ribbon sales-order-status-ribbon--confirmed no-print"
                    aria-label="Confirmed"
                  >
                    <span>Confirmed</span>
                  </div>
                ) : null}
                <SalesOrderLiveDocument
                  settings={previewSettings}
                  templateId={data.templateId}
                  storeDetails={data.storeDetails}
                  order={previewOrder}
                />
              </div>
            </PaperScaleFrame>
          </div>
        </s-grid>
      </div>
      <AppProvider i18n={enTranslations}>
        <Modal
          open={deleteInvoiceOpen}
          onClose={() => setDeleteInvoiceOpen(false)}
          title="Delete invoice?"
          primaryAction={{
            content: "Delete",
            destructive: true,
            onAction: handleDeleteInvoice,
            loading:
              isConverting &&
              convertFetcher.formData?.get("intent") === "delete-invoice",
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setDeleteInvoiceOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <Text as="p">
              Are you sure you want to delete this invoice? The sales order will
              stay; only the invoice record is removed.
            </Text>
          </Modal.Section>
        </Modal>
        <Modal
          open={invoiceEditOpen && !numberPrefOpen}
          onClose={requestCloseInvoiceEdit}
          title={isInvoice ? "Edit invoice" : "Edit sales order"}
          primaryAction={{
            content: "Save",
            onAction: handleSaveInvoiceDetails,
            loading:
              isConverting &&
              (convertFetcher.formData?.get("intent") ===
                "update-invoice-details" ||
                convertFetcher.formData?.get("intent") ===
                  "update-sales-order-details"),
            disabled: !invoiceDetailsDirty || isConverting,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: closeInvoiceEdit,
            },
          ]}
        >
          <Modal.Section>
            <s-stack direction="block" gap="base">
              <s-grid
                gridTemplateColumns="1fr 1fr"
                gap="base"
                alignItems="end"
              >
                <s-text-field
                  label={isInvoice ? "Invoice number" : "Sales order number"}
                  value={editInvoiceNumber}
                  onInput={handleInvoiceNumberInput}
                  onBlur={handleInvoiceNumberBlur}
                  autocomplete="off"
                />
                <s-date-field
                  label={isInvoice ? "Invoice date" : "Order date"}
                  value={editInvoiceDate}
                  onInput={(event: Event) =>
                    setEditInvoiceDate(fieldValue(event))
                  }
                  onChange={(event: Event) =>
                    setEditInvoiceDate(fieldValue(event))
                  }
                />
              </s-grid>
              <s-text-area
                label="Customer note"
                value={editCustomerNote}
                rows={3}
                onInput={(event: Event) =>
                  setEditCustomerNote(fieldValue(event))
                }
              />
              <s-text-area
                label="Terms & Conditions"
                value={editTerms}
                rows={3}
                onInput={(event: Event) => setEditTerms(fieldValue(event))}
              />
              <s-banner tone="info" heading="Important">
                Items, prices, discounts, tax, and totals cannot be edited here.
                Update them in the Shopify order — changes sync to this{" "}
                {isInvoice ? "invoice" : "sales order"} automatically.
              </s-banner>
              {invoiceEntryMode === "manual" ? (
                <Text as="p" tone="subdued">
                  {isInvoice ? "Invoice" : "Sales order"} numbers are set to
                  manual entry.
                </Text>
              ) : null}
            </s-stack>
          </Modal.Section>
        </Modal>
        <Modal
          open={numberPrefOpen}
          onClose={() => closeNumberPrefModal(true)}
          title={
            isInvoice
              ? "Configure Invoice Number Preferences"
              : "Configure Sales Order Number Preferences"
          }
          primaryAction={{
            content: "Save",
            onAction: confirmNumberPref,
            disabled:
              numberPrefChoice === "manual" && !editInvoiceNumber.trim(),
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => closeNumberPrefModal(true),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p">
                {isInvoice
                  ? "Your invoice numbers are set on auto-generate mode to save your time. Are you sure about changing this setting?"
                  : "Your sales order numbers are set on auto-generate mode to save your time. Are you sure about changing this setting?"}
              </Text>
              <BlockStack gap="200">
                <RadioButton
                  label={
                    isInvoice
                      ? "Continue auto-generating invoice numbers"
                      : "Continue auto-generating sales order numbers"
                  }
                  checked={numberPrefChoice === "continue-auto"}
                  id="document-number-pref-auto"
                  name="document-number-pref"
                  onChange={() => setNumberPrefChoice("continue-auto")}
                />
                <RadioButton
                  label={
                    isInvoice
                      ? "Enter invoice numbers manually"
                      : "Enter sales order numbers manually"
                  }
                  checked={numberPrefChoice === "manual"}
                  id="document-number-pref-manual"
                  name="document-number-pref"
                  onChange={() => setNumberPrefChoice("manual")}
                />
                {numberPrefChoice === "manual" ? (
                  <Box paddingInlineStart="600">
                    <TextField
                      label={
                        isInvoice ? "Invoice number" : "Sales order number"
                      }
                      labelHidden
                      value={editInvoiceNumber}
                      onChange={setEditInvoiceNumber}
                      placeholder={
                        isInvoice
                          ? "e.g. INV-0004"
                          : "e.g. SO-0004"
                      }
                      autoComplete="off"
                      autoFocus
                    />
                  </Box>
                ) : null}
                <RadioButton
                  label={
                    isInvoice
                      ? `Enter the invoice number '${editInvoiceNumber.trim() || originalInvoiceNumber}' for this invoice but resume auto-generating invoice numbers from the next invoice`
                      : `Enter the sales order number '${editInvoiceNumber.trim() || originalInvoiceNumber}' for this sales order but resume auto-generating sales order numbers from the next sales order`
                  }
                  checked={numberPrefChoice === "once"}
                  id="document-number-pref-once"
                  name="document-number-pref"
                  onChange={() => setNumberPrefChoice("once")}
                />
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </AppProvider>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
