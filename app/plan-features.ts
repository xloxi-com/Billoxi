/**
 * Billoxi plan catalog (display + gating metadata).
 * Pricing CTAs use Shopify Billing via `app/billing-plans.ts` + `shopify.server.ts`.
 */

export type PlanId = "starter" | "premium" | "ultimate";

export type PlanFeatureRow = {
  category: string;
  feature: string;
  value: string;
};

export type PlanComparisonRow = {
  category: string;
  feature: string;
  starter: string;
  premium: string;
  ultimate: string;
};

export type PlanDefinition = {
  id: PlanId;
  name: string;
  /** Monthly list price in USD */
  priceAmount: number;
  trialDays: number;
  /** Monthly order limit. `null` = unlimited. */
  monthlyOrderLimit: number | null;
  tagline: string;
  appStoreCopy: string;
  /** Key features shown on the pricing card */
  highlights: readonly string[];
};

/** Yearly billing discount off monthly × 12. */
export const YEARLY_DISCOUNT_PERCENT = 20;

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function formatUsd(amount: number): string {
  const fixed = amount.toFixed(2);
  return fixed.endsWith(".00") ? `$${fixed.slice(0, -3)}` : `$${fixed}`;
}

export function planMonthlyPriceLabel(amount: number): string {
  return `${formatUsd(amount)} / mo`;
}

export function planYearlyTotal(amount: number): number {
  return roundMoney(amount * 12 * (1 - YEARLY_DISCOUNT_PERCENT / 100));
}

export function planYearlyMonthlyEquivalent(amount: number): number {
  return roundMoney(amount * (1 - YEARLY_DISCOUNT_PERCENT / 100));
}

export function planYearlyPriceLabel(amount: number): string {
  return `${formatUsd(planYearlyTotal(amount))} / yr`;
}

export function planYearlyEquivalentLabel(amount: number): string {
  return `${formatUsd(planYearlyMonthlyEquivalent(amount))} / mo`;
}

export const PLAN_USAGE_COUNTS: Array<{ action: string; count: string }> = [
  { action: "Process an order (print, download, or email)", count: "1 order" },
  { action: "Bulk actions across multiple orders", count: "1 order each" },
];

export const PLAN_USAGE_NOT_COUNTED = [
  "Open document preview",
  "Edit templates or settings",
  "Convert between document types",
  "Browse order lists",
] as const;

/** Single feature matrix — STARTER · PREMIUM · ULTIMATE in one table. */
export const PLAN_COMPARISON_ROWS: readonly PlanComparisonRow[] = [
  {
    category: "Limit",
    feature: "Monthly orders",
    starter: "50",
    premium: "200",
    ultimate: "Unlimited",
  },
  {
    category: "Modules",
    feature: "Sales Orders",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Modules",
    feature: "Invoices",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Modules",
    feature: "Packing Slips",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Modules",
    feature: "Credit Notes",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Modules",
    feature: "Drafts",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Modules",
    feature: "Returns",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Order list (search, filter, sort, tabs)",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Convert sales order → invoice",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Convert sales order → packing slip",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Convert sales order → return",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Save as draft / finalize draft",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Create / void / delete credit note",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Edit number, date, notes, terms",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Live document preview",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Print (single)",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Download PDF (single)",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "List quick actions",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Workflow",
    feature: "Bulk convert, bulk download (PDF/ZIP), bulk email",
    starter: "No",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Templates",
    feature: "Layout presets",
    starter: "All available",
    premium: "All available",
    ultimate: "All available",
  },
  {
    category: "Templates",
    feature: "Paper size",
    starter: "A5, A4, Letter",
    premium: "A5, A4, Letter",
    ultimate: "A5, A4, Letter",
  },
  {
    category: "Templates",
    feature: "Orientation",
    starter: "Portrait, Landscape",
    premium: "Portrait, Landscape",
    ultimate: "Portrait, Landscape",
  },
  {
    category: "Templates",
    feature: "Logo upload",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Templates",
    feature: "Full template editor (margins, boxes, columns, appearance)",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Templates",
    feature: "Payment status styles (5)",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Templates",
    feature: "Language",
    starter: "All available",
    premium: "All available",
    ultimate: "All available",
  },
  {
    category: "Email",
    feature: "Send via mailto draft",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Email",
    feature: "SMTP + PDF attach",
    starter: "No",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Email",
    feature: "Email templates",
    starter: "No",
    premium: "All 6 types",
    ultimate: "All 6 types",
  },
  {
    category: "Email",
    feature: "Attach PDF toggle per type",
    starter: "No",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Settings",
    feature: "Store details",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Settings",
    feature: "Transaction numbers",
    starter: "All modules",
    premium: "All modules",
    ultimate: "All modules",
  },
  {
    category: "Settings",
    feature: "Auto invoice on paid",
    starter: "No",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Settings",
    feature: "Auto credit note (cancel / refund)",
    starter: "No",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Settings",
    feature: "Multi-currency",
    starter: "No",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Settings",
    feature: "Customer download links",
    starter: "No",
    premium: "No",
    ultimate: "Yes (all 6 types)",
  },
  {
    category: "Admin",
    feature: "Shopify order page extensions (download / print)",
    starter: "Yes",
    premium: "Yes",
    ultimate: "Yes",
  },
  {
    category: "Analytics",
    feature: "Dashboard usage",
    starter: "Basic",
    premium: "Full + daily chart",
    ultimate: "Full + daily chart",
  },
  {
    category: "Analytics",
    feature: "Activity / event log",
    starter: "No",
    premium: "No",
    ultimate: "Yes",
  },
  {
    category: "Support",
    feature: "Support",
    starter: "Email",
    premium: "Email",
    ultimate: "Priority email",
  },
] as const;

