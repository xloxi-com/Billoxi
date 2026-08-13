/**
 * Pricing page copy (admin UI language). Separate from template/PDF language.
 */
import {
  normalizeAdminUiLanguage,
  type AdminUiLanguage,
} from "./admin-i18n";
import { adminLocaleMessage } from "./admin-locale-store";
import type { PlanId } from "./plan-features";
import { planCtaKind } from "./plan-features";

export type PricingMessageKey =
  | "pricing.title"
  | "pricing.subtitleActive"
  | "pricing.subtitleFree"
  | "pricing.monthly"
  | "pricing.yearlySave"
  | "pricing.mostPopular"
  | "pricing.billedMonthly"
  | "pricing.yearlyBilledSave"
  | "pricing.trialDays"
  | "pricing.pricePerMo"
  | "pricing.ctaChoose"
  | "pricing.ctaCurrent"
  | "pricing.ctaUpgrade"
  | "pricing.ctaDowngrade"
  | "pricing.freeTitle"
  | "pricing.freeDesc"
  | "pricing.featuresTitle"
  | "pricing.featuresSubtitle"
  | "pricing.featureCol"
  | "pricing.howOrdersTitle"
  | "pricing.howOrdersDesc"
  | "pricing.countsToward"
  | "pricing.neverCounted"
  | "pricing.yes"
  | "pricing.no"
  | "pricing.unlimited"
  | "pricing.allAvailable"
  | "pricing.allModules"
  | "pricing.all6Types"
  | "pricing.yesAll6Types"
  | "pricing.basic"
  | "pricing.fullDailyChart"
  | "pricing.email"
  | "pricing.priorityEmail"
  | "pricing.usageProcessOrder"
  | "pricing.usageBulk"
  | "pricing.usageCountOne"
  | "pricing.usageCountEach"
  | "pricing.usagePreview"
  | "pricing.usageEdit"
  | "pricing.usageConvert"
  | "pricing.usageBrowse"
  | "pricing.hl.all6Docs"
  | "pricing.hl.orders50"
  | "pricing.hl.templatesEditor"
  | "pricing.hl.printPdf"
  | "pricing.hl.livePreview"
  | "pricing.hl.storeNumbering"
  | "pricing.hl.allLanguages"
  | "pricing.hl.everythingStarter"
  | "pricing.hl.orders200"
  | "pricing.hl.emailTemplates"
  | "pricing.hl.smtpPdf"
  | "pricing.hl.bulk"
  | "pricing.hl.autoDocs"
  | "pricing.hl.multiCurrency"
  | "pricing.hl.dashboardChart"
  | "pricing.hl.everythingPremium"
  | "pricing.hl.unlimitedOrders"
  | "pricing.hl.customerLinks"
  | "pricing.hl.adminExtensions"
  | "pricing.hl.activityLog"
  | "pricing.hl.prioritySupport"
  | "pricing.cmp.monthlyOrders"
  | "pricing.cmp.salesOrders"
  | "pricing.cmp.invoices"
  | "pricing.cmp.packingSlips"
  | "pricing.cmp.creditNotes"
  | "pricing.cmp.drafts"
  | "pricing.cmp.returns"
  | "pricing.cmp.orderList"
  | "pricing.cmp.convertInvoice"
  | "pricing.cmp.convertPacking"
  | "pricing.cmp.convertReturn"
  | "pricing.cmp.saveDraft"
  | "pricing.cmp.creditNoteOps"
  | "pricing.cmp.editFields"
  | "pricing.cmp.livePreview"
  | "pricing.cmp.printSingle"
  | "pricing.cmp.downloadSingle"
  | "pricing.cmp.listQuickActions"
  | "pricing.cmp.bulkActions"
  | "pricing.cmp.layoutPresets"
  | "pricing.cmp.paperSize"
  | "pricing.cmp.orientation"
  | "pricing.cmp.logoUpload"
  | "pricing.cmp.fullEditor"
  | "pricing.cmp.paymentStyles"
  | "pricing.cmp.language"
  | "pricing.cmp.mailto"
  | "pricing.cmp.smtp"
  | "pricing.cmp.emailTemplates"
  | "pricing.cmp.attachToggle"
  | "pricing.cmp.storeDetails"
  | "pricing.cmp.transactionNumbers"
  | "pricing.cmp.autoInvoice"
  | "pricing.cmp.autoCreditNote"
  | "pricing.cmp.multiCurrency"
  | "pricing.cmp.customerLinks"
  | "pricing.cmp.adminExtensions"
  | "pricing.cmp.dashboardUsage"
  | "pricing.cmp.activityLog"
  | "pricing.cmp.support";

