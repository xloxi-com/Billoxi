import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { requireAdminAuth } from "../shopify-context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Warm auth for nested loaders (shared WeakMap memo).
  // Existing-order SO number sync is merchant-triggered from Settings.
  await requireAdminAuth(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export const shouldRevalidate = () => false;

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app" rel="home">
          Home
        </s-link>
        <s-link href="/app/sales-order">Sales Orders</s-link>
        <s-link href="/app/invoice">Invoice</s-link>
        <s-link href="/app/draft">Draft</s-link>
        <s-link href="/app/return">Return</s-link>
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
  const error = useRouteError();
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  // Recover from React Router single-fetch / route-discovery mismatches
  // (e.g. "No result found for routeId routes/app.templates").
  // Also recover auth-bounce Responses that surface as blank "200".
  const status =
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;
  if (
    typeof window !== "undefined" &&
    (status === 200 || /No result found for routeId/i.test(message))
  ) {
    const key = "billoxi:routeId-reload";
    const last = Number(sessionStorage.getItem(key) || "0");
    if (Date.now() - last > 4000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
      return null;
    }
  }

  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
