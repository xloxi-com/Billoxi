import type { StoreDetails } from "./store-details";
import { formatStoreAddressLines } from "./store-details";
import { normalizeTemplateLanguage } from "./template-labels";

export type PaymentStatusStyle =
  | "boxed"
  | "underTotal"
  | "inTotals"
  | "splitPanels"
  | "balanceBanner";

export type SalesOrderLogoPosition = "left" | "right" | "center";

export type SalesOrderMetaStyle =
  | "boxed"
  | "outline"
  | "plain"
  | "strip"
  | "card"
  | "inverted";

export const PAYMENT_STATUS_STYLES: ReadonlyArray<{
  value: PaymentStatusStyle;
  label: string;
}> = [
  { value: "boxed", label: "Style 1 – Boxed" },
  { value: "underTotal", label: "Style 2 – Under Total" },
  { value: "inTotals", label: "Style 3 – In totals list (under Total)" },
  { value: "splitPanels", label: "Style 4 – Split panels" },
  { value: "balanceBanner", label: "Style 5 – Balance banner" },
];

export function normalizePaymentStatusStyle(
  value: unknown,
  fallback: PaymentStatusStyle = "inTotals",
): PaymentStatusStyle {
  if (
    value === "boxed" ||
    value === "underTotal" ||
    value === "inTotals" ||
    value === "splitPanels" ||
    value === "balanceBanner"
  ) {
    return value;
  }
  return fallback;
}

export type TemplateAppearance = {
  textColor: string;
  headingColor: string;
  mutedColor: string;
  organizationColor: string;
  companyColor: string;
  customerNameColor: string;
  customerDetailsColor: string;
  orderNumberColor: string;
  tableHeaderBackground: string;
  tableHeaderText: string;
  tableBorderColor: string;
  totalHighlightBackground: string;
  /** Unit / rate price text color */
  unitPriceColor: string;
  /** Strikethrough compare price color */
  comparePriceColor: string;
  bodyFontSize: number;
  titleFontSize: number;
  organizationFontSize: number;
  /** Store address / phone / email under organization name */
  organizationDetailsFontSize: number;
  companyFontSize: number;
  customerNameFontSize: number;
  customerDetailsFontSize: number;
  /** Bill To / Ship To / Customer Details section labels only */
  addressLabelFontSize: number;
  orderNumberFontSize: number;
  metadataFontSize: number;
  tableHeaderFontSize: number;
  tableBodyFontSize: number;
  totalsFontSize: number;
  paymentStatusLabelFontSize: number;
  paymentStatusValueFontSize: number;
  taxSummaryTitleFontSize: number;
  taxSummaryHeaderFontSize: number;
  taxSummaryBodyFontSize: number;
  notesLabelFontSize: number;
  notesBodyFontSize: number;
  termsLabelFontSize: number;
  termsBodyFontSize: number;
  notesLabelColor: string;
  notesBodyColor: string;
  termsLabelColor: string;
  termsBodyColor: string;
  paymentStatusLabelColor: string;
  paymentStatusValueColor: string;
  paymentStatusBorderColor: string;
  taxSummaryTitleColor: string;
  taxSummaryHeaderBackground: string;
  taxSummaryHeaderText: string;
  taxSummaryTextColor: string;
  taxSummaryBorderColor: string;
};

export type TemplateEditorSettings = {
  name: string;
  /** Document label language (Bill To, totals, columns, etc.). */
  language?: string;
  paperSize: "A5" | "A4" | "Letter";
  orientation: "portrait" | "landscape";
  margins: { top: number; bottom: number; left: number; right: number };
  /**
   * Bumps when premium template look (colors/fonts/finance blocks) is applied.
   * Used to upgrade older saved customizations once without wiping later edits.
   */
  designVersion?: number;
  /** @deprecated Prefer taxSummary.enabled */
  showTaxSummaryTable?: boolean;
  taxSummary: {
    enabled: boolean;
    title: string;
    detailsLabel: string;
    showTaxableAmount: boolean;
    taxableAmountLabel: string;
    showTaxAmount: boolean;
    taxAmountLabel: string;
    showTotalAmount: boolean;
    totalAmountLabel: string;
    totalLabel: string;
  };
  fontFamily: string;
  backgroundColor: string;
  appearance: TemplateAppearance;
  logoDataUrl?: string;
  logoFileName?: string;
  logoSize: number;
  /** Header logo placement — gated by template admin capabilities. */
  logoPosition: SalesOrderLogoPosition;
  /** Order Date / Ref# / Payment Method block style. */
  metaStyle: SalesOrderMetaStyle;
  header: {
    showLogo: boolean;
    showOrganization: boolean;
    /** @deprecated Prefer showBilling / showShipping / showCustomerDetails */
    showCustomer: boolean;
    showBilling: boolean;
    showShipping: boolean;
    showCustomerDetails: boolean;
    showDocumentTitle: boolean;
    showOrderNumber: boolean;
    showDate: boolean;
    showExpectedShipmentDate: boolean;
    showPaymentMethod: boolean;
  };
  billingDetails: Array<{ key: string; enabled: boolean; label: string }>;
  shippingDetails: Array<{ key: string; enabled: boolean; label: string }>;
  /** Third column: Customer Details (separate from Bill To / Ship To). */
  customerBlockDetails: Array<{ key: string; enabled: boolean; label: string }>;
  transactionLabels: {
    organization: string;
    customer: string;
    shipping: string;
    customerDetails: string;
    documentTitle: string;
    orderNumber: string;
    date: string;
    reference: string;
    expectedShipmentDate: string;
    paymentMethod: string;
  };
  numbering: {
    prefix: string;
    startingNumber: string;
    suffix: string;
  };
  columns: Array<{
    key: string;
    enabled: boolean;
    width: number;
    label: string;
    showUnit?: boolean;
    showComparePrice?: boolean;
    showImage?: boolean;
    imageSize?: "small" | "medium" | "large";
  }>;
  selectedCustomFields: Array<{ id: string; name: string }>;
  totals: {
    showSubtotal: boolean;
    subtotalLabel: string;
    showQuantity: boolean;
    itemsInTotalLabel: string;
    showTaxLines: boolean;
    showDiscountAmount: boolean;
    discountAmountLabel: string;
    showShippingPrice: boolean;
    shippingPriceLabel: string;
    showVatAmount: boolean;
    vatAmountLabel: string;
    showPaidAmount: boolean;
    paidAmountLabel: string;
    showBalanceDue: boolean;
    balanceDueLabel: string;
    refundedAmountLabel: string;
    paymentStatusStyle: PaymentStatusStyle;
    /** @deprecated Prefer showDiscountAmount */
    showDiscount?: boolean;
    /** @deprecated Prefer discountAmountLabel */
    discountLabel?: string;
    /** @deprecated Prefer showVatAmount */
    showTax?: boolean;
    /** @deprecated Prefer vatAmountLabel */
    taxLabel?: string;
    totalLabel: string;
  };
  notesLabel: string;
  notes: string;
  termsLabel: string;
  terms: string;
  showSignature: boolean;
  showStamp: boolean;
};

export const defaultTemplateAppearance: TemplateAppearance = {
  textColor: "#303030",
  headingColor: "#303030",
  mutedColor: "#737373",
  organizationColor: "#B90128",
  companyColor: "#B90128",
  customerNameColor: "#303030",
  customerDetailsColor: "#303030",
  orderNumberColor: "#303030",
  tableHeaderBackground: "#B90128",
  tableHeaderText: "#FFFFFF",
  tableBorderColor: "#DEDEDE",
  totalHighlightBackground: "#F2F2F2",
  unitPriceColor: "#303030",
  comparePriceColor: "#737373",
  bodyFontSize: 12,
  titleFontSize: 28,
  organizationFontSize: 12,
  organizationDetailsFontSize: 12,
  companyFontSize: 12,
  customerNameFontSize: 12,
  customerDetailsFontSize: 12,
  addressLabelFontSize: 12,
  orderNumberFontSize: 12,
  metadataFontSize: 12,
  tableHeaderFontSize: 12,
  tableBodyFontSize: 12,
  totalsFontSize: 12,
  paymentStatusLabelFontSize: 12,
  paymentStatusValueFontSize: 12,
  taxSummaryTitleFontSize: 12,
  taxSummaryHeaderFontSize: 12,
  taxSummaryBodyFontSize: 12,
  notesLabelFontSize: 12,
  notesBodyFontSize: 12,
  termsLabelFontSize: 12,
  termsBodyFontSize: 12,
  notesLabelColor: "#303030",
  notesBodyColor: "#303030",
  termsLabelColor: "#303030",
  termsBodyColor: "#303030",
  paymentStatusLabelColor: "#B90128",
  paymentStatusValueColor: "#303030",
  paymentStatusBorderColor: "#CFCFCF",
  taxSummaryTitleColor: "#303030",
  taxSummaryHeaderBackground: "#B90128",
  taxSummaryHeaderText: "#FFFFFF",
  taxSummaryTextColor: "#303030",
  taxSummaryBorderColor: "#DEDEDE",
};

function clampAppearanceFontSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const size = Number(value);
  return Number.isFinite(size) ? Math.min(max, Math.max(min, size)) : fallback;
}

