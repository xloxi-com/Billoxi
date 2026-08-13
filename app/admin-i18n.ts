/**
 * Admin UI language (Billoxi backend chrome) — separate from template/PDF language.
 * Template language stays in the template editor only.
 *
 * Selector lists Shopify-style admin locales. Locale JSON under app/admin-locales/
 * holds UI strings for every listed language (EN source + translated packs).
 */

import { adminLocaleMessage } from "./admin-locale-store";

export const ADMIN_UI_LANGUAGES = [
  { value: "af", label: "Afrikaans" },
  { value: "ak", label: "Akan" },
  { value: "am", label: "አማርኛ (Amharic)" },
  { value: "ar", label: "العربية (Arabic)" },
  { value: "as", label: "অসমীয়া (Assamese)" },
  { value: "az", label: "Azərbaycan (Azerbaijani)" },
  { value: "be", label: "Беларуская (Belarusian)" },
  { value: "bg", label: "Български (Bulgarian)" },
  { value: "bm", label: "Bamanankan (Bambara)" },
  { value: "bn", label: "বাংলা (Bangla)" },
  { value: "bo", label: "བོད་སྐད་ (Tibetan)" },
  { value: "br", label: "Brezhoneg (Breton)" },
  { value: "bs", label: "Bosanski (Bosnian)" },
  { value: "ca", label: "Català (Catalan)" },
  { value: "ce", label: "Нохчийн (Chechen)" },
  { value: "ckb", label: "کوردیی ناوەندی (Central Kurdish)" },
  { value: "cs", label: "Čeština (Czech)" },
  { value: "cy", label: "Cymraeg (Welsh)" },
  { value: "da", label: "Dansk (Danish)" },
  { value: "de", label: "Deutsch (German)" },
  { value: "dz", label: "རྫོང་ཁ (Dzongkha)" },
  { value: "ee", label: "Eʋegbe (Ewe)" },
  { value: "el", label: "Ελληνικά (Greek)" },
  { value: "en", label: "English" },
  { value: "eo", label: "Esperanto" },
  { value: "es", label: "Español (Spanish)" },
  { value: "et", label: "Eesti (Estonian)" },
  { value: "eu", label: "Euskara (Basque)" },
  { value: "fa", label: "فارسی (Persian)" },
  { value: "ff", label: "Fulfulde (Fulah)" },
  { value: "fi", label: "Suomi (Finnish)" },
  { value: "fil", label: "Filipino" },
  { value: "fo", label: "Føroyskt (Faroese)" },
  { value: "fr", label: "Français (French)" },
  { value: "fy", label: "Frysk (Western Frisian)" },
  { value: "ga", label: "Gaeilge (Irish)" },
  { value: "gd", label: "Gàidhlig (Scottish Gaelic)" },
  { value: "gl", label: "Galego (Galician)" },
  { value: "gu", label: "ગુજરાતી (Gujarati)" },
  { value: "gv", label: "Gaelg (Manx)" },
  { value: "ha", label: "Hausa" },
  { value: "he", label: "עברית (Hebrew)" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "hr", label: "Hrvatski (Croatian)" },
  { value: "hu", label: "Magyar (Hungarian)" },
  { value: "hy", label: "Հայերեն (Armenian)" },
  { value: "ia", label: "Interlingua" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "ig", label: "Igbo" },
  { value: "ii", label: "ꆈꌠꉙ (Sichuan Yi)" },
  { value: "is", label: "Íslenska (Icelandic)" },
  { value: "it", label: "Italiano (Italian)" },
  { value: "ja", label: "日本語 (Japanese)" },
  { value: "jv", label: "Basa Jawa (Javanese)" },
  { value: "ka", label: "ქართული (Georgian)" },
  { value: "ki", label: "Gĩkũyũ (Kikuyu)" },
  { value: "kk", label: "Қазақ (Kazakh)" },
  { value: "kl", label: "Kalaallisut" },
  { value: "km", label: "ខ្មែរ (Khmer)" },
  { value: "kn", label: "ಕನ್ನಡ (Kannada)" },
  { value: "ko", label: "한국어 (Korean)" },
  { value: "ks", label: "کٲشُر (Kashmiri)" },
  { value: "ku", label: "Kurdî (Kurdish)" },
  { value: "kw", label: "Kernewek (Cornish)" },
  { value: "ky", label: "Кыргызча (Kyrgyz)" },
  { value: "lb", label: "Lëtzebuergesch (Luxembourgish)" },
  { value: "lg", label: "Luganda (Ganda)" },
  { value: "ln", label: "Lingála (Lingala)" },
  { value: "lo", label: "ລາວ (Lao)" },
  { value: "lt", label: "Lietuvių (Lithuanian)" },
  { value: "lu", label: "Tshiluba (Luba-Katanga)" },
  { value: "lv", label: "Latviešu (Latvian)" },
  { value: "mg", label: "Malagasy" },
  { value: "mi", label: "Māori" },
  { value: "mk", label: "Македонски (Macedonian)" },
  { value: "ml", label: "മലയാളം (Malayalam)" },
  { value: "mn", label: "Монгол (Mongolian)" },
  { value: "mr", label: "मराठी (Marathi)" },
  { value: "ms", label: "Bahasa Melayu (Malay)" },
  { value: "mt", label: "Malti (Maltese)" },
  { value: "my", label: "မြန်မာ (Burmese)" },
  { value: "nb", label: "Norsk Bokmål" },
  { value: "nd", label: "isiNdebele (North Ndebele)" },
  { value: "ne", label: "नेपाली (Nepali)" },
  { value: "nl", label: "Nederlands (Dutch)" },
  { value: "nn", label: "Norsk Nynorsk" },
  { value: "no", label: "Norsk (Norwegian)" },
  { value: "om", label: "Oromoo (Oromo)" },
  { value: "or", label: "ଓଡ଼ିଆ (Odia)" },
  { value: "os", label: "Ирон (Ossetic)" },
  { value: "pa", label: "ਪੰਜਾਬੀ (Punjabi)" },
  { value: "pl", label: "Polski (Polish)" },
  { value: "ps", label: "پښتو (Pashto)" },
  { value: "pt-BR", label: "Português (Brazil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "qu", label: "Runasimi (Quechua)" },
  { value: "rm", label: "Rumantsch (Romansh)" },
  { value: "rn", label: "Ikirundi (Rundi)" },
  { value: "ro", label: "Română (Romanian)" },
  { value: "ru", label: "Русский (Russian)" },
  { value: "rw", label: "Ikinyarwanda (Kinyarwanda)" },
  { value: "sa", label: "संस्कृतम् (Sanskrit)" },
  { value: "sc", label: "Sardu (Sardinian)" },
  { value: "sd", label: "سنڌي (Sindhi)" },
  { value: "se", label: "Davvisámegiella (Northern Sami)" },
  { value: "sg", label: "Sängö (Sango)" },
  { value: "si", label: "සිංහල (Sinhala)" },
  { value: "sk", label: "Slovenčina (Slovak)" },
  { value: "sl", label: "Slovenščina (Slovenian)" },
  { value: "sn", label: "chiShona (Shona)" },
  { value: "so", label: "Soomaali (Somali)" },
  { value: "sq", label: "Shqip (Albanian)" },
  { value: "sr", label: "Српски (Serbian)" },
  { value: "su", label: "Basa Sunda (Sundanese)" },
  { value: "sv", label: "Svenska (Swedish)" },
  { value: "sw", label: "Kiswahili (Swahili)" },
  { value: "ta", label: "தமிழ் (Tamil)" },
  { value: "te", label: "తెలుగు (Telugu)" },
  { value: "tg", label: "Тоҷикӣ (Tajik)" },
  { value: "th", label: "ไทย (Thai)" },
  { value: "ti", label: "ትግርኛ (Tigrinya)" },
  { value: "tk", label: "Türkmen (Turkmen)" },
  { value: "to", label: "lea fakatonga (Tongan)" },
  { value: "tr", label: "Türkçe (Turkish)" },
  { value: "tt", label: "Татар (Tatar)" },
  { value: "ug", label: "ئۇيغۇرچە (Uyghur)" },
  { value: "uk", label: "Українська (Ukrainian)" },
  { value: "ur", label: "اردو (Urdu)" },
  { value: "uz", label: "Oʻzbek (Uzbek)" },
  { value: "vi", label: "Tiếng Việt (Vietnamese)" },
  { value: "wo", label: "Wolof" },
  { value: "xh", label: "isiXhosa (Xhosa)" },
  { value: "yi", label: "ייִדיש (Yiddish)" },
  { value: "yo", label: "Yorùbá (Yoruba)" },
  { value: "zh-CN", label: "简体中文 (Chinese Simplified)" },
  { value: "zh-TW", label: "繁體中文 (Chinese Traditional)" },
  { value: "zu", label: "isiZulu (Zulu)" },
] as const;

export type AdminUiLanguage = (typeof ADMIN_UI_LANGUAGES)[number]["value"];
export const DEFAULT_ADMIN_UI_LANGUAGE: AdminUiLanguage = "en";

export type AdminMessageKey =
  | "nav.home"
  | "nav.salesOrders"
  | "nav.invoice"
  | "nav.draft"
  | "nav.return"
  | "nav.creditNote"
  | "nav.packingSlip"
  | "nav.templates"
  | "nav.pricing"
  | "nav.settings"
  | "nav.loadingPage"
  | "pages.salesOrders"
  | "pages.invoice"
  | "pages.draft"
  | "pages.return"
  | "pages.creditNote"
  | "pages.packingSlip"
  | "pages.templates"
  | "pages.settings"
  | "pages.pricing"
  | "pages.home"
  | "settings.language"
  | "settings.languageDesc"
  | "settings.languageHelp"
  | "settings.languageSaved"
  | "settings.storeDetails"
  | "settings.storeDetailsDesc"
  | "settings.storeLoadFromShopify"
  | "settings.storeLogo"
  | "settings.storeLogoHelp"
  | "settings.storeUploadLogo"
  | "settings.storeChangeLogo"
  | "settings.storeRemoveLogo"
  | "settings.storeLogoFormats"
  | "settings.storeLogoHint"
  | "settings.storeLogoReject"
  | "settings.storeLogoTooBig"
  | "settings.storeLogoBadType"
  | "settings.storeLogoReadFail"
  | "settings.storeName"
  | "settings.storeAddress"
  | "settings.storeAddressHelp"
  | "settings.storePhone"
  | "settings.storeEmail"
  | "settings.storeWebsite"
  | "settings.storeWebsiteHelp"
  | "settings.storeCustomFields"
  | "settings.storeAddField"
  | "settings.storeNoCustomFields"
  | "settings.storeDragReorder"
  | "settings.storeFieldLabel"
  | "settings.storeFieldText"
  | "settings.storeRemoveField"
  | "settings.storeUnsaved"
  | "settings.saving"
  | "settings.discard"
  | "settings.transactionNumbers"
  | "settings.transactionNumbersDesc"
  | "settings.advanced"
  | "settings.advancedDesc"
  | "settings.multiCurrency"
  | "settings.multiCurrencyDesc"
  | "settings.downloadLinks"
  | "settings.downloadLinksDesc"
  | "settings.smtp"
  | "settings.smtpDesc"
  | "settings.emailTemplates"
  | "settings.emailSalesOrders"
  | "settings.emailInvoice"
  | "settings.emailDraft"
  | "settings.emailCreditNote"
  | "settings.emailPackingSlip"
  | "settings.emailReturn"
  | "setup.adminLanguage"
  | "setup.adminLanguageDetail"
  | "setup.saveLanguage"
  | "setup.updateLanguage"
  | "setup.storeDetails"
  | "setup.storeDetailsDetail"
  | "setup.openStoreDetails"
  | "setup.templates"
  | "setup.templatesDetail"
  | "setup.openTemplates"
  | "setup.transactionNumbers"
  | "setup.transactionNumbersDetail"
  | "setup.openTransactionNumbers"
  | "setup.smtp"
  | "setup.smtpDetail"
  | "setup.openSmtp"
  | "setup.guideTitle"
  | "setup.complete"
  | "setup.done"
  | "setup.allDone"
  | "setup.finishSteps"
  | "setup.collapse"
  | "setup.expand"
  | "setup.paidPlan"
  | "setup.lockedBody"
  | "setup.unlockBody"
  | "home.plan"
  | "home.planCurrent"
  | "home.planInstalled"
  | "home.planFee"
  | "home.planTrialEnds"
  | "home.analytics"
  | "home.analyticsSubtitle"
  | "home.monthlyPrinted"
  | "home.monthlyDownloaded"
  | "home.monthlySent"
  | "home.chartTitle"
  | "home.chartSubtitle"
  | "home.chartPrinted"
  | "home.chartDownloaded"
  | "home.chartSent"
  | "home.chartEmpty"
  | "home.chartAria"
  | "home.chartLockedTitle"
  | "home.chartLockedBody"
  | "home.upgradePlan"
  | "home.eventLogs"
  | "home.eventLogsSubtitle"
  | "home.eventLogsLocked"
  | "home.eventLogsEmpty"
  | "home.eventOrderId"
  | "home.eventDescription"
  | "home.eventLogDate"
  | "home.eventSingular"
  | "home.eventPlural"
  | "home.eventMessage"
  | "home.eventAsDocument"
  | "home.eventActionPrinted"
  | "home.eventActionDownloaded"
  | "home.eventActionSent"
  | "home.eventActionUploaded"
  | "home.eventKindSalesOrder"
  | "home.eventKindInvoice"
  | "home.eventKindDraft"
  | "home.eventKindCreditNote"
  | "home.eventKindPackingSlip"
  | "home.eventKindReturn"
  | "home.eventKindDocument"
  | "home.moreFromUs"
  | "home.moreFromUsSubtitle"
  | "home.freeBannerTitle"
  | "home.freeBannerBody"
  | "list.reload"
  | "list.tabAll"
  | "list.tabUnpaid"
  | "list.tabPaid"
  | "list.tabVoided"
  | "list.tabInvoiced"
  | "list.tabOpen"
  | "list.tabRefunded"
  | "list.tabInvoiceSent"
  | "list.tabCompleted"
  | "list.tabUnfulfilled"
  | "list.tabPartial"
  | "list.tabFulfilled"
  | "list.emptyFilterTry"
  | "list.emptyNoOrdersFound"
  | "list.emptyNoInvoicesFound"
  | "list.emptyNoDraftsFound"
  | "list.emptyNoCreditNotesFound"
  | "list.emptyNoPackingSlipsFound"
  | "list.emptyNoReturnsFound"
  | "list.emptyNoOrdersYet"
  | "list.emptyNoOrdersYetDesc"
  | "list.emptyNoInvoicesYet"
  | "list.emptyNoInvoicesYetDesc"
  | "list.emptyNoDraftsYet"
  | "list.emptyNoDraftsYetDesc"
  | "list.emptyNoCreditNotesYet"
  | "list.emptyNoCreditNotesYetDesc"
  | "list.emptyNoPackingSlipsYet"
  | "list.emptyNoPackingSlipsYetDesc"
  | "list.emptyNoReturnsYet"
  | "list.emptyNoReturnsYetDesc"
  | "list.goToSalesOrders"
  | "list.goToInvoice"
  | "list.createInShopify"
  | "col.salesOrder"
  | "col.invoice"
  | "col.draft"
  | "col.creditNote"
  | "col.packingSlip"
  | "col.return"
  | "col.reference"
  | "col.order"
  | "col.date"
  | "col.company"
  | "col.customer"
  | "col.total"
  | "col.amount"
  | "col.balanceDue"
  | "col.creditTotal"
  | "col.paymentStatus"
  | "col.status"
  | "col.fulfillmentStatus"
  | "col.fulfillment"
  | "col.invoiced"
  | "col.actions"
  | "col.reason"
  | "col.salesOrderNumber"
  | "col.invoiceNumber"
  | "col.columns"
  | "col.editColumns"
  | "status.pending"
  | "status.paid"
  | "status.unpaid"
  | "status.voided"
  | "status.refunded"
  | "status.partiallyRefunded"
  | "status.partiallyPaid"
  | "status.authorized"
  | "status.expired"
  | "status.overdueByOneDay"
  | "status.overdueByDays"
  | "status.fulfilled"
  | "status.unfulfilled"
  | "status.partiallyFulfilled"
  | "status.onHold"
  | "status.inProgress"
  | "status.requestDeclined"
  | "status.pendingFulfillment"
  | "status.notInvoiced"
  | "status.packingSlipCreated"
  | "status.noPackingSlip"
  | "status.returnCreated"
  | "status.noReturn"
  | "status.creditNoteCreated"
  | "status.creditNoteVoided"
  | "status.noCreditNote"
  | "list.actionPrint"
  | "list.actionDownloadPdf"
  | "list.actionSendEmail"
  | "list.actionEmailSent"
  | "common.save"
  | "common.salesOrders"
  | "common.templates"
  | "common.settings"
  | "common.viewPricing"
  | "common.edit"
  | "common.delete"
  | "common.cancel"
  | "common.yes"
  | "common.no"
  | "common.download"
  | "common.viewAll"
  | "common.search"
  | "status.invoiced"
  | "detail.downloading"
  | "detail.preparing"
  | "detail.convertToInvoice"
  | "detail.convertToPackingSlip"
  | "detail.convertToReturn"
  | "detail.sidebarInvoices"
  | "detail.sidebarDrafts"
  | "detail.sidebarCreditNotes"
  | "detail.sidebarPackingSlips"
  | "detail.sidebarReturns"
  | "detail.searchOrders"
  | "detail.searchInvoices"
  | "detail.searchDrafts"
  | "detail.searchCreditNotes"
  | "detail.searchPackingSlips"
  | "detail.searchReturns"
  | "detail.loadingOrders"
  | "detail.loadingPreview"
  | "detail.noMatches"
  | "detail.openItem"
  | "detail.noun.salesOrder"
  | "detail.noun.salesOrders"
  | "detail.noun.invoice"
  | "detail.noun.invoices"
  | "detail.noun.draft"
  | "detail.noun.drafts"
  | "detail.noun.creditNote"
  | "detail.noun.creditNotes"
  | "detail.noun.packingSlip"
  | "detail.noun.packingSlips"
  | "detail.noun.return"
  | "detail.noun.returns"
  | "detail.convertInvoiceTitle"
  | "detail.convertInvoiceBody"
  | "detail.convertDraftInvoiceBody"
  | "detail.deleteInvoiceTitle"
  | "detail.deleteCreditNoteTitle"
  | "detail.deletePackingSlipTitle"
  | "detail.deleteReturnTitle"
  | "detail.deleteDraftTitle"
  | "detail.deleteInvoiceBody"
  | "detail.deleteInvoiceHasCredit"
  | "detail.deleteCreditNoteBody"
  | "detail.deletePackingSlipBody"
  | "detail.deleteReturnBody"
  | "detail.deleteDraftBody"
  | "detail.editSalesOrder"
  | "detail.editInvoice"
  | "detail.editDraft"
  | "detail.editCreditNote"
  | "detail.numberSalesOrder"
  | "detail.numberInvoice"
  | "detail.numberDraft"
  | "detail.numberCreditNote"
  | "detail.dateSalesOrder"
  | "detail.dateInvoice"
  | "detail.dateDraft"
  | "detail.dateCreditNote"
  | "detail.reason"
  | "detail.reasonPlaceholder"
  | "detail.afterSavingNumber"
  | "detail.numberModeContinue"
  | "detail.numberModeManual"
  | "detail.thisNumber"
  | "detail.customerNote"
  | "detail.customerNoteHelp"
  | "detail.terms"
  | "detail.important"
  | "detail.itemsLocked"
  | "detail.toast.pdfDownloaded"
  | "detail.toast.pdfFailed"
  | "detail.toast.printFailed"
  | "detail.toast.noEmail"
  | "detail.toast.pdfEmailFailed"
  | "detail.toast.sendFailed"
  | "detail.toast.emailSent"
  | "detail.toast.emailSentPdf"
  | "detail.toast.creditSaved"
  | "detail.toast.invoiceSaved"
  | "detail.toast.draftSaved"
  | "detail.toast.salesOrderSaved"
  | "detail.toast.creditDeleted"
  | "detail.toast.invoiceDeleted"
  | "detail.toast.packingDeleted"
  | "detail.toast.returnDeleted"
  | "detail.toast.draftDeleted"
  | "detail.toast.convertedPacking"
  | "detail.toast.convertedReturn"
  | "detail.toast.convertedInvoice"
  | "detail.toast.savedDraft"
  | "detail.toast.deleteCreditFirst";

export function isAdminUiLanguage(value: unknown): value is AdminUiLanguage {
  return (
    typeof value === "string" &&
    ADMIN_UI_LANGUAGES.some((entry) => entry.value === value)
  );
}

export function normalizeAdminUiLanguage(
  value: unknown,
  fallback: AdminUiLanguage = DEFAULT_ADMIN_UI_LANGUAGE,
): AdminUiLanguage {
  if (isAdminUiLanguage(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const raw = value.trim();
    const lower = raw.toLowerCase();
    const base = lower.split("-")[0] || lower;
    // Prefer exact / case-insensitive match, then pt-BR vs pt-PT before bare pt.
    const exact = ADMIN_UI_LANGUAGES.find(
      (entry) =>
        entry.value === raw || entry.value.toLowerCase() === lower,
    );
    if (exact) return exact.value;
    if (base === "pt") {
      if (lower.includes("br")) return "pt-BR";
      if (lower.includes("pt")) return "pt-PT";
      return "pt-BR";
    }
    if (base === "zh") {
      if (
        lower.includes("tw") ||
        lower.includes("hk") ||
        lower.includes("hant")
      ) {
        return "zh-TW";
      }
      return "zh-CN";
    }
    const match = ADMIN_UI_LANGUAGES.find(
      (entry) => entry.value.split("-")[0]?.toLowerCase() === base,
    );
    if (match) return match.value;
  }
  return fallback;
}

export function adminT(
  language: AdminUiLanguage | string | null | undefined,
  key: AdminMessageKey,
): string {
  return adminLocaleMessage(normalizeAdminUiLanguage(language), key);
}

export function adminTf(
  language: AdminUiLanguage | string | null | undefined,
  key: AdminMessageKey,
  vars: Record<string, string>,
): string {
  let text = adminT(language, key);
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

export function adminPageHeading(
  language: AdminUiLanguage | string | null | undefined,
  module:
    | "sales-order"
    | "invoice"
    | "draft"
    | "return"
    | "credit-note"
    | "packing-slip",
): string {
  switch (module) {
    case "sales-order":
      return adminT(language, "pages.salesOrders");
    case "invoice":
      return adminT(language, "pages.invoice");
    case "draft":
      return adminT(language, "pages.draft");
    case "return":
      return adminT(language, "pages.return");
    case "credit-note":
      return adminT(language, "pages.creditNote");
    case "packing-slip":
      return adminT(language, "pages.packingSlip");
  }
}

export function adminEventActionLabel(
  language: AdminUiLanguage | string | null | undefined,
  action: string,
): string {
  switch (action) {
    case "printed":
      return adminT(language, "home.eventActionPrinted");
    case "downloaded":
      return adminT(language, "home.eventActionDownloaded");
    case "sent":
      return adminT(language, "home.eventActionSent");
    case "uploaded":
      return adminT(language, "home.eventActionUploaded");
    default:
      return action;
  }
}

export function adminEventKindLabel(
  language: AdminUiLanguage | string | null | undefined,
  kind?: string | null,
): string {
  switch (kind) {
    case "sales-order":
      return adminT(language, "home.eventKindSalesOrder");
    case "invoice":
      return adminT(language, "home.eventKindInvoice");
    case "draft":
      return adminT(language, "home.eventKindDraft");
    case "credit-note":
      return adminT(language, "home.eventKindCreditNote");
    case "packing-slip":
      return adminT(language, "home.eventKindPackingSlip");
    case "return":
      return adminT(language, "home.eventKindReturn");
    default:
      return adminT(language, "home.eventKindDocument");
  }
}

export function adminListTabLabel(
  language: AdminUiLanguage | string | null | undefined,
  tabId: string,
): string {
  switch (tabId) {
    case "all":
      return adminT(language, "list.tabAll");
    case "unpaid":
      return adminT(language, "list.tabUnpaid");
    case "paid":
      return adminT(language, "list.tabPaid");
    case "voided":
      return adminT(language, "list.tabVoided");
    case "invoiced":
      return adminT(language, "list.tabInvoiced");
    case "open":
      return adminT(language, "list.tabOpen");
    case "refunded":
      return adminT(language, "list.tabRefunded");
    case "invoice_sent":
      return adminT(language, "list.tabInvoiceSent");
    case "completed":
      return adminT(language, "list.tabCompleted");
    case "unfulfilled":
      return adminT(language, "list.tabUnfulfilled");
    case "partial":
      return adminT(language, "list.tabPartial");
    case "fulfilled":
      return adminT(language, "list.tabFulfilled");
    default:
      return tabId;
  }
}

export function adminIndexColumnLabel(
  language: AdminUiLanguage | string | null | undefined,
  listMode: string,
  columnId: string,
): string {
  if (columnId === "document") {
    switch (listMode) {
      case "invoice":
        return adminT(language, "col.invoice");
      case "draft":
        return adminT(language, "col.draft");
      case "credit-note":
        return adminT(language, "col.creditNote");
      case "packing-slip":
        return adminT(language, "col.packingSlip");
      case "return":
        return adminT(language, "col.return");
      default:
        return adminT(language, "col.salesOrder");
    }
  }

  switch (columnId) {
    case "reference":
      return listMode === "packing-slip" || listMode === "return"
        ? adminT(language, "col.order")
        : adminT(language, "col.reference");
    case "shopifyOrderNumber":
      return adminT(language, "col.order");
    case "salesOrderNumber":
      return adminT(language, "col.salesOrderNumber");
    case "invoiceNumber":
      return adminT(language, "col.invoiceNumber");
    case "date":
      return adminT(language, "col.date");
    case "company":
      return adminT(language, "col.company");
    case "customer":
      return adminT(language, "col.customer");
    case "total":
      if (listMode === "credit-note") return adminT(language, "col.creditTotal");
      if (
        listMode === "invoice" ||
        listMode === "draft"
      ) {
        return adminT(language, "col.amount");
      }
      return adminT(language, "col.total");
    case "balanceDue":
      return adminT(language, "col.balanceDue");
    case "paymentStatus":
      return listMode === "sales-order" || !listMode
        ? adminT(language, "col.paymentStatus")
        : adminT(language, "col.status");
    case "fulfillmentStatus":
      return listMode === "packing-slip" || listMode === "return"
        ? adminT(language, "col.fulfillment")
        : adminT(language, "col.fulfillmentStatus");
    case "invoiced":
      return adminT(language, "col.invoiced");
    case "packingSlip":
      return adminT(language, "col.packingSlip");
    case "creditNote":
      return adminT(language, "col.creditNote");
    case "returnSlip":
      return adminT(language, "col.return");
    case "reason":
      return adminT(language, "col.reason");
    case "actions":
      return adminT(language, "col.actions");
    default:
      return columnId;
  }
}

function normalizeStatusToken(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function adminPaymentStatusLabel(
  language: AdminUiLanguage | string | null | undefined,
  keyOrLabel: string | null | undefined,
): string {
  switch (normalizeStatusToken(keyOrLabel)) {
    case "PENDING":
      return adminT(language, "status.pending");
    case "PAID":
      return adminT(language, "status.paid");
    case "UNPAID":
      return adminT(language, "status.unpaid");
    case "VOIDED":
      return adminT(language, "status.voided");
    case "REFUNDED":
      return adminT(language, "status.refunded");
    case "PARTIALLY_REFUNDED":
      return adminT(language, "status.partiallyRefunded");
    case "PARTIALLY_PAID":
      return adminT(language, "status.partiallyPaid");
    case "AUTHORIZED":
      return adminT(language, "status.authorized");
    case "EXPIRED":
      return adminT(language, "status.expired");
    default:
      return keyOrLabel?.trim() || "";
  }
}

export function adminFulfillmentStatusLabel(
  language: AdminUiLanguage | string | null | undefined,
  keyOrLabel: string | null | undefined,
): string {
  switch (normalizeStatusToken(keyOrLabel)) {
    case "FULFILLED":
      return adminT(language, "status.fulfilled");
    case "UNFULFILLED":
      return adminT(language, "status.unfulfilled");
    case "PARTIALLY_FULFILLED":
      return adminT(language, "status.partiallyFulfilled");
    case "ON_HOLD":
      return adminT(language, "status.onHold");
    case "IN_PROGRESS":
      return adminT(language, "status.inProgress");
    case "REQUEST_DECLINED":
      return adminT(language, "status.requestDeclined");
    case "PENDING_FULFILLMENT":
      return adminT(language, "status.pendingFulfillment");
    default:
      return keyOrLabel?.trim() || "";
  }
}
