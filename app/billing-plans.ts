/**
 * Shopify Billing plan keys + helpers for Billoxi pricing.
 * Configured in shopify.server.ts; requested from /app/pricing.
 */

import {
  BILLIOXI_PLANS,
  PLACEHOLDER_CURRENT_PLAN_ID,
  planYearlyTotal,
  type PlanId,
} from "./plan-features";

export type BillingPeriod = "monthly" | "yearly";

export const BILLING_PLAN = {
  starterMonthly: "Billoxi STARTER Monthly",
  starterYearly: "Billoxi STARTER Yearly",
  premiumMonthly: "Billoxi PREMIUM Monthly",
  premiumYearly: "Billoxi PREMIUM Yearly",
  ultimateMonthly: "Billoxi ULTIMATE Monthly",
  ultimateYearly: "Billoxi ULTIMATE Yearly",
} as const;

export type BillingPlanName =
  (typeof BILLING_PLAN)[keyof typeof BILLING_PLAN];

export const ALL_BILLING_PLAN_NAMES = Object.values(
  BILLING_PLAN,
) as BillingPlanName[];

export function billingPlanName(
  planId: PlanId,
  period: BillingPeriod,
): BillingPlanName {
  if (planId === "starter") {
    return period === "yearly"
      ? BILLING_PLAN.starterYearly
      : BILLING_PLAN.starterMonthly;
  }
  if (planId === "premium") {
    return period === "yearly"
      ? BILLING_PLAN.premiumYearly
      : BILLING_PLAN.premiumMonthly;
  }
  return period === "yearly"
    ? BILLING_PLAN.ultimateYearly
    : BILLING_PLAN.ultimateMonthly;
}

export function isPlanId(value: unknown): value is PlanId {
  return value === "starter" || value === "premium" || value === "ultimate";
}

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === "monthly" || value === "yearly";
}

export function planIdFromBillingPlanName(
  name: string | undefined | null,
): PlanId | null {
  if (!name) return null;
  const upper = name.toUpperCase();
  if (upper.includes("ULTIMATE")) return "ultimate";
  if (upper.includes("PREMIUM")) return "premium";
  if (upper.includes("STARTER")) return "starter";
  return null;
}

export function billingAmountFor(
  planId: PlanId,
  period: BillingPeriod,
): number {
  const plan = BILLIOXI_PLANS.find((item) => item.id === planId);
  if (!plan) {
    throw new Error(`Unknown plan: ${planId}`);
  }
  return period === "yearly"
    ? planYearlyTotal(plan.priceAmount)
    : plan.priceAmount;
}

export function trialDaysFor(planId: PlanId): number {
  const plan = BILLIOXI_PLANS.find((item) => item.id === planId);
  return plan?.trialDays ?? 7;
}

/** Prefer active Shopify subscription; fall back to placeholder for gating demos. */
export function resolveCurrentPlanId(
  subscriptionNames: Array<string | undefined | null>,
): PlanId {
  for (const name of subscriptionNames) {
    const planId = planIdFromBillingPlanName(name);
    if (planId) return planId;
  }
  return PLACEHOLDER_CURRENT_PLAN_ID;
}

/** Paths reachable before the merchant picks a paid plan.
 * Until a plan is chosen, only Pricing is allowed (install → pricing gate).
 */
export function isAppPathAllowedWithoutPlan(pathname: string): boolean {
  const path =
    pathname
      .replace(/\/$/, "")
      // React Router single-fetch data requests: /app/pricing.data
      .replace(/\.data$/i, "") || "/app";
  return path === "/app/pricing" || path.startsWith("/app/pricing/");
}

type BillingCheckApi = {
  check: (options?: {
    plans?: BillingPlanName[];
    isTest?: boolean;
  }) => Promise<{
    hasActivePayment: boolean;
    appSubscriptions: Array<{ name: string; id: string }>;
  }>;
};

type AdminGraphqlClient = {
  graphql: (query: string) => Promise<Response>;
};

export type ShopBillingState = {
  hasActivePlan: boolean;
  currentPlanId: PlanId | null;
  activeSubscriptionId: string | null;
  /** True when the active Shopify subscription is a test charge. */
  activeSubscriptionIsTest: boolean | null;
  appSubscriptions: Array<{ name: string; id: string }>;
};

