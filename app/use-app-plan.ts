import { useOutletContext, useRouteLoaderData } from "react-router";

import { isPlanId } from "./billing-plans";
import { PLACEHOLDER_CURRENT_PLAN_ID, type PlanId } from "./plan-features";
import type { loader as appLoader } from "./routes/app";
import type { AppOutletContext } from "./routes/app";

/** Real Shopify subscription from the app shell — same source Pricing uses. */
export function useAppPlan(): {
  currentPlanId: PlanId;
  hasActivePlan: boolean;
} {
  const appData = useRouteLoaderData<typeof appLoader>("routes/app");
  const ctx = useOutletContext<AppOutletContext | undefined>();
  const rawPlan = appData?.currentPlanId ?? ctx?.currentPlanId ?? null;
  const currentPlanId: PlanId = isPlanId(rawPlan)
    ? rawPlan
    : PLACEHOLDER_CURRENT_PLAN_ID;
  return {
    currentPlanId,
    hasActivePlan: Boolean(appData?.hasActivePlan ?? ctx?.hasActivePlan),
  };
}
