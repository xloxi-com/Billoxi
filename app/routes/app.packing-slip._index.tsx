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
  resolvePackingSlipTemplateId,
  resolveSalesOrderTemplateId,
} from "../sales-order-ids";
import {
  loadSalesOrdersPage,
  parseSalesOrdersSearchParams,
} from "../sales-orders.server";
import { loadSelectedTemplateForShop, loadSmtpSettingsForShop } from "../shop-settings.server";
import { isSmtpReadyForSend } from "../smtp-settings";
import { getShopPlanIdForGating, smtpReadyForPlan } from "../plan-access";
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
  const { admin, session, billing } = await requireAdminAuth(request);
  const url = new URL(request.url);
  if (!url.searchParams.get("sort")) {
    url.searchParams.set("sort", "date desc");
  }

  const params = parseSalesOrdersSearchParams(url);

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
      { listFilter: "packing-slip" },
    ),
  );
  const [
    shopSelectedTemplateId,
    shopSelectedPackingTemplateId,
    smtpSettings,
    planId,
    page,
  ] = await Promise.all([
    soTemplatePromise,
    loadSelectedTemplateForShop(session.shop, "packing-slip"),
    loadSmtpSettingsForShop(session.shop),
    getShopPlanIdForGating(billing, session.shop),
    pagePromise,
  ]);
  const selectedTemplateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId,
  );

  return {
    ...page,
    selectedTemplateId,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    smtpReady: smtpReadyForPlan(planId, isSmtpReadyForSend(smtpSettings)),
    listMode: "packing-slip" as const,
    pageHeading: "Packing Slip",
    invoiceTemplateId: null as string | null,
    creditNoteTemplateId: null as string | null,
    packingSlipTemplateId: resolvePackingSlipTemplateId(
      shopSelectedPackingTemplateId,
    ),
    returnTemplateId: null as string | null,
  };
}

const packingSlipListCache = createAppPageClientCache();

export async function clientLoader(args: ClientLoaderFunctionArgs) {
  return cachedClientLoader(packingSlipListCache, args);
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
    packingSlipListCache.bust();
    return true;
  }
  if (currentUrl.search !== nextUrl.search) {
    packingSlipListCache.bust();
    return true;
  }
  if (defaultShouldRevalidate) packingSlipListCache.bust();
  return defaultShouldRevalidate;
}

export default SalesOrdersListPage;

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:packing-slip-list-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return salesOrdersHeaders(headersArgs);
};