export const BILLIOXI_PLANS: readonly PlanDefinition[] = [
  {
    id: "starter",
    name: "STARTER",
    priceAmount: 9.99,
    trialDays: 7,
    monthlyOrderLimit: 50,
    tagline: "For small and new stores getting started with documents.",
    appStoreCopy:
      "All 6 document types — sales orders, invoices, packing slips, credit notes, drafts & returns. All templates available, print & PDF download. Perfect for small stores.",
    highlights: [
      "All 6 document types",
      "50 orders / month",
      "Shopify Admin order extensions",
      "All templates + full editor",
      "Print & PDF download",
      "Live preview & convert docs",
      "Store details & numbering",
      "All template languages",
    ],
  },
  {
    id: "premium",
    name: "PREMIUM",
    priceAmount: 19.99,
    trialDays: 7,
    monthlyOrderLimit: 200,
    tagline:
      "For growing stores that need SMTP email, bulk actions, and automation.",
    appStoreCopy:
      "SMTP email with PDF, bulk download & automation. All templates available.",
    highlights: [
      "Everything in STARTER",
      "200 orders / month",
      "Email templates (all 6 types)",
      "SMTP email with PDF attach",
      "Bulk download, email & convert",
      "Auto invoice / credit note",
      "Multi-currency",
      "Dashboard daily chart",
    ],
  },
  {
    id: "ultimate",
    name: "ULTIMATE",
    priceAmount: 39,
    trialDays: 7,
    monthlyOrderLimit: null,
    tagline:
      "For high-volume stores that need customer downloads, unlimited orders, and priority support.",
    appStoreCopy:
      "Unlimited documents, customer download links in order emails & priority support.",
    highlights: [
      "Everything in PREMIUM",
      "Unlimited orders",
      "Customer download links in emails",
      "Activity / event log",
      "Priority email support",
    ],
  },
] as const;

export function featuresForPlan(planId: PlanId): PlanFeatureRow[] {
  return PLAN_COMPARISON_ROWS.map((row) => ({
    category: row.category,
    feature: row.feature,
    value: row[planId],
  }));
}

export function getPlanById(id: PlanId): PlanDefinition {
  const plan = BILLIOXI_PLANS.find((item) => item.id === id);
  if (!plan) {
    throw new Error(`Unknown plan: ${id}`);
  }
  return plan;
}

const PLAN_RANK: Record<PlanId, number> = {
  starter: 0,
  premium: 1,
  ultimate: 2,
};

export function planRank(id: PlanId): number {
  return PLAN_RANK[id];
}

export type PlanCtaKind = "current" | "upgrade" | "downgrade";

export function planCtaKind(
  planId: PlanId,
  currentPlanId: PlanId | null,
): PlanCtaKind {
  if (currentPlanId == null) return "upgrade";
  const delta = planRank(planId) - planRank(currentPlanId);
  if (delta === 0) return "current";
  if (delta > 0) return "upgrade";
  return "downgrade";
}

export function planCtaLabel(
  planId: PlanId,
  currentPlanId: PlanId | null,
): string {
  if (currentPlanId == null) return "Choose plan";
  switch (planCtaKind(planId, currentPlanId)) {
    case "current":
      return "Current";
    case "upgrade":
      return "Upgrade";
    case "downgrade":
      return "Downgrade";
  }
}

/** Placeholder “current plan” until Shopify Billing is connected. */
export const PLACEHOLDER_CURRENT_PLAN_ID: PlanId = "starter";
