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
  Text,
  RadioButton,
  BlockStack,
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
import { numberingFromSeries } from "../number-series";
import {
  DEFAULT_CREDIT_NOTE_TEMPLATE_ID,
  DEFAULT_INVOICE_TEMPLATE_ID,
  findTemplatePreset,
  formatOrderDate,
  paperPaddingCss,
  resolveDocumentNotes,
  resolveSalesOrderTemplateId,
  SALES_ORDER_TEMPLATE_STORAGE_KEY,
  toOrderGid,
} from "../sales-order-document";
import {
  loadNumberSeriesEntryForShop,
  loadSelectedTemplateForShop,
  loadSelectedTemplatesForShop,
} from "../shop-settings.server";
import {
  ensureInvoiceDocumentNumbers,
  getInvoicedMetaByOrderGids,
  markOrderInvoiced,
  unmarkOrdersInvoiced,
  updateInvoiceDocumentDetails,
} from "../order-invoice-status.server";
import { markOrderPackingSlip } from "../order-packing-slip-status.server";
import {
  getCreditNoteMetaByOrderGids,
  getAllCreditNoteOrderGids,
  getCreditNoteOrderGids,
  ensureCreditNoteDocumentNumbers,
  updateCreditNoteDocumentDetails,
  unmarkOrdersCreditNote,
} from "../order-credit-note-status.server";
import { invalidateSalesOrdersCache } from "../sales-orders.server";
import { PaperScaleFrame } from "../components/paper-scale-frame";
import "../template-editor.css";
import "../sales-order-document.css";

type DocumentMode = "sales-order" | "invoice" | "credit-note";

