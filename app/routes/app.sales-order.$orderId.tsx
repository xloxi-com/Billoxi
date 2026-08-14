import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Await,
  PrefetchPageLinks,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { renderEmbeddedRouteError } from "../embedded-route-error";
import {
  AppProvider,
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Modal,
  RadioButton,
  Icon,
  ResourceItem,
  ResourceList,
  Scrollable,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";

import { SalesOrderLiveDocument } from "../components/sales-order-live-document";
import { PageLoader } from "../components/page-loader";
import { requireAdminAuth } from "../shopify-context.server";
import {
  fetchSalesOrderDocument,
  fetchSalesOrderList,
  invalidateSalesOrderDocumentCache,
  loadDocumentTemplateSettings,
  loadSalesOrderTemplateSettings,
} from "../sales-order-document.server";
import {
  fetchDraftOrderDocument,
  fetchDraftOrderSidebarList,
  invalidateDraftOrderDocumentCache,
} from "../shopify-draft-orders.server";
import {
  allocateSalesOrderDocumentNumber,
  hasCompletedSalesOrderNumberSync,
  waitForSalesOrderNumberSync,
  getSalesOrderDocumentDetails,
  getSalesOrderDocumentNumbersByOrderGids,
  updateSalesOrderDocumentDetails,
} from "../sales-order-number.server";
import { numberingFromSeries } from "../number-series";
import {
  formatOrderDate,
  paperPaddingCss,
  resolveDocumentNotes,
  SALES_ORDER_TEMPLATE_STORAGE_KEY,
} from "../sales-order-document";
import {
  resolveCreditNoteTemplateId,
  resolveDraftTemplateId,
  resolveInvoiceTemplateId,
  resolvePackingSlipTemplateId,
  resolveReturnTemplateId,
  resolveSalesOrderTemplateId,
  toDraftOrderGid,
  toOrderGid,
} from "../sales-order-ids";
import {
  loadInvoiceSettingsForShop,
  loadNumberSeriesEntryForShop,
  loadSelectedTemplateForShop,
  loadSelectedTemplatesForShop,
  loadSmtpSettingsForShop,
} from "../shop-settings.server";
import { isSmtpReadyForSend, SMTP_REQUIRED_NOTICE } from "../smtp-settings";
import { getShopPlanIdForGating, planHasCapability, smtpReadyForPlan } from "../plan-access";
import {
  ensureInvoiceDocumentNumbers,
  getInvoicedMetaByOrderGids,
  getInvoicedOrderGids,
  markOrderInvoiced,
  unmarkOrdersInvoiced,
  updateInvoiceDocumentDetails,
} from "../order-invoice-status.server";
import {
  getDraftMetaByOrderGids,
  getDraftOrderGids,
  markOrderDraft,
  unmarkOrdersDraft,
  updateDraftDocumentDetails,
} from "../order-invoice-draft-status.server";
import { markOrderPackingSlip, getAllPackingSlipOrderGids, getPackingSlipMetaByOrderGids, getPackingSlipOrderGids, unmarkOrdersPackingSlip, ensurePackingSlipDocumentNumbers } from "../order-packing-slip-status.server";
import {
  markOrderReturn,
  getAllReturnOrderGids,
  getReturnMetaByOrderGids,
  getReturnOrderGids,
  unmarkOrdersReturn,
  ensureReturnDocumentNumbers,
} from "../order-return-status.server";
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
import { recordDocumentActivity } from "../record-document-activity.client";
import {
  adminPageHeading,
  adminPaymentStatusLabel,
  adminTf,
  type AdminMessageKey,
} from "../admin-i18n";
import { useAdminI18n } from "../admin-i18n-context";
import "../template-editor.css";
import "../sales-order-document.css";

type DocumentMode =
  | "sales-order"
  | "invoice"
  | "credit-note"
  | "packing-slip"
  | "return"
  | "draft";

function resolveDocumentMode(requestUrl: string): DocumentMode {
  try {
    const pathname = new URL(requestUrl).pathname;
    if (pathname.includes("/app/credit-note/")) return "credit-note";
    if (pathname.includes("/app/invoice/")) return "invoice";
    if (pathname.includes("/app/packing-slip/")) return "packing-slip";
    if (pathname.includes("/app/return/")) return "return";
    if (pathname.includes("/app/draft/")) return "draft";
    return "sales-order";
  } catch {
    return "sales-order";
  }
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

function sidebarTitleKey(mode: DocumentMode): AdminMessageKey {
  switch (mode) {
    case "credit-note":
      return "detail.sidebarCreditNotes";
    case "invoice":
      return "detail.sidebarInvoices";
    case "packing-slip":
      return "detail.sidebarPackingSlips";
    case "return":
      return "detail.sidebarReturns";
    case "draft":
      return "detail.sidebarDrafts";
    default:
      return "common.salesOrders";
  }
}

function sidebarSearchKey(mode: DocumentMode): AdminMessageKey {
  switch (mode) {
    case "credit-note":
      return "detail.searchCreditNotes";
    case "invoice":
      return "detail.searchInvoices";
    case "packing-slip":
      return "detail.searchPackingSlips";
    case "return":
      return "detail.searchReturns";
    case "draft":
      return "detail.searchDrafts";
    default:
      return "detail.searchOrders";
  }
}

function sidebarResourceNameKeys(mode: DocumentMode): {
  singular: AdminMessageKey;
  plural: AdminMessageKey;
} {
  switch (mode) {
    case "credit-note":
      return {
        singular: "detail.noun.creditNote",
        plural: "detail.noun.creditNotes",
      };
    case "invoice":
      return {
        singular: "detail.noun.invoice",
        plural: "detail.noun.invoices",
      };
    case "packing-slip":
      return {
        singular: "detail.noun.packingSlip",
        plural: "detail.noun.packingSlips",
      };
    case "return":
      return {
        singular: "detail.noun.return",
        plural: "detail.noun.returns",
      };
    case "draft":
      return {
        singular: "detail.noun.draft",
        plural: "detail.noun.drafts",
      };
    default:
      return {
        singular: "detail.noun.salesOrder",
        plural: "detail.noun.salesOrders",
      };
  }
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
  const { session, admin, billing } = await requireAdminAuth(request);
  const orderId = params.orderId;
  if (!orderId) {
    throw new Response("Order not found", { status: 404 });
  }

  const documentMode = resolveDocumentMode(request.url);
  const isInvoice = documentMode === "invoice";
  const isCreditNote = documentMode === "credit-note";
  const isPackingSlip = documentMode === "packing-slip";
  const isReturn = documentMode === "return";
  const isDraft = documentMode === "draft";
  const isIssuedDocument =
    isInvoice || isCreditNote || isPackingSlip || isReturn || isDraft;
  const url = new URL(request.url);
  const bypassCache = url.searchParams.get("fresh") === "1";

  const orderGid = isDraft
    ? toDraftOrderGid(decodeURIComponent(orderId))
    : toOrderGid(decodeURIComponent(orderId));

  // Kick off Shopify order fetch immediately — don't wait on template/SMTP lookups.
  const orderPromise = isDraft
    ? fetchDraftOrderDocument(admin, orderGid, {
        shop: session.shop,
        bypassCache,
      })
    : fetchSalesOrderDocument(admin, orderGid, {
        asCreditNote: isCreditNote,
        shop: session.shop,
        bypassCache,
      });

  const [selectedMap, smtpSettings, planId] = await Promise.all([
    loadSelectedTemplatesForShop(session.shop),
    loadSmtpSettingsForShop(session.shop),
    getShopPlanIdForGating(billing),
  ]);
  const shopSelectedTemplateId =
    selectedMap[
      isCreditNote
        ? "credit-note"
        : isDraft
          ? "draft"
          : isInvoice
            ? "invoice"
            : isPackingSlip
              ? "packing-slip"
              : isReturn
                ? "return"
                : "sales-order"
    ] || null;
  const shopSelectedSalesOrderTemplateId = selectedMap["sales-order"] || null;

  // Shop Active template wins over a stale ?template= query (e.g. after
  // switching Classic on Templates while an old Studio URL is still open).
  const templateId = isCreditNote
    ? resolveCreditNoteTemplateId(
        shopSelectedTemplateId || url.searchParams.get("template"),
      )
    : isDraft
      ? resolveDraftTemplateId(
          shopSelectedTemplateId || url.searchParams.get("template"),
        )
      : isInvoice
        ? resolveInvoiceTemplateId(
            shopSelectedTemplateId || url.searchParams.get("template"),
          )
        : isPackingSlip
          ? resolvePackingSlipTemplateId(
              shopSelectedTemplateId || url.searchParams.get("template"),
            )
          : isReturn
            ? resolveReturnTemplateId(
                shopSelectedTemplateId || url.searchParams.get("template"),
              )
            : resolveSalesOrderTemplateId(
                shopSelectedTemplateId || url.searchParams.get("template"),
              );

  // Sidebar list still uses sales-order template ids for SO document numbers.
  const salesOrderTemplateId = isIssuedDocument
    ? resolveSalesOrderTemplateId(shopSelectedSalesOrderTemplateId)
    : templateId;

  const templatePromise = isIssuedDocument
    ? loadDocumentTemplateSettings(
        session.shop,
        isCreditNote
          ? "credit-note"
          : isDraft
            ? "draft"
            : isInvoice
              ? "invoice"
              : isReturn
                ? "return"
                : "packing-slip",
        templateId,
        admin,
      )
    : loadSalesOrderTemplateSettings(session.shop, templateId, admin);

  const metaGids = [orderGid];
  const creditNoteMetaPromise = isCreditNote
    ? getCreditNoteMetaByOrderGids(session.shop, metaGids)
    : null;
  const invoiceMetaPromise =
    isCreditNote || isInvoice
      ? getInvoicedMetaByOrderGids(session.shop, metaGids)
      : null;
  const creditNoteGidsPromise = isInvoice
    ? getCreditNoteOrderGids(session.shop, metaGids)
    : null;
  const salesOrderNumbersPromise =
    isInvoice || isPackingSlip || isReturn
      ? getSalesOrderDocumentNumbersByOrderGids(
          session.shop,
          salesOrderTemplateId,
          metaGids,
        )
      : null;
  const draftMetaPromise = isDraft
    ? getDraftMetaByOrderGids(session.shop, metaGids)
    : null;
  const packingMetaPromise = isPackingSlip
    ? getPackingSlipMetaByOrderGids(session.shop, metaGids)
    : null;
  const returnMetaPromise = isReturn
    ? getReturnMetaByOrderGids(session.shop, metaGids)
    : null;
  const salesOrderFlagsPromise = !isIssuedDocument
    ? Promise.all([
        getSalesOrderDocumentDetails(
          session.shop,
          salesOrderTemplateId,
          orderGid,
        ),
        getInvoicedOrderGids(session.shop, metaGids),
        getPackingSlipOrderGids(session.shop, metaGids),
        getReturnOrderGids(session.shop, metaGids),
        getDraftOrderGids(session.shop, metaGids),
      ])
    : null;

  const [order, template] = await Promise.all([
    orderPromise,
    templatePromise,
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
  let orderInvoiced = false;
  let orderPackingSlip = false;
  let orderReturn = false;
  let orderDraft = false;

  if (isCreditNote) {
    const [creditMeta, invoiceMeta] = await Promise.all([
      creditNoteMetaPromise!,
      invoiceMetaPromise!,
    ]);
    const currentMeta = creditMeta.get(order.id) ?? creditMeta.get(orderGid);
    const currentInvoice = invoiceMeta.get(order.id) ?? invoiceMeta.get(orderGid);

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
  } else if (isInvoice) {
    const [invoiceMeta, creditNoteGids, soNumbers] = await Promise.all([
      invoiceMetaPromise!,
      creditNoteGidsPromise!,
      salesOrderNumbersPromise!,
    ]);
    const currentMeta = invoiceMeta.get(order.id) ?? invoiceMeta.get(orderGid);
    hasCreditNote = creditNoteGids.has(order.id) || creditNoteGids.has(orderGid);
    orderInvoiced = Boolean(currentMeta);
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
    referenceNumber =
      soNumbers.get(order.id) || soNumbers.get(orderGid) || undefined;
  } else if (isDraft) {
    // Shopify DraftOrder — Billoxi DFT- from Settings series; keep #D… as reference.
    orderDraft = true;
    let draftNumber = "";
    const draftMeta = await draftMetaPromise!;
    const currentMeta = draftMeta.get(order.id) ?? draftMeta.get(orderGid);
    draftNumber = currentMeta?.documentNumber?.trim() || "";
    if (!draftNumber) {
      draftNumber = (await markOrderDraft(session.shop, order.id))?.trim() || "";
    }
    documentNumber = draftNumber || order.name;
    documentDate =
      currentMeta?.draftedAt?.toISOString() || order.createdAt;
    referenceNumber = order.name;
    invoiceCustomerNote = currentMeta?.customerNote ?? null;
    invoiceTerms = currentMeta?.terms ?? null;
  } else if (isPackingSlip) {
    const [packingMeta, soNumbers] = await Promise.all([
      packingMetaPromise!,
      salesOrderNumbersPromise!,
    ]);
    const currentMeta = packingMeta.get(order.id) ?? packingMeta.get(orderGid);
    const ensured =
      currentMeta && !currentMeta.documentNumber
        ? await ensurePackingSlipDocumentNumbers(session.shop, [order.id])
        : new Map<string, string>();
    const existingSalesOrderNumber =
      soNumbers.get(order.id) || soNumbers.get(orderGid);
    documentNumber =
      currentMeta?.documentNumber ||
      ensured.get(order.id) ||
      existingSalesOrderNumber ||
      order.name;
    documentDate =
      currentMeta?.convertedAt?.toISOString() || order.createdAt;
    referenceNumber = existingSalesOrderNumber || order.name;
  } else if (isReturn) {
    const [returnMeta, soNumbers] = await Promise.all([
      returnMetaPromise!,
      salesOrderNumbersPromise!,
    ]);
    const currentMeta = returnMeta.get(order.id) ?? returnMeta.get(orderGid);
    const ensured =
      currentMeta && !currentMeta.documentNumber
        ? await ensureReturnDocumentNumbers(session.shop, [order.id])
        : new Map<string, string>();
    const existingSalesOrderNumber =
      soNumbers.get(order.id) || soNumbers.get(orderGid);
    documentNumber =
      currentMeta?.documentNumber ||
      ensured.get(order.id) ||
      existingSalesOrderNumber ||
      order.name;
    documentDate =
      currentMeta?.convertedAt?.toISOString() || order.createdAt;
    referenceNumber = existingSalesOrderNumber || order.name;
  } else {
    const [soDetailsInitial, invoicedGids, packingGids, returnGids, draftGids] =
      await salesOrderFlagsPromise!;
    orderInvoiced = invoicedGids.has(order.id) || invoicedGids.has(orderGid);
    orderPackingSlip = packingGids.has(order.id) || packingGids.has(orderGid);
    orderReturn = returnGids.has(order.id) || returnGids.has(orderGid);
    orderDraft = draftGids.has(order.id) || draftGids.has(orderGid);

    // Paid in Shopify → self-heal invoice mark without blocking first paint.
    // Primary path is the orders/paid webhook (respects Advanced → On paid).
    const financialStatus = (order.financialStatus || "").toUpperCase();
    if (!orderInvoiced && financialStatus === "PAID") {
      const invoiceSettings = await loadInvoiceSettingsForShop(session.shop);
      if (
        invoiceSettings.autoOnPaid &&
        planHasCapability(planId, "autoInvoice")
      ) {
        orderInvoiced = true;
        void markOrderInvoiced(session.shop, order.id)
          .then(() => invalidateSalesOrdersCache(session.shop))
          .catch((error) => {
            console.error("[sales-order] Paid self-heal failed", error);
          });
      }
    }

    let soDetails = soDetailsInitial;
    if (!soDetails?.documentNumber) {
      const soSeries = await loadNumberSeriesEntryForShop(
        session.shop,
        "sales-order",
      );
      if (soSeries.entryMode !== "manual") {
        await waitForSalesOrderNumberSync(session.shop);
        if (await hasCompletedSalesOrderNumberSync(session.shop)) {
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
    }
    documentNumber = soDetails?.documentNumber ?? "";
    documentDate =
      soDetails?.documentDate?.toISOString() || order.createdAt;
    invoiceCustomerNote = soDetails?.customerNote ?? null;
    invoiceTerms = soDetails?.terms ?? null;
  }

  // Sidebar is non-blocking — document paints first, list streams in.
  const salesOrdersPromise = (async () => {
    if (isDraft) {
      const draftOrders = await fetchDraftOrderSidebarList(admin, session.shop);
      return draftOrders.map((item) => ({
        ...item,
        documentNumber:
          item.id === order.id ? documentNumber : item.documentNumber || item.name,
        createdAt: item.id === order.id && documentDate ? documentDate : item.createdAt,
      }));
    }

    const salesOrders = await fetchSalesOrderList(admin, {
      shop: session.shop,
      templateId: salesOrderTemplateId,
    });

    if (isCreditNote) {
      const [creditMeta, creditGids] = await Promise.all([
        getCreditNoteMetaByOrderGids(
          session.shop,
          salesOrders.map((item) => item.id),
        ),
        getAllCreditNoteOrderGids(session.shop),
      ]);
      const creditGidSet = new Set(creditGids);
      return salesOrders
        .filter((item) => creditGidSet.has(item.id))
        .map((item) => {
          const meta = creditMeta.get(item.id);
          const creditTotal = Number(item.refundedTotal ?? NaN);
          return {
            ...item,
            // Sidebar Amount = Credit Total (refunded), matching the document.
            total:
              Number.isFinite(creditTotal) && creditTotal > 0
                ? item.refundedTotal!
                : item.total,
            documentNumber:
              meta?.documentNumber ||
              (item.id === order.id ? documentNumber : item.documentNumber),
            createdAt: meta?.convertedAt?.toISOString() || item.createdAt,
            creditNoteVoided: Boolean(meta?.voidedAt),
          };
        });
    }

    if (isInvoice) {
      const invoiceMeta = await getInvoicedMetaByOrderGids(
        session.shop,
        salesOrders.map((item) => item.id),
      );
      return salesOrders
        .filter((item) => invoiceMeta.has(item.id))
        .map((item) => {
          const meta = invoiceMeta.get(item.id);
          return {
            ...item,
            documentNumber:
              meta?.documentNumber ||
              (item.id === order.id ? documentNumber : item.documentNumber),
            createdAt: meta?.invoicedAt?.toISOString() || item.createdAt,
          };
        });
    }

    if (isPackingSlip) {
      const packingGids = await getAllPackingSlipOrderGids(session.shop);
      const packingGidSet = new Set(packingGids);
      const filtered = salesOrders.filter((item) =>
        packingGidSet.has(item.id),
      );
      const packingMeta = await getPackingSlipMetaByOrderGids(
        session.shop,
        filtered.map((item) => item.id),
      );
      return filtered.map((item) => {
        const meta = packingMeta.get(item.id);
        return {
          ...item,
          documentNumber:
            meta?.documentNumber ||
            (item.id === order.id ? documentNumber : item.documentNumber),
          createdAt: meta?.convertedAt?.toISOString() || item.createdAt,
        };
      });
    }

    if (isReturn) {
      const returnGids = await getAllReturnOrderGids(session.shop);
      const returnGidSet = new Set(returnGids);
      const filtered = salesOrders.filter((item) => returnGidSet.has(item.id));
      const returnMeta = await getReturnMetaByOrderGids(
        session.shop,
        filtered.map((item) => item.id),
      );
      return filtered.map((item) => {
        const meta = returnMeta.get(item.id);
        return {
          ...item,
          documentNumber:
            meta?.documentNumber ||
            (item.id === order.id ? documentNumber : item.documentNumber),
          createdAt: meta?.convertedAt?.toISOString() || item.createdAt,
        };
      });
    }

    return salesOrders;
  })();

  // Keep logo only on storeDetails — avoids shipping base64 twice in the payload.
  const settingsForClient = { ...template.settings };
  if (template.storeDetails?.logoDataUrl) {
    delete settingsForClient.logoDataUrl;
    delete settingsForClient.logoFileName;
  }

  return {
    documentMode,
    order: {
      ...order,
      documentNumber,
      ...(referenceNumber ? { referenceNumber } : {}),
      ...(documentDate ? { documentDate } : {}),
    },
    salesOrders: salesOrdersPromise,
    paymentStatus: order.financialStatus ?? null,
    orderInvoiced,
    orderPackingSlip,
    orderReturn,
    orderDraft,
    templateId: template.templateId,
    templateName: template.templateName,
    settings: settingsForClient,
    storeDetails: template.storeDetails,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    smtpReady: smtpReadyForPlan(planId, isSmtpReadyForSend(smtpSettings)),
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
  const documentMode = resolveDocumentMode(request.url);
  const isDraftAction = documentMode === "draft";
  const orderGid = isDraftAction
    ? toDraftOrderGid(decodeURIComponent(orderId))
    : toOrderGid(decodeURIComponent(orderId));

  if (intent === "reload") {
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({ ok: true, document: "reload" as const });
  }

  if (intent === "convert-to-invoice") {
    await markOrderInvoiced(session.shop, orderGid);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "invoice" as const,
    });
  }

  if (intent === "finalize-draft") {
    await markOrderInvoiced(session.shop, orderGid);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "finalize-draft" as const,
    });
  }

  if (intent === "save-as-draft") {
    const invoicedGids = await getInvoicedOrderGids(session.shop, [orderGid]);
    if (invoicedGids.has(orderGid)) {
      return Response.json(
        { ok: false, error: "Already invoiced orders cannot be saved as draft" },
        { status: 400 },
      );
    }
    const draftNumber = await markOrderDraft(session.shop, orderGid);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "draft" as const,
      draftNumber,
    });
  }

  if (intent === "convert-to-packing-slip") {
    await markOrderPackingSlip(session.shop, orderGid);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "packing-slip" as const,
    });
  }

  if (intent === "convert-to-return") {
    await markOrderReturn(session.shop, orderGid);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "return" as const,
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
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-invoice" as const,
    });
  }

  if (intent === "delete-credit-note") {
    const deleted = await unmarkOrdersCreditNote(session.shop, [orderGid]);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-credit-note" as const,
    });
  }

  if (intent === "delete-packing-slip") {
    const deleted = await unmarkOrdersPackingSlip(session.shop, [orderGid]);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-packing-slip" as const,
    });
  }

  if (intent === "delete-return") {
    const deleted = await unmarkOrdersReturn(session.shop, [orderGid]);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-return" as const,
    });
  }

  if (intent === "delete-draft") {
    const deleted = await unmarkOrdersDraft(session.shop, [orderGid]);
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      deleted,
      document: "delete-draft" as const,
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
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
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
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "update-invoice" as const,
      documentNumber,
      invoiceDate: invoiceDateRaw,
    });
  }

  if (intent === "update-draft-details") {
    const documentNumber = String(formData.get("documentNumber") || "").trim();
    const draftDateRaw = String(formData.get("draftDate") || "").trim();
    const customerNote = String(formData.get("customerNote") || "");
    const terms = String(formData.get("terms") || "");
    if (!documentNumber) {
      return Response.json(
        { ok: false, error: "Draft number is required" },
        { status: 400 },
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draftDateRaw)) {
      return Response.json(
        { ok: false, error: "Draft date is required" },
        { status: 400 },
      );
    }
    const draftedAt = new Date(`${draftDateRaw}T12:00:00.000Z`);
    if (Number.isNaN(draftedAt.getTime())) {
      return Response.json(
        { ok: false, error: "Invalid draft date" },
        { status: 400 },
      );
    }

    await updateDraftDocumentDetails(session.shop, orderGid, {
      documentNumber,
      draftedAt,
      customerNote,
      terms,
    });
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
    invalidateSalesOrdersCache(session.shop);
    return Response.json({
      ok: true,
      document: "update-draft" as const,
      documentNumber,
      draftDate: draftDateRaw,
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
    invalidateSalesOrderDocumentCache(session.shop, orderGid);
    invalidateDraftOrderDocumentCache(session.shop, orderGid);
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

const PREVIEW_CLIENT_TTL_MS = 120_000;
const PREVIEW_CLIENT_MAX = 24;
const previewClientCache = new Map<string, { expires: number; data: unknown }>();

function previewCacheKeyFromUrl(url: URL) {
  return `${url.pathname}?template=${url.searchParams.get("template") || ""}`;
}

function previewCacheKeyFromHref(href: string) {
  try {
    return previewCacheKeyFromUrl(new URL(href, "https://billoxi.local"));
  } catch {
    return href;
  }
}

function hasCachedDocumentPreview(href: string | null | undefined) {
  if (!href) return false;
  const hit = previewClientCache.get(previewCacheKeyFromHref(href));
  return Boolean(hit && hit.expires > Date.now());
}

function bustPreviewClientCache() {
  previewClientCache.clear();
}

function writePreviewClientCache(key: string, data: unknown) {
  previewClientCache.set(key, {
    expires: Date.now() + PREVIEW_CLIENT_TTL_MS,
    data,
  });
  while (previewClientCache.size > PREVIEW_CLIENT_MAX) {
    const oldest = previewClientCache.keys().next().value;
    if (oldest === undefined) break;
    previewClientCache.delete(oldest);
  }
}

export function shouldRevalidate({
  formMethod,
  currentUrl,
  nextUrl,
}: {
  formMethod?: string | null;
  currentUrl: URL;
  nextUrl: URL;
}) {
  if (formMethod && formMethod.toUpperCase() !== "GET") {
    bustPreviewClientCache();
    return true;
  }
  return (
    currentUrl.pathname !== nextUrl.pathname ||
    currentUrl.search !== nextUrl.search
  );
}

/** Instant back/forward + second click: skip the server round-trip when warm. */
export async function clientLoader({
  request,
  serverLoader,
}: ClientLoaderFunctionArgs) {
  const url = new URL(request.url);
  const key = previewCacheKeyFromUrl(url);
  if (url.searchParams.get("fresh") !== "1") {
    const hit = previewClientCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data;
  }

  const data = await serverLoader();
  writePreviewClientCache(key, data);
  void Promise.resolve(
    (data as { salesOrders?: unknown }).salesOrders,
  )
    .then((salesOrders) => {
      writePreviewClientCache(key, { ...(data as object), salesOrders });
    })
    .catch(() => undefined);
  return data;
}

export default function SalesOrderDocumentPage() {
  const data = useLoaderData<typeof loader>();
  const { language, t } = useAdminI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const convertFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    document?: string;
  }>();
  const sendFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    to?: string;
    attachedPdf?: boolean;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const paperRef = useRef<HTMLDivElement>(null);
  const documentPageRef = useRef<HTMLDivElement>(null);
  const actionRanRef = useRef(false);
  const handledConvertDataRef = useRef<unknown>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isPreparingEmail, setIsPreparingEmail] = useState(false);
  const isConverting = convertFetcher.state !== "idle";
  const isSendingEmail = isPreparingEmail || sendFetcher.state !== "idle";
  const isInvoice = data.documentMode === "invoice";
  const isCreditNote = data.documentMode === "credit-note";
  const isPackingSlip = data.documentMode === "packing-slip";
  const isReturn = data.documentMode === "return";
  const isDraft = data.documentMode === "draft";
  const isIssuedDocument =
    isInvoice || isCreditNote || isPackingSlip || isReturn || isDraft;
  const listPath = isCreditNote
    ? "/app/credit-note"
    : isInvoice
      ? "/app/invoice"
      : isPackingSlip
        ? "/app/packing-slip"
        : isReturn
          ? "/app/return"
          : isDraft
            ? "/app/draft"
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
  const [convertInvoiceOpen, setConvertInvoiceOpen] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [prefetchOrderHref, setPrefetchOrderHref] = useState<string | null>(
    null,
  );
  const [pendingPreviewHref, setPendingPreviewHref] = useState<string | null>(
    null,
  );
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

  // Fill remaining viewport under the page header so no empty footer gap remains.
  useEffect(() => {
    const page = documentPageRef.current;
    if (!page) return;

    const BOTTOM_GAP_PX = 8;
    const mobileQuery = window.matchMedia("(max-width: 900px)");

    const syncHeight = () => {
      if (mobileQuery.matches) {
        page.style.removeProperty("--sales-order-doc-height");
        return;
      }
      const top = page.getBoundingClientRect().top;
      const next = Math.max(
        240,
        Math.floor(window.innerHeight - top - BOTTOM_GAP_PX),
      );
      page.style.setProperty("--sales-order-doc-height", `${next}px`);
    };

    syncHeight();
    const rafId = window.requestAnimationFrame(syncHeight);
    window.addEventListener("resize", syncHeight);
    mobileQuery.addEventListener("change", syncHeight);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(syncHeight)
        : null;
    observer?.observe(document.documentElement);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", syncHeight);
      mobileQuery.removeEventListener("change", syncHeight);
      observer?.disconnect();
      page.style.removeProperty("--sales-order-doc-height");
    };
  }, []);

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
    } else if (isDraft) {
      formData.set("intent", "update-draft-details");
      formData.set("documentNumber", editInvoiceNumber.trim());
      formData.set("draftDate", editInvoiceDate);
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
    isDraft,
    isInvoice,
    numberChanged,
    numberMode,
  ]);

  useEffect(() => {
    if (isInvoice || isDraft) {
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
    isDraft,
    isInvoice,
    searchParams,
    setSearchParams,
  ]);

  const openOrder = useCallback(
    (orderGid: string) => {
      const numericId = orderGid.includes("/")
        ? orderGid.split("/").pop() || orderGid
        : orderGid;
      const href = `${documentBasePath}/${encodeURIComponent(numericId)}${templateQuery}`;
      setPendingPreviewHref(hasCachedDocumentPreview(href) ? null : href);
      setPrefetchOrderHref(href);
      navigate(href, { preventScrollReset: true });
    },
    [documentBasePath, navigate, templateQuery],
  );

  useEffect(() => {
    setPendingPreviewHref(null);
  }, [data.order.id]);

  const navigatingHref =
    navigation.state === "loading" &&
    !navigation.formMethod &&
    navigation.location &&
    navigation.location.pathname !== location.pathname &&
    navigation.location.pathname.startsWith(`${documentBasePath}/`)
      ? `${navigation.location.pathname}${navigation.location.search}`
      : null;
  const pendingHref = pendingPreviewHref || navigatingHref;
  const isPreviewLoading =
    Boolean(pendingHref) && !hasCachedDocumentPreview(pendingHref);

  const orderHref = useCallback(
    (orderGid: string) => {
      const numericId = orderGid.includes("/")
        ? orderGid.split("/").pop() || orderGid
        : orderGid;
      return `${documentBasePath}/${encodeURIComponent(numericId)}${templateQuery}`;
    },
    [documentBasePath, templateQuery],
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
      recordDocumentActivity("printed", {
        documentKind: isCreditNote
          ? "credit-note"
          : isDraft
            ? "draft"
            : isInvoice
              ? "invoice"
              : isPackingSlip
                ? "packing-slip"
                : isReturn
                  ? "return"
                  : "sales-order",
        documentNumber: previewOrder.documentNumber || null,
        orderGid: data.order.id,
        orderId: data.order.id,
        orderName: data.order.name,
        processType: "manual",
      });
    } catch (error) {
      console.error("Print failed:", error);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(t("detail.toast.printFailed"), { isError: true });
      }
    } finally {
      setIsPrinting(false);
    }
  }, [
    data.order.id,
    data.order.name,
    data.settings,
    isDownloading,
    isCreditNote,
    isDraft,
    isInvoice,
    isPackingSlip,
    isReturn,
    isPrinting,
    previewOrder.documentNumber,
    t,
  ]);

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
        isCreditNote
          ? "credit-note"
          : isDraft
            ? "draft"
            : isInvoice
              ? "invoice"
              : isPackingSlip
                ? "packing-slip"
                : isReturn
                  ? "return"
                  : "sales-order",
      );

      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(t("detail.toast.pdfDownloaded"));
      }
      recordDocumentActivity("downloaded", {
        documentKind: isCreditNote
          ? "credit-note"
          : isDraft
            ? "draft"
            : isInvoice
              ? "invoice"
              : isPackingSlip
                ? "packing-slip"
                : isReturn
                  ? "return"
                  : "sales-order",
        documentNumber: previewOrder.documentNumber || null,
        orderGid: data.order.id,
        orderId: data.order.id,
        orderName: data.order.name,
        processType: "manual",
      });
    } catch (error) {
      console.error("PDF download failed:", error);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(t("detail.toast.pdfFailed"), { isError: true });
      }
    } finally {
      setIsDownloading(false);
    }
  }, [
    data.order.id,
    data.order.name,
    data.settings,
    isDownloading,
    isCreditNote,
    isDraft,
    isInvoice,
    isPackingSlip,
    isReturn,
    isPrinting,
    previewOrder.documentNumber,
    t,
  ]);

  const handleSend = useCallback(async () => {
    const email = data.order.email || data.order.billing.email;
    if (!email) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(t("detail.toast.noEmail"), { isError: true });
      }
      return;
    }
    if (!data.smtpReady) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(SMTP_REQUIRED_NOTICE, { isError: true });
      }
      return;
    }
    if (isSendingEmail) return;

    const documentKind = isCreditNote
      ? "credit-note"
      : isDraft
        ? "draft"
        : isInvoice
          ? "invoice"
          : isPackingSlip
            ? "packing-slip"
            : isReturn
              ? "return"
              : "sales-order";

    const formData = new FormData();
    formData.set("orderId", data.order.id);
    // Email templates do not have a dedicated draft kind — use invoice copy.
    formData.set("documentKind", documentKind);
    formData.set("toEmail", email);
    formData.set(
      "documentNumber",
      data.order.documentNumber || data.order.name,
    );
    formData.set("orderName", data.order.name);
    formData.set(
      "customerName",
      data.order.customerName || data.order.billing.name || "",
    );
    formData.set("total", data.order.total);
    formData.set("currency", data.order.currencyCode);
    formData.set("referenceNumber", data.order.referenceNumber || "");
    formData.set("templateId", data.templateId);

    setIsPreparingEmail(true);
    try {
      const paper = paperRef.current;
      let pdfBlob: Blob;
      let fileName: string;
      if (paper) {
        const { buildSalesOrderDomVectorPdfBlob } = await import(
          "../sales-order-pdf"
        );
        ({ blob: pdfBlob, fileName } = await buildSalesOrderDomVectorPdfBlob(
          paper,
          {
            paperSize: data.settings.paperSize,
            orientation: data.settings.orientation,
            backgroundColor: data.settings.backgroundColor,
            fontFamily: resolveDocumentFontFamily(data.settings.fontFamily),
            margins: data.settings.margins,
          },
          previewOrder.documentNumber || data.order.name,
          documentKind,
        ));
      } else {
        const { buildSalesOrderDomPdfBlobFromList } = await import(
          "../sales-order-dom-export.client"
        );
        ({ blob: pdfBlob, fileName } = await buildSalesOrderDomPdfBlobFromList({
          orderId: data.order.id,
          templateId: data.templateId,
          documentKind,
        }));
      }
      formData.append(
        "pdf",
        new File([pdfBlob], fileName, { type: "application/pdf" }),
      );
    } catch (error) {
      console.error("Email PDF prepare failed:", error);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(t("detail.toast.pdfEmailFailed"), {
          isError: true,
        });
      }
      setIsPreparingEmail(false);
      return;
    }
    setIsPreparingEmail(false);

    sendFetcher.submit(formData, {
      method: "post",
      action: "/app/send-document-email",
      encType: "multipart/form-data",
    });
  }, [
    data.order,
    data.settings,
    data.smtpReady,
    data.templateId,
    isCreditNote,
    isDraft,
    isInvoice,
    isPackingSlip,
    isReturn,
    isSendingEmail,
    previewOrder.documentNumber,
    sendFetcher,
    t,
  ]);

  const handledSendDataRef = useRef<unknown>(null);
  useEffect(() => {
    if (sendFetcher.state !== "idle" || !sendFetcher.data) return;
    if (handledSendDataRef.current === sendFetcher.data) return;
    handledSendDataRef.current = sendFetcher.data;

    const result = sendFetcher.data;
    if (!result.ok) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(result.error || t("detail.toast.sendFailed"), {
          isError: true,
        });
      }
      return;
    }

    if (typeof shopify !== "undefined" && shopify.toast) {
      shopify.toast.show(
        result.attachedPdf
          ? adminTf(language, "detail.toast.emailSentPdf", {
              email: result.to || "",
            })
          : adminTf(language, "detail.toast.emailSent", {
              email: result.to || "",
            }),
      );
    }
  }, [sendFetcher.state, sendFetcher.data, language, t]);

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

  const creditNoteVoided = Boolean(data.creditNoteVoided);
  const paymentStatus = data.paymentStatus ?? null;
  // Drafts / packing / return are not payment documents — hide Pending/Paid payment badges.
  const headerStatus =
    isDraft || isPackingSlip || isReturn
      ? null
      : isCreditNote && creditNoteVoided
        ? "VOIDED"
        : paymentStatus;
  const paymentLabel =
    adminPaymentStatusLabel(language, headerStatus) || formatStatus(headerStatus);
  const paymentStatusKey = (paymentStatus || "").toUpperCase();
  const isCancelledOrder =
    paymentStatusKey === "VOIDED" ||
    paymentStatusKey.includes("CANCEL");
  const alreadyInvoiced = Boolean(data.orderInvoiced);
  const alreadyDraft = Boolean(data.orderDraft);

  const documentStatusRibbon = (() => {
    if (!data.isAdmin) return null;

    if (isDraft) {
      return { label: t("pages.draft"), variant: "pending" as const };
    }

    if (isPackingSlip || isReturn) {
      if (isCancelledOrder) {
        return { label: t("status.voided"), variant: "voided" as const };
      }
      return null;
    }

    if (isIssuedDocument) {
      if (isCreditNote && creditNoteVoided) {
        return { label: t("status.voided"), variant: "voided" as const };
      }
      if (isCancelledOrder) {
        return { label: t("status.voided"), variant: "voided" as const };
      }
      if (paymentStatusKey === "REFUNDED") {
        return { label: t("status.refunded"), variant: "refunded" as const };
      }
      if (paymentStatusKey === "PARTIALLY_REFUNDED") {
        return {
          label: t("status.partiallyRefunded"),
          variant: "partial" as const,
        };
      }
      if (paymentStatusKey === "PAID") {
        return { label: t("status.paid"), variant: "paid" as const };
      }
      if (paymentStatusKey === "PARTIALLY_PAID") {
        return {
          label: t("status.partiallyPaid"),
          variant: "partial" as const,
        };
      }
      if (
        paymentStatusKey === "PENDING" ||
        paymentStatusKey === "AUTHORIZED" ||
        paymentStatusKey === "UNPAID" ||
        paymentStatusKey === "EXPIRED" ||
        !paymentStatusKey
      ) {
        return { label: t("status.pending"), variant: "pending" as const };
      }
      return null;
    }

    if (isCancelledOrder) {
      return { label: t("status.voided"), variant: "voided" as const };
    }
    if (alreadyInvoiced) {
      return { label: t("status.invoiced"), variant: "invoiced" as const };
    }
    if (alreadyDraft) {
      return { label: t("pages.draft"), variant: "pending" as const };
    }
    return { label: t("status.notInvoiced"), variant: "not-invoiced" as const };
  })();

  const handleConvertToInvoice = useCallback(() => {
    if (isConverting || isCancelledOrder) return;
    setConvertInvoiceOpen(true);
  }, [isCancelledOrder, isConverting]);

  const confirmConvertToInvoice = useCallback(() => {
    if (isConverting || isCancelledOrder) return;
    convertFetcher.submit(
      { intent: isDraft ? "finalize-draft" : "convert-to-invoice" },
      { method: "post" },
    );
  }, [convertFetcher, isCancelledOrder, isConverting, isDraft]);

  const handleConvertToPackingSlip = useCallback(() => {
    if (isConverting || isCancelledOrder) return;
    convertFetcher.submit(
      { intent: "convert-to-packing-slip" },
      { method: "post" },
    );
  }, [convertFetcher, isCancelledOrder, isConverting]);

  const canConvertToReturn =
    !isIssuedDocument &&
    !data.orderReturn &&
    (paymentStatusKey === "REFUNDED" ||
      paymentStatusKey === "PARTIALLY_REFUNDED");

  const handleConvertToReturn = useCallback(() => {
    if (isConverting || isCancelledOrder || !canConvertToReturn) return;
    convertFetcher.submit(
      { intent: "convert-to-return" },
      { method: "post" },
    );
  }, [
    canConvertToReturn,
    convertFetcher,
    isCancelledOrder,
    isConverting,
  ]);

  const handleSaveAsDraft = useCallback(() => {
    if (isConverting || isCancelledOrder || alreadyInvoiced || alreadyDraft) {
      return;
    }
    convertFetcher.submit({ intent: "save-as-draft" }, { method: "post" });
  }, [
    alreadyDraft,
    alreadyInvoiced,
    convertFetcher,
    isCancelledOrder,
    isConverting,
  ]);

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
    if (isPackingSlip) {
      setDeleteInvoiceOpen(false);
      convertFetcher.submit(
        { intent: "delete-packing-slip" },
        { method: "post" },
      );
      return;
    }
    if (isReturn) {
      setDeleteInvoiceOpen(false);
      convertFetcher.submit(
        { intent: "delete-return" },
        { method: "post" },
      );
      return;
    }
    if (isDraft) {
      setDeleteInvoiceOpen(false);
      convertFetcher.submit({ intent: "delete-draft" }, { method: "post" });
      return;
    }
    if (!isInvoice) return;
    if (data.hasCreditNote) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(t("detail.toast.deleteCreditFirst"), {
          isError: true,
        });
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
    isDraft,
    isInvoice,
    isPackingSlip,
    isReturn,
    t,
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

    if (result.document === "reload") {
      return;
    }

    if (typeof shopify !== "undefined" && shopify.toast) {
      if (result.document === "update-credit-note") {
        shopify.toast.show(t("detail.toast.creditSaved"));
        setInvoiceEditOpen(false);
      } else if (result.document === "update-invoice") {
        shopify.toast.show(t("detail.toast.invoiceSaved"));
        setInvoiceEditOpen(false);
      } else if (result.document === "update-draft") {
        shopify.toast.show(t("detail.toast.draftSaved"));
        setInvoiceEditOpen(false);
      } else if (result.document === "update-sales-order") {
        shopify.toast.show(t("detail.toast.salesOrderSaved"));
        setInvoiceEditOpen(false);
      } else if (result.document === "delete-credit-note") {
        shopify.toast.show(t("detail.toast.creditDeleted"));
        navigate(listPath);
        return;
      } else if (result.document === "delete-invoice") {
        shopify.toast.show(t("detail.toast.invoiceDeleted"));
        navigate(listPath);
        return;
      } else if (result.document === "delete-packing-slip") {
        shopify.toast.show(t("detail.toast.packingDeleted"));
        navigate(listPath);
        return;
      } else if (result.document === "delete-return") {
        shopify.toast.show(t("detail.toast.returnDeleted"));
        navigate(listPath);
        return;
      } else if (result.document === "delete-draft") {
        shopify.toast.show(t("detail.toast.draftDeleted"));
        navigate("/app/draft");
        return;
      } else if (result.document === "packing-slip") {
        shopify.toast.show(t("detail.toast.convertedPacking"));
      } else if (result.document === "return") {
        shopify.toast.show(t("detail.toast.convertedReturn"));
      } else if (result.document === "draft") {
        shopify.toast.show(t("detail.toast.savedDraft"));
        const numericId = data.order.id.includes("/")
          ? data.order.id.split("/").pop() || data.order.id
          : data.order.id;
        navigate(`/app/draft/${encodeURIComponent(numericId)}`);
        return;
      } else if (
        result.document === "finalize-draft" ||
        (result.document === "invoice" && isDraft)
      ) {
        setConvertInvoiceOpen(false);
        shopify.toast.show(t("detail.toast.convertedInvoice"));
        const numericId = data.order.id.includes("/")
          ? data.order.id.split("/").pop() || data.order.id
          : data.order.id;
        navigate(
          `/app/invoice/${encodeURIComponent(numericId)}${templateQuery}`,
        );
        return;
      } else if (result.document === "invoice") {
        setConvertInvoiceOpen(false);
        shopify.toast.show(t("detail.toast.convertedInvoice"));
      }
    }
    // Fetcher POST already revalidates via shouldRevalidate — avoid a second full reload.
  }, [
    convertFetcher.data,
    convertFetcher.state,
    data.order.id,
    isDraft,
    listPath,
    navigate,
    t,
    templateQuery,
  ]);

  const handleReload = useCallback(() => {
    if (
      isConverting ||
      isDownloading ||
      isPrinting ||
      isSendingEmail ||
      revalidator.state !== "idle"
    ) {
      return;
    }
    // Bust short-lived caches then revalidate via POST shouldRevalidate.
    convertFetcher.submit({ intent: "reload" }, { method: "post" });
  }, [
    convertFetcher,
    isConverting,
    isDownloading,
    isPrinting,
    isSendingEmail,
    revalidator.state,
  ]);

  return (
    <s-page
      heading={previewOrder.documentNumber || data.order.name}
      inlineSize="large"
    >
      {prefetchOrderHref ? <PrefetchPageLinks page={prefetchOrderHref} /> : null}
      {pendingPreviewHref && pendingPreviewHref !== prefetchOrderHref ? (
        <PrefetchPageLinks page={pendingPreviewHref} />
      ) : null}
      <s-link slot="breadcrumb-actions" href={listPath}>
        {adminPageHeading(language, data.documentMode)}
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
        {isDownloading ? t("detail.downloading") : t("common.download")}
      </s-button>
      <s-button
        slot="secondary-actions"
        icon="refresh"
        loading={
          revalidator.state !== "idle" || isConverting || undefined
        }
        disabled={
          isConverting ||
          isDownloading ||
          isPrinting ||
          isSendingEmail ||
          revalidator.state !== "idle" ||
          undefined
        }
        onClick={handleReload}
      >
        {t("list.reload")}
      </s-button>
      {!isPackingSlip && !isReturn ? (
        <s-button
          slot="secondary-actions"
          icon="edit"
          disabled={isConverting || undefined}
          onClick={openInvoiceEdit}
        >
          {t("common.edit")}
        </s-button>
      ) : null}
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
              {t("detail.convertToInvoice")}
            </s-button>
          ) : null}
          {!isIssuedDocument && !data.orderPackingSlip ? (
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
              {t("detail.convertToPackingSlip")}
            </s-button>
          ) : null}
          {canConvertToReturn ? (
            <s-button
              slot="secondary-actions"
              loading={
                (isConverting &&
                  convertFetcher.formData?.get("intent") ===
                    "convert-to-return") ||
                undefined
              }
              disabled={isConverting || undefined}
              onClick={handleConvertToReturn}
            >
              {t("detail.convertToReturn")}
            </s-button>
          ) : null}
        </>
      ) : null}
      <s-button
        slot="secondary-actions"
        icon="email"
        loading={isSendingEmail || undefined}
        disabled={isConverting || isCancelledOrder || isSendingEmail || undefined}
        onClick={handleSend}
      >
        {t("list.actionSendEmail")}
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
        {isPrinting ? t("detail.preparing") : t("list.actionPrint")}
      </s-button>
      {isInvoice || isCreditNote || isPackingSlip || isReturn || isDraft ? (
        <s-button
          slot="secondary-actions"
          icon="delete"
          tone="critical"
          loading={
            (isConverting &&
              (convertFetcher.formData?.get("intent") === "delete-invoice" ||
                convertFetcher.formData?.get("intent") ===
                  "delete-credit-note" ||
                convertFetcher.formData?.get("intent") ===
                  "delete-packing-slip" ||
                convertFetcher.formData?.get("intent") === "delete-return" ||
                convertFetcher.formData?.get("intent") === "delete-draft")) ||
            undefined
          }
          disabled={
            isConverting || (isInvoice && data.hasCreditNote) || undefined
          }
          onClick={() => setDeleteInvoiceOpen(true)}
        >
          {t("common.delete")}
        </s-button>
      ) : null}

      <div ref={documentPageRef} className="sales-order-document-page">
        <div className="sales-order-document-layout">
          <aside className="sales-order-document-sidebar no-print">
            <AppProvider i18n={enTranslations}>
              <div className="sales-order-document-sidebar__card">
                <Card padding="0">
                  <Box
                    paddingInline="400"
                    paddingBlockStart="400"
                    paddingBlockEnd="300"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingSm">
                          {t(sidebarTitleKey(data.documentMode))}
                        </Text>
                        <Button
                          onClick={() => navigate(listPath)}
                          variant="plain"
                        >
                          {t("common.viewAll")}
                        </Button>
                      </InlineStack>
                      <TextField
                        label={t("common.search")}
                        labelHidden
                        value={sidebarQuery}
                        onChange={setSidebarQuery}
                        autoComplete="off"
                        placeholder={t(sidebarSearchKey(data.documentMode))}
                        prefix={<Icon source={SearchIcon} tone="subdued" />}
                        clearButton
                        onClearButtonClick={() => setSidebarQuery("")}
                      />
                    </BlockStack>
                  </Box>
                  <Scrollable
                    className="sales-order-document-sidebar__list"
                    vertical
                    horizontal={false}
                    scrollbarWidth="thin"
                  >
                    <Suspense
                      fallback={
                        <div className="sales-order-document-sidebar__loading">
                          <PageLoader label={t("detail.loadingOrders")} />
                        </div>
                      }
                    >
                      <Await resolve={data.salesOrders}>
                        {(salesOrders) => {
                          const query = sidebarQuery.trim().toLowerCase();
                          const filteredOrders = query
                            ? salesOrders.filter((item) => {
                                const haystack = [
                                  item.customer,
                                  item.documentNumber,
                                  item.name,
                                  item.total,
                                  item.paymentStatus,
                                  formatStatus(item.paymentStatus || ""),
                                  adminPaymentStatusLabel(
                                    language,
                                    item.paymentStatus,
                                  ),
                                ]
                                  .filter(Boolean)
                                  .join(" ")
                                  .toLowerCase();
                                return haystack.includes(query);
                              })
                            : salesOrders;

                          const currentIndex = filteredOrders.findIndex(
                            (item) => item.id === data.order.id,
                          );
                          const nearbyHrefs = [
                            filteredOrders[currentIndex + 1],
                            filteredOrders[currentIndex + 2],
                          ]
                            .filter(Boolean)
                            .map((item) => orderHref(item.id));

                          return (
                    <>
                    {nearbyHrefs.map((href) =>
                      href !== prefetchOrderHref &&
                      href !== pendingPreviewHref ? (
                        <PrefetchPageLinks key={href} page={href} />
                      ) : null,
                    )}
                    <ResourceList
                      resourceName={{
                        singular: t(
                          sidebarResourceNameKeys(data.documentMode).singular,
                        ),
                        plural: t(
                          sidebarResourceNameKeys(data.documentMode).plural,
                        ),
                      }}
                      items={filteredOrders}
                      idForItem={(item) => item.id}
                      emptyState={
                        query ? (
                          <Box padding="400">
                            <Text as="p" tone="subdued" alignment="center">
                              {adminTf(language, "detail.noMatches", {
                                query: sidebarQuery.trim(),
                              })}
                            </Text>
                          </Box>
                        ) : undefined
                      }
                      renderItem={(item) => {
                        const itemHref = orderHref(item.id);
                        const isActive =
                          item.id === data.order.id ||
                          itemHref === pendingPreviewHref ||
                          itemHref === pendingHref;
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
                        const badgeTone = sidebarBadgeStatus
                          ? paymentBadgeTone(sidebarBadgeStatus)
                          : null;

                        return (
                          <ResourceItem
                            id={item.id}
                            accessibilityLabel={adminTf(
                              language,
                              "detail.openItem",
                              { name: salesOrderLabel },
                            )}
                            onClick={() => {
                              if (item.id === data.order.id) return;
                              openOrder(item.id);
                            }}
                            name={salesOrderLabel}
                            onMouseOver={() => {
                              if (item.id === data.order.id) return;
                              setPrefetchOrderHref((current) =>
                                current === itemHref ? current : itemHref,
                              );
                            }}
                            onFocus={() => {
                              if (item.id === data.order.id) return;
                              setPrefetchOrderHref((current) =>
                                current === itemHref ? current : itemHref,
                              );
                            }}
                          >
                            <div
                              className={
                                isActive
                                  ? "sales-order-sidebar-item sales-order-sidebar-item--active"
                                  : "sales-order-sidebar-item"
                              }
                            >
                              <BlockStack gap="100">
                                <InlineStack
                                  align="space-between"
                                  blockAlign="start"
                                  gap="200"
                                  wrap={false}
                                >
                                  <Text
                                    as="span"
                                    variant="bodyMd"
                                    fontWeight="semibold"
                                    breakWord
                                  >
                                    {item.customer}
                                  </Text>
                                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                                    {formatMoney(item.total, item.currencyCode)}
                                  </Text>
                                </InlineStack>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {salesOrderLabel} ·{" "}
                                  {formatOrderDate(item.createdAt)}
                                </Text>
                                <InlineStack gap="200" blockAlign="center">
                                  {sidebarBadgeStatus ? (
                                    <Badge
                                      tone={
                                        badgeTone === "neutral"
                                          ? undefined
                                          : badgeTone ?? undefined
                                      }
                                    >
                                      {adminPaymentStatusLabel(
                                        language,
                                        sidebarBadgeStatus,
                                      ) || formatStatus(sidebarBadgeStatus)}
                                    </Badge>
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
                                          ? t("status.invoiced")
                                          : t("status.notInvoiced")
                                      }
                                      title={
                                        item.invoiced
                                          ? t("status.invoiced")
                                          : t("status.notInvoiced")
                                      }
                                    />
                                  ) : null}
                                </InlineStack>
                              </BlockStack>
                            </div>
                          </ResourceItem>
                        );
                      }}
                    />
                    </>
                          );
                        }}
                      </Await>
                    </Suspense>
                  </Scrollable>
                </Card>
              </div>
            </AppProvider>
          </aside>

          <div
            className={
              isPreviewLoading
                ? "sales-order-document-stage is-preview-loading"
                : "sales-order-document-stage"
            }
            aria-busy={isPreviewLoading || undefined}
          >
            {isPreviewLoading ? (
              <div className="sales-order-document-stage__loader no-print">
                <PageLoader label={t("detail.loadingPreview")} />
              </div>
            ) : null}
            <Scrollable
              className="sales-order-document-stage__scroll"
              vertical
              horizontal={false}
              scrollbarWidth="thin"
            >
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
            </Scrollable>
          </div>
        </div>
      </div>
      <AppProvider i18n={enTranslations}>
        <Modal
          open={convertInvoiceOpen}
          onClose={() => {
            if (isConverting) return;
            setConvertInvoiceOpen(false);
          }}
          title={t("detail.convertInvoiceTitle")}
          primaryAction={{
            content: t("common.yes"),
            onAction: confirmConvertToInvoice,
            loading:
              isConverting &&
              (convertFetcher.formData?.get("intent") === "convert-to-invoice" ||
                convertFetcher.formData?.get("intent") === "finalize-draft"),
          }}
          secondaryActions={[
            {
              content: t("common.no"),
              disabled: isConverting,
              onAction: () => setConvertInvoiceOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <Text as="p">
              {isDraft
                ? t("detail.convertDraftInvoiceBody")
                : t("detail.convertInvoiceBody")}
            </Text>
          </Modal.Section>
        </Modal>
        <Modal
          open={deleteInvoiceOpen}
          onClose={() => setDeleteInvoiceOpen(false)}
          title={
            isCreditNote
              ? t("detail.deleteCreditNoteTitle")
              : isPackingSlip
                ? t("detail.deletePackingSlipTitle")
                : isReturn
                  ? t("detail.deleteReturnTitle")
                  : isDraft
                    ? t("detail.deleteDraftTitle")
                    : t("detail.deleteInvoiceTitle")
          }
          primaryAction={{
            content: t("common.delete"),
            destructive: true,
            onAction: handleDeleteInvoice,
            loading:
              isConverting &&
              (convertFetcher.formData?.get("intent") === "delete-invoice" ||
                convertFetcher.formData?.get("intent") ===
                  "delete-credit-note" ||
                convertFetcher.formData?.get("intent") ===
                  "delete-packing-slip" ||
                convertFetcher.formData?.get("intent") === "delete-return" ||
                convertFetcher.formData?.get("intent") === "delete-draft"),
            disabled: isInvoice && Boolean(data.hasCreditNote),
          }}
          secondaryActions={[
            {
              content: t("common.cancel"),
              onAction: () => setDeleteInvoiceOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <Text as="p">
              {isCreditNote
                ? t("detail.deleteCreditNoteBody")
                : isPackingSlip
                  ? t("detail.deletePackingSlipBody")
                  : isReturn
                    ? t("detail.deleteReturnBody")
                    : isDraft
                      ? t("detail.deleteDraftBody")
                      : data.hasCreditNote
                        ? t("detail.deleteInvoiceHasCredit")
                        : t("detail.deleteInvoiceBody")}
            </Text>
          </Modal.Section>
        </Modal>
        <Modal
          open={invoiceEditOpen}
          onClose={closeInvoiceEdit}
          title={
            isCreditNote
              ? t("detail.editCreditNote")
              : isInvoice
                ? t("detail.editInvoice")
                : isDraft
                  ? t("detail.editDraft")
                  : t("detail.editSalesOrder")
          }
          primaryAction={{
            content: t("common.save"),
            onAction: handleSaveInvoiceDetails,
            loading:
              isConverting &&
              (convertFetcher.formData?.get("intent") ===
                "update-invoice-details" ||
                convertFetcher.formData?.get("intent") ===
                  "update-sales-order-details" ||
                convertFetcher.formData?.get("intent") ===
                  "update-credit-note-details" ||
                convertFetcher.formData?.get("intent") ===
                  "update-draft-details"),
            disabled: !invoiceDetailsDirty || isConverting,
          }}
          secondaryActions={[
            {
              content: t("common.cancel"),
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
                      ? t("detail.numberCreditNote")
                      : isInvoice
                        ? t("detail.numberInvoice")
                        : isDraft
                          ? t("detail.numberDraft")
                          : t("detail.numberSalesOrder")
                  }
                  value={editInvoiceNumber}
                  onInput={handleInvoiceNumberInput}
                  autocomplete="off"
                />
                <s-date-field
                  label={
                    isCreditNote
                      ? t("detail.dateCreditNote")
                      : isInvoice
                        ? t("detail.dateInvoice")
                        : isDraft
                          ? t("detail.dateDraft")
                          : t("detail.dateSalesOrder")
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
                  label={t("detail.reason")}
                  value={editCreditReason}
                  onInput={(event: Event) =>
                    setEditCreditReason(fieldValue(event))
                  }
                  autocomplete="off"
                  placeholder={t("detail.reasonPlaceholder")}
                />
              ) : null}
              {!isInvoice && !isCreditNote && !isDraft && numberChanged ? (
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {t("detail.afterSavingNumber")}
                  </Text>
                  <RadioButton
                    label={adminTf(language, "detail.numberModeContinue", {
                      number: editInvoiceNumber.trim() || t("detail.thisNumber"),
                    })}
                    checked={numberMode === "continue"}
                    id="so-number-mode-continue"
                    name="so-number-mode"
                    onChange={() => setNumberMode("continue")}
                  />
                  <RadioButton
                    label={t("detail.numberModeManual")}
                    checked={numberMode === "manual"}
                    id="so-number-mode-manual"
                    name="so-number-mode"
                    onChange={() => setNumberMode("manual")}
                  />
                </BlockStack>
              ) : null}
              <s-text-area
                label={t("detail.customerNote")}
                value={editCustomerNote}
                rows={3}
                onInput={(event: Event) =>
                  setEditCustomerNote(fieldValue(event))
                }
              />
              <Text as="p" tone="subdued">
                {t("detail.customerNoteHelp")}
              </Text>
              <s-text-area
                label={t("detail.terms")}
                value={editTerms}
                rows={3}
                onInput={(event: Event) => setEditTerms(fieldValue(event))}
              />
              <s-banner tone="info" heading={t("detail.important")}>
                {adminTf(language, "detail.itemsLocked", {
                  kind: isCreditNote
                    ? t("detail.noun.creditNote")
                    : isInvoice
                      ? t("detail.noun.invoice")
                      : isDraft
                        ? t("detail.noun.draft")
                        : t("detail.noun.salesOrder"),
                })}
              </s-banner>
            </s-stack>
          </Modal.Section>
        </Modal>
      </AppProvider>
    </s-page>
  );
}

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:sales-order-detail-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
