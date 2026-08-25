/**
 * Template editor admin UI chrome (tabs, labels, help, banners).
 * Does NOT change document/preview language — that stays on settings.language.
 */
import {
  normalizeAdminUiLanguage,
  type AdminUiLanguage,
} from "./admin-i18n";
import { adminLocaleMessage } from "./admin-locale-store";

export type TemplateEditorMessageKey =
  | "te.tab.general"
  | "te.tab.transaction"
  | "te.tab.table"
  | "te.tab.total"
  | "te.tab.appearance"
  | "te.tab.other"
  | "te.pageTitle"
  | "te.breadcrumbTemplates"
  | "te.save"
  | "te.saving"
  | "te.discard"
  | "te.savedToast"
  | "te.doc.sales-order"
  | "te.doc.invoice"
  | "te.doc.draft"
  | "te.doc.credit-note"
  | "te.doc.packing-slip"
  | "te.doc.return"
  | "te.general.title"
  | "te.general.language"
  | "te.general.languageHelp"
  | "te.general.date"
  | "te.general.dateHelp"
  | "te.general.currency"
  | "te.general.currencyHelp"
  | "te.general.paperSize"
  | "te.general.orientation"
  | "te.general.portrait"
  | "te.general.landscape"
  | "te.general.margins"
  | "te.side.top"
  | "te.side.bottom"
  | "te.side.left"
  | "te.side.right"
  | "te.pos.left"
  | "te.pos.right"
  | "te.pos.center"
  | "te.meta.boxed"
  | "te.meta.outline"
  | "te.meta.plain"
  | "te.meta.strip"
  | "te.meta.card"
  | "te.meta.inverted"
  | "te.tx.title"
  | "te.tx.orgDetails"
  | "te.tx.orgHelp"
  | "te.tx.storeNameUnset"
  | "te.tx.editStore"
  | "te.tx.orgLogoAlt"
  | "te.tx.logoFromStore"
  | "te.tx.logoSize"
  | "te.tx.noLogo"
  | "te.tx.uploadLogo"
  | "te.tx.logoPosition"
  | "te.tx.metaStyle"
  | "te.tx.metaHelpPacking"
  | "te.tx.metaHelpDefault"
  | "te.tx.dragBlocks"
  | "te.tx.billing"
  | "te.tx.shipping"
  | "te.tx.customer"
  | "te.tx.document"
  | "te.tx.showBilling"
  | "te.tx.showShipping"
  | "te.tx.showCustomer"
  | "te.tx.dragFields"
  | "te.tx.dragFieldsCustomer"
  | "te.tx.sectionTitle"
  | "te.tx.sectionTitleHelp"
  | "te.tx.visibleFields"
  | "te.tx.customerMetafields"
  | "te.tx.customerMetafieldsHelp"
  | "te.tx.loadingMetafields"
  | "te.tx.noMetafields"
  | "te.tx.customLabel"
  | "te.tx.customLabelHelp"
  | "te.tx.docLabelsHelp"
  | "te.tx.documentTitle"
  | "te.tx.orderNumberLabel"
  | "te.tx.dateLabel"
  | "te.tx.referenceLabel"
  | "te.tx.shopifyOrderLabel"
  | "te.tx.expectedShipLabel"
  | "te.tx.paymentMethodLabel"
  | "te.tx.deliveryMethodLabel"
  | "te.tx.deliveryMethodPickupLabel"
  | "te.tx.deliveryMethodShippingLabel"
  | "te.tx.showExpectedShip"
  | "te.tx.showPaymentMethod"
  | "te.tx.showDeliveryMethod"
  | "te.tx.showReference"
  | "te.tx.showReferenceHelp"
  | "te.tx.showShopifyOrder"
  | "te.tx.showShopifyOrderHelp"
  | "te.field.company"
  | "te.field.name"
  | "te.field.fullName"
  | "te.field.address"
  | "te.field.vat"
  | "te.field.phone"
  | "te.field.email"
  | "te.showField"
  | "te.appearance.title"
  | "te.appearance.font"
  | "te.appearance.cat.general"
  | "te.appearance.cat.documentTitle"
  | "te.appearance.cat.organization"
  | "te.appearance.cat.addresses"
  | "te.appearance.cat.table"
  | "te.appearance.cat.totals"
  | "te.appearance.cat.paidBalance"
  | "te.appearance.cat.taxSummary"
  | "te.appearance.cat.notesTerms"
  | "te.size.small"
  | "te.size.medium"
  | "te.size.large"
  | "te.table.title"
  | "te.table.field"
  | "te.table.widthPct"
  | "te.table.label"
  | "te.table.width"
  | "te.table.showCompare"
  | "te.table.showBelowTitle"
  | "te.table.showImage"
  | "te.table.refreshHint"
  | "te.table.refresh"
  | "te.table.manageMetafields"
  | "te.table.loadingMetafields"
  | "te.table.setupTitle"
  | "te.table.setupBody"
  | "te.table.setupStep1"
  | "te.table.setupStep2"
  | "te.table.setupStep3"
  | "te.table.createMetafield"
  | "te.table.selectMetafields"
  | "te.table.customField"
  | "te.col.number"
  | "te.col.item"
  | "te.col.custom"
  | "te.col.sku"
  | "te.col.barcode"
  | "te.col.qty"
  | "te.col.rate"
  | "te.col.discount"
  | "te.col.discountPct"
  | "te.col.taxPct"
  | "te.col.tax"
  | "te.col.amount"
  | "te.total.title"
  | "te.total.subTotal"
  | "te.total.showItemsPacked"
  | "te.total.showQuantity"
  | "te.total.itemsPackedLabel"
  | "te.total.itemsInTotalLabel"
  | "te.total.showTaxDetails"
  | "te.total.discount"
  | "te.total.shipping"
  | "te.total.totalTax"
  | "te.total.totalLabel"
  | "te.total.paidAmount"
  | "te.total.balanceDue"
  | "te.total.paymentStatusStyle"
  | "te.total.showTaxSummary"
  | "te.total.currencyHint"
  | "te.total.taxSummaryTitle"
  | "te.total.taxDetails"
  | "te.total.taxableAmount"
  | "te.total.showTaxableAmount"
  | "te.total.taxAmount"
  | "te.total.showTaxAmount"
  | "te.total.totalAmount"
  | "te.total.showTotalAmount"
  | "te.total.rowTotal"
  | "te.other.title"
  | "te.other.notesLabel"
  | "te.other.preferOrderNote"
  | "te.other.preferOrderNoteHelp"
  | "te.other.defaultNotes"
  | "te.other.defaultNotesHelp"
  | "te.other.termsLabel"
  | "te.other.defaultTerms"
  | "te.other.showSignature"
  | "te.other.showStamp"
  | "te.payStyle1"
  | "te.payStyle2"
  | "te.payStyle3"
  | "te.payStyle4"
  | "te.payStyle5"
  | "te.color.background"
  | "te.color.text"
  | "te.color.muted"
  | "te.color.heading"
  | "te.color.orderNumber"
  | "te.color.organization"
  | "te.color.company"
  | "te.color.name"
  | "te.color.details"
  | "te.color.tableHeader"
  | "te.color.tableText"
  | "te.color.tableBorder"
  | "te.color.unitPrice"
  | "te.color.comparePrice"
  | "te.color.totalHighlight"
  | "te.color.label"
  | "te.color.value"
  | "te.color.border"
  | "te.color.title"
  | "te.color.headerBg"
  | "te.color.headerText"
  | "te.color.bodyText"
  | "te.color.notesLabel"
  | "te.color.notesText"
  | "te.color.termsLabel"
  | "te.color.termsText"
  | "te.sizeLabel.title"
  | "te.sizeLabel.orderNum"
  | "te.sizeLabel.dateRef"
  | "te.sizeLabel.org"
  | "te.sizeLabel.address"
  | "te.sizeLabel.label"
  | "te.sizeLabel.company"
  | "te.sizeLabel.name"
  | "te.sizeLabel.details"
  | "te.sizeLabel.tableHeader"
  | "te.sizeLabel.tableBody"
  | "te.sizeLabel.totals"
  | "te.sizeLabel.value"
  | "te.sizeLabel.header"
  | "te.sizeLabel.body"
  | "te.sizeLabel.notesLabel"
  | "te.sizeLabel.notesText"
  | "te.sizeLabel.termsLabel"
  | "te.sizeLabel.termsText"
  | "te.hex"
  | "te.dragReorder"
  | "te.hideLabelFor"
  | "te.editLabelFor"
  | "te.pickColor"
  | "te.preview"
  | "te.loadingPreview";