const HIGHLIGHT_KEYS: Record<string, PricingMessageKey> = {
  "All 6 document types": "pricing.hl.all6Docs",
  "50 orders / month": "pricing.hl.orders50",
  "All templates + full editor": "pricing.hl.templatesEditor",
  "Print & PDF download": "pricing.hl.printPdf",
  "Live preview & convert docs": "pricing.hl.livePreview",
  "Store details & numbering": "pricing.hl.storeNumbering",
  "All template languages": "pricing.hl.allLanguages",
  "Everything in STARTER": "pricing.hl.everythingStarter",
  "200 orders / month": "pricing.hl.orders200",
  "Email templates (all 6 types)": "pricing.hl.emailTemplates",
  "SMTP email with PDF attach": "pricing.hl.smtpPdf",
  "Bulk download, email & convert": "pricing.hl.bulk",
  "Auto invoice / credit note": "pricing.hl.autoDocs",
  "Multi-currency": "pricing.hl.multiCurrency",
  "Dashboard daily chart": "pricing.hl.dashboardChart",
  "Everything in PREMIUM": "pricing.hl.everythingPremium",
  "Unlimited orders": "pricing.hl.unlimitedOrders",
  "Customer download links in emails": "pricing.hl.customerLinks",
  "Shopify Admin order extensions": "pricing.hl.adminExtensions",
  "Activity / event log": "pricing.hl.activityLog",
  "Priority email support": "pricing.hl.prioritySupport",
};

const FEATURE_KEYS: Record<string, PricingMessageKey> = {
  "Monthly orders": "pricing.cmp.monthlyOrders",
  "Sales Orders": "pricing.cmp.salesOrders",
  Invoices: "pricing.cmp.invoices",
  "Packing Slips": "pricing.cmp.packingSlips",
  "Credit Notes": "pricing.cmp.creditNotes",
  Drafts: "pricing.cmp.drafts",
  Returns: "pricing.cmp.returns",
  "Order list (search, filter, sort, tabs)": "pricing.cmp.orderList",
  "Convert sales order → invoice": "pricing.cmp.convertInvoice",
  "Convert sales order → packing slip": "pricing.cmp.convertPacking",
  "Convert sales order → return": "pricing.cmp.convertReturn",
  "Save as draft / finalize draft": "pricing.cmp.saveDraft",
  "Create / void / delete credit note": "pricing.cmp.creditNoteOps",
  "Edit number, date, notes, terms": "pricing.cmp.editFields",
  "Live document preview": "pricing.cmp.livePreview",
  "Print (single)": "pricing.cmp.printSingle",
  "Download PDF (single)": "pricing.cmp.downloadSingle",
  "List quick actions": "pricing.cmp.listQuickActions",
  "Bulk convert, bulk download (PDF/ZIP), bulk email":
    "pricing.cmp.bulkActions",
  "Layout presets": "pricing.cmp.layoutPresets",
  "Paper size": "pricing.cmp.paperSize",
  Orientation: "pricing.cmp.orientation",
  "Logo upload": "pricing.cmp.logoUpload",
  "Full template editor (margins, boxes, columns, appearance)":
    "pricing.cmp.fullEditor",
  "Payment status styles (5)": "pricing.cmp.paymentStyles",
  Language: "pricing.cmp.language",
  "Send via mailto draft": "pricing.cmp.mailto",
  "SMTP + PDF attach": "pricing.cmp.smtp",
  "Email templates": "pricing.cmp.emailTemplates",
  "Attach PDF toggle per type": "pricing.cmp.attachToggle",
  "Store details": "pricing.cmp.storeDetails",
  "Transaction numbers": "pricing.cmp.transactionNumbers",
  "Auto invoice on paid": "pricing.cmp.autoInvoice",
  "Auto credit note (cancel / refund)": "pricing.cmp.autoCreditNote",
  "Multi-currency": "pricing.cmp.multiCurrency",
  "Customer download links": "pricing.cmp.customerLinks",
  "Shopify order page extensions (download / print)":
    "pricing.cmp.adminExtensions",
  "Dashboard usage": "pricing.cmp.dashboardUsage",
  "Activity / event log": "pricing.cmp.activityLog",
  Support: "pricing.cmp.support",
};

