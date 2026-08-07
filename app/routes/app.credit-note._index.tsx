import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdminAuth } from "../shopify-context.server";
import {
  resolveCreditNoteTemplateId,
  resolveSalesOrderTemplateId,
} from "../sales-order-ids";
import {
  loadSalesOrdersPage,
  parseSalesOrdersSearchParams,
} from "../sales-orders.server";
import { loadSelectedTemplateForShop } from "../shop-settings.server";
import SalesOrdersListPage, {
  action,
  headers as salesOrdersHeaders,
  links as salesOrdersLinks,
} from "./app.sales-order._index";

export { action };
export const links: LinksFunction = salesOrdersLinks;

/**
 * Credit note list — same IndexTable UI as Invoice, filtered to orders
 * marked in OrderCreditNoteStatus.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireAdminAuth(request);
  const url = new URL(request.url);
  if (!url.searchParams.get("sort")) {
    url.searchParams.set("sort", "date desc");
  }

  const params = parseSalesOrdersSearchParams(url);

  const [
    shopSelectedTemplateId,
    shopSelectedCreditNoteTemplateId,
  ] = await Promise.all([
    loadSelectedTemplateForShop(session.shop, "sales-order"),
    loadSelectedTemplateForShop(session.shop, "credit-note"),
  ]);
  const selectedTemplateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId,
  );
  const page = await loadSalesOrdersPage(
    admin,
    session.shop,
    params,
    selectedTemplateId,
    { listFilter: "credit-note" },
  );

  return {
    ...page,
    selectedTemplateId,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    listMode: "credit-note" as const,
    pageHeading: "Credit Note",
    invoiceTemplateId: null as string | null,
    creditNoteTemplateId: resolveCreditNoteTemplateId(
      shopSelectedCreditNoteTemplateId,
    ),
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
