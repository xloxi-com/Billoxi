/**
 * Settings page body copy (admin UI language).
 * Nav section titles stay in admin-i18n.ts.
 */
import {
  normalizeAdminUiLanguage,
  type AdminUiLanguage,
} from "./admin-i18n";
import { adminLocaleMessage } from "./admin-locale-store";
import type { PlanCapability } from "./plan-access";
import { PLAN_CAPABILITY_LABEL, requiredPlanFor } from "./plan-access";
import { getPlanById, type PlanId } from "./plan-features";
import type { NumberSeriesModuleId } from "./number-series";
import type { CustomerDownloadDocumentType } from "./customer-download-links";

export type SettingsMessageKey =
  | "set.edit"
  | "set.cancel"
  | "set.unsaved"
  | "set.colModule"
  | "set.colPrefix"
  | "set.colStarting"
  | "set.colPreview"
  | "set.previewNext"
  | "set.numbersInfo"
  | "set.mod.salesOrder"
  | "set.mod.invoice"
  | "set.mod.draft"
  | "set.mod.return"
  | "set.mod.creditNote"
  | "set.mod.packingSlip"
  | "set.creditNoteTitle"
  | "set.creditNoteDesc"
  | "set.automation"
  | "set.onCancel"
  | "set.onCancelHelp"
  | "set.onFullRefund"
  | "set.onFullRefundHelp"
  | "set.onPartialRefund"
  | "set.onPartialRefundHelp"
  | "set.invoiceTitle"
  | "set.invoiceDesc"
  | "set.onPaid"
  | "set.onPaidHelp"
  | "set.multiCurrencyTitle"
  | "set.multiCurrencyBody"
  | "set.mcOff"
  | "set.mcOffHelp"
  | "set.mcShopify"
  | "set.mcShopifyHelp"
  | "set.downloadTitle"
  | "set.downloadDesc"
  | "set.downloadWhenTitle"
  | "set.downloadWhenBody"
  | "set.downloadRecommended"
  | "set.downloadHelpSmart"
  | "set.downloadHelpInvoice"
  | "set.downloadHelpSalesOrder"
  | "set.downloadHelpOther"
  | "set.openNotifications"
  | "set.copyCode"
  | "set.copied"
  | "set.copyFail"
  | "set.doc.salesOrder"
  | "set.doc.invoice"
  | "set.doc.draft"
  | "set.doc.return"
  | "set.doc.creditNote"
  | "set.doc.packingSlip"
  | "set.smtpHowTo"
  | "set.smtpUseGmail"
  | "set.smtpUseWebmail"
  | "set.smtpGmailHint"
  | "set.smtpWebmailHint"
  | "set.smtpHost"
  | "set.smtpPort"
  | "set.smtpTls"
  | "set.smtpFromEmail"
  | "set.smtpFromName"
  | "set.smtpUsername"
  | "set.smtpPassword"
  | "set.smtpPasswordKeep"
  | "set.smtpPasswordApp"
  | "set.smtpReadyTitle"
  | "set.smtpReadyBody"
  | "set.smtpMissingTitle"
  | "set.smtpMissingBody"
  | "set.smtpGmailStep1"
  | "set.smtpGmailStep2"
  | "set.smtpGmailStep3"
  | "set.smtpGmailStep4"
  | "set.smtpGmailStep5"
  | "set.smtpWebStep1"
  | "set.smtpWebStep2"
  | "set.smtpWebStep3"
  | "set.smtpWebStep4"
  | "set.webmailCustom"
  | "set.planFeatureTitle"
  | "set.planUpgradeTo"
  | "set.planNeeds"
  | "set.planPaid"
  | "set.planUpgradeModalTitle"
  | "set.planViewPlan"
  | "set.planNotNow"
  | "set.planLockedOn"
  | "set.cap.bulkActions"
  | "set.cap.smtp"
  | "set.cap.emailTemplates"
  | "set.cap.emailAttachPdf"
  | "set.cap.autoInvoice"
  | "set.cap.autoCreditNote"
  | "set.cap.multiCurrency"
  | "set.cap.customerDownloadLinks"
  | "set.cap.adminExtensions"
  | "set.cap.dashboardChart"
  | "set.cap.eventLog"
  | "set.rec.title"
  | "set.rec.subtitle"
  | "set.rec.approvefyBadge"
  | "set.rec.approvefyTag"
  | "set.rec.offrefyBadge"
  | "set.rec.offrefyTag"
  | "set.emailReset"
  | "set.emailLoadAll"
  | "set.emailSubject"
  | "set.emailAttachPdf"
  | "set.emailBody"
  | "set.emailLoadingEditor"
  | "set.emailDescSales"
  | "set.emailDescInvoice"
  | "set.emailDescDraft"
  | "set.emailDescCredit"
  | "set.emailDescPacking"
  | "set.emailDescReturn";