const VALUE_KEYS: Record<string, PricingMessageKey> = {
  Yes: "pricing.yes",
  No: "pricing.no",
  Unlimited: "pricing.unlimited",
  "All available": "pricing.allAvailable",
  "All modules": "pricing.allModules",
  "All 6 types": "pricing.all6Types",
  "Yes (all 6 types)": "pricing.yesAll6Types",
  Basic: "pricing.basic",
  "Full + daily chart": "pricing.fullDailyChart",
  Email: "pricing.email",
  "Priority email": "pricing.priorityEmail",
};

const USAGE_ACTION_KEYS: Record<string, PricingMessageKey> = {
  "Process an order (print, download, or email)": "pricing.usageProcessOrder",
  "Bulk actions across multiple orders": "pricing.usageBulk",
};

const USAGE_COUNT_KEYS: Record<string, PricingMessageKey> = {
  "1 order": "pricing.usageCountOne",
  "1 order each": "pricing.usageCountEach",
};

const USAGE_FREE_KEYS: Record<string, PricingMessageKey> = {
  "Open document preview": "pricing.usagePreview",
  "Edit templates or settings": "pricing.usageEdit",
  "Convert between document types": "pricing.usageConvert",
  "Browse order lists": "pricing.usageBrowse",
};

export function pricingT(
  language: AdminUiLanguage | string | null | undefined,
  key: PricingMessageKey,
): string {
  const lang = normalizeAdminUiLanguage(language);
  return adminLocaleMessage(lang, key);
}

export function pricingTf(
  language: AdminUiLanguage | string | null | undefined,
  key: PricingMessageKey,
  vars: Record<string, string>,
): string {
  let text = pricingT(language, key);
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

function mapLookup(
  language: AdminUiLanguage | string | null | undefined,
  text: string,
  map: Record<string, PricingMessageKey>,
): string {
  const key = map[text];
  return key ? pricingT(language, key) : text;
}

export function pricingHighlight(
  language: AdminUiLanguage | string | null | undefined,
  text: string,
): string {
  return mapLookup(language, text, HIGHLIGHT_KEYS);
}

export function pricingFeature(
  language: AdminUiLanguage | string | null | undefined,
  text: string,
): string {
  return mapLookup(language, text, FEATURE_KEYS);
}

export function pricingValue(
  language: AdminUiLanguage | string | null | undefined,
  value: string,
): string {
  const trimmed = value.trim();
  const mapped = VALUE_KEYS[trimmed];
  if (mapped) return pricingT(language, mapped);
  if (/^yes\s+/i.test(trimmed)) {
    const note = trimmed.replace(/^yes\s*/i, "").trim();
    return note
      ? `${pricingT(language, "pricing.yes")} ${note}`
      : pricingT(language, "pricing.yes");
  }
  return trimmed;
}

export function pricingUsageAction(
  language: AdminUiLanguage | string | null | undefined,
  text: string,
): string {
  return mapLookup(language, text, USAGE_ACTION_KEYS);
}

export function pricingUsageCount(
  language: AdminUiLanguage | string | null | undefined,
  text: string,
): string {
  return mapLookup(language, text, USAGE_COUNT_KEYS);
}

export function pricingUsageFree(
  language: AdminUiLanguage | string | null | undefined,
  text: string,
): string {
  return mapLookup(language, text, USAGE_FREE_KEYS);
}

export function pricingPlanCtaLabel(
  language: AdminUiLanguage | string | null | undefined,
  planId: PlanId,
  currentPlanId: PlanId | null,
): string {
  if (currentPlanId == null) return pricingT(language, "pricing.ctaChoose");
  switch (planCtaKind(planId, currentPlanId)) {
    case "current":
      return pricingT(language, "pricing.ctaCurrent");
    case "upgrade":
      return pricingT(language, "pricing.ctaUpgrade");
    case "downgrade":
      return pricingT(language, "pricing.ctaDowngrade");
  }
}
