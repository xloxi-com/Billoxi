import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
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
  const { admin, session } = await requireAdminAuth(request);
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

  const [
    shopSelectedTemplateId,
    shopSelectedInvoiceTemplateId,
    smtpSettings,
  ] = await Promise.all([
    loadSelectedTemplateForShop(session.shop, "sales-order"),
    loadSelectedTemplateForShop(session.shop, "invoice"),
    loadSmtpSettingsForShop(session.shop),
  ]);
  const selectedTemplateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId,
  );
  let page = await loadSalesOrdersPage(
    admin,
    session.shop,
    params,
    selectedTemplateId,
  );

  // Heal only when this page has refunded invoices that still need a CN.
  const healCandidates = page.orders.filter((order) => {
    if (!order.invoiced) return false;
    if (order.creditNote && !order.creditNoteVoided) return false;
    const status = String(order.paymentStatusKey || "").toUpperCase();
    return status === "REFUNDED" || status === "PARTIALLY_REFUNDED";
  });
  if (healCandidates.length > 0) {
    const healed = await ensureAutoCreditNotesForOrders(
      session.shop,
      healCandidates.map((order) => ({
        orderGid: order.id,
        financialStatus: order.paymentStatusKey,
        hasInvoice: order.invoiced,
        hasCreditNote: Boolean(order.creditNote) && !order.creditNoteVoided,
      })),
    );
    if (healed.created > 0) {
      page = await loadSalesOrdersPage(
        admin,
        session.shop,
        params,
        selectedTemplateId,
      );
    }
  }

  return {
    ...page,
    selectedTemplateId,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    smtpReady: isSmtpReadyForSend(smtpSettings),
    listMode: "invoice" as const,
    pageHeading: "Invoice",
    invoiceTemplateId: resolveInvoiceTemplateId(shopSelectedInvoiceTemplateId),
    creditNoteTemplateId: null as string | null,
  };
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
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  return currentUrl.search !== nextUrl.search;
}

export default SalesOrdersListPage;

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:invoice-list-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return salesOrdersHeaders(headersArgs);
};