export function teT(
  language: AdminUiLanguage | string | null | undefined,
  key: TemplateEditorMessageKey,
): string {
  const lang = normalizeAdminUiLanguage(language);
  return adminLocaleMessage(lang, key);
}

export function teTf(
  language: AdminUiLanguage | string | null | undefined,
  key: TemplateEditorMessageKey,
  vars: Record<string, string>,
): string {
  let text = teT(language, key);
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

const SECTION_TAB_KEYS: Record<string, TemplateEditorMessageKey> = {
  general: "te.tab.general",
  transaction: "te.tab.transaction",
  table: "te.tab.table",
  total: "te.tab.total",
  appearance: "te.tab.appearance",
  other: "te.tab.other",
};

export function teSectionTabLabel(
  language: AdminUiLanguage | string | null | undefined,
  id: string,
): string {
  const key = SECTION_TAB_KEYS[id];
  return key ? teT(language, key) : id;
}

export function teDocumentBreadcrumb(
  language: AdminUiLanguage | string | null | undefined,
  documentType: string,
): string {
  const key = `te.doc.${documentType}` as TemplateEditorMessageKey;
  return teT(language, key);
}

const FIELD_KEYS: Record<string, TemplateEditorMessageKey> = {
  company: "te.field.company",
  name: "te.field.fullName",
  address: "te.field.address",
  vatNumber: "te.field.vat",
  phone: "te.field.phone",
  email: "te.field.email",
};

export function teCustomerFieldLabel(
  language: AdminUiLanguage | string | null | undefined,
  key: string,
  fallback: string,
): string {
  const msgKey = FIELD_KEYS[key];
  return msgKey ? teT(language, msgKey) : fallback;
}

const COL_KEYS: Record<string, TemplateEditorMessageKey> = {
  number: "te.col.number",
  item: "te.col.item",
  custom: "te.col.custom",
  sku: "te.col.sku",
  barcode: "te.col.barcode",
  quantity: "te.col.qty",
  rate: "te.col.rate",
  discount: "te.col.discount",
  discountPercentage: "te.col.discountPct",
  taxPercentage: "te.col.taxPct",
  taxAmount: "te.col.tax",
  amount: "te.col.amount",
};

export function teColumnFieldLabel(
  language: AdminUiLanguage | string | null | undefined,
  key: string,
  fallback: string,
): string {
  const msgKey = COL_KEYS[key];
  return msgKey ? teT(language, msgKey) : fallback;
}
