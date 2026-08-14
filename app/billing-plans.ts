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

export type ShopBillingState = {
  hasActivePlan: boolean;
  currentPlanId: PlanId | null;
  activeSubscriptionId: string | null;
  appSubscriptions: Array<{ name: string; id: string }>;
};

/** One billing.check per auth/billing object (parent + child loaders share it). */
const billingStateByApi = new WeakMap<
  object,
  Promise<ShopBillingState>
>();

async function fetchShopBillingState(
  billing: BillingCheckApi,
): Promise<ShopBillingState> {
  try {
    const { hasActivePayment, appSubscriptions } = await billing.check({
      plans: [...ALL_BILLING_PLAN_NAMES],
      // Include test subscriptions so Partner development stores stay gated
      // after approving a test charge.
      isTest: true,
    });

    const active = hasActivePayment ? appSubscriptions[0] : null;

    return {
      hasActivePlan: hasActivePayment,
      currentPlanId: hasActivePayment
        ? resolveCurrentPlanId(appSubscriptions.map((item) => item.name))
        : null,
      activeSubscriptionId: active?.id ?? null,
      appSubscriptions,
    };
  } catch {
    // Don't break Pricing/Home if Shopify billing check fails.
    return {
      hasActivePlan: false,
      currentPlanId: null,
      activeSubscriptionId: null,
      appSubscriptions: [],
    };
  }
}

export async function loadShopBillingState(
  billing: BillingCheckApi,
): Promise<ShopBillingState> {
  const key = billing as object;
  let pending = billingStateByApi.get(key);
  if (!pending) {
    pending = fetchShopBillingState(billing);
    billingStateByApi.set(key, pending);
  }
  return pending;
}

/** After cancel/subscribe, drop memo so the next load sees fresh status. */
export function clearShopBillingStateCache(billing: BillingCheckApi) {
  billingStateByApi.delete(billing as object);
}

type AdminGraphql = {
  graphql: (query: string) => Promise<Response>;
};

const SHOP_PLAN_QUERY = `#graphql
  query ShopPartnerDevelopment {
    shop {
      plan {
        partnerDevelopment
      }
    }
  }
`;

const APP_SUBSCRIPTIONS_QUERY = `#graphql
  query BilloxiActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        name
        status
      }
    }
  }
`;

/** Partner development stores cannot add a card — they need test charges. */
export async function isPartnerDevelopmentShop(
  admin: AdminGraphql,
): Promise<boolean> {
  try {
    const response = await admin.graphql(SHOP_PLAN_QUERY);
    const payload = (await response.json()) as {
      data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
    };
    return Boolean(payload.data?.shop?.plan?.partnerDevelopment);
  } catch {
    return false;
  }
}

/** Active Shopify app subscription plan for webhook / unauthenticated paths. */
export async function loadShopPlanIdFromAdmin(
  admin: AdminGraphql,
): Promise<PlanId | null> {
  try {
    const response = await admin.graphql(APP_SUBSCRIPTIONS_QUERY);
    const payload = (await response.json()) as {
      data?: {
        currentAppInstallation?: {
          activeSubscriptions?: Array<{
            name?: string | null;
            status?: string | null;
          } | null> | null;
        } | null;
      };
    };
    const subs = (
      payload.data?.currentAppInstallation?.activeSubscriptions ?? []
    ).filter((row): row is { name?: string | null; status?: string | null } =>
      Boolean(row),
    );
    if (subs.length === 0) return null;
    const active = subs.filter((row) => {
      const status = String(row.status || "ACTIVE").toUpperCase();
      return status === "ACTIVE" || status === "ACCEPTED" || status === "PENDING";
    });
    const names = (active.length > 0 ? active : subs).map((row) => row.name);
    for (const name of names) {
      const planId = planIdFromBillingPlanName(name);
      if (planId) return planId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Test charges by default so hosted apps (NODE_ENV=production) can still be
 * approved on stores with no payment method. Set SHOPIFY_BILLING_TEST=false
 * for live merchant charges. Development stores always stay on test charges.
 */
export function isShopifyBillingTestMode(): boolean {
  const raw = process.env.SHOPIFY_BILLING_TEST?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

export async function shouldUseTestBillingCharge(
  admin: AdminGraphql,
): Promise<boolean> {
  if (isShopifyBillingTestMode()) return true;
  return isPartnerDevelopmentShop(admin);
}
