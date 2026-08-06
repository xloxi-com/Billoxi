import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdminAuth } from "../shopify-context.server";
import {
  DEFAULT_INVOICE_TEMPLATE_ID,
  findTemplatePreset,
  resolveSalesOrderTemplateId,
} from "../sales-order-document";
import {
  loadSalesOrdersPage,
  parseSalesOrdersSearchParams,
} from "../sales-orders.server";
import { loadSelectedTemplateForShop } from "../shop-settings.server";
import { INVOICED_VIEW_INDEX } from "../sales-orders";
import SalesOrdersListPage, {
  action,
  headers as salesOrdersHeaders,
} from "./app.sales-order._index";

export { action };

function resolveInvoiceTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("invoice-")) {
    return value;
  }
  return DEFAULT_INVOICE_TEMPLATE_ID;
}

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
  ] = await Promise.all([
    loadSelectedTemplateForShop(session.shop, "sales-order"),
    loadSelectedTemplateForShop(session.shop, "invoice"),
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
    listMode: "invoice" as const,
    pageHeading: "Invoice",
    invoiceTemplateId: resolveInvoiceTemplateId(shopSelectedInvoiceTemplateId),
  };
}

export const shouldRevalidate = () => true;

export default SalesOrdersListPage;

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return salesOrdersHeaders(headersArgs);
};
