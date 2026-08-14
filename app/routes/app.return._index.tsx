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
  resolveReturnTemplateId,
  resolveSalesOrderTemplateId,
} from "../sales-order-ids";
import {
  loadSalesOrdersPage,
  parseSalesOrdersSearchParams,
} from "../sales-orders.server";
import {
  loadSelectedTemplateForShop,
  loadSmtpSettingsForShop,
} from "../shop-settings.server";
import { isSmtpReadyForSend } from "../smtp-settings";
import { getShopPlanIdForGating, smtpReadyForPlan } from "../plan-access";
import { syncShopifyReturnsForShop } from "../shopify-returns.server";
import SalesOrdersListPage, {
  action,
  headers as salesOrdersHeaders,
  links as salesOrdersLinks,
} from "./app.sales-order._index";

export { action };
export const links: LinksFunction = salesOrdersLinks;

function sessionHasReturnsScope(scope: string | undefined | null): boolean {
  if (!scope) return false;
  return scope
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .includes("read_returns");
}

/**
 * Return list — Shopify returns synced into Billoxi RET- documents.
 * Requires `read_returns` scope.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, billing } = await requireAdminAuth(request);
  const url = new URL(request.url);
  if (!url.searchParams.get("sort")) {
    url.searchParams.set("sort", "date desc");
  }

  const params = parseSalesOrdersSearchParams(url);
  const hasScope = sessionHasReturnsScope(session.scope);

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
      { listFilter: "return" },
    ),
  );

  const scopeError = hasScope
    ? null
    : "Missing read_returns permission. Update app scopes, then reopen Return.";

  // Sync Shopify returns in the background — list paints from DB first.
  if (hasScope) {
    void syncShopifyReturnsForShop(admin, session.shop).catch((error) => {
      console.error("Return list Shopify sync failed:", error);
    });
  }

  const [
    shopSelectedTemplateId,
    shopSelectedReturnTemplateId,
    smtpSettings,
    planId,
    page,
  ] = await Promise.all([
    soTemplatePromise,
    loadSelectedTemplateForShop(session.shop, "return"),
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
    listMode: "return" as const,
    pageHeading: "Return",
    invoiceTemplateId: null as string | null,
    creditNoteTemplateId: null as string | null,
    packingSlipTemplateId: null as string | null,
    returnTemplateId: resolveReturnTemplateId(shopSelectedReturnTemplateId),
    shopDomain: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    scopeError,
  };
}

const returnListCache = createAppPageClientCache();

export async function clientLoader(args: ClientLoaderFunctionArgs) {
  return cachedClientLoader(returnListCache, args);
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
    returnListCache.bust();
    return true;
  }
  if (currentUrl.search !== nextUrl.search) {
    returnListCache.bust();
    return true;
  }
  if (defaultShouldRevalidate) returnListCache.bust();
  return defaultShouldRevalidate;
}

export default SalesOrdersListPage;

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:return-list-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return salesOrdersHeaders(headersArgs);
};
