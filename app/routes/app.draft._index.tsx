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
import { resolveDraftTemplateId } from "../sales-order-ids";
import { parseSalesOrdersSearchParams } from "../sales-orders.server";
import { loadShopifyDraftOrdersPage } from "../shopify-draft-orders.server";
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

function sessionHasDraftOrdersScope(scope: string | undefined | null): boolean {
  if (!scope) return false;
  return scope
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .includes("read_draft_orders");
}

/**
 * Draft list — Shopify Admin draft orders (`draftOrders` query).
 * Requires `read_draft_orders` scope.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, billing } = await requireAdminAuth(request);
  const url = new URL(request.url);
  if (!url.searchParams.get("sort")) {
    url.searchParams.set("sort", "date desc");
  }

  const params = parseSalesOrdersSearchParams(url);
  const hasScope = sessionHasDraftOrdersScope(session.scope);

  const pagePromise = hasScope
    ? loadShopifyDraftOrdersPage(admin, session.shop, params)
    : Promise.resolve({
        orders: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
        query: params.query,
        selectedView: 0,
        availableViews: [0],
        paymentStatus: params.paymentStatus,
        fulfillmentStatus: params.fulfillmentStatus,
        sortSelected: params.sortSelected,
        scopeError:
          "Missing read_draft_orders permission. Click Update permissions, approve access, then reopen Draft.",
      });

  // Never redirect to /auth inside the embedded iframe (causes a blank page).
  // Load what we can and surface a permissions banner instead.
  const [shopSelectedDraftTemplateId, smtpSettings, planId, page] =
    await Promise.all([
      loadSelectedTemplateForShop(session.shop, "draft"),
      loadSmtpSettingsForShop(session.shop),
      getShopPlanIdForGating(billing, session.shop),
      pagePromise,
    ]);

  return {
    ...page,
    selectedTemplateId: null as string | null,
    hasSelectedTemplate: false,
    smtpReady: smtpReadyForPlan(planId, isSmtpReadyForSend(smtpSettings)),
    listMode: "draft" as const,
    pageHeading: "Draft",
    invoiceTemplateId: resolveDraftTemplateId(shopSelectedDraftTemplateId),
    creditNoteTemplateId: null as string | null,
    packingSlipTemplateId: null as string | null,
    shopDomain: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    scopeError: page.scopeError ?? null,
  };
}

const draftListCache = createAppPageClientCache();

function draftListHasBlankNumbers(data: unknown) {
  const orders = (data as { orders?: Array<{ draftNumber?: string }> })?.orders;
  if (!Array.isArray(orders) || orders.length === 0) return false;
  return orders.some((order) => !String(order.draftNumber || "").trim());
}

export async function clientLoader(args: ClientLoaderFunctionArgs) {
  const cached = draftListCache.get(args.request);
  if (cached && draftListHasBlankNumbers(cached)) {
    draftListCache.bust();
  }
  return cachedClientLoader(draftListCache, args);
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
    draftListCache.bust();
    return true;
  }
  if (currentUrl.search !== nextUrl.search) {
    draftListCache.bust();
    return true;
  }
  if (defaultShouldRevalidate) draftListCache.bust();
  return defaultShouldRevalidate;
}

export default SalesOrdersListPage;

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:draft-list-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return salesOrdersHeaders(headersArgs);
};
