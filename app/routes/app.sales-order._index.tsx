import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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
  Badge,
  Button,
  ButtonGroup,
  ChoiceList,
  IndexFilters,
  IndexFiltersMode,
  IndexTable,
  InlineStack,
  Card,
  Link,
  Modal,
  Text,
  useIndexResourceState,
  useSetIndexFiltersMode,
} from "@shopify/polaris";
import type { IndexFiltersProps, TabProps } from "@shopify/polaris";
import { EmailIcon, ImportIcon, PrintIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";

import { requireAdminAuth } from "../shopify-context.server";
import {
  DEFAULT_SALES_ORDER_TEMPLATE_ID,
  SALES_ORDER_TEMPLATE_STORAGE_KEY,
  resolveSalesOrderTemplateId,
  toOrderGid,
} from "../sales-order-document";
import { markOrderInvoiced, unmarkOrdersInvoiced } from "../order-invoice-status.server";
import { markOrderPackingSlip } from "../order-packing-slip-status.server";
import {
  invalidateSalesOrdersCache,
  loadSalesOrdersPage,
  parseSalesOrdersSearchParams,
  type SalesOrderRow,
} from "../sales-orders.server";
import { loadSelectedTemplateForShop } from "../shop-settings.server";
import { INVOICED_VIEW_INDEX, SALES_ORDER_VIEWS } from "../sales-orders";
import {
  downloadSalesOrderDomPdfFromList,
  printSalesOrderDomPdfFromList,
} from "../sales-order-dom-export.client";
import "../sales-orders.css";

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

function invoiceStatusDisplay(order: SalesOrderRow): {
  label: string;
  tone: SalesOrderRow["paymentTone"];
  progress: SalesOrderRow["paymentProgress"];
} {
  const key = order.paymentStatusKey;
  if (key === "PAID") {
    return { label: "Paid", tone: "success", progress: "complete" };
  }
  if (key === "VOIDED") {
    return { label: "Voided", tone: undefined, progress: "complete" };
  }
  if (key === "REFUNDED") {
    return { label: "Refunded", tone: undefined, progress: "complete" };
  }

  const startIso = order.invoicedAt || order.createdAt;
  const startMs = new Date(startIso).getTime();
  const days = Number.isFinite(startMs)
    ? Math.max(0, Math.floor((Date.now() - startMs) / 86_400_000))
    : 0;

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
  | "email"
  | "download"
  | "delete-invoice";

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
      "Are you sure you want to delete the selected invoice? The sales order will stay; only the invoice record is removed.",
    confirm: "Delete",
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
    listMode: "sales-order" as const,
    pageHeading: "Sales Orders",
    invoiceTemplateId: null as string | null,
  };
};

