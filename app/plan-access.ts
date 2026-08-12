/**
 * Plan feature access — gate UI with lock + badge + upgrade (do not hide).
 * Pricing CTAs use Shopify Billing; gating still falls back to PLACEHOLDER_CURRENT_PLAN_ID when no subscription.
 */

import {
  PLACEHOLDER_CURRENT_PLAN_ID,
  getPlanById,
  planRank,
  type PlanId,
} from "./plan-features";

export type PlanCapability =
  | "bulkActions"
  | "smtp"
  | "emailTemplates"
  | "emailAttachPdf"
  | "autoInvoice"
  | "autoCreditNote"
  | "multiCurrency"
  | "customerDownloadLinks"
  | "adminExtensions"
  | "dashboardChart"
  | "eventLog";

/** Minimum plan required for each capability. */
export const PLAN_CAPABILITY_MIN: Record<PlanCapability, PlanId> = {
  bulkActions: "premium",
  smtp: "premium",
  emailTemplates: "premium",
  emailAttachPdf: "premium",
  autoInvoice: "premium",
  autoCreditNote: "premium",
  multiCurrency: "premium",
  customerDownloadLinks: "ultimate",
  adminExtensions: "ultimate",
  dashboardChart: "premium",
  eventLog: "ultimate",
};

export const PLAN_CAPABILITY_LABEL: Record<PlanCapability, string> = {
  bulkActions: "Bulk actions",
  smtp: "SMTP email",
  emailTemplates: "Email templates",
  emailAttachPdf: "Attach PDF when sending",
  autoInvoice: "Auto invoice on paid",
  autoCreditNote: "Auto credit note",
  multiCurrency: "Multi Currency",
  customerDownloadLinks: "Customer download links",
  adminExtensions: "Shopify Admin extensions",
  dashboardChart: "Usage analytics chart",
  eventLog: "Activity / event log",
};

export function requiredPlanFor(capability: PlanCapability): PlanId {
  return PLAN_CAPABILITY_MIN[capability];
}

export function planHasCapability(
  planId: PlanId,
  capability: PlanCapability,
): boolean {
  return planRank(planId) >= planRank(PLAN_CAPABILITY_MIN[capability]);
}

export function getCurrentPlanId(): PlanId {
  return PLACEHOLDER_CURRENT_PLAN_ID;
}

export function planBadgeLabel(minPlan: PlanId): string {
  return getPlanById(minPlan).name;
}

export function upgradeMessage(
  capability: PlanCapability,
  currentPlanId: PlanId = getCurrentPlanId(),
): string {
  const feature = PLAN_CAPABILITY_LABEL[capability];
  const required = getPlanById(requiredPlanFor(capability)).name;
  const current = getPlanById(currentPlanId).name;
  return `${feature} needs the ${required} plan. You’re on ${current}.`;
}
