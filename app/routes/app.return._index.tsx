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
  const { admin, session } = await requireAdminAuth(request);
  const url = new URL(request.url);
  if (!url.searchParams.get("sort")) {
    url.searchParams.set("sort", "date desc");
  }

  const params = parseSalesOrdersSearchParams(url);
  const hasScope = sessionHasReturnsScope(session.scope);

  const [shopSelectedTemplateId, shopSelectedReturnTemplateId, smtpSettings] =
    await Promise.all([
      loadSelectedTemplateForShop(session.shop, "sales-order"),
      loadSelectedTemplateForShop(session.shop, "return"),
      loadSmtpSettingsForShop(session.shop),
    ]);
  const selectedTemplateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId,
  );

  let scopeError: string | null = null;
  if (!hasScope) {
    scopeError =
      "Missing read_returns permission. Update app scopes, then reopen Return.";
  } else {
    try {
      const sync = await syncShopifyReturnsForShop(admin, session.shop);
      if (sync.scopeError) scopeError = sync.scopeError;
    } catch (error) {
      console.error("Return list Shopify sync failed:", error);
      scopeError =
        error instanceof Error
          ? error.message
          : "Could not sync Shopify returns.";
    }
  }

  const page = await loadSalesOrdersPage(
    admin,
    session.shop,
    params,
    selectedTemplateId,
    { listFilter: "return" },
  );

  return {
    ...page,
    selectedTemplateId,
    hasSelectedTemplate: Boolean(shopSelectedTemplateId),
    smtpReady: isSmtpReadyForSend(smtpSettings),
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
  return renderEmbeddedRouteError(useRouteError(), "billoxi:return-list-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return salesOrdersHeaders(headersArgs);
};
