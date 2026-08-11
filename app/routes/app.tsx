import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Outlet,
  PrefetchPageLinks,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { requireAdminAuth } from "../shopify-context.server";
import { scheduleInstallNumberSync } from "../install-number-sync.server";
import { renderEmbeddedRouteError } from "../embedded-route-error";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Warm auth for nested loaders (shared WeakMap memo).
  const { session, admin } = await requireAdminAuth(request);
  // One-shot historical number backfill after install (idempotent).
  scheduleInstallNumberSync(session.shop, admin);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export const shouldRevalidate = () => false;

function isHeavyAppPage(pathname: string) {
  return (
    pathname === "/app/templates" ||
    pathname.startsWith("/app/templates/") ||
    pathname === "/app/settings" ||
    pathname.startsWith("/app/settings/")
  );
}

function AppNavLoader() {
  const navigation = useNavigation();
  const to = navigation.location?.pathname || "";
  const showLoader =
    navigation.state === "loading" &&
    !navigation.formMethod &&
    isHeavyAppPage(to);
  if (!showLoader) return null;

  return (
    <div
      aria-busy="true"
      className="billoxi-nav-loader"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "color-mix(in srgb, #f6f6f7 78%, transparent)",
      }}
    >
      <s-spinner accessibilityLabel="Loading page" />
    </div>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PrefetchPageLinks page="/app/templates" />
      <PrefetchPageLinks page="/app/settings" />
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
      <AppNavLoader />
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:routeId-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
