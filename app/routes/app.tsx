import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useState } from "react";
import {
  Outlet,
  PrefetchPageLinks,
  useLoaderData,
  useLocation,
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

const APP_NAV_PAGES = [
  "/app",
  "/app/sales-order",
  "/app/invoice",
  "/app/draft",
  "/app/return",
  "/app/credit-note",
  "/app/packing-slip",
  "/app/templates",
  "/app/settings",
] as const;

function documentSectionBase(pathname: string) {
  const match = pathname.match(
    /^(\/app\/(?:sales-order|invoice|draft|return|credit-note|packing-slip))\/[^/]+$/,
  );
  return match?.[1] ?? null;
}

function AppNavLoader() {
  const navigation = useNavigation();
  const location = useLocation();
  const to = navigation.location?.pathname || "";
  const from = location.pathname;
  const sameDocumentSwitch =
    Boolean(documentSectionBase(from)) &&
    documentSectionBase(from) === documentSectionBase(to);
  const showLoader =
    navigation.state === "loading" &&
    !navigation.formMethod &&
    Boolean(to) &&
    to !== from &&
    !sameDocumentSwitch;
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

function AppNavPrefetch() {
  const location = useLocation();
  const [pages, setPages] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    APP_NAV_PAGES.forEach((page, i) => {
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setPages((prev) => (prev.includes(page) ? prev : [...prev, page]));
        }, 700 + i * 180),
      );
    });
    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);
  const current = location.pathname.replace(/\/$/, "") || "/app";
  return (
    <>
      {pages
        .filter((page) => page !== current)
        .map((page) => (
          <PrefetchPageLinks key={page} page={page} />
        ))}
    </>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <AppNavPrefetch />
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
