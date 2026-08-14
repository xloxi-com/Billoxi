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

  const [shopSelectedTemplateId, shopSelectedReturnTemplateId, smtpSettings, planId] =
    await Promise.all([
      loadSelectedTemplateForShop(session.shop, "sales-order"),
      loadSelectedTemplateForShop(session.shop, "return"),
      loadSmtpSettingsForShop(session.shop),
      getShopPlanIdForGating(billing),
    ]);
  const selectedTemplateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId,
  );

  let scopeError: string | null = null;
  const syncPromise = hasScope
    ? syncShopifyReturnsForShop(admin, session.shop).catch((error) => {
        console.error("Return list Shopify sync failed:", error);
        return {
          marked: 0,
          scopeError:
            error instanceof Error
              ? error.message
              : "Could not sync Shopify returns.",
        };
      })
    : Promise.resolve({
        marked: 0,
        scopeError:
          "Missing read_returns permission. Update app scopes, then reopen Return.",
      });

  let page = await loadSalesOrdersPage(
    admin,
    session.shop,
    params,
    selectedTemplateId,
    { listFilter: "return" },
  );
  const sync = await syncPromise;
  if (sync.scopeError) scopeError = sync.scopeError;
  if (sync.marked > 0) {
    page = await loadSalesOrdersPage(
      admin,
      session.shop,
      params,
      selectedTemplateId,
      { listFilter: "return" },
    );
  }

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
