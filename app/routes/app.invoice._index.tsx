import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

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
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return salesOrdersHeaders(headersArgs);
};