const EMPTY_BILLING_STATE: ShopBillingState = {
  hasActivePlan: false,
  currentPlanId: null,
  activeSubscriptionId: null,
  activeSubscriptionIsTest: null,
  appSubscriptions: [],
};

const SHOP_PARTNER_DEVELOPMENT_QUERY = `#graphql
  query ShopPartnerDevelopment {
    shop {
      plan {
        partnerDevelopment
      }
    }
  }
`;

/** One billing.check per auth/billing object (parent + child loaders share it). */
const billingStateByApi = new WeakMap<
  object,
  Promise<ShopBillingState>
>();

const testChargesByAdmin = new WeakMap<object, Promise<boolean>>();

function toBillingState(
  result: {
    hasActivePayment: boolean;
    appSubscriptions: Array<{ name: string; id: string }>;
  },
  isTest: boolean,
): ShopBillingState {
  const active = result.hasActivePayment ? result.appSubscriptions[0] : null;
  return {
    hasActivePlan: result.hasActivePayment,
    currentPlanId: result.hasActivePayment
      ? resolveCurrentPlanId(result.appSubscriptions.map((item) => item.name))
      : null,
    activeSubscriptionId: active?.id ?? null,
    activeSubscriptionIsTest: result.hasActivePayment ? isTest : null,
    appSubscriptions: result.appSubscriptions,
  };
}

async function checkPlans(billing: BillingCheckApi, isTest: boolean) {
  return billing.check({
    plans: [...ALL_BILLING_PLAN_NAMES],
    isTest,
  });
}

async function fetchShopBillingState(
  billing: BillingCheckApi,
  admin?: AdminGraphqlClient,
): Promise<ShopBillingState> {
  try {
    const preferredTest = admin
      ? await shopUsesTestCharges(admin)
      : isShopifyBillingTestMode();
    const preferred = await checkPlans(billing, preferredTest);
    if (preferred.hasActivePayment) {
      return toBillingState(preferred, preferredTest);
    }

    // Dev-store test charges are invisible if we only check live (`isTest: false`).
    const fallbackTest = !preferredTest;
    const fallback = await checkPlans(billing, fallbackTest);
    if (fallback.hasActivePayment) {
      return toBillingState(fallback, fallbackTest);
    }

    return EMPTY_BILLING_STATE;
  } catch {
    // Don't break Pricing/Home if Shopify billing check fails.
    return EMPTY_BILLING_STATE;
  }
}

export async function loadShopBillingState(
  billing: BillingCheckApi,
  admin?: AdminGraphqlClient,
): Promise<ShopBillingState> {
  const key = billing as object;
  let pending = billingStateByApi.get(key);
  if (!pending) {
    pending = fetchShopBillingState(billing, admin);
    billingStateByApi.set(key, pending);
  }
  return pending;
}

/** After cancel/subscribe, drop memo so the next load sees fresh status. */
export function clearShopBillingStateCache(billing: BillingCheckApi) {
  billingStateByApi.delete(billing as object);
}

/** Test charges by default; set SHOPIFY_BILLING_TEST=false for live charges. */
export function isShopifyBillingTestMode(): boolean {
  const raw = process.env.SHOPIFY_BILLING_TEST?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * Development stores cannot accept live charges — always use test charges there,
 * even when the app is running in production (e.g. billoxi-app.xloxi.com).
 */
export async function shopUsesTestCharges(
  admin: AdminGraphqlClient,
): Promise<boolean> {
  const key = admin as object;
  let pending = testChargesByAdmin.get(key);
  if (!pending) {
    pending = resolveShopUsesTestCharges(admin);
    testChargesByAdmin.set(key, pending);
  }
  return pending;
}

async function resolveShopUsesTestCharges(
  admin: AdminGraphqlClient,
): Promise<boolean> {
  try {
    const response = await admin.graphql(SHOP_PARTNER_DEVELOPMENT_QUERY);
    const json = (await response.json()) as {
      data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
    };
    if (json.data?.shop?.plan?.partnerDevelopment) return true;
  } catch {
    // Fall through to env / NODE_ENV.
  }
  return isShopifyBillingTestMode();
}
