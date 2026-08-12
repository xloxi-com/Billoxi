import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
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
import { PageLoader } from "../components/page-loader";
import { TawkChat } from "../components/tawk-chat";
import {
  isAppPathAllowedWithoutPlan,
  loadShopBillingState,
} from "../billing-plans";

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { session, admin, billing, redirect } = await requireAdminAuth(request);
  // One-shot historical number backfill after install (idempotent).
  scheduleInstallNumberSync(session.shop, admin);

  const billingState = await loadShopBillingState(billing);
  // Prefer normalized `url` (no .data). Fall back strips .data from request.url
  // because future.v8_passThroughRequests leaves the raw suffix on request.url.
  const pathname = (
    url?.pathname || new URL(request.url).pathname
  ).replace(/\.data$/i, "");

  // No paid plan yet (fresh install / FREE): force Pricing until they subscribe.
  // Billoxi / Home / any other route → /app/pricing.
  if (!billingState.hasActivePlan && !isAppPathAllowedWithoutPlan(pathname)) {
    throw redirect("/app/pricing");
  }

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    hasActivePlan: billingState.hasActivePlan,
    currentPlanId: billingState.currentPlanId,
    activeSubscriptionId: billingState.activeSubscriptionId,
  };
};

/** Keep nav warm; revalidate after billing posts — never same-path loops. */
export const shouldRevalidate = ({
  currentUrl,
  nextUrl,
  formMethod,
}: ShouldRevalidateFunctionArgs) => {
  if (formMethod && formMethod !== "GET") return true;

  const curr = currentUrl.pathname.replace(/\/$/, "") || "/app";
  const next = nextUrl.pathname.replace(/\/$/, "") || "/app";

  if (curr === next && currentUrl.search === nextUrl.search) return false;

  // Revalidate shell when entering/leaving pricing (plan may have changed).
  if (next.includes("/pricing") && !curr.includes("/pricing")) return true;
  if (curr.includes("/pricing") && !next.includes("/pricing")) return true;

  return false;
};

const FULL_APP_NAV_PAGES = [
  "/app",
  "/app/sales-order",
  "/app/invoice",
  "/app/draft",
  "/app/return",
  "/app/credit-note",
  "/app/packing-slip",
  "/app/templates",
  "/app/pricing",
  "/app/settings",
] as const;

const FREE_NAV_PAGES = ["/app/pricing"] as const;

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
      <PageLoader label="Loading page" />
    </div>
  );
}

function AppNavPrefetch({ hasActivePlan }: { hasActivePlan: boolean }) {
  const location = useLocation();
  const [pages, setPages] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const navPages = hasActivePlan ? FULL_APP_NAV_PAGES : FREE_NAV_PAGES;
    setPages([]);
    navPages.forEach((page, i) => {
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
  }, [hasActivePlan]);
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

export type AppOutletContext = {
  hasActivePlan: boolean;
  currentPlanId: import("../plan-features").PlanId | null;
  activeSubscriptionId: string | null;
};

export default function App() {
  const { apiKey, hasActivePlan, currentPlanId, activeSubscriptionId } =
    useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <AppNavPrefetch hasActivePlan={hasActivePlan} />
      <s-app-nav>
        {/* rel="home" → Billoxi title opens Home; Home link stays hidden from sidebar. */}
        <s-link
          href="/app"
          {...({ rel: "home" } as Record<string, string>)}
        >
          Home
        </s-link>
        {hasActivePlan ? (
          <>
            <s-link href="/app/sales-order">Sales Orders</s-link>
            <s-link href="/app/invoice">Invoice</s-link>
            <s-link href="/app/draft">Draft</s-link>
            <s-link href="/app/return">Return</s-link>
            <s-link href="/app/credit-note">Credit Note</s-link>
            <s-link href="/app/packing-slip">Packing Slip</s-link>
            <s-link href="/app/templates">Templates</s-link>
          </>
        ) : null}
        <s-link href="/app/pricing">Pricing</s-link>
        {hasActivePlan ? (
          <s-link href="/app/settings">Settings</s-link>
        ) : null}
      </s-app-nav>
      <AppNavLoader />
      <Outlet
        context={
          {
            hasActivePlan,
            currentPlanId,
            activeSubscriptionId,
          } satisfies AppOutletContext
        }
      />
      <TawkChat />
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
