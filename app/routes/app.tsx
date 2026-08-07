import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { requireAdminAuth } from "../shopify-context.server";
import { ensureSalesOrderNumbersSynced } from "../sales-order-number-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Share the same per-request auth memo as child loaders (avoids 2× session DB hits).
  const { session, admin } = await requireAdminAuth(request);
  // Never block navigation on one-time SO backfill — run in background.
  void ensureSalesOrderNumbersSynced(session.shop, admin);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export const shouldRevalidate = () => false;

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/sales-order">Sales Orders</s-link>
        <s-link href="/app/invoice">Invoice</s-link>
        <s-link href="/app/credit-note">Credit Note</s-link>
        <s-link href="/app/packing-slip">Packing Slip</s-link>
        <s-link href="/app/templates">Templates</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
