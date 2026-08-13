import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { useMemo } from "react";
import {
  Outlet,
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
import { loadAdminLanguage } from "../setup-guide.server";
import {
  adminT,
  DEFAULT_ADMIN_UI_LANGUAGE,
  normalizeAdminUiLanguage,
  type AdminUiLanguage,
} from "../admin-i18n";
import { hydrateAdminLocale } from "../admin-locale-store";
import { loadAdminLocalePack } from "../admin-locale-load.server";
import { AdminI18nContext } from "../admin-i18n-context";

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

  const savedAdminLanguage = await loadAdminLanguage(session.shop);
  const adminLanguage = normalizeAdminUiLanguage(
    savedAdminLanguage,
    DEFAULT_ADMIN_UI_LANGUAGE,
  );
  // Always ship the active pack (incl. English) so newly added keys resolve
  // instead of showing raw ids after locale edits / HMR.
  const adminMessages = loadAdminLocalePack(adminLanguage);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    hasActivePlan: billingState.hasActivePlan,
    currentPlanId: billingState.currentPlanId,
    activeSubscriptionId: billingState.activeSubscriptionId,
    adminLanguage,
    adminMessages,
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

function documentSectionBase(pathname: string) {
  const match = pathname.match(
    /^(\/app\/(?:sales-order|invoice|draft|return|credit-note|packing-slip))\/[^/]+$/,
  );
  return match?.[1] ?? null;
}

function AppNavLoader({ label }: { label: string }) {
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
      <PageLoader label={label} />
    </div>
  );
}

export type AppOutletContext = {
  hasActivePlan: boolean;
  currentPlanId: import("../plan-features").PlanId | null;
  activeSubscriptionId: string | null;
  adminLanguage: AdminUiLanguage;
};

export default function App() {
  const {
    apiKey,
    hasActivePlan,
    currentPlanId,
    activeSubscriptionId,
    adminLanguage,
    adminMessages,
  } = useLoaderData<typeof loader>();
  if (adminMessages) hydrateAdminLocale(adminLanguage, adminMessages);

  const i18n = useMemo(
    () => ({
      language: adminLanguage,
      t: (key: Parameters<typeof adminT>[1]) => adminT(adminLanguage, key),
    }),
    [adminLanguage],
  );

  return (
    <AppProvider embedded apiKey={apiKey}>
      <AdminI18nContext.Provider value={i18n}>
        <s-app-nav>
          {/* rel="home" → Billoxi title opens Home; Home link stays hidden from sidebar. */}
          <s-link
            href="/app"
            {...({ rel: "home" } as Record<string, string>)}
          >
            {i18n.t("nav.home")}
          </s-link>
          {hasActivePlan ? (
            <>
              <s-link href="/app/sales-order">
                {i18n.t("nav.salesOrders")}
              </s-link>
              <s-link href="/app/invoice">{i18n.t("nav.invoice")}</s-link>
              <s-link href="/app/draft">{i18n.t("nav.draft")}</s-link>
              <s-link href="/app/return">{i18n.t("nav.return")}</s-link>
              <s-link href="/app/credit-note">
                {i18n.t("nav.creditNote")}
              </s-link>
              <s-link href="/app/packing-slip">
                {i18n.t("nav.packingSlip")}
              </s-link>
              <s-link href="/app/templates">{i18n.t("nav.templates")}</s-link>
              <s-link href="/app/settings">{i18n.t("nav.settings")}</s-link>
              <s-link href="/app/pricing">{i18n.t("nav.pricing")}</s-link>
            </>
          ) : (
            <s-link href="/app/pricing">{i18n.t("nav.pricing")}</s-link>
          )}
        </s-app-nav>
        <AppNavLoader label={i18n.t("nav.loadingPage")} />
        <Outlet
          context={
            {
              hasActivePlan,
              currentPlanId,
              activeSubscriptionId,
              adminLanguage,
            } satisfies AppOutletContext
          }
        />
        <TawkChat />
      </AdminI18nContext.Provider>
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