export const shouldRevalidate = () => true;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (
    intent !== "convert-to-invoice" &&
    intent !== "convert-to-packing-slip" &&
    intent !== "delete-invoice" &&
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
    await Promise.all(
      orderIds.map((orderId) =>
        markOrderPackingSlip(session.shop, toOrderGid(orderId)),
      ),
    );
    invalidateSalesOrdersCache(session.shop);
  }

  if (intent === "delete-invoice") {
    const deleted = await unmarkOrdersInvoiced(
      session.shop,
      orderIds.map((orderId) => toOrderGid(orderId)),
    );
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-invoice" as const,
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

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(orders);
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

  const isBusy = isConverting || isDownloadingZip || Boolean(quickActionOrderId);

  const resolveOrderPath = useCallback((orderGid: string) => {
    const numericId = orderGid.includes("/")
      ? orderGid.split("/").pop() || orderGid
      : orderGid;
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
    data.hasSelectedTemplate,
    data.invoiceTemplateId,
    data.selectedTemplateId,
    isInvoiceList,
  ]);

  const openOrderDocument = useCallback(
    (orderGid: string) => {
      navigate(resolveOrderPath(orderGid));
    },
    [navigate, resolveOrderPath],
  );

  const activeTemplateId = useCallback(() => {
    if (isInvoiceList) {
      return data.invoiceTemplateId || "invoice-professional";
    }
    return getSelectedTemplateId(
      data.hasSelectedTemplate ? data.selectedTemplateId : null,
    );
  }, [
    data.hasSelectedTemplate,
    data.invoiceTemplateId,
    data.selectedTemplateId,
    isInvoiceList,
  ]);

  const activeDocumentKind = isInvoiceList ? "invoice" : "sales-order";

  const runQuickDownload = useCallback(
    async (orderId: string) => {
      if (isBusy) return;
      setQuickActionOrderId(orderId);
      try {
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

      const docName = isInvoiceList
        ? order.invoiceNumber || order.salesOrderNumber || order.name
        : order.salesOrderNumber || order.name;
      const docLabel = isInvoiceList ? "Invoice" : "Sales Order";
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
    [isInvoiceList],
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

  const handleDeleteInvoices = useCallback(() => {
    if (selectedResources.length === 0 || isConverting) return;
    const formData = new FormData();
    formData.set("intent", "delete-invoice");
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
      const fileName =
        match?.[1] ||
        (isInvoiceList ? "invoices.zip" : "sales-orders.zip");
      triggerBrowserDownload(blob, fileName);

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
                isInvoiceList ? "invoice" : "sales order"
              } PDFs as a zip?`
            : confirmAction === "download" && isInvoiceList
              ? "Are you sure you want to download the selected invoice PDF?"
              : confirmAction === "email" && isInvoiceList
                ? "Are you sure you want to open an email draft for this invoice?"
                : confirmAction === "delete-invoice" &&
                    selectedResources.length > 1
                  ? `Are you sure you want to delete ${selectedResources.length} invoices? Sales orders will stay; only the invoice records are removed.`
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
    else if (action === "email") handleBulkSendEmail();
    else if (action === "delete-invoice") handleDeleteInvoices();
    else void handleBulkDownloadPdf();
  }, [
    confirmAction,
    handleBulkDownloadPdf,
    handleBulkSendEmail,
    handleConvertToInvoice,
    handleConvertToPackingSlip,
    handleDeleteInvoices,
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
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    !selectedOrder!.invoiced;
  const canConvertToPackingSlip =
    !isInvoiceList &&
    Boolean(selectedOrder) &&
    !hasCancelledSelected &&
    !selectedOrder!.packingSlip;
  const canSendEmail = !hasCancelledSelected;

  const [bulkActionsMountNode, setBulkActionsMountNode] =
    useState<HTMLElement | null>(null);

  useEffect(() => {
    if (selectedResources.length === 0) {
      setBulkActionsMountNode(null);
      return;
    }

    let frame = 0;
    const findMountNode = () => {
      const node = document.querySelector(
        ".sales-orders-page .Polaris-BulkActions__BulkActionsSelectAllWrapper",
      );
      if (node instanceof HTMLElement) {
        setBulkActionsMountNode(node);
        return;
      }
      frame = window.requestAnimationFrame(findMountNode);
    };
    findMountNode();
    return () => window.cancelAnimationFrame(frame);
  }, [selectedResources.length, isBusy]);

  const bulkActionButtons =
    bulkActionsMountNode && selectedResources.length > 0
      ? createPortal(
          <div className="sales-orders-bulk-buttons">
            <InlineStack gap="100" blockAlign="center" wrap={false}>
              {canConvertToInvoice ? (
                <Button
                  size="micro"
                  variant="secondary"
                  loading={isConverting}
                  disabled={isConverting || isDownloadingZip}
                  onClick={() => setConfirmAction("invoice")}
                >
                  Convert to invoice
                </Button>
              ) : null}
              {canConvertToPackingSlip ? (
                <Button
                  size="micro"
                  variant="secondary"
                  loading={isConverting}
                  disabled={isConverting || isDownloadingZip}
                  onClick={() => setConfirmAction("packing-slip")}
                >
                  Convert to packing slip
                </Button>
              ) : null}
              {canSendEmail ? (
                <Button
                  size="micro"
                  variant="secondary"
                  disabled={isConverting || isDownloadingZip}
                  onClick={() => setConfirmAction("email")}
                >
                  Send email
                </Button>
              ) : null}
              <Button
                size="micro"
                variant="secondary"
                loading={isDownloadingZip}
                disabled={isConverting || isDownloadingZip}
                onClick={() => setConfirmAction("download")}
              >
                {downloadPdfLabel}
              </Button>
              {isInvoiceList ? (
                <Button
                  size="micro"
                  variant="primary"
                  tone="critical"
                  loading={isConverting}
                  disabled={isConverting || isDownloadingZip}
                  onClick={() => setConfirmAction("delete-invoice")}
                >
                  {selectedResources.length > 1 ? "Delete invoices" : "Delete"}
                </Button>
              ) : null}
            </InlineStack>
          </div>,
          bulkActionsMountNode,
        )
      : null;

  useEffect(() => {
    if (convertFetcher.state !== "idle" || !convertFetcher.data) return;
    if (handledConvertDataRef.current === convertFetcher.data) return;
    handledConvertDataRef.current = convertFetcher.data;

    const result = convertFetcher.data as {
      ok?: boolean;
      converted?: number;
      deleted?: number;
      document?: "invoice" | "packing-slip" | "delete-invoice" | "reload";
      orderId?: string | null;
      orderIds?: string[];
      invoiceNumbers?: Record<string, string>;
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
      } else if (result.document === "packing-slip") {
        shopify.toast.show("Converted to packing slip");
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
      } else if (result.document === "packing-slip") {
        setOrders((prev) =>
          prev.map((order) =>
            patchedIds.has(order.id)
              ? { ...order, packingSlip: true }
              : order,
          ),
        );
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
    if (isInvoiceList) {
      return [
        {
          content: "All",
          index: 0,
          onAction: () => {},
          id: "invoice-all",
          isLocked: true,
          actions: [],
        },
      ];
    }
    return visibleViews.map((view, index) => ({
      content: view.label,
      index,
      onAction: () => {},
      id: `${view.id}-${view.viewIndex}`,
      isLocked: view.viewIndex === 0,
      actions: [],
    }));
  }, [isInvoiceList, visibleViews]);

  const selectedTab = isInvoiceList
    ? 0
    : Math.max(
        0,
        visibleViews.findIndex((view) => view.viewIndex === data.selectedView),
      );

  const handlePaymentStatusChange = useCallback(
    (value: string[]) => {
      updateParams({ view: "", payment: value[0] ?? "" });
    },
    [updateParams],
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
      label: isInvoiceList ? "Status" : "Payment status",
      filter: (
        <ChoiceList
          title={isInvoiceList ? "Status" : "Payment status"}
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

    if (isInvoiceList) return [paymentFilter];

    return [
      paymentFilter,
      {
        key: "fulfillmentStatus",
        label: "Fulfillment status",
        filter: (
          <ChoiceList
            title="Fulfillment status"
            titleHidden
            choices={[
              { label: "Fulfilled", value: "fulfilled" },
              { label: "Unfulfilled", value: "unfulfilled" },
              { label: "Partially fulfilled", value: "partial" },
            ]}
            selected={data.fulfillmentStatus ? [data.fulfillmentStatus] : []}
            onChange={handleFulfillmentStatusChange}
          />
        ),
        shortcut: true,
      },
    ];
  }, [
    data.paymentStatus,
    data.fulfillmentStatus,
    handlePaymentStatusChange,
    handleFulfillmentStatusChange,
    isInvoiceList,
  ]);

  const appliedFilters: IndexFiltersProps["appliedFilters"] = [];
  if (data.paymentStatus) {
    appliedFilters.push({
      key: "paymentStatus",
      label: `${isInvoiceList ? "Status" : "Payment status"} is ${data.paymentStatus.replaceAll("_", " ")}`,
      onRemove: handlePaymentStatusRemove,
    });
  }
  if (!isInvoiceList && data.fulfillmentStatus) {
    appliedFilters.push({
      key: "fulfillmentStatus",
      label: `Fulfillment status is ${data.fulfillmentStatus.replaceAll("_", " ")}`,
      onRemove: handleFulfillmentStatusRemove,
    });
  }

  const rowMarkup = orders.map((order, index) => {
    const invoiceStatus = isInvoiceList
      ? invoiceStatusDisplay(order)
      : null;

    return (
    <IndexTable.Row
      id={order.id}
      key={order.id}
      selected={selectedResources.includes(order.id)}
      position={index}
      onClick={() => openOrderDocument(order.id)}
    >
      <IndexTable.Cell>
        <Link
          dataPrimaryLink
          monochrome
          removeUnderline
          onClick={() => openOrderDocument(order.id)}
        >
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {isInvoiceList
              ? order.invoiceNumber || order.salesOrderNumber || "—"
              : order.salesOrderNumber || "—"}
          </Text>
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">
          {isInvoiceList
            ? order.salesOrderNumber || "—"
            : order.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{order.date}</IndexTable.Cell>
      <IndexTable.Cell>{order.company}</IndexTable.Cell>
      <IndexTable.Cell>{order.customer}</IndexTable.Cell>
      <IndexTable.Cell>
        <div style={{ paddingInlineEnd: 20 }}>
          <Text as="span" alignment="end" numeric>
            {order.total}
          </Text>
        </div>
      </IndexTable.Cell>
      {isInvoiceList ? (
        <IndexTable.Cell>
          <div style={{ paddingInlineEnd: 20 }}>
            <Text as="span" alignment="end" numeric>
              {order.balanceDue}
            </Text>
          </div>
        </IndexTable.Cell>
      ) : null}
      <IndexTable.Cell>
        <div style={{ paddingInlineStart: 12 }}>
          {invoiceStatus ? (
            <Badge
              tone={invoiceStatus.tone}
              progress={invoiceStatus.progress}
            >
              {invoiceStatus.label}
            </Badge>
          ) : (
            <Badge tone={order.paymentTone} progress={order.paymentProgress}>
              {order.paymentStatus}
            </Badge>
          )}
        </div>
      </IndexTable.Cell>
      {!isInvoiceList ? (
        <>
          <IndexTable.Cell>
            <Badge
              tone={order.fulfillmentTone}
              progress={order.fulfillmentProgress}
            >
              {order.fulfillmentStatus}
            </Badge>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <span
                role="img"
                aria-label={order.invoiced ? "Invoiced" : "Not invoiced"}
                title={order.invoiced ? "Invoiced" : "Not invoiced"}
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: order.invoiced
                    ? "var(--p-color-bg-fill-success)"
                    : "var(--p-color-icon-disabled)",
                }}
              />
            </div>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <span
                role="img"
                aria-label={
                  order.packingSlip ? "Packing slip created" : "No packing slip"
                }
                title={
                  order.packingSlip ? "Packing slip created" : "No packing slip"
                }
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: order.packingSlip
                    ? "var(--p-color-icon-info)"
                    : "var(--p-color-icon-disabled)",
                }}
              />
            </div>
          </IndexTable.Cell>
        </>
      ) : null}
      <IndexTable.Cell>
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          style={{ display: "flex", justifyContent: "center" }}
        >
          <ButtonGroup gap="extraTight" noWrap>
            <Button
              icon={PrintIcon}
              variant="tertiary"
              accessibilityLabel={`Print ${
                isInvoiceList
                  ? order.invoiceNumber || order.name
                  : order.salesOrderNumber || order.name
              }`}
              disabled={isBusy}
              onClick={() => {
                void runQuickPrint(order.id);
              }}
            />
            <Button
              icon={ImportIcon}
              variant="tertiary"
              accessibilityLabel={`Download ${
                isInvoiceList
                  ? order.invoiceNumber || order.name
                  : order.salesOrderNumber || order.name
              }`}
              disabled={isBusy}
              onClick={() => {
                void runQuickDownload(order.id);
              }}
            />
            <Button
              icon={EmailIcon}
              variant="tertiary"
              accessibilityLabel={`Send ${
                isInvoiceList
                  ? order.invoiceNumber || order.name
                  : order.salesOrderNumber || order.name
              }`}
              disabled={isBusy}
              onClick={() => runQuickSend(order)}
            />
          </ButtonGroup>
        </div>
      </IndexTable.Cell>
    </IndexTable.Row>
    );
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
        <div className="sales-orders-page">
        {bulkActionButtons}
        <Modal
          open={confirmAction !== null}
          onClose={() => setConfirmAction(null)}
          title={confirmCopy?.title ?? "Are you sure?"}
          primaryAction={{
            content: confirmCopy?.confirm ?? "Confirm",
            destructive: confirmAction === "delete-invoice",
            onAction: handleConfirmBulkAction,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setConfirmAction(null),
            },
          ]}
        >
          <Modal.Section>
            <Text as="p">
              {confirmCopy?.message ?? "Are you sure you want to continue?"}
            </Text>
          </Modal.Section>
        </Modal>
        <Card padding="0">
          <IndexFilters
            sortOptions={SORT_UI_OPTIONS}
            sortSelected={[data.sortSelected]}
            queryValue={queryValue}
            queryPlaceholder={
              isInvoiceList ? "Search invoices" : "Search orders"
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
              if (isInvoiceList) return;
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
              isInvoiceList
                ? { singular: "invoice", plural: "invoices" }
                : { singular: "order", plural: "orders" }
            }
            itemCount={orders.length}
            selectedItemsCount={
              allResourcesSelected ? "All" : selectedResources.length
            }
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: isInvoiceList ? "Invoice" : "Sales Order" },
              { title: "Reference" },
              { title: "Date" },
              { title: "Company" },
              { title: "Customer" },
              {
                id: "total",
                title: (
                  <span style={{ display: "inline-block", paddingInlineEnd: 20 }}>
                    {isInvoiceList ? "Amount" : "Total"}
                  </span>
                ),
                alignment: "end",
              },
              ...(isInvoiceList
                ? [
                    {
                      id: "balance-due",
                      title: (
                        <span
                          style={{
                            display: "inline-block",
                            paddingInlineEnd: 20,
                          }}
                        >
                          Balance Due
                        </span>
                      ),
                      alignment: "end" as const,
                    },
                  ]
                : []),
              {
                id: "payment-status",
                title: (
                  <span style={{ display: "inline-block", paddingInlineStart: 12 }}>
                    {isInvoiceList ? "Status" : "Payment status"}
                  </span>
                ),
              },
              ...(isInvoiceList
                ? []
                : [
                    { title: "Fulfillment status" },
                    { title: "Invoiced", alignment: "center" as const },
                    { title: "Packing slip", alignment: "center" as const },
                  ]),
              { title: "Actions", alignment: "center" },
            ]}
            pagination={{
              hasPrevious: data.pageInfo.hasPreviousPage,
              hasNext: data.pageInfo.hasNextPage,
              onPrevious: goToPreviousPage,
              onNext: goToNextPage,
            }}
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
