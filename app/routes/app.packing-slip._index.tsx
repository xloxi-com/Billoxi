import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdminAuth } from "../shopify-context.server";
import {
  resolvePackingSlipTemplateId,
  resolveSalesOrderTemplateId,
} from "../sales-order-ids";
import {
  loadSalesOrdersPage,
  parseSalesOrdersSearchParams,
} from "../sales-orders.server";
import { loadSelectedTemplateForShop, loadSmtpSettingsForShop } from "../shop-settings.server";
import { isSmtpReadyForSend } from "../smtp-settings";
import SalesOrdersListPage, {
  action,
  headers as salesOrdersHeaders,
  links as salesOrdersLinks,
} from "./app.sales-order._index";

export { action };
export const links: LinksFunction = salesOrdersLinks;

/**
 * Packing slip list — Polaris IndexTable of orders marked as packing slip.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireAdminAuth(request);
  const url = new URL(request.url);
  if (!url.searchParams.get("sort")) {
    url.searchParams.set("sort", "date desc");
  }

  const params = parseSalesOrdersSearchParams(url);

  const [shopSelectedTemplateId, shopSelectedPackingTemplateId, smtpSettings] =
    await Promise.all([
      loadSelectedTemplateForShop(session.shop, "sales-order"),
      loadSelectedTemplateForShop(session.shop, "packing-slip"),
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
    { listFilter: "packing-slip" },
  );

  return {
    ...page,
    selectedTemplateId,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    smtpReady: isSmtpReadyForSend(smtpSettings),
    listMode: "packing-slip" as const,
    pageHeading: "Packing Slip",
    invoiceTemplateId: null as string | null,
    creditNoteTemplateId: null as string | null,
    packingSlipTemplateId: resolvePackingSlipTemplateId(
      shopSelectedPackingTemplateId,
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