export function appearanceCssVars(
  appearance: TemplateAppearance,
): Record<string, string> {
  return {
    color: appearance.textColor,
    fontSize: `${appearance.bodyFontSize}px`,
    ["--doc-text-color"]: appearance.textColor,
    ["--doc-heading-color"]: appearance.headingColor,
    ["--doc-muted-color"]: appearance.mutedColor,
    ["--doc-organization-color"]: appearance.organizationColor,
    ["--doc-company-color"]: appearance.companyColor,
    ["--doc-customer-name-color"]:
      appearance.customerNameColor ?? appearance.textColor,
    ["--doc-customer-details-color"]:
      appearance.customerDetailsColor ?? appearance.textColor,
    ["--doc-order-number-color"]: appearance.orderNumberColor,
    ["--doc-title-size"]: `${appearance.titleFontSize}px`,
    ["--doc-organization-size"]: `${appearance.organizationFontSize}px`,
    ["--doc-organization-details-size"]: `${appearance.organizationDetailsFontSize ?? appearance.bodyFontSize}px`,
    ["--doc-company-size"]: `${appearance.companyFontSize}px`,
    ["--doc-customer-name-size"]: `${appearance.customerNameFontSize}px`,
    ["--doc-customer-details-size"]: `${appearance.customerDetailsFontSize}px`,
    ["--doc-address-label-size"]: `${appearance.addressLabelFontSize ?? appearance.bodyFontSize}px`,
    ["--doc-order-number-size"]: `${appearance.orderNumberFontSize}px`,
    ["--doc-metadata-size"]: `${appearance.metadataFontSize}px`,
    ["--doc-table-header-size"]: `${appearance.tableHeaderFontSize}px`,
    ["--doc-table-body-size"]: `${appearance.tableBodyFontSize}px`,
    ["--doc-totals-size"]: `${appearance.totalsFontSize}px`,
    ["--doc-payment-status-label-size"]: `${appearance.paymentStatusLabelFontSize ?? appearance.totalsFontSize}px`,
    ["--doc-payment-status-value-size"]: `${appearance.paymentStatusValueFontSize ?? appearance.totalsFontSize}px`,
    ["--doc-payment-status-label-color"]:
      appearance.paymentStatusLabelColor ?? appearance.organizationColor,
    ["--doc-payment-status-value-color"]:
      appearance.paymentStatusValueColor ?? appearance.textColor,
    ["--doc-payment-status-border"]:
      appearance.paymentStatusBorderColor ?? appearance.tableBorderColor,
    ["--doc-tax-summary-title-size"]: `${appearance.taxSummaryTitleFontSize ?? appearance.tableHeaderFontSize}px`,
    ["--doc-tax-summary-header-size"]: `${appearance.taxSummaryHeaderFontSize ?? appearance.tableHeaderFontSize}px`,
    ["--doc-tax-summary-body-size"]: `${appearance.taxSummaryBodyFontSize ?? appearance.tableBodyFontSize}px`,
    ["--doc-notes-label-size"]: `${appearance.notesLabelFontSize}px`,
    ["--doc-notes-body-size"]: `${appearance.notesBodyFontSize}px`,
    ["--doc-terms-label-size"]: `${appearance.termsLabelFontSize}px`,
    ["--doc-terms-body-size"]: `${appearance.termsBodyFontSize}px`,
    ["--doc-notes-label-color"]: appearance.notesLabelColor,
    ["--doc-notes-body-color"]: appearance.notesBodyColor,
    ["--doc-terms-label-color"]: appearance.termsLabelColor,
    ["--doc-terms-body-color"]: appearance.termsBodyColor,
    ["--doc-tax-summary-title-color"]:
      appearance.taxSummaryTitleColor ?? appearance.headingColor,
    ["--doc-tax-summary-header-bg"]:
      appearance.taxSummaryHeaderBackground ?? appearance.tableHeaderBackground,
    ["--doc-tax-summary-header-text"]:
      appearance.taxSummaryHeaderText ?? appearance.tableHeaderText,
    ["--doc-tax-summary-text-color"]:
      appearance.taxSummaryTextColor ?? appearance.textColor,
    ["--doc-tax-summary-border"]:
      appearance.taxSummaryBorderColor ?? appearance.tableBorderColor,
    ["--doc-table-header-bg"]: appearance.tableHeaderBackground,
    ["--doc-table-header-text"]: appearance.tableHeaderText,
    ["--doc-table-border"]: appearance.tableBorderColor,
    ["--doc-total-bg"]: appearance.totalHighlightBackground,
    ["--doc-unit-price-color"]:
      appearance.unitPriceColor ?? appearance.textColor,
    ["--doc-compare-price-color"]:
      appearance.comparePriceColor ?? appearance.mutedColor,
  };
}

export type CustomerOrderListItem = {
  id: string;
  name: string;
  documentNumber: string | null;
  customer: string;
  createdAt: string;
  total: string;
  currencyCode: string;
  paymentStatus: string | null;
  invoiced: boolean;
  packingSlip?: boolean;
};

export type SalesOrderDocumentData = {
  id: string;
  /** Shopify order name, e.g. #1008 */
  name: string;
  /** Template sales-order document number, e.g. SO-0001 */
  documentNumber?: string;
  /**
   * Value shown as Ref# on the document.
   * Invoice documents use the sales-order number (SO-*); otherwise Shopify name.
   */
  referenceNumber?: string;
  /**
   * ISO date used for the document date line (e.g. invoice date).
   * Falls back to createdAt when omitted.
   */
  documentDate?: string;
  createdAt: string;
  /** Formatted expected shipment / fulfill-by date when available. */
  expectedShipmentDate: string;
  /** Payment gateway / method label, e.g. "Shopify Payments". */
  paymentMethod: string;
  email: string | null;
  phone: string | null;
  customerId: string | null;
  customerName: string;
  billing: {
    company: string;
    name: string;
    address: string[];
    phone: string;
    email: string;
  };
  shipping: {
    company: string;
    name: string;
    address: string[];
    phone: string;
    email: string;
  };
  /** Shopify customer / account details for the Customer Details column. */
  customer: {
    company: string;
    name: string;
    address: string[];
    phone: string;
    email: string;
  };
  terms: string;
  lineItems: Array<{
    title: string;
    /** Variant label, e.g. "Large / Red". Empty for default variant. */
    variantTitle: string;
    /** Product / variant image URL when available. */
    imageUrl: string;
    quantity: string;
    rate: string;
    /** Variant compare-at price when available. */
    compareAtPrice: string;
    discount: string;
    /** Line discount as percent of original line total, e.g. "10.00%". */
    discountPercentage: string;
    /** Combined line tax rate, e.g. "20.00%". */
    taxPercentage: string;
    /** Total tax allocated to the line. */
    taxAmount: string;
    amount: string;
    sku: string;
  }>;
  subtotal: string;
  discount: string;
  shippingPrice: string;
  tax: string;
  total: string;
  /** Amount already paid / received on the order. */
  paidAmount: string;
  /** Remaining balance due. */
  balanceDue: string;
  /** Amount refunded to the customer (from Shopify totalRefundedSet). */
  refundedAmount: string;
  /** Shopify financial status, e.g. PAID, REFUNDED. */
  financialStatus?: string | null;
  currencyCode: string;
  /** Grouped tax rows for the optional tax summary table. */
  taxSummary: Array<{
    title: string;
    rate: string;
    taxableAmount: string;
    taxAmount: string;
  }>;
};

export const DEFAULT_SALES_ORDER_TEMPLATE_ID = "sales-standard";

/** Bump when premium presets get new per-template colors / look. */
export const PREMIUM_DESIGN_VERSION = 6;
export const SALES_ORDER_TEMPLATE_STORAGE_KEY =
  "invoice-app:selected-template:sales-order";

/** Visual layout modifier applied via `.live-document--{layout}` CSS. */
export type SalesOrderLayoutStyle =
  | "standard"
  | "modern"
  | "classic"
  | "compact"
  | "minimal"
  | "european"
  | "japanese"
  | "bold"
  | "professional"
  | "studio"
  | "horizon"
  | "ledger"
  | "folio"
  | "spectrum"
  | "apex";

/** Per-template admin options — only listed controls appear in the editor. */
export type TemplateAdminCapabilities = {
  /** Table → Show Image / image size */
  productImages: boolean;
  /** Transaction → Logo position control */
  logoPosition: boolean;
  logoPositions?: readonly SalesOrderLogoPosition[];
  /** Transaction → Details box style (Order Date / Ref# / Payment) */
  metaStyle: boolean;
  metaStyles?: readonly SalesOrderMetaStyle[];
  /** Total → payment status style radios (subset). Empty/omit = all. */
  paymentStatusStyles?: readonly PaymentStatusStyle[];
  /** Total → Tax Summary table controls */
  taxSummary?: boolean;
  /** Total → Paid Amount / Balance Due toggles */
  paymentAmounts?: boolean;
};

export type SalesOrderTemplatePreset = {
  id: string;
  name: string;
  description: string;
  accent: string;
  alignment: "left" | "center" | "right";
  layout: SalesOrderLayoutStyle;
  logoPosition: SalesOrderLogoPosition;
  metaStyle: SalesOrderMetaStyle;
  admin: TemplateAdminCapabilities;
  showProductImages?: boolean;
  productImageSize?: "small" | "medium" | "large";
  /** Tax Summary table on by default (classic / european / professional only). */
  showTaxSummary?: boolean;
  /** Premium templates: Paid Amount row on by default. */
  showPaidAmount?: boolean;
  /** Premium templates: Balance Due row on by default. */
  showBalanceDue?: boolean;
  fontFamily: string;
  backgroundColor: string;
  paymentStatusStyle: PaymentStatusStyle;
  logoSize?: number;
  margins?: Partial<TemplateEditorSettings["margins"]>;
  appearance: Partial<TemplateAppearance>;
};

function brandAppearance(
  brand: string,
  overrides: Partial<TemplateAppearance> = {},
): Partial<TemplateAppearance> {
  return {
    organizationColor: brand,
    companyColor: brand,
    tableHeaderBackground: brand,
    tableHeaderText: "#FFFFFF",
    taxSummaryHeaderBackground: brand,
    taxSummaryHeaderText: "#FFFFFF",
    paymentStatusLabelColor: brand,
    ...overrides,
  };
}

function adminCaps(
  partial: TemplateAdminCapabilities,
): TemplateAdminCapabilities {
  return partial;
}

