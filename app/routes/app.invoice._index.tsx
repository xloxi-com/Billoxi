import type {
  ClientLoaderFunctionArgs,
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  cachedClientLoader,
  createAppPageClientCache,
} from "../client-page-cache";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { renderEmbeddedRouteError } from "../embedded-route-error";

import { requireAdminAuth } from "../shopify-context.server";
import {
  resolveInvoiceTemplateId,
  resolveSalesOrderTemplateId,
} from "../sales-order-ids";
import {
  loadSalesOrdersPage,
  parseSalesOrdersSearchParams,
} from "../sales-orders.server";
import { loadSelectedTemplateForShop, loadSmtpSettingsForShop } from "../shop-settings.server";
import { isSmtpReadyForSend } from "../smtp-settings";
import { getShopPlanIdForGating, smtpReadyForPlan } from "../plan-access";
import { INVOICED_VIEW_INDEX } from "../sales-orders";
import { ensureAutoCreditNotesForOrders } from "../auto-credit-note.server";
import SalesOrdersListPage, {
  action,
  headers as salesOrdersHeaders,
  links as salesOrdersLinks,
} from "./app.sales-order._index";

export { action };
export const links: LinksFunction = salesOrdersLinks;

/**
 * Invoice list — same Sales Orders table UI, but only orders that were
 * converted to invoice (OrderInvoiceStatus).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, billing } = await requireAdminAuth(request);
  const url = new URL(request.url);
  // Invoice list defaults to newest created invoice first.
  if (!url.searchParams.get("sort")) {
    url.searchParams.set("sort", "date desc");
  }
  const invoicedView =
    INVOICED_VIEW_INDEX >= 0 ? String(INVOICED_VIEW_INDEX) : "4";
  url.searchParams.set("view", invoicedView);

  const params = parseSalesOrdersSearchParams(url);
  params.selectedView =
    INVOICED_VIEW_INDEX >= 0 ? INVOICED_VIEW_INDEX : params.selectedView;

  const soTemplatePromise = loadSelectedTemplateForShop(
    session.shop,
    "sales-order",
  );
  const pagePromise = soTemplatePromise.then((shopSelectedTemplateId) =>
    loadSalesOrdersPage(
      admin,
      session.shop,
      params,
      resolveSalesOrderTemplateId(shopSelectedTemplateId),
    ),
  );
  const [
    shopSelectedTemplateId,
    shopSelectedInvoiceTemplateId,
    smtpSettings,
    planId,
    page,
  ] = await Promise.all([
    soTemplatePromise,
    loadSelectedTemplateForShop(session.shop, "invoice"),
    loadSmtpSettingsForShop(session.shop),
    getShopPlanIdForGating(billing, session.shop),
    pagePromise,
  ]);
  const selectedTemplateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId,
  );

  // Heal refunded invoices in the background — never block list TTFB.
  const healCandidates = page.orders.filter((order) => {
    if (!order.invoiced) return false;
    if (order.creditNote && !order.creditNoteVoided) return false;
    const status = String(order.paymentStatusKey || "").toUpperCase();
    return status === "REFUNDED" || status === "PARTIALLY_REFUNDED";
  });
  if (healCandidates.length > 0) {
    void ensureAutoCreditNotesForOrders(
      session.shop,
      healCandidates.map((order) => ({
        orderGid: order.id,
        financialStatus: order.paymentStatusKey,
        hasInvoice: order.invoiced,
        hasCreditNote: Boolean(order.creditNote) && !order.creditNoteVoided,
      })),
    ).catch((error) => {
      console.warn("[invoice-list] background CN heal failed:", error);
    });
  }

  return {
    ...page,
    selectedTemplateId,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    smtpReady: smtpReadyForPlan(planId, isSmtpReadyForSend(smtpSettings)),
    listMode: "invoice" as const,
    pageHeading: "Invoice",
    invoiceTemplateId: resolveInvoiceTemplateId(shopSelectedInvoiceTemplateId),
    creditNoteTemplateId: null as string | null,
  };
}

const invoiceListCache = createAppPageClientCache();

export async function clientLoader(args: ClientLoaderFunctionArgs) {
  return cachedClientLoader(invoiceListCache, args);
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
    invoiceListCache.bust();
    return true;
  }
  if (currentUrl.search !== nextUrl.search) {
    invoiceListCache.bust();
    return true;
  }
  if (defaultShouldRevalidate) invoiceListCache.bust();
  return defaultShouldRevalidate;
}

export default SalesOrdersListPage;

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:invoice-list-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return salesOrdersHeaders(headersArgs);
};
