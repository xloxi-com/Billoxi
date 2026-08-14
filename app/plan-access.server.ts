import { loadShopBillingState, loadShopPlanIdFromAdmin } from "./billing-plans";
import {
  planHasCapability,
  type PlanCapability,
} from "./plan-access";
import type { PlanId } from "./plan-features";
import { unauthenticated } from "./shopify.server";

type BillingCheckApi = Parameters<typeof loadShopBillingState>[0];

/** Webhook / public routes: resolve plan from the shop session. */
export async function getShopPlanIdForShop(
  shop: string,
): Promise<PlanId | null> {
  try {
    const ctx = await unauthenticated.admin(shop);
    const billing = (ctx as { billing?: BillingCheckApi }).billing;
    if (billing) {
      const state = await loadShopBillingState(billing);
      return state.currentPlanId;
    }
    return loadShopPlanIdFromAdmin(ctx.admin);
  } catch {
    return null;
  }
}

export async function shopHasCapability(
  shop: string,
  capability: PlanCapability,
): Promise<boolean> {
  const planId = await getShopPlanIdForShop(shop);
  if (!planId) return false;
  return planHasCapability(planId, capability);
}