/** 15 premium sales-order designs — distinct layouts; admin options gated per template. */
export const SALES_ORDER_TEMPLATE_PRESETS: readonly SalesOrderTemplatePreset[] =
  [
    {
      id: "sales-standard",
      name: "Standard",
      description: "Original sales order layout — your saved settings stay as set.",
      accent: "#B90128",
      alignment: "right",
      layout: "standard",
      logoPosition: "left",
      metaStyle: "boxed",
      // Keep Standard unchanged: no extra design controls; use classic defaults.
      admin: adminCaps({
        productImages: true,
        logoPosition: false,
        metaStyle: false,
        taxSummary: true,
        paymentAmounts: true,
      }),
      showProductImages: false,
      showPaidAmount: false,
      showBalanceDue: true,
      fontFamily: "Inter, system-ui, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "inTotals",
      appearance: brandAppearance("#B90128"),
    },
    {
      id: "sales-modern",
      name: "Modern",
      description: "Accent bar header, product images, and paid/due amounts.",
      accent: "#2563EB",
      alignment: "right",
      layout: "modern",
      logoPosition: "left",
      metaStyle: "card",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["card", "boxed", "strip"],
        paymentStatusStyles: ["boxed", "inTotals", "splitPanels"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "medium",
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'DM Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "boxed",
      appearance: brandAppearance("#2563EB", {
        textColor: "#1E293B",
        headingColor: "#0F172A",
        mutedColor: "#64748B",
        totalHighlightBackground: "#EFF6FF",
        tableBorderColor: "#DBEAFE",
        paymentStatusBorderColor: "#93C5FD",
        taxSummaryBorderColor: "#BFDBFE",
      }),
    },
    {
      id: "sales-classic",
      name: "Classic",
      description: "Editorial serif with full tax summary and balances.",
      accent: "#171717",
      alignment: "left",
      layout: "classic",
      logoPosition: "right",
      metaStyle: "plain",
      admin: adminCaps({
        productImages: false,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["plain", "outline"],
        paymentStatusStyles: ["underTotal", "inTotals"],
        taxSummary: true,
        paymentAmounts: true,
      }),
      showProductImages: false,
      showTaxSummary: true,
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "Georgia, 'Times New Roman', serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "underTotal",
      appearance: brandAppearance("#171717", {
        textColor: "#262626",
        headingColor: "#0A0A0A",
        mutedColor: "#737373",
        tableBorderColor: "#D4D4D4",
        totalHighlightBackground: "#FAFAFA",
        tableHeaderBackground: "#171717",
        taxSummaryHeaderBackground: "#171717",
        paymentStatusLabelColor: "#171717",
      }),
    },
    {
      id: "sales-compact",
      name: "Compact",
      description: "Dense premium layout with thumbs and payment status.",
      accent: "#D97706",
      alignment: "center",
      layout: "compact",
      logoPosition: "left",
      metaStyle: "outline",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["outline", "plain", "boxed"],
        paymentStatusStyles: ["inTotals", "underTotal", "boxed"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "small",
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'IBM Plex Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "inTotals",
      logoSize: 36,
      appearance: brandAppearance("#D97706", {
        textColor: "#292524",
        headingColor: "#78350F",
        mutedColor: "#A8A29E",
        totalHighlightBackground: "#FFFBEB",
        tableBorderColor: "#FDE68A",
      }),
    },
    {
      id: "sales-minimal",
      name: "Minimal",
      description: "Soft ocean accents, airy spacing, and a calm totals block.",
      accent: "#0E7490",
      alignment: "left",
      layout: "minimal",
      logoPosition: "left",
      metaStyle: "card",
      admin: adminCaps({
        productImages: false,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["card", "plain", "outline"],
        paymentStatusStyles: ["inTotals", "underTotal", "boxed"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: false,
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'DM Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "inTotals",
      appearance: brandAppearance("#0E7490", {
        organizationColor: "#155E75",
        companyColor: "#0F172A",
        textColor: "#334155",
        headingColor: "#0F172A",
        mutedColor: "#94A3B8",
        orderNumberColor: "#0E7490",
        customerNameColor: "#0F172A",
        tableHeaderBackground: "#0E7490",
        tableHeaderText: "#FFFFFF",
        tableBorderColor: "#CBD5E1",
        totalHighlightBackground: "#ECFEFF",
        unitPriceColor: "#0F172A",
        comparePriceColor: "#94A3B8",
        paymentStatusLabelColor: "#0E7490",
        paymentStatusBorderColor: "#67E8F9",
        taxSummaryHeaderBackground: "#ECFEFF",
        taxSummaryHeaderText: "#155E75",
        taxSummaryBorderColor: "#A5F3FC",
      }),
    },
    {
      id: "sales-european",
      name: "European",
      description: "Logo right / title left — tax summary + balance banner.",
      accent: "#0F766E",
      alignment: "left",
      layout: "european",
      logoPosition: "right",
      metaStyle: "outline",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["outline", "boxed", "card"],
        paymentStatusStyles: ["balanceBanner", "underTotal", "inTotals"],
        taxSummary: true,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "medium",
      showTaxSummary: true,
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'Open Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "balanceBanner",
      appearance: brandAppearance("#0F766E", {
        textColor: "#134E4A",
        headingColor: "#134E4A",
        mutedColor: "#5F8F8A",
        totalHighlightBackground: "#F0FDFA",
        tableBorderColor: "#99F6E4",
        paymentStatusBorderColor: "#2DD4BF",
      }),
    },
    {
      id: "sales-japanese",
      name: "Japanese",
      description: "Centered premium layout with boxed payment status.",
      accent: "#4F46E5",
      alignment: "center",
      layout: "japanese",
      logoPosition: "center",
      metaStyle: "boxed",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["center", "left", "right"],
        metaStyle: true,
        metaStyles: ["boxed", "plain", "card"],
        paymentStatusStyles: ["boxed", "inTotals", "splitPanels"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "medium",
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'IBM Plex Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "boxed",
      appearance: brandAppearance("#4F46E5", {
        textColor: "#312E81",
        headingColor: "#312E81",
        mutedColor: "#818CF8",
        totalHighlightBackground: "#EEF2FF",
        tableBorderColor: "#C7D2FE",
      }),
    },
    {
      id: "sales-bold",
      name: "Bold",
      description: "Color title band with inverted details and balances.",
      accent: "#DC2626",
      alignment: "left",
      layout: "bold",
      logoPosition: "right",
      metaStyle: "inverted",
      admin: adminCaps({
        productImages: false,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["inverted", "strip", "boxed"],
        paymentStatusStyles: ["balanceBanner", "boxed", "inTotals"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: false,
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'Work Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "balanceBanner",
      appearance: brandAppearance("#DC2626", {
        textColor: "#1C1917",
        headingColor: "#18181B",
        mutedColor: "#A8A29E",
        totalHighlightBackground: "#FEF2F2",
        tableBorderColor: "#FECACA",
      }),
    },
    {
      id: "sales-professional",
      name: "Professional",
      description: "Navy B2B with tax summary, paid & balance due.",
      accent: "#1E3A8A",
      alignment: "left",
      layout: "professional",
      logoPosition: "right",
      metaStyle: "card",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["card", "outline", "boxed"],
        paymentStatusStyles: ["underTotal", "inTotals", "splitPanels"],
        taxSummary: true,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "medium",
      showTaxSummary: true,
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'IBM Plex Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "underTotal",
      appearance: brandAppearance("#1E3A8A", {
        textColor: "#1E293B",
        headingColor: "#0F172A",
        mutedColor: "#64748B",
        tableBorderColor: "#BFDBFE",
        totalHighlightBackground: "#EFF6FF",
        paymentStatusLabelColor: "#1E3A8A",
      }),
    },
    {
      id: "sales-studio",
      name: "Studio",
      description: "Violet title with logo top-right and payment panels.",
      accent: "#7C3AED",
      alignment: "left",
      layout: "studio",
      logoPosition: "right",
      metaStyle: "strip",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["strip", "card", "boxed"],
        paymentStatusStyles: ["boxed", "splitPanels", "inTotals"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "medium",
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'Work Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "boxed",
      appearance: brandAppearance("#7C3AED", {
        textColor: "#1E1B4B",
        headingColor: "#4C1D95",
        mutedColor: "#A78BFA",
        totalHighlightBackground: "#F5F3FF",
        tableBorderColor: "#DDD6FE",
      }),
    },
    {
      id: "sales-horizon",
      name: "Horizon",
      description: "Full-width banner title with payment totals.",
      accent: "#EA580C",
      alignment: "center",
      layout: "horizon",
      logoPosition: "left",
      metaStyle: "plain",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: false,
        paymentStatusStyles: ["inTotals", "underTotal", "balanceBanner"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "medium",
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'DM Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "inTotals",
      appearance: brandAppearance("#EA580C", {
        textColor: "#292524",
        headingColor: "#9A3412",
        mutedColor: "#FB923C",
        totalHighlightBackground: "#FFF7ED",
        tableBorderColor: "#FED7AA",
      }),
    },
    {
      id: "sales-ledger",
      name: "Ledger",
      description: "Formal ledger with under-total dues.",
      accent: "#3F6212",
      alignment: "left",
      layout: "ledger",
      logoPosition: "right",
      metaStyle: "plain",
      admin: adminCaps({
        productImages: false,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: false,
        paymentStatusStyles: ["underTotal", "inTotals", "boxed"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: false,
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'Source Serif 4', Georgia, serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "underTotal",
      appearance: brandAppearance("#3F6212", {
        textColor: "#1A2E05",
        headingColor: "#1A2E05",
        mutedColor: "#65A30D",
        tableHeaderBackground: "#365314",
        totalHighlightBackground: "#F7FEE7",
        tableBorderColor: "#BEF264",
      }),
    },
    {
      id: "sales-folio",
      name: "Folio",
      description: "Display serif title with split payment panels.",
      accent: "#BE185D",
      alignment: "left",
      layout: "folio",
      logoPosition: "right",
      metaStyle: "card",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["card", "outline", "strip"],
        paymentStatusStyles: ["splitPanels", "boxed", "inTotals"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "medium",
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'Playfair Display', Georgia, serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "splitPanels",
      appearance: brandAppearance("#BE185D", {
        textColor: "#500724",
        headingColor: "#831843",
        mutedColor: "#9D174D",
        totalHighlightBackground: "#FDF2F8",
        tableBorderColor: "#FBCFE8",
      }),
    },
    {
      id: "sales-spectrum",
      name: "Spectrum",
      description: "Sky dual-tone accents, large images, and balance banner.",
      accent: "#0284C7",
      alignment: "right",
      layout: "spectrum",
      logoPosition: "left",
      metaStyle: "strip",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["strip", "card", "inverted"],
        paymentStatusStyles: ["balanceBanner", "boxed", "splitPanels"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "large",
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'Nunito Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "balanceBanner",
      appearance: brandAppearance("#0284C7", {
        textColor: "#0C4A6E",
        headingColor: "#075985",
        mutedColor: "#64748B",
        totalHighlightBackground: "#F0F9FF",
        tableBorderColor: "#7DD3FC",
        paymentStatusBorderColor: "#38BDF8",
      }),
    },
    {
      id: "sales-apex",
      name: "Apex",
      description: "Indigo accents with inverted payment dues.",
      accent: "#4338CA",
      alignment: "left",
      layout: "apex",
      logoPosition: "right",
      metaStyle: "inverted",
      admin: adminCaps({
        productImages: true,
        logoPosition: true,
        logoPositions: ["left", "right"],
        metaStyle: true,
        metaStyles: ["inverted", "card", "strip"],
        paymentStatusStyles: ["balanceBanner", "boxed", "underTotal"],
        taxSummary: false,
        paymentAmounts: true,
      }),
      showProductImages: true,
      productImageSize: "medium",
      showPaidAmount: true,
      showBalanceDue: true,
      fontFamily: "'Work Sans', Helvetica, Arial, sans-serif",
      backgroundColor: "#ffffff",
      paymentStatusStyle: "balanceBanner",
      appearance: brandAppearance("#4338CA", {
        textColor: "#1E1B4B",
        headingColor: "#1E1B4B",
        mutedColor: "#818CF8",
        totalHighlightBackground: "#EEF2FF",
        tableBorderColor: "#A5B4FC",
      }),
    },
  ];

/** 15 invoice designs — modern, European, and classic business styles. */
export const INVOICE_TEMPLATE_PRESETS: readonly SalesOrderTemplatePreset[] = [
  {
    id: "invoice-professional",
    name: "Professional",
    description: "Navy B2B invoice with card meta and under-total dues.",
    accent: "#1E3A8A",
    alignment: "left",
    layout: "professional",
    logoPosition: "right",
    metaStyle: "card",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["card", "outline", "boxed"],
      paymentStatusStyles: ["underTotal", "inTotals", "splitPanels"],
      taxSummary: true,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "medium",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'IBM Plex Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "underTotal",
    appearance: brandAppearance("#1E3A8A", {
      textColor: "#1E293B",
      headingColor: "#0F172A",
      mutedColor: "#64748B",
      tableBorderColor: "#BFDBFE",
      totalHighlightBackground: "#EFF6FF",
      paymentStatusLabelColor: "#1E3A8A",
    }),
  },
  {
    id: "invoice-modern",
    name: "Modern",
    description: "Clean blue accent bar with product images and boxed dues.",
    accent: "#2563EB",
    alignment: "right",
    layout: "modern",
    logoPosition: "left",
    metaStyle: "card",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["card", "boxed", "strip"],
      paymentStatusStyles: ["boxed", "inTotals", "underTotal"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "medium",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'DM Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "boxed",
    appearance: brandAppearance("#2563EB", {
      textColor: "#1E293B",
      headingColor: "#0F172A",
      mutedColor: "#64748B",
      totalHighlightBackground: "#EFF6FF",
      tableBorderColor: "#DBEAFE",
      paymentStatusBorderColor: "#93C5FD",
    }),
  },
  {
    id: "invoice-european",
    name: "European",
    description: "EU-style layout — logo right, tax summary, balance banner.",
    accent: "#0F766E",
    alignment: "left",
    layout: "european",
    logoPosition: "right",
    metaStyle: "outline",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["outline", "boxed", "card"],
      paymentStatusStyles: ["balanceBanner", "underTotal", "inTotals"],
      taxSummary: true,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "medium",
    showTaxSummary: true,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'Open Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "balanceBanner",
    appearance: brandAppearance("#0F766E", {
      textColor: "#134E4A",
      headingColor: "#134E4A",
      mutedColor: "#5F8F8A",
      totalHighlightBackground: "#F0FDFA",
      tableBorderColor: "#99F6E4",
      paymentStatusBorderColor: "#2DD4BF",
    }),
  },
  {
    id: "invoice-classic",
    name: "Classic",
    description: "Editorial European serif with formal tax summary.",
    accent: "#171717",
    alignment: "left",
    layout: "classic",
    logoPosition: "right",
    metaStyle: "plain",
    admin: adminCaps({
      productImages: false,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["plain", "outline"],
      paymentStatusStyles: ["underTotal", "inTotals"],
      taxSummary: true,
      paymentAmounts: true,
    }),
    showProductImages: false,
    showTaxSummary: true,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "Georgia, 'Times New Roman', serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "underTotal",
    appearance: brandAppearance("#171717", {
      textColor: "#262626",
      headingColor: "#0A0A0A",
      mutedColor: "#737373",
      tableBorderColor: "#D4D4D4",
      totalHighlightBackground: "#FAFAFA",
      tableHeaderBackground: "#171717",
      taxSummaryHeaderBackground: "#171717",
      paymentStatusLabelColor: "#171717",
    }),
  },
  {
    id: "invoice-compact",
    name: "Compact",
    description: "Dense amber layout for multi-line invoices.",
    accent: "#D97706",
    alignment: "center",
    layout: "compact",
    logoPosition: "left",
    metaStyle: "outline",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["outline", "plain", "boxed"],
      paymentStatusStyles: ["inTotals", "underTotal", "boxed"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "small",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'IBM Plex Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "inTotals",
    logoSize: 36,
    appearance: brandAppearance("#D97706", {
      textColor: "#292524",
      headingColor: "#78350F",
      mutedColor: "#A8A29E",
      totalHighlightBackground: "#FFFBEB",
      tableBorderColor: "#FDE68A",
    }),
  },
  {
    id: "invoice-minimal",
    name: "Minimal",
    description: "Soft Nordic accents and airy spacing.",
    accent: "#0E7490",
    alignment: "left",
    layout: "minimal",
    logoPosition: "left",
    metaStyle: "card",
    admin: adminCaps({
      productImages: false,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["card", "plain", "outline"],
      paymentStatusStyles: ["inTotals", "underTotal", "boxed"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: false,
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'DM Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "inTotals",
    appearance: brandAppearance("#0E7490", {
      organizationColor: "#155E75",
      companyColor: "#0F172A",
      textColor: "#334155",
      headingColor: "#0F172A",
      mutedColor: "#94A3B8",
      orderNumberColor: "#0E7490",
      tableHeaderBackground: "#0E7490",
      tableBorderColor: "#CBD5E1",
      totalHighlightBackground: "#ECFEFF",
      paymentStatusLabelColor: "#0E7490",
      paymentStatusBorderColor: "#67E8F9",
    }),
  },
  {
    id: "invoice-standard",
    name: "Standard",
    description: "Simple everyday invoice — clear and familiar.",
    accent: "#B90128",
    alignment: "right",
    layout: "standard",
    logoPosition: "left",
    metaStyle: "boxed",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["boxed", "card", "outline"],
      paymentStatusStyles: ["underTotal", "inTotals"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: false,
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "Inter, system-ui, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "underTotal",
    appearance: brandAppearance("#B90128", {
      totalHighlightBackground: "#FEF2F2",
      tableBorderColor: "#FECACA",
    }),
  },
  {
    id: "invoice-bold",
    name: "Bold",
    description: "Strong red title band with inverted meta details.",
    accent: "#DC2626",
    alignment: "left",
    layout: "bold",
    logoPosition: "right",
    metaStyle: "inverted",
    admin: adminCaps({
      productImages: false,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["inverted", "strip", "boxed"],
      paymentStatusStyles: ["balanceBanner", "boxed", "inTotals"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: false,
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'Work Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "balanceBanner",
    appearance: brandAppearance("#DC2626", {
      textColor: "#1C1917",
      headingColor: "#18181B",
      mutedColor: "#A8A29E",
      totalHighlightBackground: "#FEF2F2",
      tableBorderColor: "#FECACA",
    }),
  },
  {
    id: "invoice-studio",
    name: "Studio",
    description: "Creative violet strip meta and boxed payments.",
    accent: "#7C3AED",
    alignment: "left",
    layout: "studio",
    logoPosition: "right",
    metaStyle: "strip",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["strip", "card", "boxed"],
      paymentStatusStyles: ["boxed", "splitPanels", "inTotals"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "medium",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'Work Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "boxed",
    appearance: brandAppearance("#7C3AED", {
      textColor: "#1E1B4B",
      headingColor: "#4C1D95",
      mutedColor: "#A78BFA",
      totalHighlightBackground: "#F5F3FF",
      tableBorderColor: "#DDD6FE",
    }),
  },
  {
    id: "invoice-horizon",
    name: "Horizon",
    description: "Full-width warm banner title for retail invoices.",
    accent: "#EA580C",
    alignment: "center",
    layout: "horizon",
    logoPosition: "left",
    metaStyle: "plain",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["plain", "card", "outline"],
      paymentStatusStyles: ["inTotals", "underTotal", "balanceBanner"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "medium",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'DM Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "inTotals",
    appearance: brandAppearance("#EA580C", {
      textColor: "#292524",
      headingColor: "#9A3412",
      mutedColor: "#FB923C",
      totalHighlightBackground: "#FFF7ED",
      tableBorderColor: "#FED7AA",
    }),
  },
  {
    id: "invoice-ledger",
    name: "Ledger",
    description: "Formal European ledger with under-total balances.",
    accent: "#3F6212",
    alignment: "left",
    layout: "ledger",
    logoPosition: "right",
    metaStyle: "plain",
    admin: adminCaps({
      productImages: false,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["plain", "outline", "boxed"],
      paymentStatusStyles: ["underTotal", "inTotals", "boxed"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: false,
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'Source Serif 4', Georgia, serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "underTotal",
    appearance: brandAppearance("#3F6212", {
      textColor: "#1A2E05",
      headingColor: "#1A2E05",
      mutedColor: "#65A30D",
      tableHeaderBackground: "#365314",
      totalHighlightBackground: "#F7FEE7",
      tableBorderColor: "#BEF264",
    }),
  },
  {
    id: "invoice-folio",
    name: "Folio",
    description: "Display serif title with split payment panels.",
    accent: "#BE185D",
    alignment: "left",
    layout: "folio",
    logoPosition: "right",
    metaStyle: "card",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["card", "outline", "strip"],
      paymentStatusStyles: ["splitPanels", "boxed", "inTotals"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "medium",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'Playfair Display', Georgia, serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "splitPanels",
    appearance: brandAppearance("#BE185D", {
      textColor: "#500724",
      headingColor: "#831843",
      mutedColor: "#9D174D",
      totalHighlightBackground: "#FDF2F8",
      tableBorderColor: "#FBCFE8",
    }),
  },
  {
    id: "invoice-spectrum",
    name: "Spectrum",
    description: "Sky dual-tone modern invoice with large images.",
    accent: "#0284C7",
    alignment: "right",
    layout: "spectrum",
    logoPosition: "left",
    metaStyle: "strip",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["strip", "card", "inverted"],
      paymentStatusStyles: ["balanceBanner", "boxed", "splitPanels"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "large",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'Nunito Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "balanceBanner",
    appearance: brandAppearance("#0284C7", {
      textColor: "#0C4A6E",
      headingColor: "#075985",
      mutedColor: "#64748B",
      totalHighlightBackground: "#F0F9FF",
      tableBorderColor: "#7DD3FC",
      paymentStatusBorderColor: "#38BDF8",
    }),
  },
  {
    id: "invoice-apex",
    name: "Apex",
    description: "Indigo modern invoice with inverted meta and banner dues.",
    accent: "#4338CA",
    alignment: "left",
    layout: "apex",
    logoPosition: "right",
    metaStyle: "inverted",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["left", "right"],
      metaStyle: true,
      metaStyles: ["inverted", "card", "strip"],
      paymentStatusStyles: ["balanceBanner", "boxed", "underTotal"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "medium",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'Work Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "balanceBanner",
    appearance: brandAppearance("#4338CA", {
      textColor: "#1E1B4B",
      headingColor: "#1E1B4B",
      mutedColor: "#818CF8",
      totalHighlightBackground: "#EEF2FF",
      tableBorderColor: "#A5B4FC",
    }),
  },
  {
    id: "invoice-japanese",
    name: "Japanese",
    description: "Centered modern layout with boxed payment status.",
    accent: "#4F46E5",
    alignment: "center",
    layout: "japanese",
    logoPosition: "center",
    metaStyle: "boxed",
    admin: adminCaps({
      productImages: true,
      logoPosition: true,
      logoPositions: ["center", "left", "right"],
      metaStyle: true,
      metaStyles: ["boxed", "plain", "card"],
      paymentStatusStyles: ["boxed", "inTotals", "splitPanels"],
      taxSummary: false,
      paymentAmounts: true,
    }),
    showProductImages: true,
    productImageSize: "medium",
    showTaxSummary: false,
    showPaidAmount: true,
    showBalanceDue: true,
    fontFamily: "'IBM Plex Sans', Helvetica, Arial, sans-serif",
    backgroundColor: "#ffffff",
    paymentStatusStyle: "boxed",
    appearance: brandAppearance("#4F46E5", {
      textColor: "#312E81",
      headingColor: "#312E81",
      mutedColor: "#818CF8",
      totalHighlightBackground: "#EEF2FF",
      tableBorderColor: "#C7D2FE",
    }),
  },
];

export const DEFAULT_INVOICE_TEMPLATE_ID = "invoice-professional";

const ALL_DOCUMENT_TEMPLATE_PRESETS: readonly SalesOrderTemplatePreset[] = [
  ...SALES_ORDER_TEMPLATE_PRESETS,
  ...INVOICE_TEMPLATE_PRESETS,
];

const SALES_ORDER_TEMPLATES: Record<string, { name: string }> =
  Object.fromEntries(
    SALES_ORDER_TEMPLATE_PRESETS.map((preset) => [
      preset.id,
      { name: preset.name },
    ]),
  );

/** Resolve a sales-order or invoice layout preset by id. */
export function findTemplatePreset(
  templateId: string,
): SalesOrderTemplatePreset | undefined {
  return ALL_DOCUMENT_TEMPLATE_PRESETS.find(
    (preset) => preset.id === templateId,
  );
}

/** True for any preset-backed template except Classic Standard. */
export function isPremiumTemplatePreset(templateId: string): boolean {
  const preset = findTemplatePreset(templateId);
  return Boolean(preset && preset.id !== "sales-standard");
}

export function getSalesOrderTemplatePreset(
  templateId: string,
): SalesOrderTemplatePreset {
  return (
    findTemplatePreset(templateId) ?? SALES_ORDER_TEMPLATE_PRESETS[0]!
  );
}

export function getTemplateAdminCapabilities(
  templateId: string,
): TemplateAdminCapabilities {
  return getSalesOrderTemplatePreset(templateId).admin;
}

export function salesOrderLayoutStyle(
  templateId: string,
): SalesOrderLayoutStyle {
  return getSalesOrderTemplatePreset(templateId).layout;
}

export function salesOrderLogoPosition(
  templateId: string,
  settings?: Partial<Pick<TemplateEditorSettings, "logoPosition">> | null,
): SalesOrderLogoPosition {
  const preset = getSalesOrderTemplatePreset(templateId);
  const value = settings?.logoPosition;
  if (value === "left" || value === "right" || value === "center") {
    const allowed = preset.admin.logoPositions;
    if (!allowed || allowed.includes(value)) return value;
  }
  return preset.logoPosition;
}

export function salesOrderMetaStyle(
  templateId: string,
  settings?: Partial<Pick<TemplateEditorSettings, "metaStyle">> | null,
): SalesOrderMetaStyle {
  const preset = getSalesOrderTemplatePreset(templateId);
  const value = settings?.metaStyle;
  if (
    value === "boxed" ||
    value === "outline" ||
    value === "plain" ||
    value === "strip" ||
    value === "card" ||
    value === "inverted"
  ) {
    const allowed = preset.admin.metaStyles;
    if (!allowed || allowed.includes(value)) return value;
  }
  return preset.metaStyle;
}

export function defaultColumnsForPreset(
  preset: SalesOrderTemplatePreset,
): TemplateEditorSettings["columns"] {
  const showImage = preset.showProductImages === true;
  const imageSize = preset.productImageSize ?? "medium";
  return [
    { key: "number", enabled: true, width: 4, label: "#" },
    {
      key: "item",
      enabled: true,
      width: showImage ? 40 : 36,
      label: "Item",
      showImage: showImage === true,
      ...(showImage ? { imageSize } : {}),
    },
    { key: "custom", enabled: false, width: 12, label: "Custom" },
    { key: "sku", enabled: true, width: showImage ? 10 : 11, label: "SKU" },
    {
      key: "quantity",
      enabled: true,
      width: showImage ? 8 : 10,
      label: "Qty",
      showUnit: false,
    },
    {
      key: "rate",
      enabled: true,
      width: showImage ? 9 : 10,
      label: "Rate",
      showComparePrice: true,
    },
    {
      key: "discount",
      enabled: false,
      width: showImage ? 9 : 10,
      label: "Discount",
    },
    { key: "discountPercentage", enabled: false, width: 10, label: "Discount %" },
    { key: "taxPercentage", enabled: false, width: 10, label: "Tax %" },
    { key: "taxAmount", enabled: false, width: 10, label: "Tax" },
    { key: "amount", enabled: true, width: showImage ? 11 : 12, label: "Amount" },
  ];
}

export function formatPercentOf(part: string, whole: string) {
  const amount = parseAmountNumber(part);
  const base = parseAmountNumber(whole);
  if (!Number.isFinite(amount) || !Number.isFinite(base) || base === 0) {
    return "0,00%";
  }
  return `${formatAmountDisplay((amount / base) * 100)}%`;
}

export function buildTaxSummaryFromLineItems(
  lineItems: SalesOrderDocumentData["lineItems"],
): SalesOrderDocumentData["taxSummary"] {
  const groups = new Map<
    string,
    { title: string; rate: string; taxable: number; tax: number }
  >();

  for (const item of lineItems) {
    const tax = Number(item.taxAmount);
    const taxable = Number(item.amount);
    if (!Number.isFinite(tax) || tax <= 0) continue;
    const rate =
      item.taxPercentage?.trim() ||
      formatPercentOf(String(tax), String(taxable > 0 ? taxable : tax));
    const key = rate;
    const current = groups.get(key) ?? {
      title: `Tax ${rate}`,
      rate,
      taxable: 0,
      tax: 0,
    };
    current.taxable += Number.isFinite(taxable) && taxable > 0 ? taxable : 0;
    current.tax += tax;
    groups.set(key, current);
  }

  return Array.from(groups.values()).map((row) => ({
    title: row.title,
    rate: row.rate,
    taxableAmount: row.taxable.toFixed(2),
    taxAmount: row.tax.toFixed(2),
  }));
}

export function resolveTaxSummaryLabel(label: string, moneySymbol: string) {
  return String(label || "")
    .replaceAll("{currency}", moneySymbol)
    .trim();
}

export function defaultTaxSummarySettings(): TemplateEditorSettings["taxSummary"] {
  return {
    enabled: false,
    title: "Tax Summary",
    detailsLabel: "Tax Details",
    showTaxableAmount: true,
    taxableAmountLabel: "Taxable Amount ({currency})",
    showTaxAmount: true,
    taxAmountLabel: "Tax Amount ({currency})",
    showTotalAmount: true,
    totalAmountLabel: "Total Amount ({currency})",
    totalLabel: "Total",
  };
}

export function mergeTaxSummarySettings(
  incoming: unknown,
  legacyShow?: boolean,
  /** Template-preset default (premium = true, Standard = false). */
  presetEnabled = false,
): TemplateEditorSettings["taxSummary"] {
  const defaults = defaultTaxSummarySettings();
  const input =
    incoming && typeof incoming === "object" && !Array.isArray(incoming)
      ? (incoming as Partial<TemplateEditorSettings["taxSummary"]>)
      : {};

  // Prefer explicit boolean; otherwise honor legacy flag; otherwise preset default.
  const enabled =
    typeof input.enabled === "boolean"
      ? input.enabled
      : typeof legacyShow === "boolean"
        ? legacyShow
        : presetEnabled;

  return {
    enabled,
    title:
      typeof input.title === "string" && input.title.trim()
        ? input.title
        : defaults.title,
    detailsLabel:
      typeof input.detailsLabel === "string" && input.detailsLabel.trim()
        ? input.detailsLabel
        : defaults.detailsLabel,
    showTaxableAmount: input.showTaxableAmount !== false,
    taxableAmountLabel:
      typeof input.taxableAmountLabel === "string" &&
      input.taxableAmountLabel.trim()
        ? input.taxableAmountLabel
        : defaults.taxableAmountLabel,
    showTaxAmount: input.showTaxAmount !== false,
    taxAmountLabel:
      typeof input.taxAmountLabel === "string" && input.taxAmountLabel.trim()
        ? input.taxAmountLabel
        : defaults.taxAmountLabel,
    showTotalAmount: input.showTotalAmount !== false,
    totalAmountLabel:
      typeof input.totalAmountLabel === "string" && input.totalAmountLabel.trim()
        ? input.totalAmountLabel
        : defaults.totalAmountLabel,
    totalLabel:
      typeof input.totalLabel === "string" && input.totalLabel.trim()
        ? input.totalLabel
        : defaults.totalLabel,
  };
}

export function formatTaxSummaryMoney(value: string | number) {
  const amount = parseAmountNumber(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

/**
 * Parse stored/display amounts. Accepts US `50000.00` / `50,000.00`
 * and European `50.000,00` / `300,00`.
 */
export function parseAmountNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const raw = String(value ?? "")
    .replace(/\s+Nos$/i, "")
    .replace(/[^\d.,-]/g, "")
    .trim();
  if (!raw) return NaN;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) {
    // European thousands + decimal: 50.000,00
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      return Number(raw.replace(/\./g, "").replace(",", "."));
    }
    // US thousands + decimal: 50,000.00
    return Number(raw.replace(/,/g, ""));
  }
  if (hasComma && !hasDot) {
    // European decimal: 300,00
    return Number(raw.replace(",", "."));
  }
  return Number(raw);
}

/** European money/qty display: 50.000,00 · 300,00 · 1,00 */
export function formatAmountDisplay(value: string | number | null | undefined) {
  const amount = parseAmountNumber(value);
  if (!Number.isFinite(amount)) return "0,00";
  const negative = amount < 0;
  const fixed = Math.abs(amount).toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${withDots},${decPart}`;
}

/** True when amount is present and not ±0.00 (hide zero totals rows). */
export function hasNonZeroAmount(value: string | number | null | undefined) {
  const amount = parseAmountNumber(value);
  return Number.isFinite(amount) && Math.abs(amount) >= 0.005;
}

export function normalizeFinancialStatus(value: string | null | undefined) {
  return (value || "").toUpperCase();
}

/** Hide Paid Amount on fully refunded/voided orders. */
export function shouldShowDocumentPaidAmount(
  order: Pick<SalesOrderDocumentData, "paidAmount" | "financialStatus">,
  enabled: boolean,
) {
  if (!enabled) return false;
  const status = normalizeFinancialStatus(order.financialStatus);
  if (status === "REFUNDED" || status === "VOIDED") return false;
  return hasNonZeroAmount(order.paidAmount);
}

/** Show Balance Due; on fully refunded orders use invoice total (not $0). */
export function shouldShowDocumentBalanceDue(
  order: Pick<SalesOrderDocumentData, "balanceDue" | "financialStatus">,
  enabled: boolean,
) {
  if (!enabled) return false;
  const status = normalizeFinancialStatus(order.financialStatus);
  if (status === "REFUNDED") return true;
  return hasNonZeroAmount(order.balanceDue);
}

export function shouldShowDocumentRefundedAmount(
  order: Pick<SalesOrderDocumentData, "refundedAmount" | "financialStatus">,
) {
  const status = normalizeFinancialStatus(order.financialStatus);
  if (status !== "REFUNDED" && status !== "PARTIALLY_REFUNDED") return false;
  return hasNonZeroAmount(order.refundedAmount);
}

/**
 * Keep Paid / Balance / Refunded rows consistent with document Total.
 * Shopify outstanding/received can drift by cents from currentTotalPriceSet.
 */
export function reconcilePaymentAmounts(
  total: string,
  paid: string,
  outstanding: string,
  financialStatus?: string | null,
  refunded?: string,
): {
  paidAmount: string;
  balanceDue: string;
  refundedAmount: string;
} {
  const totalN = Math.round((parseAmountNumber(total) || 0) * 100) / 100;
  let paidN = Math.round((parseAmountNumber(paid) || 0) * 100) / 100;
  const outstandingN =
    Math.round((parseAmountNumber(outstanding) || 0) * 100) / 100;
  let refundedN = Math.round((parseAmountNumber(refunded) || 0) * 100) / 100;
  const status = normalizeFinancialStatus(financialStatus);

  if (status === "REFUNDED") {
    if (refundedN <= 0 && totalN > 0) refundedN = totalN;
    return {
      paidAmount: "0.00",
      // Invoice total — not $0 (refund recorded separately on Refunded Amount).
      balanceDue: totalN.toFixed(2),
      refundedAmount: refundedN.toFixed(2),
    };
  }

  if (status === "VOIDED") {
    return {
      paidAmount: "0.00",
      balanceDue: "0.00",
      refundedAmount: "0.00",
    };
  }

  if (status === "PARTIALLY_REFUNDED" && refundedN > 0) {
    if (paidN > refundedN) {
      paidN = Math.round((paidN - refundedN) * 100) / 100;
    } else if (paidN <= 0 && totalN > 0) {
      paidN = Math.max(0, Math.round((totalN - refundedN) * 100) / 100);
    }
    let balanceN =
      outstandingN >= 0
        ? Math.round(outstandingN * 100) / 100
        : Math.round((totalN - paidN) * 100) / 100;
    if (balanceN < 0) balanceN = 0;
    return {
      paidAmount: paidN.toFixed(2),
      balanceDue: balanceN.toFixed(2),
      refundedAmount: refundedN.toFixed(2),
    };
  }

  if (
    (status === "PAID" || status === "PARTIALLY_REFUNDED") &&
    paidN <= 0 &&
    totalN > 0
  ) {
    paidN = totalN;
  }

  // Prefer deriving balance from Total − Paid so footer lines always add up.
  let balanceN = Math.round((totalN - paidN) * 100) / 100;
  if (balanceN < 0) {
    paidN = totalN;
    balanceN = 0;
  }

  // Fully unpaid: show Balance Due exactly equal to Total (not Shopify drift).
  if (paidN === 0 && totalN > 0) {
    balanceN = totalN;
  } else if (
    paidN > 0 &&
    Math.abs(paidN + outstandingN - totalN) <= 0.05 &&
    Math.abs(outstandingN - balanceN) > 0.005
  ) {
    // Tiny Shopify drift — keep paid, use derived balance so Total matches.
  }

  return {
    paidAmount: paidN.toFixed(2),
    balanceDue: balanceN.toFixed(2),
    refundedAmount: "0.00",
  };
}

/** Qty always as 2 European decimals, e.g. 10 → 10,00 */
export function formatQuantityDisplay(value: string | number | null | undefined) {
  return formatAmountDisplay(value);
}

export function computeTotalItemQuantity(
  lineItems: SalesOrderDocumentData["lineItems"],
) {
  const total = lineItems.reduce(
    (sum, item) => sum + (parseAmountNumber(item.quantity) || 0),
    0,
  );
  return formatQuantityDisplay(total);
}

/**
 * Reconstructing taxable = tax / rate causes ±0.01 rounding across rows.
 * Nudge the largest taxable row so Σ taxable + Σ tax equals the order total.
 */
export function reconcileTaxSummaryToOrderTotal(
  rows: SalesOrderDocumentData["taxSummary"],
  orderTotal: string,
  orderTax: string,
): SalesOrderDocumentData["taxSummary"] {
  if (rows.length === 0) return rows;
  const total = parseAmountNumber(orderTotal);
  const taxTotal = parseAmountNumber(orderTax);
  if (!Number.isFinite(total) || !Number.isFinite(taxTotal)) return rows;

  const targetTaxable = Math.round((total - taxTotal) * 100) / 100;
  const currentTaxable =
    Math.round(
      rows.reduce((sum, row) => sum + (parseAmountNumber(row.taxableAmount) || 0), 0) *
        100,
    ) / 100;
  const diff = Math.round((targetTaxable - currentTaxable) * 100) / 100;
  if (Math.abs(diff) < 0.005) return rows;

  let adjustIndex = 0;
  let largest = parseAmountNumber(rows[0]?.taxableAmount) || 0;
  for (let i = 1; i < rows.length; i += 1) {
    const value = parseAmountNumber(rows[i]?.taxableAmount) || 0;
    if (value > largest) {
      largest = value;
      adjustIndex = i;
    }
  }

  return rows.map((row, index) => {
    if (index !== adjustIndex) return row;
    const adjusted =
      Math.round(((parseAmountNumber(row.taxableAmount) || 0) + diff) * 100) / 100;
    return {
      ...row,
      taxableAmount: formatTaxSummaryMoney(Math.max(0, adjusted)),
    };
  });
}

/** Display rows for the Tax Summary table (details + total amount). */
export function taxSummaryDisplayRows(
  rows: SalesOrderDocumentData["taxSummary"],
) {
  return rows.map((row) => {
    const taxable = parseAmountNumber(row.taxableAmount) || 0;
    const tax = parseAmountNumber(row.taxAmount) || 0;
    const rate = row.rate?.trim() || "";
    const details =
      rate && !row.title.includes("(")
        ? `${row.title} (${rate})`
        : row.title;
    return {
      details,
      taxableAmount: formatAmountDisplay(taxable),
      taxAmount: formatAmountDisplay(tax),
      totalAmount: formatAmountDisplay(taxable + tax),
    };
  });
}

export function taxSummaryTotals(
  rows: SalesOrderDocumentData["taxSummary"],
  orderTotal?: string,
) {
  const taxable = rows.reduce(
    (sum, row) => sum + (parseAmountNumber(row.taxableAmount) || 0),
    0,
  );
  const tax = rows.reduce(
    (sum, row) => sum + (parseAmountNumber(row.taxAmount) || 0),
    0,
  );
  return {
    taxableAmount: formatAmountDisplay(taxable),
    taxAmount: formatAmountDisplay(tax),
    // Prefer document total so footer matches Paid Amount / Grand Total.
    totalAmount: orderTotal?.trim()
      ? formatAmountDisplay(orderTotal)
      : formatAmountDisplay(taxable + tax),
  };
}

export function formatTaxLineLabel(row: {
  title: string;
  rate: string;
}) {
  const title = row.title?.trim() || "Tax";
  const rate = row.rate?.trim();
  if (!rate) return title;
  const normalized = rate.endsWith("%") ? rate : `${rate}%`;
  return `${title} (${normalized})`;
}

export function currencySymbol(currencyCode: string) {
  if (currencyCode === "EUR") return "€";
  if (currencyCode === "USD") return "$";
  if (currencyCode === "GBP") return "£";
  if (currencyCode === "INR") return "₹";
  if (currencyCode === "JPY") return "¥";
  if (currencyCode === "CNY") return "¥";
  if (currencyCode === "AUD") return "A$";
  if (currencyCode === "CAD") return "C$";
  return `${currencyCode} `;
}

export function lineItemImageSizePx(
  size: "small" | "medium" | "large" | undefined,
) {
  if (size === "large") return 56;
  if (size === "medium") return 40;
  return 28;
}

export function lineItemImageSizeMm(
  size: "small" | "medium" | "large" | undefined,
) {
  if (size === "large") return 16;
  if (size === "medium") return 12;
  return 8;
}

/**
 * Template UI "margins (inches)" → CSS padding.
 * Uses 10mm per UI unit so Preview / Sales Order / PDF match the designed
 * spacing (UI 1.0 ≈ 10mm). Same formula everywhere.
 */
export function paperPaddingCss(margins: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}) {
  const mm = (value: number) => `${Math.max(0, Number(value) || 0) * 10}mm`;
  return `${mm(margins.top)} ${mm(margins.right)} ${mm(margins.bottom)} ${mm(margins.left)}`;
}

/** Same mapping as paperPaddingCss, for vector PDF page margins. */
export function paperMarginMm(margins: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}) {
  const toMm = (value: number) => Math.max(0, (Number(value) || 0) * 10);
  return {
    top: toMm(margins.top),
    right: toMm(margins.right),
    bottom: toMm(margins.bottom),
    left: toMm(margins.left),
  };
}

function parseLineQuantity(quantity: string) {
  const qty = parseAmountNumber(quantity);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

/**
 * When Show Compare Price is on and the line has a discount, show the
 * discounted unit price with the pre-discount unit struck through.
 * No discount → never show compare/strikethrough price.
 */
export function resolveDisplayedUnitPrice(
  item: {
    quantity: string;
    rate: string;
    discount: string;
    amount: string;
    compareAtPrice?: string;
  },
  showComparePrice: boolean,
): { rate: string; compareAtPrice: string } {
  const storedUnit = parseAmountNumber(item.rate);
  const discount = parseAmountNumber(item.discount);
  const lineAmount = parseAmountNumber(item.amount);
  const qty = parseLineQuantity(item.quantity);
  const netUnit =
    Number.isFinite(lineAmount) && lineAmount >= 0
      ? lineAmount / qty
      : storedUnit;
  const hasLineDiscount = Number.isFinite(discount) && discount > 0.0001;

  if (!showComparePrice || !hasLineDiscount) {
    return {
      rate: formatAmountDisplay(item.rate || 0),
      compareAtPrice: "",
    };
  }

  // Prefer stored original unit; otherwise reconstruct from net + discount.
  const rateIsOriginal =
    Number.isFinite(storedUnit) && storedUnit > netUnit + 0.0001;
  const displayRateNum = rateIsOriginal ? netUnit : storedUnit;
  const originalUnit = rateIsOriginal
    ? storedUnit
    : Number.isFinite(storedUnit)
      ? storedUnit + discount / qty
      : displayRateNum + discount / qty;
  const compare =
    Number.isFinite(originalUnit) && originalUnit > displayRateNum + 0.0001
      ? formatAmountDisplay(originalUnit)
      : "";
  return {
    rate: formatAmountDisplay(displayRateNum),
    compareAtPrice: compare,
  };
}

export function mergeTotalsSettings(
  incoming: unknown,
  defaults: TemplateEditorSettings["totals"],
): TemplateEditorSettings["totals"] {
  const input =
    incoming && typeof incoming === "object" && !Array.isArray(incoming)
      ? (incoming as Partial<TemplateEditorSettings["totals"]> & {
          showDiscount?: boolean;
          discountLabel?: string;
          showTax?: boolean;
          taxLabel?: string;
        })
      : {};

  const merged = { ...defaults, ...input };

  const showDiscountAmount =
    typeof input.showDiscountAmount === "boolean"
      ? input.showDiscountAmount
      : typeof input.showDiscount === "boolean"
        ? input.showDiscount
        : defaults.showDiscountAmount;
  let discountAmountLabel =
    typeof input.discountAmountLabel === "string" &&
    input.discountAmountLabel.trim() !== ""
      ? input.discountAmountLabel
      : typeof input.discountLabel === "string" && input.discountLabel.trim() !== ""
        ? input.discountLabel
        : defaults.discountAmountLabel;

  const showVatAmount =
    typeof input.showVatAmount === "boolean"
      ? input.showVatAmount
      : typeof input.showTax === "boolean"
        ? input.showTax
        : defaults.showVatAmount;
  let vatAmountLabel =
    typeof input.vatAmountLabel === "string" && input.vatAmountLabel.trim() !== ""
      ? input.vatAmountLabel
      : typeof input.taxLabel === "string" && input.taxLabel.trim() !== ""
        ? input.taxLabel
        : defaults.vatAmountLabel;

  let shippingPriceLabel =
    merged.shippingPriceLabel || defaults.shippingPriceLabel;

  discountAmountLabel = normalizeStockTotalLabel(
    discountAmountLabel,
    "Discount Amount",
    "Discount",
  );
  shippingPriceLabel = normalizeStockTotalLabel(
    shippingPriceLabel,
    "Shipping Price",
    "Shipping Charge",
  );
  shippingPriceLabel = normalizeStockTotalLabel(
    shippingPriceLabel,
    "Shipping",
    "Shipping Charge",
  );
  vatAmountLabel = normalizeStockTotalLabel(
    normalizeStockTotalLabel(
      normalizeStockTotalLabel(vatAmountLabel, "VAT Amount", "Total Tax"),
      "VAT Tax",
      "Total Tax",
    ),
    "Tax",
    "Total Tax",
  );

  return {
    ...merged,
    showSubtotal: merged.showSubtotal !== false,
    subtotalLabel: merged.subtotalLabel || defaults.subtotalLabel,
    showQuantity: input.showQuantity === true,
    itemsInTotalLabel:
      typeof input.itemsInTotalLabel === "string" &&
      input.itemsInTotalLabel.trim() !== ""
        ? input.itemsInTotalLabel
        : defaults.itemsInTotalLabel,
    showTaxLines:
      typeof input.showTaxLines === "boolean"
        ? input.showTaxLines
        : defaults.showTaxLines,
    showDiscountAmount,
    discountAmountLabel,
    showShippingPrice: merged.showShippingPrice !== false,
    shippingPriceLabel,
    showVatAmount,
    vatAmountLabel,
    showPaidAmount:
      typeof input.showPaidAmount === "boolean"
        ? input.showPaidAmount
        : defaults.showPaidAmount,
    paidAmountLabel: merged.paidAmountLabel || defaults.paidAmountLabel,
    showBalanceDue:
      typeof input.showBalanceDue === "boolean"
        ? input.showBalanceDue
        : defaults.showBalanceDue,
    balanceDueLabel: merged.balanceDueLabel || defaults.balanceDueLabel,
    refundedAmountLabel:
      merged.refundedAmountLabel || defaults.refundedAmountLabel,
    paymentStatusStyle: normalizePaymentStatusStyle(
      input.paymentStatusStyle,
      defaults.paymentStatusStyle ?? "inTotals",
    ),
    totalLabel: merged.totalLabel || defaults.totalLabel,
  };
}

function normalizeStockTotalLabel(
  value: string,
  legacy: string,
  next: string,
) {
  return value.trim() === legacy ? next : value;
}

export function hasLegacyTotalLabels(totals: {
  discountAmountLabel?: string;
  shippingPriceLabel?: string;
  vatAmountLabel?: string;
}) {
  const discount = totals.discountAmountLabel?.trim();
  const shipping = totals.shippingPriceLabel?.trim();
  const vat = totals.vatAmountLabel?.trim();
  return (
    discount === "Discount Amount" ||
    shipping === "Shipping Price" ||
    shipping === "Shipping" ||
    vat === "VAT Amount" ||
    vat === "VAT Tax" ||
    vat === "Tax"
  );
}

export function formatSalesOrderDocumentNumber(
  numbering: TemplateEditorSettings["numbering"],
  offset = 0,
) {
  const padLength = Math.max(numbering.startingNumber.length, 1);
  const base = Number.parseInt(numbering.startingNumber, 10);
  const next = (Number.isFinite(base) ? base : 1) + offset;
  return `${numbering.prefix}${String(Math.max(0, next)).padStart(padLength, "0")}${numbering.suffix ?? ""}`;
}

export function resolveSalesOrderTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)) return value;
  return DEFAULT_SALES_ORDER_TEMPLATE_ID;
}

export function salesOrderTemplateName(templateId: string) {
  return findTemplatePreset(templateId)?.name ?? "Standard";
}

export function resolveDocumentTypeForTemplateId(
  templateId: string,
): "sales-order" | "invoice" | null {
  if (templateId.startsWith("sales-")) return "sales-order";
  if (templateId.startsWith("invoice-")) return "invoice";
  return null;
}

export function toOrderGid(orderIdParam: string) {
  if (orderIdParam.startsWith("gid://")) return orderIdParam;
  return `gid://shopify/Order/${orderIdParam}`;
}

export function formatOrderDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .format(new Date(value))
    .replace(/\//g, "-");
}

export function defaultTemplateSettings(
  name: string,
  templateId: string = DEFAULT_SALES_ORDER_TEMPLATE_ID,
): TemplateEditorSettings {
  const preset = getSalesOrderTemplatePreset(templateId);
  const isPremium = isPremiumTemplatePreset(templateId);
  const isInvoice = templateId.startsWith("invoice-");
  return {
    name,
    language: "en",
    paperSize: "A4",
    orientation: "portrait",
    designVersion: isPremium ? PREMIUM_DESIGN_VERSION : 1,
    margins: {
      top: 1,
      bottom: 1,
      left: 1,
      right: 1,
    },
    taxSummary: {
      ...defaultTaxSummarySettings(),
      enabled: preset.showTaxSummary === true,
    },
    fontFamily: preset.fontFamily,
    backgroundColor: preset.backgroundColor,
    appearance: {
      ...defaultTemplateAppearance,
      ...preset.appearance,
    },
    logoSize: preset.logoSize ?? 46,
    logoPosition: preset.logoPosition,
    metaStyle: preset.metaStyle,
    header: {
      showLogo: true,
      showOrganization: true,
      showCustomer: true,
      showBilling: true,
      showShipping: true,
      showCustomerDetails: true,
      showDocumentTitle: true,
      showOrderNumber: true,
      showDate: true,
      showExpectedShipmentDate: false,
      showPaymentMethod: true,
    },
    billingDetails: [
      { key: "company", enabled: true, label: "Company" },
      { key: "name", enabled: true, label: "Name" },
      { key: "address", enabled: true, label: "Address" },
      { key: "phone", enabled: true, label: "Phone" },
      { key: "email", enabled: true, label: "Email" },
      { key: "taxId", enabled: false, label: "Tax ID" },
      { key: "vatNumber", enabled: false, label: "VAT number" },
    ],
    shippingDetails: [
      { key: "company", enabled: true, label: "Company" },
      { key: "name", enabled: true, label: "Name" },
      { key: "address", enabled: true, label: "Address" },
      { key: "phone", enabled: true, label: "Phone" },
      { key: "email", enabled: true, label: "Email" },
    ],
    transactionLabels: {
      organization: "Organization",
      customer: "Bill To",
      shipping: "Ship To",
      customerDetails: "Customer Details",
      documentTitle: isInvoice ? "INVOICE" : "SALES ORDER",
      orderNumber: isInvoice ? "Invoice#" : "Sales Order#",
      date: isInvoice ? "Invoice Date" : "Order Date",
      reference: "Ref#",
      expectedShipmentDate: "Expected Shipment Date",
      paymentMethod: "Payment Method",
    },
    numbering: {
      prefix: isInvoice ? "INV-" : "SO-",
      startingNumber: "0001",
      suffix: "",
    },
    customerBlockDetails: [
      { key: "company", enabled: true, label: "Company" },
      { key: "name", enabled: true, label: "Name" },
      { key: "address", enabled: true, label: "Address" },
      { key: "taxId", enabled: false, label: "Tax ID" },
      { key: "vatNumber", enabled: false, label: "VAT number" },
      { key: "phone", enabled: true, label: "Phone" },
      { key: "email", enabled: true, label: "Email" },
    ],
    columns: defaultColumnsForPreset(preset),
    selectedCustomFields: [],
    totals: {
      showSubtotal: true,
      subtotalLabel: "Sub Total",
      showQuantity: false,
      itemsInTotalLabel: "Items in Total",
      // Invoice: tax line details + tax summary table off by default.
      // Sales-order premium: tax line details on.
      showTaxLines: isPremium && !isInvoice,
      showDiscountAmount: true,
      discountAmountLabel: "Discount",
      showShippingPrice: true,
      shippingPriceLabel: "Shipping Charge",
      showVatAmount: true,
      vatAmountLabel: "Total Tax",
      showPaidAmount: isInvoice ? true : preset.showPaidAmount === true,
      paidAmountLabel: "Paid Amount",
      showBalanceDue:
        isInvoice || templateId === "sales-standard"
          ? true
          : preset.showBalanceDue === true,
      balanceDueLabel: "Balance Due",
      refundedAmountLabel: "Refunded Amount",
      paymentStatusStyle: preset.paymentStatusStyle,
      totalLabel: "Total",
    },
    notesLabel: "Notes",
    notes: "Thanks for your business.",
    termsLabel: "Terms & Conditions",
    terms: "Payment is due on receipt.",
    showSignature: false,
    showStamp: false,
  };
}

export function mergeTemplateSettings(
  value: unknown,
  defaultName: string,
  templateId: string = DEFAULT_SALES_ORDER_TEMPLATE_ID,
): TemplateEditorSettings {
  const defaults = defaultTemplateSettings(defaultName, templateId);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const input = value as Partial<TemplateEditorSettings>;
  const isPremiumSales = isPremiumTemplatePreset(templateId);
  const needsLookUpgrade =
    isPremiumSales &&
    Number(input.designVersion ?? 0) < PREMIUM_DESIGN_VERSION;
  const taxSummary = mergeTaxSummarySettings(
    input.taxSummary,
    input.showTaxSummaryTable === true,
    defaults.taxSummary.enabled,
  );
  const totals = mergeTotalsSettings(input.totals, defaults.totals);
  return {
    ...defaults,
    ...input,
    language: normalizeTemplateLanguage(input.language, "en"),
    designVersion: isPremiumSales
      ? PREMIUM_DESIGN_VERSION
      : Number(input.designVersion ?? 1) || 1,
    taxSummary: isPremiumSales
      ? defaults.taxSummary.enabled
        ? {
            ...taxSummary,
            enabled: true,
            showTaxableAmount: true,
            showTaxAmount: true,
            showTotalAmount: true,
          }
        : {
            ...taxSummary,
            enabled: false,
          }
      : taxSummary,
    showTaxSummaryTable: undefined,
    showSignature: input.showSignature === true,
    showStamp: input.showStamp === true,
    logoPosition: needsLookUpgrade
      ? defaults.logoPosition
      : salesOrderLogoPosition(templateId, input),
    metaStyle: needsLookUpgrade
      ? defaults.metaStyle
      : salesOrderMetaStyle(templateId, input),
    paperSize: needsLookUpgrade
      ? defaults.paperSize
      : input.paperSize === "A5" ||
          input.paperSize === "A4" ||
          input.paperSize === "Letter"
        ? input.paperSize
        : defaults.paperSize,
    orientation: needsLookUpgrade
      ? defaults.orientation
      : input.orientation === "landscape" || input.orientation === "portrait"
        ? input.orientation
        : defaults.orientation,
    margins: needsLookUpgrade
      ? { ...defaults.margins }
      : { ...defaults.margins, ...input.margins },
    terms:
      typeof input.terms === "string" && input.terms.trim() !== ""
        ? input.terms
        : defaults.terms,
    fontFamily: needsLookUpgrade
      ? defaults.fontFamily
      : typeof input.fontFamily === "string" && input.fontFamily.trim()
        ? input.fontFamily
        : defaults.fontFamily,
    backgroundColor: needsLookUpgrade
      ? defaults.backgroundColor
      : typeof input.backgroundColor === "string" && input.backgroundColor.trim()
        ? input.backgroundColor
        : defaults.backgroundColor,
    appearance: (() => {
      // On look upgrade, use this template's preset colors only (ignore stale saves).
      const incoming =
        !needsLookUpgrade &&
        input.appearance &&
        typeof input.appearance === "object" &&
        !Array.isArray(input.appearance)
          ? (input.appearance as Partial<TemplateAppearance>)
          : {};
      return {
        ...defaults.appearance,
        ...incoming,
        bodyFontSize: clampAppearanceFontSize(
          incoming.bodyFontSize,
          defaults.appearance.bodyFontSize,
          8,
          18,
        ),
        titleFontSize: clampAppearanceFontSize(
          incoming.titleFontSize,
          defaults.appearance.titleFontSize,
          14,
          48,
        ),
        organizationFontSize: clampAppearanceFontSize(
          incoming.organizationFontSize,
          defaults.appearance.organizationFontSize,
          8,
          24,
        ),
        organizationDetailsFontSize: clampAppearanceFontSize(
          incoming.organizationDetailsFontSize,
          defaults.appearance.organizationDetailsFontSize,
          7,
          18,
        ),
        companyFontSize: clampAppearanceFontSize(
          incoming.companyFontSize,
          defaults.appearance.companyFontSize,
          8,
          24,
        ),
        customerNameFontSize: clampAppearanceFontSize(
          incoming.customerNameFontSize,
          defaults.appearance.customerNameFontSize,
          8,
          24,
        ),
        customerDetailsFontSize: clampAppearanceFontSize(
          incoming.customerDetailsFontSize,
          defaults.appearance.customerDetailsFontSize,
          7,
          18,
        ),
        addressLabelFontSize: clampAppearanceFontSize(
          incoming.addressLabelFontSize,
          defaults.appearance.addressLabelFontSize,
          7,
          18,
        ),
        orderNumberFontSize: clampAppearanceFontSize(
          incoming.orderNumberFontSize,
          defaults.appearance.orderNumberFontSize,
          8,
          24,
        ),
        metadataFontSize: clampAppearanceFontSize(
          incoming.metadataFontSize,
          defaults.appearance.metadataFontSize,
          7,
          18,
        ),
        tableHeaderFontSize: clampAppearanceFontSize(
          incoming.tableHeaderFontSize,
          defaults.appearance.tableHeaderFontSize,
          7,
          18,
        ),
        tableBodyFontSize: clampAppearanceFontSize(
          incoming.tableBodyFontSize,
          defaults.appearance.tableBodyFontSize,
          7,
          18,
        ),
        totalsFontSize: clampAppearanceFontSize(
          incoming.totalsFontSize,
          defaults.appearance.totalsFontSize,
          8,
          20,
        ),
        paymentStatusLabelFontSize: clampAppearanceFontSize(
          incoming.paymentStatusLabelFontSize,
          defaults.appearance.paymentStatusLabelFontSize,
          7,
          18,
        ),
        paymentStatusValueFontSize: clampAppearanceFontSize(
          incoming.paymentStatusValueFontSize,
          defaults.appearance.paymentStatusValueFontSize,
          7,
          18,
        ),
        taxSummaryTitleFontSize: clampAppearanceFontSize(
          incoming.taxSummaryTitleFontSize,
          defaults.appearance.taxSummaryTitleFontSize,
          7,
          18,
        ),
        taxSummaryHeaderFontSize: clampAppearanceFontSize(
          incoming.taxSummaryHeaderFontSize,
          defaults.appearance.taxSummaryHeaderFontSize,
          7,
          18,
        ),
        taxSummaryBodyFontSize: clampAppearanceFontSize(
          incoming.taxSummaryBodyFontSize,
          defaults.appearance.taxSummaryBodyFontSize,
          7,
          18,
        ),
        notesLabelFontSize: clampAppearanceFontSize(
          incoming.notesLabelFontSize ??
            (incoming as { notesFontSize?: number }).notesFontSize,
          defaults.appearance.notesLabelFontSize,
          7,
          18,
        ),
        notesBodyFontSize: clampAppearanceFontSize(
          incoming.notesBodyFontSize ??
            (incoming as { notesFontSize?: number }).notesFontSize,
          defaults.appearance.notesBodyFontSize,
          7,
          18,
        ),
        termsLabelFontSize: clampAppearanceFontSize(
          incoming.termsLabelFontSize ??
            (incoming as { termsFontSize?: number }).termsFontSize,
          defaults.appearance.termsLabelFontSize,
          7,
          18,
        ),
        termsBodyFontSize: clampAppearanceFontSize(
          incoming.termsBodyFontSize ??
            (incoming as { termsFontSize?: number }).termsFontSize,
          defaults.appearance.termsBodyFontSize,
          7,
          18,
        ),
        notesLabelColor:
          incoming.notesLabelColor ??
          (incoming as { notesColor?: string }).notesColor ??
          defaults.appearance.notesLabelColor,
        notesBodyColor:
          incoming.notesBodyColor ??
          (incoming as { notesColor?: string }).notesColor ??
          defaults.appearance.notesBodyColor,
        termsLabelColor:
          incoming.termsLabelColor ??
          (incoming as { termsColor?: string }).termsColor ??
          defaults.appearance.termsLabelColor,
        termsBodyColor:
          incoming.termsBodyColor ??
          (incoming as { termsColor?: string }).termsColor ??
          defaults.appearance.termsBodyColor,
        paymentStatusLabelColor:
          incoming.paymentStatusLabelColor ??
          defaults.appearance.paymentStatusLabelColor,
        paymentStatusValueColor:
          incoming.paymentStatusValueColor ??
          defaults.appearance.paymentStatusValueColor,
        paymentStatusBorderColor:
          incoming.paymentStatusBorderColor ??
          defaults.appearance.paymentStatusBorderColor,
        taxSummaryTitleColor:
          incoming.taxSummaryTitleColor ??
          defaults.appearance.taxSummaryTitleColor,
        taxSummaryHeaderBackground:
          incoming.taxSummaryHeaderBackground ??
          defaults.appearance.taxSummaryHeaderBackground,
        taxSummaryHeaderText:
          incoming.taxSummaryHeaderText ??
          defaults.appearance.taxSummaryHeaderText,
        taxSummaryTextColor:
          incoming.taxSummaryTextColor ??
          defaults.appearance.taxSummaryTextColor,
        taxSummaryBorderColor:
          incoming.taxSummaryBorderColor ??
          defaults.appearance.taxSummaryBorderColor,
      };
    })(),
    header: (() => {
      const incoming =
        input.header &&
        typeof input.header === "object" &&
        !Array.isArray(input.header)
          ? (input.header as Partial<TemplateEditorSettings["header"]>)
          : {};
      const merged = { ...defaults.header, ...incoming };
      const legacyShow = merged.showCustomer !== false;
      const showBilling =
        typeof incoming.showBilling === "boolean"
          ? incoming.showBilling
          : legacyShow;
      const showShipping =
        typeof incoming.showShipping === "boolean"
          ? incoming.showShipping
          : legacyShow;
      const showCustomerDetails =
        typeof incoming.showCustomerDetails === "boolean"
          ? incoming.showCustomerDetails
          : legacyShow;
      return {
        ...merged,
        showBilling,
        showShipping,
        showCustomerDetails,
        showCustomer: showBilling || showShipping || showCustomerDetails,
        showExpectedShipmentDate: merged.showExpectedShipmentDate === true,
        showPaymentMethod: merged.showPaymentMethod !== false,
      };
    })(),
    billingDetails: Array.isArray(input.billingDetails)
      ? input.billingDetails
      : defaults.billingDetails,
    shippingDetails: Array.isArray(input.shippingDetails)
      ? input.shippingDetails
      : defaults.shippingDetails,
    customerBlockDetails: Array.isArray(input.customerBlockDetails)
      ? input.customerBlockDetails
      : defaults.customerBlockDetails,
    transactionLabels: {
      organization:
        input.transactionLabels?.organization ??
        defaults.transactionLabels.organization,
      customer:
        input.transactionLabels?.customer ?? defaults.transactionLabels.customer,
      shipping:
        input.transactionLabels?.shipping ?? defaults.transactionLabels.shipping,
      customerDetails:
        input.transactionLabels?.customerDetails ??
        defaults.transactionLabels.customerDetails,
      documentTitle:
        input.transactionLabels?.documentTitle ??
        defaults.transactionLabels.documentTitle,
      orderNumber:
        input.transactionLabels?.orderNumber ??
        defaults.transactionLabels.orderNumber,
      date: input.transactionLabels?.date ?? defaults.transactionLabels.date,
      reference:
        input.transactionLabels?.reference ??
        defaults.transactionLabels.reference,
      expectedShipmentDate:
        input.transactionLabels?.expectedShipmentDate ??
        defaults.transactionLabels.expectedShipmentDate,
      paymentMethod:
        input.transactionLabels?.paymentMethod ??
        defaults.transactionLabels.paymentMethod,
    },
    numbering: (() => {
      const incoming =
        input.numbering &&
        typeof input.numbering === "object" &&
        !Array.isArray(input.numbering)
          ? (input.numbering as Partial<TemplateEditorSettings["numbering"]>)
          : {};
      const rawStarting =
        typeof incoming.startingNumber === "string" ||
        typeof incoming.startingNumber === "number"
          ? String(incoming.startingNumber)
          : defaults.numbering.startingNumber;
      const digitsOnly = rawStarting.replace(/\D/g, "");
      return {
        prefix:
          typeof incoming.prefix === "string"
            ? incoming.prefix
            : defaults.numbering.prefix,
        startingNumber:
          digitsOnly.length > 0
            ? digitsOnly
            : defaults.numbering.startingNumber,
        suffix:
          typeof incoming.suffix === "string"
            ? incoming.suffix
            : defaults.numbering.suffix,
      };
    })(),
    columns: Array.isArray(input.columns)
      ? (() => {
          const mapped = input.columns.map((column) => {
            if (!column || typeof column !== "object" || !("key" in column)) {
              return column;
            }
            let next = column as TemplateEditorSettings["columns"][number];
            if (next.key === "ean") {
              next = {
                ...next,
                key: "sku",
                label:
                  typeof next.label === "string" &&
                  next.label !== "EAN" &&
                  next.label.trim()
                    ? next.label
                    : "SKU",
                enabled: true,
              };
            }
            if (next.key === "rate") {
              next = {
                ...next,
                showComparePrice: next.showComparePrice !== false,
                label:
                  !next.label?.trim() || next.label.trim() === "Unit Price"
                    ? "Rate"
                    : next.label,
              };
            }
            if (next.key === "item") {
              const imageSize =
                next.imageSize === "small" ||
                next.imageSize === "medium" ||
                next.imageSize === "large"
                  ? next.imageSize
                  : "medium";
              const preset = getSalesOrderTemplatePreset(templateId);
              const allowImages = preset.admin.productImages === true;
              next = {
                ...next,
                showImage: allowImages && next.showImage === true,
                imageSize,
              };
            }
            return next;
          });
          const savedKeys = new Set(
            mapped
              .filter(
                (column): column is TemplateEditorSettings["columns"][number] =>
                  Boolean(
                    column &&
                      typeof column === "object" &&
                      "key" in column &&
                      typeof column.key === "string",
                  ),
              )
              .map((column) => column.key),
          );
          const merged = [...mapped];
          for (const column of defaults.columns) {
            if (!savedKeys.has(column.key)) {
              const insertAfter = defaults.columns
                .slice(
                  0,
                  defaults.columns.findIndex((item) => item.key === column.key),
                )
                .map((item) => item.key)
                .reverse()
                .find((key) => savedKeys.has(key));
              const insertIndex = insertAfter
                ? merged.findIndex(
                    (item) =>
                      item &&
                      typeof item === "object" &&
                      "key" in item &&
                      item.key === insertAfter,
                  ) + 1
                : 0;
              merged.splice(insertIndex, 0, column);
              savedKeys.add(column.key);
            }
          }
          const skuIndex = merged.findIndex(
            (column) =>
              column &&
              typeof column === "object" &&
              "key" in column &&
              column.key === "sku",
          );
          const qtyIndex = merged.findIndex(
            (column) =>
              column &&
              typeof column === "object" &&
              "key" in column &&
              column.key === "quantity",
          );
          if (skuIndex >= 0 && qtyIndex >= 0 && skuIndex > qtyIndex) {
            const next = [...merged];
            const [skuColumn] = next.splice(skuIndex, 1);
            next.splice(qtyIndex, 0, skuColumn);
            return next;
          }
          return merged;
        })()
      : defaults.columns,
    selectedCustomFields: Array.isArray(input.selectedCustomFields)
      ? input.selectedCustomFields
      : defaults.selectedCustomFields,
    totals: isPremiumSales
      ? {
          ...totals,
          showPaidAmount: true,
          showBalanceDue: true,
          ...(needsLookUpgrade
            ? {
                paymentStatusStyle: defaults.totals.paymentStatusStyle,
                showSubtotal: defaults.totals.showSubtotal,
                showTaxLines: defaults.totals.showTaxLines,
                showDiscountAmount: defaults.totals.showDiscountAmount,
                showShippingPrice: defaults.totals.showShippingPrice,
                showVatAmount: defaults.totals.showVatAmount,
                subtotalLabel: defaults.totals.subtotalLabel,
                discountAmountLabel: defaults.totals.discountAmountLabel,
                shippingPriceLabel: defaults.totals.shippingPriceLabel,
                vatAmountLabel: defaults.totals.vatAmountLabel,
                paidAmountLabel: defaults.totals.paidAmountLabel,
                balanceDueLabel: defaults.totals.balanceDueLabel,
                totalLabel: defaults.totals.totalLabel,
              }
            : {}),
        }
      : totals,
  };
}

export type { StoreDetails };
export { formatStoreAddressLines };