function resolveDocumentMode(requestUrl: string): DocumentMode {
  try {
    const pathname = new URL(requestUrl).pathname;
    if (pathname.includes("/app/credit-note/")) return "credit-note";
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

function resolveCreditNoteTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("credit-")) {
    return value;
  }
  // Fall back to invoice layout if credit presets aren't registered yet.
  if (value && findTemplatePreset(value)?.id.startsWith("invoice-")) {
    return value;
  }
  return DEFAULT_CREDIT_NOTE_TEMPLATE_ID;
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
  const isCreditNote = documentMode === "credit-note";
  const isIssuedDocument = isInvoice || isCreditNote;
  const url = new URL(request.url);

  const selectedMap = await loadSelectedTemplatesForShop(session.shop);
  const shopSelectedTemplateId =
    selectedMap[
      isCreditNote ? "credit-note" : isInvoice ? "invoice" : "sales-order"
    ] || null;
  const shopSelectedSalesOrderTemplateId = selectedMap["sales-order"] || null;

  // Shop Active template wins over a stale ?template= query (e.g. after
  // switching Classic on Templates while an old Studio URL is still open).
  const templateId = isCreditNote
    ? resolveCreditNoteTemplateId(
        shopSelectedTemplateId || url.searchParams.get("template"),
      )
    : isInvoice
      ? resolveInvoiceTemplateId(
          shopSelectedTemplateId || url.searchParams.get("template"),
        )
      : resolveSalesOrderTemplateId(
          shopSelectedTemplateId || url.searchParams.get("template"),
        );
  const orderGid = toOrderGid(decodeURIComponent(orderId));

  // Sidebar list still uses sales-order template ids for SO document numbers.
  const salesOrderTemplateId = isIssuedDocument
    ? resolveSalesOrderTemplateId(shopSelectedSalesOrderTemplateId)
    : templateId;

  const [order, template, salesOrders] = await Promise.all([
    fetchSalesOrderDocument(admin, orderGid),
    isIssuedDocument
      ? loadDocumentTemplateSettings(
          session.shop,
          isCreditNote ? "credit-note" : "invoice",
          templateId,
          admin,
        )
      : loadSalesOrderTemplateSettings(session.shop, templateId, admin),
    fetchSalesOrderList(admin, {
      shop: session.shop,
      templateId: salesOrderTemplateId,
    }),
  ]);

  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  let documentNumber: string;
  let referenceNumber: string | undefined;
  let documentDate: string | undefined;
  let invoiceCustomerNote: string | null = null;
  let invoiceTerms: string | null = null;
  let creditNoteReason: string | null = null;
  let creditNoteVoided = false;
  let hasCreditNote = false;
  let sidebarOrders = salesOrders;

  if (isCreditNote) {
    const [creditMeta, invoiceMeta] = await Promise.all([
      getCreditNoteMetaByOrderGids(
        session.shop,
        salesOrders.map((item) => item.id),
      ),
      getInvoicedMetaByOrderGids(
        session.shop,
        salesOrders.map((item) => item.id),
      ),
    ]);
    const creditGids = await getAllCreditNoteOrderGids(session.shop);
    const creditGidSet = new Set(creditGids);
    sidebarOrders = salesOrders.filter((item) => creditGidSet.has(item.id));
    const currentMeta = creditMeta.get(order.id);
    const currentInvoice = invoiceMeta.get(order.id);

    // Credit Note# must be CN-… — never fall back to invoice number.
    let creditNoteNumber = currentMeta?.documentNumber?.trim() || "";
    if (!creditNoteNumber && currentMeta) {
      const ensuredCn = await ensureCreditNoteDocumentNumbers(session.shop, [
        order.id,
      ]);
      creditNoteNumber = ensuredCn.get(order.id)?.trim() || "";
    }
    documentNumber = creditNoteNumber || order.name;
    documentDate =
      currentMeta?.convertedAt?.toISOString() || order.createdAt;
    creditNoteReason = currentMeta?.reason ?? null;
    creditNoteVoided = Boolean(currentMeta?.voidedAt);
    hasCreditNote = Boolean(currentMeta);
    // Keep reason and customer note separate — never copy reason into customerNote.
    invoiceCustomerNote = currentMeta?.customerNote ?? null;
    invoiceTerms = currentMeta?.terms ?? currentInvoice?.terms ?? null;

    // Invoice Ref# must be the invoice document number (INV-…), not SO / order name.
    let invoiceRef = currentInvoice?.documentNumber?.trim() || "";
    if (!invoiceRef && currentInvoice) {
      const ensured = await ensureInvoiceDocumentNumbers(session.shop, [
        order.id,
      ]);
      invoiceRef = ensured.get(order.id)?.trim() || "";
    }
    referenceNumber = invoiceRef || undefined;

    sidebarOrders = sidebarOrders.map((item) => {
      const meta = creditMeta.get(item.id);
      return {
        ...item,
        documentNumber:
          meta?.documentNumber ||
          (item.id === order.id ? documentNumber : item.documentNumber),
        createdAt: meta?.convertedAt?.toISOString() || item.createdAt,
        creditNoteVoided: Boolean(meta?.voidedAt),
      };
    });
  } else if (isInvoice) {
    const [invoiceMeta, creditNoteGids] = await Promise.all([
      getInvoicedMetaByOrderGids(
        session.shop,
        salesOrders.map((item) => item.id),
      ),
      getCreditNoteOrderGids(
        session.shop,
        salesOrders.map((item) => item.id),
      ),
    ]);
    sidebarOrders = salesOrders.filter((item) => invoiceMeta.has(item.id));
    const currentMeta = invoiceMeta.get(order.id);
    hasCreditNote = creditNoteGids.has(order.id);
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
    let soDetails = await getSalesOrderDocumentDetails(
      session.shop,
      template.templateId,
      order.id,
    );
    if (!soDetails?.documentNumber) {
      const soSeries = await loadNumberSeriesEntryForShop(
        session.shop,
        "sales-order",
      );
      if (soSeries.entryMode !== "manual") {
        const assigned = await allocateSalesOrderDocumentNumber(
          session.shop,
          template.templateId,
          order.id,
          numberingFromSeries(soSeries),
        );
        soDetails = {
          documentNumber: assigned,
          documentDate: soDetails?.documentDate ?? null,
          customerNote: soDetails?.customerNote ?? null,
          terms: soDetails?.terms ?? null,
        };
      }
    }
    documentNumber = soDetails?.documentNumber ?? "";
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
    invoiceCustomerNote,
    invoiceTerms,
    creditNoteReason,
    creditNoteVoided,
    hasCreditNote,
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
    const creditNoteGids = await getCreditNoteOrderGids(session.shop, [
      orderGid,
    ]);
    if (creditNoteGids.has(orderGid)) {
      return Response.json(
        {
          ok: false,
          error:
            "Delete the credit note first. Invoices with a credit note cannot be deleted.",
        },
        { status: 400 },
      );
    }
    const deleted = await unmarkOrdersInvoiced(session.shop, [orderGid]);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-invoice" as const,
    });
  }

  if (intent === "delete-credit-note") {
    const deleted = await unmarkOrdersCreditNote(session.shop, [orderGid]);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-credit-note" as const,
    });
  }

  if (intent === "update-credit-note-details") {
    const documentNumber = String(formData.get("documentNumber") || "").trim();
    const creditDateRaw = String(formData.get("creditDate") || "").trim();
    const reason = String(formData.get("reason") || "");
    const customerNote = String(formData.get("customerNote") || "");
    const terms = String(formData.get("terms") || "");
    if (!documentNumber) {
      return Response.json(
        { ok: false, error: "Credit note number is required" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(creditDateRaw)) {
      return Response.json(
        { ok: false, error: "Credit note date is required" },
        { status: 400 },
      );
    }
    const convertedAt = new Date(`${creditDateRaw}T12:00:00.000Z`);
    if (Number.isNaN(convertedAt.getTime())) {
      return Response.json(
        { ok: false, error: "Invalid credit note date" },
        { status: 400 },
      );
    }

    const result = await updateCreditNoteDocumentDetails(
      session.shop,
      orderGid,
      {
        documentNumber,
        convertedAt,
        reason,
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
      document: "update-credit-note" as const,
      documentNumber,
      creditDate: creditDateRaw,
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
        numberMode:
          String(formData.get("numberMode") || "") === "manual"
            ? "manual"
            : "continue",
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
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const paperRef = useRef<HTMLDivElement>(null);
  const actionRanRef = useRef(false);
  const handledConvertDataRef = useRef<unknown>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const isConverting = convertFetcher.state !== "idle";
  const isInvoice = data.documentMode === "invoice";
  const isCreditNote = data.documentMode === "credit-note";
  const isIssuedDocument = isInvoice || isCreditNote;
  const listPath = isCreditNote
    ? "/app/credit-note"
    : isInvoice
      ? "/app/invoice"
      : "/app/sales-order";
  const documentBasePath = listPath;
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
    isCreditNote
      ? data.invoiceCustomerNote ?? ""
      : resolveDocumentNotes({
          savedNote: data.invoiceCustomerNote,
          orderNote: data.order.orderNote,
          defaultNotes: data.settings.notes ?? "",
          preferShopifyOrderNote: data.settings.preferShopifyOrderNote,
        }),
  );
  const [editTerms, setEditTerms] = useState(
    data.invoiceTerms ?? data.settings.terms ?? "",
  );
  const [editCreditReason, setEditCreditReason] = useState(
    data.creditNoteReason ?? "",
  );

  const [invoiceEditOpen, setInvoiceEditOpen] = useState(false);
  const [deleteInvoiceOpen, setDeleteInvoiceOpen] = useState(false);
  const [numberMode, setNumberMode] = useState<"continue" | "manual">(
    "continue",
  );
  const originalDocumentNumber = data.order.documentNumber || "";
  const numberChanged =
    editInvoiceNumber.trim() !== originalDocumentNumber.trim();

  useEffect(() => {
    setEditInvoiceNumber(data.order.documentNumber || "");
    setEditInvoiceDate(
      toDateInputValue(data.order.documentDate || data.order.createdAt),
    );
    setEditCustomerNote(
      isCreditNote
        ? data.invoiceCustomerNote ?? ""
        : resolveDocumentNotes({
            savedNote: data.invoiceCustomerNote,
            orderNote: data.order.orderNote,
            defaultNotes: data.settings.notes ?? "",
            preferShopifyOrderNote: data.settings.preferShopifyOrderNote,
          }),
    );
    setEditTerms(data.invoiceTerms ?? data.settings.terms ?? "");
    setEditCreditReason(data.creditNoteReason ?? "");
    setNumberMode("continue");
    setInvoiceEditOpen(false);
  }, [
    data.creditNoteReason,
    data.invoiceCustomerNote,
    data.invoiceTerms,
    data.order.createdAt,
    data.order.documentDate,
    data.order.documentNumber,
    data.order.id,
    data.order.orderNote,
    data.settings.notes,
    data.settings.preferShopifyOrderNote,
    data.settings.terms,
    isCreditNote,
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
      const liveNote =
        isCreditNote && !editCustomerNote.trim() && editCreditReason.trim()
          ? editCreditReason
          : editCustomerNote;
      return {
        ...data.settings,
        notes: liveNote,
        terms: editTerms,
      };
    }
    // Document Notes: customer note first; reason only as display fallback.
    const creditNoteDisplayNote = isCreditNote
      ? data.invoiceCustomerNote || data.creditNoteReason || null
      : data.invoiceCustomerNote;
    return {
      ...data.settings,
      notes: resolveDocumentNotes({
        savedNote: creditNoteDisplayNote,
        orderNote: data.order.orderNote,
        defaultNotes: data.settings.notes ?? "",
        preferShopifyOrderNote: data.settings.preferShopifyOrderNote,
      }),
      terms: data.invoiceTerms ?? data.settings.terms,
    };
  }, [
    data.creditNoteReason,
    data.invoiceCustomerNote,
    data.invoiceTerms,
    data.order.orderNote,
    data.settings,
    editCreditReason,
    editCustomerNote,
    editTerms,
    invoiceEditOpen,
    isCreditNote,
  ]);

  const savedCustomerNote = isCreditNote
    ? data.invoiceCustomerNote ?? ""
    : resolveDocumentNotes({
        savedNote: data.invoiceCustomerNote,
        orderNote: data.order.orderNote,
        defaultNotes: data.settings.notes ?? "",
        preferShopifyOrderNote: data.settings.preferShopifyOrderNote,
      });
  const savedTerms = data.invoiceTerms ?? data.settings.terms ?? "";
  const savedCreditReason = data.creditNoteReason ?? "";

  const invoiceDetailsDirty =
    invoiceEditOpen &&
    (editInvoiceNumber.trim() !== (data.order.documentNumber || "").trim() ||
      editInvoiceDate !==
        toDateInputValue(data.order.documentDate || data.order.createdAt) ||
      editCustomerNote !== savedCustomerNote ||
      editTerms !== savedTerms ||
      (isCreditNote && editCreditReason !== savedCreditReason));

  const handleInvoiceNumberInput = useCallback((event: Event) => {
    setEditInvoiceNumber(fieldValue(event));
  }, []);

  const closeInvoiceEdit = useCallback(() => {
    setEditInvoiceNumber(data.order.documentNumber || "");
    setEditInvoiceDate(
      toDateInputValue(data.order.documentDate || data.order.createdAt),
    );
    setEditCustomerNote(
      isCreditNote
        ? data.invoiceCustomerNote ?? ""
        : resolveDocumentNotes({
            savedNote: data.invoiceCustomerNote,
            orderNote: data.order.orderNote,
            defaultNotes: data.settings.notes ?? "",
            preferShopifyOrderNote: data.settings.preferShopifyOrderNote,
          }),
    );
    setEditTerms(data.invoiceTerms ?? data.settings.terms ?? "");
    setEditCreditReason(data.creditNoteReason ?? "");
    setNumberMode("continue");
    setInvoiceEditOpen(false);
  }, [
    data.creditNoteReason,
    data.invoiceCustomerNote,
    data.invoiceTerms,
    data.order.createdAt,
    data.order.documentDate,
    data.order.documentNumber,
    data.order.orderNote,
    data.settings.notes,
    data.settings.preferShopifyOrderNote,
    data.settings.terms,
    isCreditNote,
  ]);

  const openInvoiceEdit = useCallback(() => {
    setEditInvoiceNumber(data.order.documentNumber || "");
    setEditInvoiceDate(
      toDateInputValue(data.order.documentDate || data.order.createdAt),
    );
    setEditCustomerNote(
      isCreditNote
        ? data.invoiceCustomerNote ?? ""
        : resolveDocumentNotes({
            savedNote: data.invoiceCustomerNote,
            orderNote: data.order.orderNote,
            defaultNotes: data.settings.notes ?? "",
            preferShopifyOrderNote: data.settings.preferShopifyOrderNote,
          }),
    );
    setEditTerms(data.invoiceTerms ?? data.settings.terms ?? "");
    setEditCreditReason(data.creditNoteReason ?? "");
    setNumberMode("continue");
    setInvoiceEditOpen(true);
  }, [
    data.creditNoteReason,
    data.invoiceCustomerNote,
    data.invoiceTerms,
    data.order.createdAt,
    data.order.documentDate,
    data.order.documentNumber,
    data.order.orderNote,
    data.settings.notes,
    data.settings.preferShopifyOrderNote,
    data.settings.terms,
    isCreditNote,
  ]);

  const handleSaveInvoiceDetails = useCallback(() => {
    if (!invoiceEditOpen || isConverting) return;
    const formData = new FormData();
    if (isCreditNote) {
      formData.set("intent", "update-credit-note-details");
      formData.set("documentNumber", editInvoiceNumber.trim());
      formData.set("creditDate", editInvoiceDate);
      formData.set("reason", editCreditReason);
      formData.set("customerNote", editCustomerNote);
      formData.set("terms", editTerms);
    } else if (isInvoice) {
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
      if (numberChanged) {
        formData.set("numberMode", numberMode);
      }
    }
    convertFetcher.submit(formData, { method: "post" });
  }, [
    convertFetcher,
    data.templateId,
    editCreditReason,
    editCustomerNote,
    editInvoiceDate,
    editInvoiceNumber,
    editTerms,
    invoiceEditOpen,
    isConverting,
    isCreditNote,
    isInvoice,
    numberChanged,
    numberMode,
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
        isIssuedDocument ? "invoice" : "sales-order",
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

    const label = isCreditNote
      ? "Credit Note"
      : isInvoice
        ? "Invoice"
        : "Sales Order";
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
  const creditNoteVoided = Boolean(data.creditNoteVoided);
  const paymentStatus = activeListItem?.paymentStatus ?? null;
  // Credit-note lifecycle status wins over Shopify order payment status.
  const headerStatus =
    isCreditNote && creditNoteVoided ? "VOIDED" : paymentStatus;
  const paymentLabel = formatStatus(headerStatus);
  const paymentStatusKey = (paymentStatus || "").toUpperCase();
  const isCancelledOrder =
    paymentStatusKey === "VOIDED" ||
    paymentStatusKey.includes("CANCEL");
  const alreadyInvoiced = Boolean(activeListItem?.invoiced);
  const isPaidOrder = paymentStatusKey === "PAID";

  const documentStatusRibbon = (() => {
    if (!data.isAdmin) return null;

    if (isIssuedDocument) {
      if (isCreditNote && creditNoteVoided) {
        return { label: "Voided", variant: "voided" as const };
      }
      if (isCancelledOrder) {
        return { label: "Voided", variant: "voided" as const };
      }
      if (paymentStatusKey === "REFUNDED") {
        return { label: "Refunded", variant: "refunded" as const };
      }
      if (paymentStatusKey === "PARTIALLY_REFUNDED") {
        return { label: "Partial refund", variant: "partial" as const };
      }
      if (paymentStatusKey === "PAID") {
        return { label: "Paid", variant: "paid" as const };
      }
      if (paymentStatusKey === "PARTIALLY_PAID") {
        return { label: "Partial paid", variant: "partial" as const };
      }
      if (
        paymentStatusKey === "PENDING" ||
        paymentStatusKey === "AUTHORIZED" ||
        paymentStatusKey === "UNPAID" ||
        paymentStatusKey === "EXPIRED" ||
        !paymentStatusKey
      ) {
        return { label: "Pending", variant: "pending" as const };
      }
      return null;
    }

    if (isCancelledOrder) {
      return { label: "Voided", variant: "voided" as const };
    }
    if (alreadyInvoiced) {
      return { label: "Invoiced", variant: "invoiced" as const };
    }
    if (isPaidOrder) {
      return { label: "Confirmed", variant: "confirmed" as const };
    }
    return null;
  })();

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
    if (isConverting) return;
    if (isCreditNote) {
      setDeleteInvoiceOpen(false);
      convertFetcher.submit(
        { intent: "delete-credit-note" },
        { method: "post" },
      );
      return;
    }
    if (!isInvoice) return;
    if (data.hasCreditNote) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(
          "Delete the credit note first. Invoices with a credit note cannot be deleted.",
          { isError: true },
        );
      }
      setDeleteInvoiceOpen(false);
      return;
    }
    setDeleteInvoiceOpen(false);
    convertFetcher.submit({ intent: "delete-invoice" }, { method: "post" });
  }, [
    convertFetcher,
    data.hasCreditNote,
    isConverting,
    isCreditNote,
    isInvoice,
  ]);

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
      if (result.document === "update-credit-note") {
        shopify.toast.show("Credit note details saved");
        setInvoiceEditOpen(false);
      } else if (result.document === "update-invoice") {
        shopify.toast.show("Invoice details saved");
        setInvoiceEditOpen(false);
      } else if (result.document === "update-sales-order") {
        shopify.toast.show("Sales order details saved");
        setInvoiceEditOpen(false);
      } else if (result.document === "delete-credit-note") {
        shopify.toast.show("Credit note deleted");
        navigate(listPath);
        return;
      } else if (result.document === "delete-invoice") {
        shopify.toast.show("Invoice deleted");
        navigate(listPath);
        return;
      } else if (result.document === "packing-slip") {
        shopify.toast.show("Converted to packing slip");
      } else if (result.document === "invoice") {
        shopify.toast.show("Converted to invoice");
      }
    }
    revalidator.revalidate();
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
        {isCreditNote ? "Credit Note" : isInvoice ? "Invoice" : "Sales Orders"}
      </s-link>
      {headerStatus ? (
        <s-badge slot="accessory" tone={paymentBadgeTone(headerStatus)}>
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
          {!isIssuedDocument && !alreadyInvoiced ? (
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
          {!isIssuedDocument && !activeListItem?.packingSlip ? (
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
      {isInvoice || isCreditNote ? (
        <s-button
          slot="secondary-actions"
          icon="delete"
          tone="critical"
          loading={
            (isConverting &&
              (convertFetcher.formData?.get("intent") === "delete-invoice" ||
                convertFetcher.formData?.get("intent") ===
                  "delete-credit-note")) ||
            undefined
          }
          disabled={
            isConverting || (isInvoice && data.hasCreditNote) || undefined
          }
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
            <s-section
              heading={
                isCreditNote
                  ? "Credit notes"
                  : isInvoice
                    ? "Invoices"
                    : "Sales orders"
              }
            >
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
                    const itemCreditNoteVoided = Boolean(
                      (
                        item as {
                          creditNoteVoided?: boolean;
                        }
                      ).creditNoteVoided,
                    );
                    const sidebarBadgeStatus =
                      isCreditNote && itemCreditNoteVoided
                        ? "VOIDED"
                        : item.paymentStatus;
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
                              {sidebarBadgeStatus ? (
                                <s-badge
                                  tone={paymentBadgeTone(sidebarBadgeStatus)}
                                >
                                  {formatStatus(sidebarBadgeStatus)}
                                </s-badge>
                              ) : null}
                              {!isIssuedDocument ? (
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
                {documentStatusRibbon ? (
                  <div
                    className={`sales-order-status-ribbon sales-order-status-ribbon--${documentStatusRibbon.variant} no-print`}
                    aria-label={documentStatusRibbon.label}
                  >
                    <span>{documentStatusRibbon.label}</span>
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
          title={isCreditNote ? "Delete credit note?" : "Delete invoice?"}
          primaryAction={{
            content: "Delete",
            destructive: true,
            onAction: handleDeleteInvoice,
            loading:
              isConverting &&
              (convertFetcher.formData?.get("intent") === "delete-invoice" ||
                convertFetcher.formData?.get("intent") ===
                  "delete-credit-note"),
            disabled: isInvoice && Boolean(data.hasCreditNote),
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
              {isCreditNote
                ? "Are you sure you want to delete this credit note? The invoice and sales order stay; only the credit note record is removed."
                : data.hasCreditNote
                  ? "This invoice has a credit note. Delete the credit note first, then you can delete the invoice."
                  : "Are you sure you want to delete this invoice? The sales order will stay; only the invoice record is removed."}
            </Text>
          </Modal.Section>
        </Modal>
        <Modal
          open={invoiceEditOpen}
          onClose={closeInvoiceEdit}
          title={
            isCreditNote
              ? "Edit credit note"
              : isInvoice
                ? "Edit invoice"
                : "Edit sales order"
          }
          primaryAction={{
            content: "Save",
            onAction: handleSaveInvoiceDetails,
            loading:
              isConverting &&
              (convertFetcher.formData?.get("intent") ===
                "update-invoice-details" ||
                convertFetcher.formData?.get("intent") ===
                  "update-sales-order-details" ||
                convertFetcher.formData?.get("intent") ===
                  "update-credit-note-details"),
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
                  label={
                    isCreditNote
                      ? "Credit note number"
                      : isInvoice
                        ? "Invoice number"
                        : "Sales order number"
                  }
                  value={editInvoiceNumber}
                  onInput={handleInvoiceNumberInput}
                  autocomplete="off"
                />
                <s-date-field
                  label={
                    isCreditNote
                      ? "Credit note date"
                      : isInvoice
                        ? "Invoice date"
                        : "Order date"
                  }
                  value={editInvoiceDate}
                  onInput={(event: Event) =>
                    setEditInvoiceDate(fieldValue(event))
                  }
                  onChange={(event: Event) =>
                    setEditInvoiceDate(fieldValue(event))
                  }
                />
              </s-grid>
              {isCreditNote ? (
                <s-text-field
                  label="Reason"
                  value={editCreditReason}
                  onInput={(event: Event) =>
                    setEditCreditReason(fieldValue(event))
                  }
                  autocomplete="off"
                  placeholder="Return, overcharge, goodwill…"
                />
              ) : null}
              {!isInvoice && !isCreditNote && numberChanged ? (
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    After saving this number
                  </Text>
                  <RadioButton
                    label={`Use ${editInvoiceNumber.trim() || "this number"} for this order, then continue auto-generating from the next number`}
                    checked={numberMode === "continue"}
                    id="so-number-mode-continue"
                    name="so-number-mode"
                    onChange={() => setNumberMode("continue")}
                  />
                  <RadioButton
                    label="Switch to manual sales order numbers (enter each one yourself)"
                    checked={numberMode === "manual"}
                    id="so-number-mode-manual"
                    name="so-number-mode"
                    onChange={() => setNumberMode("manual")}
                  />
                </BlockStack>
              ) : null}
              <s-text-area
                label="Customer note"
                value={editCustomerNote}
                rows={3}
                onInput={(event: Event) =>
                  setEditCustomerNote(fieldValue(event))
                }
              />
              <Text as="p" tone="subdued">
                Shown in the Notes section. Leave blank to use the Shopify order
                note (or the template default notes).
              </Text>
              <s-text-area
                label="Terms & Conditions"
                value={editTerms}
                rows={3}
                onInput={(event: Event) => setEditTerms(fieldValue(event))}
              />
              <s-banner tone="info" heading="Important">
                Items, prices, discounts, tax, and totals cannot be edited here.
                Update them in the Shopify order — changes sync to this{" "}
                {isCreditNote
                  ? "credit note"
                  : isInvoice
                    ? "invoice"
                    : "sales order"}{" "}
                automatically.
              </s-banner>
            </s-stack>
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