const CAP_KEYS: Record<PlanCapability, SettingsMessageKey> = {
  bulkActions: "set.cap.bulkActions",
  smtp: "set.cap.smtp",
  emailTemplates: "set.cap.emailTemplates",
  emailAttachPdf: "set.cap.emailAttachPdf",
  autoInvoice: "set.cap.autoInvoice",
  autoCreditNote: "set.cap.autoCreditNote",
  multiCurrency: "set.cap.multiCurrency",
  customerDownloadLinks: "set.cap.customerDownloadLinks",
  adminExtensions: "set.cap.adminExtensions",
  dashboardChart: "set.cap.dashboardChart",
  eventLog: "set.cap.eventLog",
};

const MOD_KEYS: Record<NumberSeriesModuleId, SettingsMessageKey> = {
  "sales-order": "set.mod.salesOrder",
  invoice: "set.mod.invoice",
  draft: "set.mod.draft",
  return: "set.mod.return",
  "credit-note": "set.mod.creditNote",
  "packing-slip": "set.mod.packingSlip",
};

const DOC_KEYS: Record<CustomerDownloadDocumentType, SettingsMessageKey> = {
  "sales-order": "set.doc.salesOrder",
  invoice: "set.doc.invoice",
  draft: "set.doc.draft",
  return: "set.doc.return",
  "credit-note": "set.doc.creditNote",
  "packing-slip": "set.doc.packingSlip",
};

export function settingsT(
  language: AdminUiLanguage | string | null | undefined,
  key: SettingsMessageKey,
): string {
  const lang = normalizeAdminUiLanguage(language);
  return adminLocaleMessage(lang, key);
}

export function settingsTf(
  language: AdminUiLanguage | string | null | undefined,
  key: SettingsMessageKey,
  vars: Record<string, string>,
): string {
  let text = settingsT(language, key);
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

export function settingsModuleLabel(
  language: AdminUiLanguage | string | null | undefined,
  id: NumberSeriesModuleId,
): string {
  return settingsT(language, MOD_KEYS[id]);
}

export function settingsDocLabel(
  language: AdminUiLanguage | string | null | undefined,
  id: CustomerDownloadDocumentType,
): string {
  return settingsT(language, DOC_KEYS[id]);
}

export function settingsCapabilityLabel(
  language: AdminUiLanguage | string | null | undefined,
  capability: PlanCapability,
): string {
  return settingsT(language, CAP_KEYS[capability]);
}

export function settingsUpgradeMessage(
  language: AdminUiLanguage | string | null | undefined,
  capability: PlanCapability,
  currentPlanId: PlanId,
): string {
  const feature = settingsCapabilityLabel(language, capability);
  const required = getPlanById(requiredPlanFor(capability)).name;
  const current = getPlanById(currentPlanId).name;
  // Keep English feature fallback available for logs.
  void PLAN_CAPABILITY_LABEL;
  return settingsTf(language, "set.planNeeds", {
    feature,
    required,
    current,
  });
}
