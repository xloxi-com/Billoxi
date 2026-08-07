import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LinksFunction,
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
  Badge,
  Button,
  ChoiceList,
  EmptySearchResult,
  EmptyState,
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
  INVOICE_INDEX_COLUMNS,
  PACKING_SLIP_INDEX_COLUMNS,
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
import { markOrderInvoiced, unmarkOrdersInvoiced } from "../order-invoice-status.server";
import {
  markOrderPackingSlip,
  unmarkOrdersPackingSlip,
} from "../order-packing-slip-status.server";
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
  type SalesOrderRow,
} from "../sales-orders.server";
import { loadSelectedTemplateForShop } from "../shop-settings.server";
import {
  INVOICED_VIEW_INDEX,
  INVOICE_LIST_VIEWS,
  CREDIT_NOTE_LIST_VIEWS,
  PACKING_SLIP_LIST_VIEWS,
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

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function documentStatusDisplay(
  order: SalesOrderRow,
  listMode: "invoice" | "credit-note",
): {
  label: string;
  tone: SalesOrderRow["paymentTone"];
  progress: SalesOrderRow["paymentProgress"];
} {
  // Credit-note void is an app lifecycle status — only on the CN list.
  // Never override invoice status with a voided credit note.
  if (listMode === "credit-note" && order.creditNoteVoided) {
    return { label: "Voided", tone: undefined, progress: "complete" };
  }

  const key = (order.paymentStatusKey || "").toUpperCase();

  if (key === "PAID") {
    return { label: "Paid", tone: "success", progress: "complete" };
  }
  if (key === "VOIDED") {
    return { label: "Voided", tone: undefined, progress: "complete" };
  }
  if (key === "REFUNDED") {
    return { label: "Refunded", tone: undefined, progress: "complete" };
  }
  if (key === "PARTIALLY_REFUNDED") {
    return {
      label: "Partially refunded",
      tone: "warning",
      progress: "partiallyComplete",
    };
  }
  if (key === "PARTIALLY_PAID") {
    return {
      label: "Partially paid",
      tone: "warning",
      progress: "partiallyComplete",
    };
  }
  if (key === "AUTHORIZED") {
    return {
      label: "Authorized",
      tone: "attention",
      progress: "partiallyComplete",
    };
  }
  if (key === "EXPIRED") {
    return { label: "Expired", tone: "critical", progress: "incomplete" };
  }

  // PENDING / UNPAID / unknown unpaid — overdue only after the invoice day.
  const startIso = order.invoicedAt || order.createdAt;
  const startMs = new Date(startIso).getTime();
  const days = Number.isFinite(startMs)
    ? Math.max(0, Math.floor((Date.now() - startMs) / 86_400_000))
    : 0;

  if (days <= 0) {
    return {
      label: "Unpaid",
      tone: "attention",
      progress: "incomplete",
    };
  }

  return {
    label: `Overdue by ${days} ${days === 1 ? "day" : "days"}`,
    tone: "warning",
    progress: "incomplete",
  };
}

const SORT_UI_OPTIONS: IndexFiltersProps["sortOptions"] = [
  { label: "Sales Order", value: "order asc", directionLabel: "Ascending" },
  { label: "Sales Order", value: "order desc", directionLabel: "Descending" },
  { label: "Customer", value: "customer asc", directionLabel: "A–Z" },
  { label: "Customer", value: "customer desc", directionLabel: "Z–A" },
  { label: "Date", value: "date asc", directionLabel: "Oldest first" },
  { label: "Date", value: "date desc", directionLabel: "Newest first" },
  { label: "Total", value: "total asc", directionLabel: "Ascending" },
  { label: "Total", value: "total desc", directionLabel: "Descending" },
];

const SEARCH_DEBOUNCE_MS = 250;

type BulkConfirmAction =
  | "invoice"
  | "packing-slip"
  | "credit-note"
  | "email"
  | "download"
  | "delete-invoice"
  | "delete-credit-note"
  | "delete-packing-slip"
  | "void-credit-note";

const BULK_CONFIRM_COPY: Record<
  BulkConfirmAction,
  { title: string; message: string; confirm: string }
> = {
  invoice: {
    title: "Convert to invoice?",
    message: "Are you sure you want to convert this sales order to an invoice?",
    confirm: "Convert",
  },
  "packing-slip": {
    title: "Convert to packing slip?",
    message:
      "Are you sure you want to convert this sales order to a packing slip?",
    confirm: "Convert",
  },
  "credit-note": {
    title: "Create credit note?",
    message:
      "Are you sure you want to create a credit note from this invoice?",
    confirm: "Create",
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
  "void-credit-note": {
    title: "Void credit note?",
    message:
      "Void this credit note? It stays in the list as voided and can be deleted later.",
    confirm: "Void",
  },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await requireAdminAuth(request);
  const url = new URL(request.url);
  const params = parseSalesOrdersSearchParams(url);
  const shopSelectedTemplateId = await loadSelectedTemplateForShop(
    session.shop,
    "sales-order",
  );
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
    listMode: "sales-order" as
      | "sales-order"
      | "invoice"
      | "credit-note"
      | "packing-slip",
    pageHeading: "Sales Orders",
    invoiceTemplateId: null as string | null,
    creditNoteTemplateId: null as string | null,
    packingSlipTemplateId: null as string | null,
  };
};

export function shouldRevalidate({
  formMethod,
  currentUrl,
  nextUrl,
}: {
  formMethod?: string | null;
  currentUrl: URL;
  nextUrl: URL;
}) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  return currentUrl.search !== nextUrl.search;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (
    intent !== "convert-to-invoice" &&
    intent !== "convert-to-packing-slip" &&
    intent !== "create-credit-note" &&
    intent !== "delete-invoice" &&
    intent !== "delete-credit-note" &&
    intent !== "delete-packing-slip" &&
    intent !== "void-credit-note" &&
    intent !== "reload-list"
  ) {
    return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }

  if (intent === "reload-list") {
    invalidateSalesOrdersCache(session.shop);
    return Response.json({ ok: true, document: "reload" as const });
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

  return Response.json({
    ok: true,
    converted: orderIds.length,
    document:
      intent === "convert-to-packing-slip" ? "packing-slip" : "invoice",
    orderId: orderIds[0] ?? null,
    orderIds,
    ...(invoiceNumbers ? { invoiceNumbers } : {}),
    ...(packingSlipNumbers ? { packingSlipNumbers } : {}),
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

export default function SalesOrderPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [, startTransition] = useTransition();
  const [queryValue, setQueryValue] = useState(data.query);
  const isInvoiceList = data.listMode === "invoice";
  const isCreditNoteList = data.listMode === "credit-note";
  const isPackingSlipList = data.listMode === "packing-slip";
  const isDocumentList = isInvoiceList || isCreditNoteList || isPackingSlipList;
  const indexColumns = isPackingSlipList
    ? PACKING_SLIP_INDEX_COLUMNS
    : isCreditNoteList
      ? CREDIT_NOTE_INDEX_COLUMNS
      : isInvoiceList
        ? INVOICE_INDEX_COLUMNS
        : SALES_ORDER_INDEX_COLUMNS;
  const columnsStorageKey = isPackingSlipList
    ? "billoxi.index-columns.packing-slip"
    : isCreditNoteList
      ? "billoxi.index-columns.credit-note"
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
  }, [isInvoiceList, isCreditNoteList, mode]);

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
  const isConverting = convertFetcher.state !== "idle";
  const handledConvertDataRef = useRef<unknown>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [quickActionOrderId, setQuickActionOrderId] = useState<string | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<BulkConfirmAction | null>(
    null,
  );
  const [creditReason, setCreditReason] = useState("");

  const isBusy = isConverting || isDownloadingZip || Boolean(quickActionOrderId);

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
    data.selectedTemplateId,
    isCreditNoteList,
    isInvoiceList,
    isPackingSlipList,
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
    if (isInvoiceList) {
      return data.invoiceTemplateId || "invoice-professional";
    }
    return getSelectedTemplateId(
      data.hasSelectedTemplate ? data.selectedTemplateId : null,
    );
  }, [
    data.creditNoteTemplateId,
    data.hasSelectedTemplate,
    data.invoiceTemplateId,
    data.packingSlipTemplateId,
    data.selectedTemplateId,
    isCreditNoteList,
    isInvoiceList,
    isPackingSlipList,
  ]);

  const activeDocumentKind = isInvoiceList
    ? "invoice"
    : isCreditNoteList
      ? "credit-note"
      : isPackingSlipList
        ? "packing-slip"
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
    [activeDocumentKind, activeTemplateId, isBusy],
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
    [activeDocumentKind, activeTemplateId, isBusy],
  );

  const runQuickSend = useCallback(
    (order: {
      id: string;
      name: string;
      email: string;
      total: string;
      invoiceNumber?: string;
      salesOrderNumber?: string;
      creditNoteNumber?: string;
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

      const docName = isCreditNoteList
        ? order.creditNoteNumber || order.name
        : isPackingSlipList
          ? order.packingSlipNumber || order.name
          : isInvoiceList
            ? order.invoiceNumber || order.salesOrderNumber || order.name
            : order.salesOrderNumber || order.name;
      const docLabel = isCreditNoteList
        ? "Credit Note"
        : isPackingSlipList
          ? "Packing Slip"
          : isInvoiceList
            ? "Invoice"
            : "Sales Order";
      const subject = encodeURIComponent(`${docLabel} ${docName}`);
      const body = encodeURIComponent(
        `Please find ${docLabel.toLowerCase()} ${docName} attached.\n\nTotal: ${order.total}`,
      );
      const mailto = `mailto:${email}?subject=${subject}&body=${body}`;
      window.open(mailto, "_blank", "noopener,noreferrer");
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(`Email draft opened for ${email}`);
      }
    },
    [isCreditNoteList, isInvoiceList, isPackingSlipList],
  );

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

  const handleVoidCreditNotes = useCallback(() => {
    if (selectedResources.length === 0 || isConverting) return;
    const formData = new FormData();
    formData.set("intent", "void-credit-note");
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
      const formData = new FormData();
      formData.set("template", activeTemplateId());
      formData.set("document", activeDocumentKind);
      for (const orderId of selectedResources) {
        formData.append("orderIds", orderId);
      }

      const response = await fetch("/app/sales-order/bulk-download", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let message = "Failed to download PDF zip";
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          // keep default message
        }
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(message, { isError: true });
        }
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/i.exec(disposition);
      const zipName = isCreditNoteList
        ? "credit-notes.zip"
        : isInvoiceList
          ? "invoices.zip"
          : "sales-orders.zip";
      triggerBrowserDownload(blob, match?.[1] || zipName);

      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(
          `Downloaded ${selectedResources.length} PDFs as zip`,
        );
      }
    } catch (error) {
      console.error("Bulk PDF zip download failed:", error);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show("Failed to download PDF zip", { isError: true });
      }
    } finally {
      setIsDownloadingZip(false);
    }
  }, [
    activeDocumentKind,
    activeTemplateId,
    isBusy,
    isCreditNoteList,
    isInvoiceList,
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
                    : isInvoiceList
                      ? "invoice"
                      : "sales order"
              } PDFs as a zip?`
            : confirmAction === "download" && isCreditNoteList
              ? "Are you sure you want to download the selected credit note PDF?"
              : confirmAction === "download" && isPackingSlipList
                ? "Are you sure you want to download the selected packing slip PDF?"
                : confirmAction === "download" && isInvoiceList
                  ? "Are you sure you want to download the selected invoice PDF?"
                  : confirmAction === "email" && isCreditNoteList
                    ? "Are you sure you want to open an email draft for this credit note?"
                    : confirmAction === "email" && isPackingSlipList
                      ? "Are you sure you want to open an email draft for this packing slip?"
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
    else if (action === "credit-note") handleCreateCreditNote();
    else if (action === "email") handleBulkSendEmail();
    else if (action === "delete-invoice") handleDeleteInvoices();
    else if (action === "delete-credit-note") handleDeleteCreditNotes();
    else if (action === "delete-packing-slip") handleDeletePackingSlips();
    else if (action === "void-credit-note") handleVoidCreditNotes();
    else void handleBulkDownloadPdf();
  }, [
    confirmAction,
    handleBulkDownloadPdf,
    handleBulkSendEmail,
    handleConvertToInvoice,
    handleConvertToPackingSlip,
    handleCreateCreditNote,
    handleDeleteCreditNotes,
    handleDeleteInvoices,
    handleDeletePackingSlips,
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
    !isCreditNoteList &&
    selectedResources.length === 1 &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    !selectedOrder!.invoiced;
  const canConvertToPackingSlip =
    !isInvoiceList &&
    !isPackingSlipList &&
    !isCreditNoteList &&
    selectedResources.length === 1 &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    !selectedOrder!.packingSlip;
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

    const actions: Array<{
      content: string;
      onAction: () => void;
      disabled?: boolean;
      destructive?: boolean;
    }> = [];

    if (isCreditNoteList) {
      actions.push({
        content: "Send email",
        onAction: () => setConfirmAction("email"),
        disabled: isBusy || !canSendEmail,
      });
      actions.push({
        content: downloadPdfLabel,
        onAction: () => setConfirmAction("download"),
        disabled: isBusy,
      });
      actions.push({
        content: "Void",
        onAction: () => setConfirmAction("void-credit-note"),
        disabled: isBusy || !canVoidCreditNote,
      });
      actions.push({
        content:
          selectedResources.length > 1 ? "Delete credit notes" : "Delete",
        onAction: () => setConfirmAction("delete-credit-note"),
        disabled: isBusy,
        destructive: true,
      });
      return actions;
    }

    if (isPackingSlipList) {
      actions.push({
        content: "Send email",
        onAction: () => setConfirmAction("email"),
        disabled: isBusy || !canSendEmail,
      });
      actions.push({
        content: downloadPdfLabel,
        onAction: () => setConfirmAction("download"),
        disabled: isBusy,
      });
      actions.push({
        content:
          selectedResources.length > 1 ? "Delete packing slips" : "Delete",
        onAction: () => setConfirmAction("delete-packing-slip"),
        disabled: isBusy,
        destructive: true,
      });
      return actions;
    }

    if (!isInvoiceList) {
      // Always show all 4 sales-order actions (disable when not applicable).
      actions.push({
        content: "Convert to invoice",
        onAction: () => setConfirmAction("invoice"),
        disabled: isBusy || !canConvertToInvoice,
      });
      actions.push({
        content: "Convert to packing slip",
        onAction: () => setConfirmAction("packing-slip"),
        disabled: isBusy || !canConvertToPackingSlip,
      });
      actions.push({
        content: "Send email",
        onAction: () => setConfirmAction("email"),
        disabled: isBusy || !canSendEmail,
      });
      actions.push({
        content: downloadPdfLabel,
        onAction: () => setConfirmAction("download"),
        disabled: isBusy,
      });
      return actions;
    }

    actions.push({
      content: "Create credit note",
      onAction: () => setConfirmAction("credit-note"),
      disabled: isBusy || !canCreateCreditNote,
    });
    actions.push({
      content: "Send email",
      onAction: () => setConfirmAction("email"),
      disabled: isBusy || !canSendEmail,
    });
    actions.push({
      content: downloadPdfLabel,
      onAction: () => setConfirmAction("download"),
      disabled: isBusy,
    });
    actions.push({
      content: selectedResources.length > 1 ? "Delete invoices" : "Delete",
      onAction: () => setConfirmAction("delete-invoice"),
      disabled: isBusy || !canDeleteInvoice,
      destructive: true,
    });

    return actions;
  }, [
    canCreateCreditNote,
    canConvertToInvoice,
    canConvertToPackingSlip,
    canDeleteInvoice,
    canSendEmail,
    canVoidCreditNote,
    downloadPdfLabel,
    isBusy,
    isCreditNoteList,
    isInvoiceList,
    isPackingSlipList,
    selectedResources.length,
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
        | "credit-note"
        | "delete-invoice"
        | "delete-credit-note"
        | "delete-packing-slip"
        | "void-credit-note"
        | "reload";
      orderId?: string | null;
      orderIds?: string[];
      invoiceNumbers?: Record<string, string>;
      packingSlipNumbers?: Record<string, string>;
      creditNoteNumbers?: Record<string, string>;
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
      } else if (result.document === "void-credit-note") {
        const count = result.voided ?? 1;
        shopify.toast.show(
          count > 1 ? `Voided ${count} credit notes` : "Credit note voided",
        );
      } else if (result.document === "packing-slip") {
        shopify.toast.show("Converted to packing slip");
      } else if (result.document === "credit-note") {
        shopify.toast.show("Credit note created");
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
      } else if (result.document === "invoice") {
        const invoicedAt = new Date().toISOString();
        const invoiceNumbers = result.invoiceNumbers || {};
        const invoiceDateLabel = new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(invoicedAt));
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
            };
          }),
        );
      }
    }
  }, [
    clearSelection,
    convertFetcher.data,
    convertFetcher.state,
    isCreditNoteList,
    isInvoiceList,
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
    if (isPackingSlipList) {
      return PACKING_SLIP_LIST_VIEWS.map((view, index) => ({
        content: view.label,
        index,
        onAction: () => {},
        id: `packing-slip-${view.id}`,
        isLocked: true,
        actions: [],
      }));
    }
    if (isCreditNoteList) {
      return CREDIT_NOTE_LIST_VIEWS.map((view, index) => ({
        content: view.label,
        index,
        onAction: () => {},
        id: `credit-note-${view.id}`,
        isLocked: true,
        actions: [],
      }));
    }
    if (isInvoiceList) {
      return INVOICE_LIST_VIEWS.map((view, index) => ({
        content: view.label,
        index,
        onAction: () => {},
        id: `invoice-${view.id}`,
        isLocked: true,
        actions: [],
      }));
    }
    return visibleViews.map((view, index) => ({
      content: view.label,
      index,
      onAction: () => {},
      id: `${view.id}-${view.viewIndex}`,
      // Keep every view tab in the bar (not collapsed into "More views").
      isLocked: true,
      actions: [],
    }));
  }, [isCreditNoteList, isInvoiceList, isPackingSlipList, visibleViews]);

  const selectedTab = isPackingSlipList
    ? Math.max(
        0,
        PACKING_SLIP_LIST_VIEWS.findIndex(
          (view) => view.fulfillment === (data.fulfillmentStatus || ""),
        ),
      )
    : isDocumentList
      ? Math.max(
          0,
          (isCreditNoteList ? CREDIT_NOTE_LIST_VIEWS : INVOICE_LIST_VIEWS).findIndex(
            (view) => view.payment === (data.paymentStatus || ""),
          ),
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
          choices={[
            { label: "Paid", value: "paid" },
            { label: "Pending", value: "pending" },
            { label: "Partially paid", value: "partially_paid" },
            { label: "Refunded", value: "refunded" },
            { label: "Voided", value: "voided" },
          ]}
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

    if (isPackingSlipList) return [fulfillmentFilter];
    if (isInvoiceList || isCreditNoteList) return [paymentFilter];

    return [paymentFilter, fulfillmentFilter];
  }, [
    data.paymentStatus,
    data.fulfillmentStatus,
    handlePaymentStatusChange,
    handleFulfillmentStatusChange,
    isCreditNoteList,
    isDocumentList,
    isInvoiceList,
    isPackingSlipList,
  ]);

  const appliedFilters: IndexFiltersProps["appliedFilters"] = [];
  if (!isPackingSlipList && data.paymentStatus) {
    appliedFilters.push({
      key: "paymentStatus",
      label: `${isDocumentList ? "Status" : "Payment status"} is ${data.paymentStatus.replaceAll("_", " ")}`,
      onRemove: handlePaymentStatusRemove,
    });
  }
  if ((isPackingSlipList || !isDocumentList) && data.fulfillmentStatus) {
    appliedFilters.push({
      key: "fulfillmentStatus",
      label: `Fulfillment status is ${data.fulfillmentStatus.replaceAll("_", " ")}`,
      onRemove: handleFulfillmentStatusRemove,
    });
  }

  const hasActiveFilters = Boolean(
    data.query || data.paymentStatus || data.fulfillmentStatus,
  );

  const emptyStateMarkup = hasActiveFilters ? (
    <EmptySearchResult
      title={
        isPackingSlipList
          ? "No packing slips found"
          : isCreditNoteList
            ? "No credit notes found"
            : isInvoiceList
              ? "No invoices found"
              : "No orders found"
      }
      description="Try changing the filters or search term"
      withIllustration
    />
  ) : isPackingSlipList ? (
    <EmptyState
      heading="No packing slips yet"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2716/files/emptystate-files.png"
      action={{
        content: "Go to Sales Orders",
        onAction: () => navigate("/app/sales-order"),
      }}
    >
      <p>Convert a sales order to a packing slip to see it listed here.</p>
    </EmptyState>
  ) : isCreditNoteList ? (
    <EmptyState
      heading="No credit notes yet"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2716/files/emptystate-files.png"
      action={{
        content: "Go to Invoice",
        onAction: () => navigate("/app/invoice"),
      }}
    >
      <p>Create a credit note from an invoice to see it listed here.</p>
    </EmptyState>
  ) : isInvoiceList ? (
    <EmptyState
      heading="No invoices yet"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2716/files/emptystate-files.png"
      action={{
        content: "Go to Sales Orders",
        onAction: () => navigate("/app/sales-order"),
      }}
    >
      <p>Convert a sales order to an invoice to see it listed here.</p>
    </EmptyState>
  ) : (
    <EmptyState
      heading="No sales orders yet"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2716/files/emptystate-files.png"
    >
      <p>Orders from your Shopify store will appear here.</p>
    </EmptyState>
  );

  const rowMarkup = orders.map((order, index) => {
    const invoiceStatus =
      isInvoiceList || isCreditNoteList
        ? documentStatusDisplay(
            order,
            isCreditNoteList ? "credit-note" : "invoice",
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
                  : isPackingSlipList
                    ? order.name
                    : isInvoiceList
                      ? order.salesOrderNumber || "—"
                      : order.name}
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
              <div style={{ paddingInlineEnd: 28 }}>
                <Text as="span" variant="bodyMd" alignment="end" numeric>
                  {order.total}
                </Text>
              </div>
            </IndexTable.Cell>
          );
        case "balanceDue":
          return (
            <IndexTable.Cell key={col.id}>
              <div style={{ paddingInlineEnd: 28 }}>
                <Text as="span" variant="bodyMd" alignment="end" numeric>
                  {order.balanceDue}
                </Text>
              </div>
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
                    {order.paymentStatus}
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
                {order.fulfillmentStatus}
              </Badge>
            </IndexTable.Cell>
          );
        case "invoiced":
          return (
            <IndexTable.Cell key={col.id}>
              <InlineStack align="center" blockAlign="center">
                <Tooltip content={order.invoiced ? "Invoiced" : "Not invoiced"}>
                  <span>
                    <Icon
                      source={
                        order.invoiced ? CheckCircleIcon : MinusCircleIcon
                      }
                      tone={order.invoiced ? "success" : "subdued"}
                      accessibilityLabel={
                        order.invoiced ? "Invoiced" : "Not invoiced"
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
                      ? "Packing slip created"
                      : "No packing slip"
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
                          ? "Packing slip created"
                          : "No packing slip"
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
          const tooltip = !hasCreditNote
            ? "No credit note"
            : voided
              ? `Credit note voided${order.creditNoteNumber ? ` (${order.creditNoteNumber})` : ""}`
              : `Credit note created${order.creditNoteNumber ? ` (${order.creditNoteNumber})` : ""}`;
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
                  <Tooltip content="Print">
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
                  <Tooltip content="Download PDF">
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
                  <Tooltip content="Send email">
                    <Button
                      icon={EmailIcon}
                      variant="tertiary"
                      accessibilityLabel={`Send ${docLabel}`}
                      disabled={isBusy}
                      onClick={() => runQuickSend(order)}
                    />
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

  const tableHeadings = visibleColumns.map((col) => {
    switch (col.id) {
      case "total":
      case "balanceDue":
        return {
          id: col.id,
          title: (
            <span style={{ display: "inline-block", paddingInlineEnd: 28 }}>
              {col.label}
            </span>
          ),
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
      case "reason":
      case "actions":
        return { title: col.label, alignment: "center" as const };
      default:
        return { title: col.label };
    }
  });

  return (
    <AppProvider i18n={enTranslations}>
      <s-page heading={data.pageHeading} inlineSize="large">
        <s-button
          slot="secondary-actions"
          variant="secondary"
          icon="refresh"
          disabled={isBusy || revalidator.state !== "idle" || undefined}
          onClick={handleReload}
        >
          Reload
        </s-button>
        <div className="sales-orders-page" ref={pageRef}>
        {columnsMenuPortal}
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
              confirmAction === "void-credit-note",
            onAction: handleConfirmBulkAction,
          }}
          secondaryActions={[
            {
              content: "Cancel",
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
            sortOptions={SORT_UI_OPTIONS}
            sortSelected={[data.sortSelected]}
            queryValue={queryValue}
            queryPlaceholder={
              isCreditNoteList
                ? "Search credit notes"
                : isPackingSlipList
                  ? "Search packing slips"
                  : isInvoiceList
                    ? "Search invoices"
                    : "Search orders"
            }
            onQueryChange={setQueryValue}
            onQueryClear={handleQueryValueRemove}
            onSort={(value) =>
              updateParams({ sort: value[0] ?? "date desc" })
            }
            cancelAction={{
              onAction: handleFiltersCancel,
              disabled: false,
              loading: false,
            }}
            tabs={tabs}
            selected={selectedTab}
            onSelect={(index) => {
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
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
