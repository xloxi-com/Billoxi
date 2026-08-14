import {
  memo,
  lazy,
  startTransition,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import {
  cachedClientLoader,
  createAppPageClientCache,
} from "../client-page-cache";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { renderEmbeddedRouteError } from "../embedded-route-error";
import {
  AppProvider,
  Banner,
  Bleed,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Collapsible,
  ColorPicker,
  Divider,
  FormLayout,
  Icon,
  InlineGrid,
  InlineStack,
  Popover,
  RadioButton,
  RangeSlider,
  OptionList,
  Select,
  Tabs,
  Text,
  TextField,
  Thumbnail,
  hsbToHex,
  hexToRgb,
  rgbToHsb,
} from "@shopify/polaris";
import type { HSBAColor } from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon, DragHandleIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";
import type { Prisma } from "@prisma/client";

import prisma from "../db.server";
import { requireAdminAuth } from "../shopify-context.server";
import {
  formatStoreAddressLines,
  type StoreDetails,
} from "../store-details";
import { loadNumberSeriesEntryForShop, loadStoreDetailsForShop } from "../shop-settings.server";
import { numberingFromSeries } from "../number-series";
import { fetchShopCurrencyCode } from "../store-details.server";
import { invalidateDocumentTemplateSettingsCache } from "../sales-order-document.server";
import {
  defaultColumnsForPreset,
  defaultTemplateSettings,
  findTemplatePreset,
  getSalesOrderTemplatePreset,
  getTemplateAdminCapabilities,
  isPremiumTemplatePreset,
  mergeTaxSummarySettings,
  mergeTotalsSettings,
  normalizeTemplateDateFormat,
  normalizeTemplateCurrencyDisplay,
  paperPaddingCss,
  PAYMENT_STATUS_STYLES,
  PREMIUM_DESIGN_VERSION,
  SALES_ORDER_TEMPLATE_PRESETS,
  INVOICE_TEMPLATE_PRESETS,
  DRAFT_TEMPLATE_PRESETS,
  CREDIT_NOTE_TEMPLATE_PRESETS,
  PACKING_SLIP_TEMPLATE_PRESETS,
  RETURN_TEMPLATE_PRESETS,
  salesOrderLogoPosition,
  salesOrderMetaStyle,
  TEMPLATE_DATE_FORMATS,
  TEMPLATE_CURRENCY_DISPLAYS,
  DEFAULT_TEMPLATE_DATE_FORMAT,
  DEFAULT_TEMPLATE_CURRENCY_DISPLAY,
  type PaymentStatusStyle,
  type SalesOrderLogoPosition,
  type SalesOrderMetaStyle,
  type AddressBlockKey,
  type TemplateDateFormat,
  type TemplateCurrencyDisplay,
  normalizeAddressBlockOrder,
  DEFAULT_ADDRESS_BLOCK_ORDER,
  resolveDocumentNotes,
  customerMetafieldDetailKey,
  isCustomerMetafieldDetailKey,
  parseCustomerMetafieldDetailKey,
} from "../sales-order-document";
import {
  syncNumberCounter,
} from "../sales-order-number.server";
import { sampleSalesOrderForShop, sampleCreditNoteForShop } from "../sales-order-sample";
import { PaperScaleFrame } from "../components/paper-scale-frame";
import { PageLoader } from "../components/page-loader";
import { templatePreviewLogoDataUrl } from "../template-preview-logo";
import { useAdminI18n } from "../admin-i18n-context";
import {
  teT,
  teTf,
  teSectionTabLabel,
  teDocumentBreadcrumb,
  teCustomerFieldLabel,
  teColumnFieldLabel,
  type TemplateEditorMessageKey,
} from "../admin-template-editor-i18n";

const SalesOrderLiveDocument = lazy(() =>
  import("../components/sales-order-live-document").then((mod) => ({
    default: mod.SalesOrderLiveDocument,
  })),
);
import {
  TEMPLATE_LANGUAGES,
  applyTemplateLanguageLabels,
  isBuiltInTemplateBody,
  normalizeTemplateLanguage,
  type TemplateLanguage,
} from "../template-labels";
import "../template-editor.css";
import "../sales-order-document.css";

type EditorSection =
  | "general"
  | "appearance"
  | "transaction"
  | "table"
  | "total"
  | "other";

type TemplateColumn = {
  key: string;
  enabled: boolean;
  width: number;
  label: string;
  showUnit?: boolean;
  showComparePrice?: boolean;
  showImage?: boolean;
  imageSize?: "small" | "medium" | "large";
  showBelowItem?: boolean;
};

type CustomFieldKind = "metafield" | "metaobject";

type CustomFieldSource = {
  id: string;
  kind: CustomFieldKind;
  name: string;
  typeName: string;
  namespace?: string;
  key?: string;
  ownerType?: string;
  metaobjectType?: string;
};

type SelectedCustomField = {
  id: string;
  kind: CustomFieldKind;
  name: string;
  width?: number;
  namespace?: string;
  key?: string;
  ownerType?: string;
  metaobjectType?: string;
};

type CustomerDetailKey =
  | "company"
  | "name"
  | "address"
  | "vatNumber"
  | "phone"
  | "email";

type CustomerDetailField = {
  key: string;
  enabled: boolean;
  label: string;
};

type TemplateAppearance = {
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
  unitPriceColor: string;
  comparePriceColor: string;
  bodyFontSize: number;
  titleFontSize: number;
  organizationFontSize: number;
  organizationDetailsFontSize: number;
  companyFontSize: number;
  customerNameFontSize: number;
  customerDetailsFontSize: number;
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

type TemplateEditorSettings = {
  name: string;
  /** Document label language (Bill To, totals, columns, etc.). */
  language: TemplateLanguage;
  /** How order / document dates render on the template. */
  dateFormat: TemplateDateFormat;
  /** Currency as symbol ($) or ISO letters (USD). */
  currencyDisplay: TemplateCurrencyDisplay;
  paperSize: "A5" | "A4" | "Letter";
  orientation: "portrait" | "landscape";
  margins: { top: number; bottom: number; left: number; right: number };
  /** Premium look upgrade marker (v2 = tax/paid/due + preset colors/fonts). */
  designVersion?: number;
  /**
   * After this is saved once, `header.showShopifyOrder` is honored.
   * Until then Shopify Order# stays off (product default).
   */
  shopifyOrderDefaultReset?: boolean;
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
  logoPosition: SalesOrderLogoPosition;
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
    showReference: boolean;
    showShopifyOrder: boolean;
    showExpectedShipmentDate: boolean;
    showPaymentMethod: boolean;
  };
  billingDetails: CustomerDetailField[];
  shippingDetails: CustomerDetailField[];
  customerBlockDetails: CustomerDetailField[];
  addressBlockOrder: AddressBlockKey[];
  transactionLabels: {
    organization: string;
    customer: string;
    shipping: string;
    customerDetails: string;
    documentTitle: string;
    orderNumber: string;
    date: string;
    reference: string;
    shopifyOrder: string;
    expectedShipmentDate: string;
    paymentMethod: string;
  };
  numbering: {
    prefix: string;
    startingNumber: string;
    suffix: string;
  };
  columns: TemplateColumn[];
  selectedCustomFields: SelectedCustomField[];
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
    totalLabel: string;
  };
  notesLabel: string;
  notes: string;
  preferShopifyOrderNote: boolean;
  termsLabel: string;
  terms: string;
  showSignature: boolean;
  showStamp: boolean;
};

const baseDefaultAppearance: TemplateAppearance = {
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

function normalizeHexColor(value: string, fallback: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((ch) => ch + ch)
      .join("")}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

function hexToHsba(value: string, fallback: string): HSBAColor {
  const hex = normalizeHexColor(value, fallback);
  return { ...rgbToHsb(hexToRgb(hex)), alpha: 1 };
}

function AppearanceSizeField({
  label,
  value,
  min,
  max,
  fallback,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  fallback: number;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    const next = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : fallback;
    setDraft(String(next));
    onChange(next);
  };

  return (
    <TextField
      label={label}
      type="number"
      inputMode="numeric"
      autoComplete="off"
      suffix="px"
      min={min}
      max={max}
      step={1}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(next) => {
        setDraft(next);
        if (next === "") return;
        const parsed = Number(next);
        if (!Number.isFinite(parsed)) return;
        const clamped = Math.min(max, Math.max(min, parsed));
        if (clamped !== parsed) {
          setDraft(String(clamped));
        }
        onChange(clamped);
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit(draft);
      }}
    />
  );
}

function AppearanceColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (next: string) => void;
}) {
  const { language } = useAdminI18n();
  const hex = normalizeHexColor(value, fallback);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hsb, setHsb] = useState<HSBAColor>(() => hexToHsba(hex, fallback));
  const [draft, setDraft] = useState(hex);
  const rafRef = useRef<number | null>(null);
  const pendingHexRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (pickerOpen) return;
    setDraft(hex);
    setHsb(hexToHsba(hex, fallback));
  }, [hex, fallback, pickerOpen]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const commitHex = (next: string, immediate = false) => {
    const normalized = normalizeHexColor(next, fallback);
    setDraft(normalized);
    setHsb(hexToHsba(normalized, fallback));
    if (immediate) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingHexRef.current = null;
      onChangeRef.current(normalized);
      return;
    }
    pendingHexRef.current = normalized;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingHexRef.current;
      pendingHexRef.current = null;
      if (pending) onChangeRef.current(pending);
    });
  };

  return (
    <TextField
      label={label}
      value={draft}
      autoComplete="off"
      onChange={(next) => {
        setDraft(next);
        const trimmed = next.trim();
        const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
        if (
          /^#[0-9a-fA-F]{6}$/i.test(withHash) ||
          /^#[0-9a-fA-F]{3}$/i.test(withHash)
        ) {
          commitHex(withHash);
        }
      }}
      onBlur={() => commitHex(draft, true)}
      prefix={
        <Popover
          active={pickerOpen}
          preferredAlignment="left"
          onClose={() => {
            if (pendingHexRef.current) {
              commitHex(pendingHexRef.current, true);
            }
            setPickerOpen(false);
          }}
          activator={
            <button
              type="button"
              className="template-editor__color-swatch"
              style={{ backgroundColor: draft }}
              aria-label={teTf(language, "te.pickColor", { name: label })}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            />
          }
        >
          <Box padding="300">
            <BlockStack gap="200">
              <ColorPicker
                color={hsb}
                onChange={(color) => {
                  setHsb(color);
                  const next = hsbToHex(color).toUpperCase();
                  setDraft(next);
                  commitHex(next);
                }}
              />
              <TextField
                label={teT(language, "te.hex")}
                labelHidden
                value={draft}
                autoComplete="off"
                onChange={(next) => {
                  setDraft(next);
                  const trimmed = next.trim();
                  const withHash = trimmed.startsWith("#")
                    ? trimmed
                    : `#${trimmed}`;
                  if (
                    /^#[0-9a-fA-F]{6}$/i.test(withHash) ||
                    /^#[0-9a-fA-F]{3}$/i.test(withHash)
                  ) {
                    commitHex(withHash);
                  }
                }}
              />
            </BlockStack>
          </Box>
        </Popover>
      }
    />
  );
}

const templateDefinitions: Record<
  string,
  { documentType: string; name: string }
> = {
  ...Object.fromEntries(
    SALES_ORDER_TEMPLATE_PRESETS.map((preset) => [
      preset.id,
      { documentType: "sales-order", name: preset.name },
    ]),
  ),
  ...Object.fromEntries(
    INVOICE_TEMPLATE_PRESETS.map((preset) => [
      preset.id,
      { documentType: "invoice", name: preset.name },
    ]),
  ),
  ...Object.fromEntries(
    DRAFT_TEMPLATE_PRESETS.map((preset) => [
      preset.id,
      { documentType: "draft", name: preset.name },
    ]),
  ),
  ...Object.fromEntries(
    CREDIT_NOTE_TEMPLATE_PRESETS.map((preset) => [
      preset.id,
      { documentType: "credit-note", name: preset.name },
    ]),
  ),
  ...Object.fromEntries(
    PACKING_SLIP_TEMPLATE_PRESETS.map((preset) => [
      preset.id,
      { documentType: "packing-slip", name: preset.name },
    ]),
  ),
  ...Object.fromEntries(
    RETURN_TEMPLATE_PRESETS.map((preset) => [
      preset.id,
      { documentType: "return", name: preset.name },
    ]),
  ),
};

const removedColumnKeys = new Set([
  "upc",
  "mpn",
  "isbn",
  "brand",
  "manufacturer",
]);

const defaultColumns: TemplateColumn[] = [
  { key: "number", enabled: true, width: 4, label: "#" },
  { key: "item", enabled: true, width: 36, label: "Item", showImage: false },
  { key: "custom", enabled: false, width: 12, label: "Custom" },
  { key: "sku", enabled: true, width: 12, label: "SKU" },
  {
    key: "barcode",
    enabled: false,
    width: 12,
    label: "Barcode",
  },
  { key: "quantity", enabled: true, width: 10, label: "Qty", showUnit: false },
  { key: "rate", enabled: true, width: 10, label: "Rate", showComparePrice: true },
  { key: "discount", enabled: false, width: 10, label: "Discount" },
  { key: "discountPercentage", enabled: false, width: 10, label: "Discount %" },
  { key: "taxPercentage", enabled: false, width: 10, label: "Tax %" },
  { key: "taxAmount", enabled: false, width: 10, label: "Tax" },
  { key: "amount", enabled: true, width: 12, label: "Amount" },
];

const columnFieldLabels: Record<string, string> = {
  number: "Number",
  item: "Item",
  custom: "Custom",
  sku: "SKU",
  barcode: "Barcode",
  quantity: "Qty",
  rate: "Rate",
  discount: "Discount",
  discountPercentage: "Discount %",
  taxPercentage: "Tax %",
  taxAmount: "Tax",
  amount: "Amount",
};

const defaultBillingDetails: CustomerDetailField[] = [
  { key: "company", enabled: true, label: "Company" },
  { key: "name", enabled: true, label: "Name" },
  { key: "address", enabled: true, label: "Address" },
  { key: "phone", enabled: true, label: "Phone" },
  { key: "email", enabled: true, label: "Email" },
];

const defaultShippingDetails: CustomerDetailField[] = [
  { key: "company", enabled: true, label: "Company" },
  { key: "name", enabled: true, label: "Name" },
  { key: "address", enabled: true, label: "Address" },
  { key: "phone", enabled: true, label: "Phone" },
  { key: "email", enabled: true, label: "Email" },
];

const defaultCustomerBlockDetails: CustomerDetailField[] = [
  { key: "company", enabled: true, label: "Company" },
  { key: "name", enabled: true, label: "Name" },
  { key: "address", enabled: true, label: "Address" },
  { key: "phone", enabled: true, label: "Phone" },
  { key: "email", enabled: true, label: "Email" },
];

const customerDetailFallbacks: Record<CustomerDetailKey, string> = {
  company: "Company",
  name: "First name and last name",
  address: "Address",
  vatNumber: "VAT number",
  phone: "Phone",
  email: "Email",
};

const customerDetailKeysWithLabel: ReadonlySet<CustomerDetailKey> = new Set([
  "phone",
  "email",
]);

type AddressSection = "billing" | "shipping" | "customer";

function isCustomerDetailKey(value: unknown): value is CustomerDetailKey {
  return typeof value === "string" && value in customerDetailFallbacks;
}

function normalizeCustomerDetails(
  value: unknown,
  defaults: CustomerDetailField[],
  options?: { allowMetafieldKeys?: boolean },
): CustomerDetailField[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const normalized: CustomerDetailField[] = [];
    let mergedName: CustomerDetailField | null = null;

    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const field = entry as {
        key?: string;
        enabled?: boolean;
        label?: string;
      };

      // Migrate legacy firstName / lastName rows into a single Name field.
      if (field.key === "firstName" || field.key === "lastName") {
        if (!mergedName) {
          mergedName = {
            key: "name",
            enabled: field.enabled !== false,
            label: "Name",
          };
        } else if (field.enabled !== false) {
          mergedName.enabled = true;
        }
        continue;
      }

      if (!field.key || seen.has(field.key)) continue;
      const isMetafield =
        options?.allowMetafieldKeys && isCustomerMetafieldDetailKey(field.key);
      if (!isMetafield) {
        if (!isCustomerDetailKey(field.key)) continue;
        // Keep only keys that belong in this section's defaults.
        if (!defaults.some((item) => item.key === field.key)) continue;
      }
      seen.add(field.key);
      normalized.push({
        key: field.key,
        enabled: field.enabled !== false,
        label:
          typeof field.label === "string" && field.label.trim()
            ? field.label
            : isCustomerDetailKey(field.key)
              ? customerDetailFallbacks[field.key]
              : field.key,
      });
    }

    if (mergedName && !seen.has("name") && defaults.some((item) => item.key === "name")) {
      const companyIndex = normalized.findIndex((field) => field.key === "company");
      const insertAt = companyIndex >= 0 ? companyIndex + 1 : 0;
      normalized.splice(insertAt, 0, mergedName);
      seen.add("name");
    }

    for (const field of defaults) {
      if (!seen.has(field.key)) normalized.push({ ...field });
    }

    return normalized;
  }

  if (value && typeof value === "object") {
    const legacy = value as Record<string, unknown>;
    return defaults.map((field) => {
      if (field.key === "name") {
        const showFirst =
          typeof legacy.showFirstName === "boolean"
            ? legacy.showFirstName
            : undefined;
        const showLast =
          typeof legacy.showLastName === "boolean"
            ? legacy.showLastName
            : undefined;
        const enabled =
          showFirst === undefined && showLast === undefined
            ? field.enabled
            : Boolean(showFirst || showLast);

        return {
          key: "name",
          enabled,
          label:
            typeof legacy.nameLabel === "string" && legacy.nameLabel.trim()
              ? legacy.nameLabel
              : field.label,
        };
      }

      const showKey = `show${field.key[0].toUpperCase()}${field.key.slice(1)}`;
      const labelKey = `${field.key}Label`;
      return {
        key: field.key,
        enabled:
          typeof legacy[showKey] === "boolean"
            ? (legacy[showKey] as boolean)
            : field.enabled,
        label:
          typeof legacy[labelKey] === "string" &&
          (legacy[labelKey] as string).trim()
            ? (legacy[labelKey] as string)
            : field.label,
      };
    });
  }

  return defaults.map((field) => ({ ...field }));
}

const fontOptions: Array<{ label: string; value: string }> = [
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Roboto", value: "Roboto, Helvetica, Arial, sans-serif" },
  { label: "Open Sans", value: "'Open Sans', Helvetica, Arial, sans-serif" },
  { label: "Lato", value: "Lato, Helvetica, Arial, sans-serif" },
  { label: "Source Sans 3", value: "'Source Sans 3', Helvetica, Arial, sans-serif" },
  { label: "IBM Plex Sans", value: "'IBM Plex Sans', Helvetica, Arial, sans-serif" },
  { label: "Nunito Sans", value: "'Nunito Sans', Helvetica, Arial, sans-serif" },
  { label: "Work Sans", value: "'Work Sans', Helvetica, Arial, sans-serif" },
  { label: "DM Sans", value: "'DM Sans', Helvetica, Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Merriweather", value: "Merriweather, Georgia, serif" },
  { label: "Source Serif 4", value: "'Source Serif 4', Georgia, serif" },
  { label: "Libre Baskerville", value: "'Libre Baskerville', Georgia, serif" },
  { label: "Lora", value: "Lora, Georgia, serif" },
  { label: "EB Garamond", value: "'EB Garamond', Georgia, serif" },
  { label: "Playfair Display", value: "'Playfair Display', Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
];

const defaultFontFamily = fontOptions[0].value;

function resolveFontFamily(value: string | undefined): string {
  if (!value) return defaultFontFamily;
  if (fontOptions.some((font) => font.value === value)) return value;
  // Migrate legacy short names saved before stacks were introduced
  const legacy = fontOptions.find(
    (font) =>
      font.label === value ||
      font.value.toLowerCase().startsWith(value.toLowerCase()),
  );
  return legacy?.value ?? defaultFontFamily;
}

function createDefaultSettings(
  name: string,
  templateId?: string,
): TemplateEditorSettings {
  return defaultTemplateSettings(
    name,
    templateId ?? "sales-standard",
  ) as TemplateEditorSettings;
}

function expectedDocumentTitle(documentType: string): string {
  switch (documentType) {
    case "invoice":
      return "INVOICE";
    case "draft":
      return "DRAFT";
    case "credit-note":
      return "CREDIT NOTE";
    case "packing-slip":
      return "PACKING SLIP";
    case "return":
      return "RETURN";
    default:
      return "SALES ORDER";
  }
}

function reconcileSettingsForDocumentType(
  settings: TemplateEditorSettings,
  documentType: string,
  templateName: string,
  templateId: string,
): TemplateEditorSettings {
  const defaults = defaultTemplateSettings(templateName, templateId);
  const language = normalizeTemplateLanguage(settings.language);
  let next = applyTemplateLanguageLabels(settings, language, {
    documentType,
    organizationName: settings.transactionLabels.organization,
    translateBodyText: {
      notes: isBuiltInTemplateBody(settings.notes),
      terms: isBuiltInTemplateBody(settings.terms),
    },
  });

  // Pin document-type header defaults, then keep merchant toggles on top.
  next = {
    ...next,
    header: { ...defaults.header, ...next.header },
  };

  // Repair stale saves where title/order labels belong to another document type.
  const expectedEn = expectedDocumentTitle(documentType);
  const title = settings.transactionLabels.documentTitle?.trim() ?? "";
  const orderLabel = settings.transactionLabels.orderNumber?.trim() ?? "";
  const knownTitles = new Set([
    "SALES ORDER",
    "INVOICE",
    "DRAFT",
    "CREDIT NOTE",
    "PACKING SLIP",
    "RETURN",
  ]);
  const titleMismatch =
    knownTitles.has(title) && title !== expectedEn;
  const orderMismatch =
    (orderLabel === "Sales Order#" && documentType !== "sales-order") ||
    (orderLabel === "Invoice#" && documentType !== "invoice") ||
    (orderLabel === "Draft#" && documentType !== "draft") ||
    (orderLabel === "Credit Note#" && documentType !== "credit-note") ||
    (orderLabel === "Packing Slip#" && documentType !== "packing-slip") ||
    (orderLabel === "Return#" && documentType !== "return");

  if (titleMismatch || orderMismatch) {
    next = {
      ...next,
      totals: { ...next.totals, ...defaults.totals },
      columns: defaults.columns.map((column, index) => {
        const saved = next.columns[index];
        return saved ? { ...column, ...saved, key: column.key } : column;
      }),
    };
    // Re-apply language after repairing totals so CN/PS totals stay translated.
    next = applyTemplateLanguageLabels(next, language, {
      documentType,
      organizationName: next.transactionLabels.organization,
      translateBodyText: {
        notes: isBuiltInTemplateBody(next.notes),
        terms: isBuiltInTemplateBody(next.terms),
      },
    });
    next = {
      ...next,
      header: { ...defaults.header, ...next.header },
    };
  }

  // Draft / packing / return are not payment documents — keep Paid / Balance Due off.
  if (
    documentType === "draft" ||
    documentType === "packing-slip" ||
    documentType === "return"
  ) {
    next = {
      ...next,
      header: { ...next.header, showPaymentMethod: false },
      totals: {
        ...next.totals,
        showPaidAmount: false,
        showBalanceDue: false,
      },
    };
  }

  // Sales Order# is already under the title — no Ref# / Shopify Order# meta rows.
  if (documentType === "sales-order") {
    next = {
      ...next,
      header: {
        ...next.header,
        showReference: false,
        showShopifyOrder: false,
      },
    };
  }

  return next;
}

function mergeSettings(
  value: unknown,
  defaultName: string,
  templateId?: string,
): TemplateEditorSettings {
  const defaults = createDefaultSettings(defaultName, templateId);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaults, shopifyOrderDefaultReset: true };
  }

  const input = value as Partial<TemplateEditorSettings> & {
    customerDetails?: unknown;
  };
  const { customerDetails: legacyCustomerDetails, ...restInput } = input;
  const isPremiumSales = Boolean(
    templateId && isPremiumTemplatePreset(templateId),
  );
  const needsLookUpgrade =
    isPremiumSales &&
    Number(restInput.designVersion ?? 0) < PREMIUM_DESIGN_VERSION;
  const taxSummary = mergeTaxSummarySettings(
    restInput.taxSummary,
    (restInput as { showTaxSummaryTable?: boolean }).showTaxSummaryTable ===
      true,
    defaults.taxSummary.enabled,
  );
  const totals = mergeTotalsSettings(input.totals, defaults.totals);
  return {
    ...defaults,
    ...restInput,
    language: normalizeTemplateLanguage(restInput.language, defaults.language),
    dateFormat: normalizeTemplateDateFormat(
      restInput.dateFormat,
      defaults.dateFormat ?? DEFAULT_TEMPLATE_DATE_FORMAT,
    ),
    currencyDisplay: normalizeTemplateCurrencyDisplay(
      restInput.currencyDisplay,
      defaults.currencyDisplay ?? DEFAULT_TEMPLATE_CURRENCY_DISPLAY,
    ),
    designVersion: isPremiumSales
      ? PREMIUM_DESIGN_VERSION
      : Number(restInput.designVersion ?? 1) || 1,
    shopifyOrderDefaultReset: true,
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
    showSignature: restInput.showSignature === true,
    showStamp: restInput.showStamp === true,
    preferShopifyOrderNote: restInput.preferShopifyOrderNote === true,
    logoPosition: needsLookUpgrade
      ? defaults.logoPosition
      : salesOrderLogoPosition(
          templateId ?? "sales-standard",
          restInput,
        ),
    metaStyle: needsLookUpgrade
      ? defaults.metaStyle
      : salesOrderMetaStyle(
          templateId ?? "sales-standard",
          restInput,
        ),
    paperSize: needsLookUpgrade
      ? defaults.paperSize
      : restInput.paperSize === "A5" ||
          restInput.paperSize === "A4" ||
          restInput.paperSize === "Letter"
        ? restInput.paperSize
        : defaults.paperSize,
    orientation: needsLookUpgrade
      ? defaults.orientation
      : restInput.orientation === "landscape" ||
          restInput.orientation === "portrait"
        ? restInput.orientation
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
      : typeof restInput.fontFamily === "string" && restInput.fontFamily.trim()
        ? resolveFontFamily(restInput.fontFamily)
        : defaults.fontFamily,
    backgroundColor: needsLookUpgrade
      ? defaults.backgroundColor
      : typeof restInput.backgroundColor === "string" &&
          restInput.backgroundColor.trim()
        ? restInput.backgroundColor
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
          8,
          24,
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
        showReference: merged.showReference !== false,
        showShopifyOrder:
          restInput.shopifyOrderDefaultReset === true &&
          incoming.showShopifyOrder === true,
        showExpectedShipmentDate: merged.showExpectedShipmentDate === true,
        showPaymentMethod: merged.showPaymentMethod !== false,
      };
    })(),
    billingDetails: normalizeCustomerDetails(
      input.billingDetails ?? legacyCustomerDetails,
      defaultBillingDetails,
    ),
    shippingDetails: normalizeCustomerDetails(
      input.shippingDetails,
      defaultShippingDetails,
    ),
    customerBlockDetails: normalizeCustomerDetails(
      input.customerBlockDetails,
      defaultCustomerBlockDetails,
      { allowMetafieldKeys: true },
    ),
    addressBlockOrder: normalizeAddressBlockOrder(
      (input as { addressBlockOrder?: unknown }).addressBlockOrder,
    ),
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
      shopifyOrder:
        input.transactionLabels?.shopifyOrder ??
        defaults.transactionLabels.shopifyOrder ??
        "Shopify Order#",
      expectedShipmentDate:
        input.transactionLabels?.expectedShipmentDate ??
        defaults.transactionLabels.expectedShipmentDate,
      paymentMethod:
        input.transactionLabels?.paymentMethod ??
        defaults.transactionLabels.paymentMethod,
    },
    numbering: normalizeNumbering(input.numbering, defaults.numbering),
    columns: Array.isArray(input.columns)
      ? (() => {
          const saved = input.columns
            .filter(
              (column): column is TemplateColumn =>
                Boolean(
                  column &&
                    typeof column === "object" &&
                    !removedColumnKeys.has(
                      String((column as TemplateColumn).key),
                    ),
                ),
            )
            .map((column) => {
              let next =
                column.key === "ean"
                  ? {
                      ...column,
                      key: "barcode",
                      enabled: false,
                      label:
                        column.label === "EAN" ||
                        !column.label.trim() ||
                        column.label.trim() === "SKU"
                          ? "Barcode"
                          : column.label,
                    }
                  : column;
              if (next.key === "barcode") {
                next = {
                  ...next,
                  enabled: next.enabled === true,
                  showBelowItem: next.showBelowItem === true,
                  label: next.label?.trim() ? next.label : "Barcode",
                };
              }
              if (next.key === "sku") {
                next = {
                  ...next,
                  showBelowItem: next.showBelowItem === true,
                  width:
                    next.width === 10 ||
                    next.width === 11 ||
                    next.width === 14 ||
                    next.width === 16
                      ? 12
                      : next.width,
                };
              }
              if (next.key === "rate") {
                next = {
                  ...next,
                  showComparePrice: next.showComparePrice !== false,
                  label:
                    !next.label?.trim() ||
                    next.label.trim() === "Unit Price"
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
                next = {
                  ...next,
                  showImage:
                    (!templateId ||
                      getSalesOrderTemplatePreset(templateId).admin
                        .productImages) &&
                    next.showImage === true,
                  imageSize,
                };
              }
              return next;
            });
          const savedKeys = new Set(saved.map((column) => column.key));
          const merged = [...saved];
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
                ? merged.findIndex((item) => item.key === insertAfter) + 1
                : 0;
              merged.splice(insertIndex, 0, column);
              savedKeys.add(column.key);
            }
          }

          // Keep SKU before Qty when both exist.
          const skuIndex = merged.findIndex((column) => column.key === "sku");
          const qtyIndex = merged.findIndex(
            (column) => column.key === "quantity",
          );
          if (skuIndex >= 0 && qtyIndex >= 0 && skuIndex > qtyIndex) {
            const [skuColumn] = merged.splice(skuIndex, 1);
            merged.splice(qtyIndex, 0, skuColumn);
          }

          // Keep Barcode immediately after SKU.
          const skuAfter = merged.findIndex((column) => column.key === "sku");
          const barcodeIndex = merged.findIndex(
            (column) => column.key === "barcode",
          );
          if (skuAfter >= 0 && barcodeIndex >= 0 && barcodeIndex !== skuAfter + 1) {
            const [barcodeColumn] = merged.splice(barcodeIndex, 1);
            const insertAt =
              barcodeIndex < skuAfter ? skuAfter : skuAfter + 1;
            merged.splice(insertAt, 0, barcodeColumn);
          }

          return merged;
        })()
      : defaults.columns,
    selectedCustomFields: normalizeSelectedCustomFields(
      input.selectedCustomFields,
    ),
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

function normalizeNumbering(
  value: unknown,
  defaults: TemplateEditorSettings["numbering"],
): TemplateEditorSettings["numbering"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaults };
  }
  const input = value as Partial<TemplateEditorSettings["numbering"]>;
  const rawStarting =
    typeof input.startingNumber === "string" ||
    typeof input.startingNumber === "number"
      ? String(input.startingNumber)
      : defaults.startingNumber;
  const digitsOnly = rawStarting.replace(/\D/g, "");
  return {
    prefix:
      typeof input.prefix === "string" ? input.prefix : defaults.prefix,
    startingNumber: digitsOnly.length > 0 ? digitsOnly : defaults.startingNumber,
    suffix: typeof input.suffix === "string" ? input.suffix : defaults.suffix,
  };
}

function formatTransactionNumber(
  numbering: TemplateEditorSettings["numbering"],
  sequence?: number | null,
): string {
  const padLength = Math.max(numbering.startingNumber.length, 1);
  const base = Number.parseInt(numbering.startingNumber, 10);
  const value =
    typeof sequence === "number" && Number.isFinite(sequence)
      ? sequence
      : Number.isFinite(base)
        ? base
        : 0;
  return `${numbering.prefix}${String(Math.max(0, value)).padStart(padLength, "0")}${numbering.suffix ?? ""}`;
}

/** Next number that will be assigned (never reuses an already issued sequence). */
function resolveNextSequence(
  numbering: TemplateEditorSettings["numbering"],
  lastAllocatedSequence: number | null,
): number {
  const startAt = Number.parseInt(numbering.startingNumber, 10);
  const start = Number.isFinite(startAt) && startAt >= 0 ? startAt : 1;
  if (lastAllocatedSequence == null) return start;
  return Math.max(start, lastAllocatedSequence + 1);
}

function normalizeSelectedCustomFields(value: unknown): SelectedCustomField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: SelectedCustomField[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const field = entry as Partial<SelectedCustomField>;
    if (typeof field.id !== "string" || !field.id) continue;
    if (field.kind !== "metafield") continue;
    if (
      field.ownerType &&
      field.ownerType !== "PRODUCT" &&
      field.ownerType !== "Product"
    ) {
      continue;
    }
    if (
      !isMerchantCreatedMetafield({
        id: field.id,
        name: typeof field.name === "string" ? field.name : "",
        namespace: typeof field.namespace === "string" ? field.namespace : "",
        key: typeof field.key === "string" ? field.key : "",
        ownerType: "PRODUCT",
      })
    ) {
      continue;
    }
    if (seen.has(field.id)) continue;
    seen.add(field.id);
    const widthRaw = (field as { width?: unknown }).width;
    const width =
      typeof widthRaw === "number" && Number.isFinite(widthRaw)
        ? Math.max(1, widthRaw)
        : undefined;
    normalized.push({
      id: field.id,
      kind: "metafield",
      name:
        typeof field.name === "string" && field.name.trim()
          ? field.name.trim()
          : field.key || "Custom field",
      ...(width != null ? { width } : {}),
      namespace: typeof field.namespace === "string" ? field.namespace : undefined,
      key: typeof field.key === "string" ? field.key : undefined,
      ownerType: "PRODUCT",
    });
  }
  return normalized;
}

type MetafieldDefinitionNode = {
  id: string;
  name: string;
  namespace: string;
  key: string;
  ownerType: string;
  type?: { name?: string | null } | null;
};

function isMerchantCreatedMetafield(node: MetafieldDefinitionNode): boolean {
  const namespace = node.namespace.trim().toLowerCase();
  // App-owned / reserved namespaces from app toml or app API
  if (
    namespace === "app" ||
    namespace === "$app" ||
    namespace.startsWith("app--") ||
    namespace.startsWith("$app:") ||
    namespace.startsWith("$app.")
  ) {
    return false;
  }
  // Template demo definition leftover
  if (node.key === "demo_info" || node.name === "Demo Source Info") {
    return false;
  }
  return true;
}

function isCustomerMetafieldSource(source: CustomFieldSource) {
  return source.ownerType === "CUSTOMER" || source.ownerType === "Customer";
}

function syncCustomerMetafieldFields(
  current: CustomerDetailField[],
  sources: CustomFieldSource[],
): CustomerDetailField[] {
  const standardKeys = new Set(
    defaultCustomerBlockDetails.map((field) => field.key),
  );
  const standard = current.filter((field) => standardKeys.has(field.key));
  const existingMeta = new Map(
    current
      .filter((field) => isCustomerMetafieldDetailKey(field.key))
      .map((field) => [field.key, field]),
  );
  const metaFields = sources
    .filter(isCustomerMetafieldSource)
    .map((source) => {
      const namespace = source.namespace?.trim() || "";
      const key = source.key?.trim() || "";
      if (!namespace || !key) return null;
      const detailKey = customerMetafieldDetailKey(namespace, key);
      const existing = existingMeta.get(detailKey);
      return {
        key: detailKey,
        enabled: existing?.enabled ?? true,
        label: existing?.label?.trim() || source.name,
      } satisfies CustomerDetailField;
    })
    .filter((field): field is CustomerDetailField => field != null);

  return [...standard, ...metaFields];
}

function customerDetailFieldTitle(
  field: CustomerDetailField,
  sources: CustomFieldSource[],
) {
  if (isCustomerDetailKey(field.key)) return customerDetailFallbacks[field.key];
  if (isCustomerMetafieldDetailKey(field.key)) {
    const parsed = parseCustomerMetafieldDetailKey(field.key);
    if (parsed) {
      const source = sources.find(
        (entry) =>
          entry.namespace === parsed.namespace && entry.key === parsed.key,
      );
      return source?.name || field.label || `${parsed.namespace}.${parsed.key}`;
    }
  }
  return field.label || field.key;
}

function getTemplate(documentType: string | undefined, templateId: string | undefined) {
  if (!documentType || !templateId) return null;
  const template = templateDefinitions[templateId];
  return template?.documentType === documentType ? template : null;
}

const templateEditCache = createAppPageClientCache();

export async function clientLoader(args: ClientLoaderFunctionArgs) {
  return cachedClientLoader(templateEditCache, args);
}

export function shouldRevalidate({
  formMethod,
  currentParams,
  nextParams,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== "GET") {
    templateEditCache.bust();
    return true;
  }
  return (
    currentParams.documentType !== nextParams.documentType ||
    currentParams.templateId !== nextParams.templateId
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const template = getTemplate(params.documentType, params.templateId);
  if (!template || !params.documentType || !params.templateId) {
    throw new Response("Template not found", { status: 404 });
  }

  const { session, admin } = await requireAdminAuth(request);
  // Critical path only — logo + metafields hydrate after paint (store-brand /
  // custom-fields). Skip logo base64 here so Edit click isn't waiting on a fat JSON.
  const [customization, storeDetails, lastAllocated, numberSeries, shopCurrencyCode] =
    await Promise.all([
      prisma.templateCustomization.findUnique({
        where: {
          shop_documentType_templateId: {
            shop: session.shop,
            documentType: params.documentType,
            templateId: params.templateId,
          },
        },
      }),
      loadStoreDetailsForShop(session.shop, admin, { includeLogo: false }),
      prisma.salesOrderDocumentNumber.findFirst({
        where: {
          shop: session.shop,
          ...(params.documentType === "sales-order"
            ? {}
            : { templateId: params.templateId }),
        },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      }),
      loadNumberSeriesEntryForShop(
        session.shop,
        params.documentType === "invoice"
          ? "invoice"
          : params.documentType === "draft"
            ? "draft"
            : params.documentType === "credit-note"
              ? "credit-note"
              : params.documentType === "packing-slip"
                ? "packing-slip"
                : params.documentType === "return"
                  ? "return"
                  : "sales-order",
      ),
      fetchShopCurrencyCode(admin, session.shop),
    ]);

  let settings = mergeSettings(
    customization?.settings,
    template.name,
    params.templateId,
  );
  // Shop store details own the org name + logo for every template.
  if (storeDetails.name) {
    settings.transactionLabels.organization = storeDetails.name;
  }
  // Logo is loaded via /app/templates/store-brand after first paint.
  delete settings.logoDataUrl;
  delete settings.logoFileName;
  settings.numbering = numberingFromSeries(numberSeries);
  settings = reconcileSettingsForDocumentType(
    settings,
    params.documentType,
    template.name,
    params.templateId,
  );

  return {
    documentType: params.documentType,
    templateId: params.templateId,
    settings,
    customFieldSources: [] as CustomFieldSource[],
    storeDetails,
    shopCurrencyCode,
    lastAllocatedSequence: lastAllocated?.sequence ?? null,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const template = getTemplate(params.documentType, params.templateId);
  if (!template || !params.documentType || !params.templateId) {
    throw new Response("Template not found", { status: 404 });
  }

  const formData = await request.formData();
  const { session } = await requireAdminAuth(request);

  const rawSettings = formData.get("settings");
  if (typeof rawSettings !== "string") {
    return Response.json({ saved: false, error: "Template settings are required." }, { status: 400 });
  }

  let parsedSettings: unknown;
  try {
    parsedSettings = JSON.parse(rawSettings);
  } catch {
    return Response.json({ saved: false, error: "Invalid template settings." }, { status: 400 });
  }

  const settings = mergeSettings(parsedSettings, template.name, params.templateId);
  // Transaction numbers are managed in Settings → Transaction numbers.
  const seriesModule =
    params.documentType === "invoice"
      ? "invoice"
      : params.documentType === "draft"
        ? "draft"
        : params.documentType === "credit-note"
          ? "credit-note"
          : params.documentType === "packing-slip"
            ? "packing-slip"
            : params.documentType === "return"
              ? "return"
              : "sales-order";
  const series = await loadNumberSeriesEntryForShop(session.shop, seriesModule);
  settings.numbering = numberingFromSeries(series);
  // Logo lives in Settings → Store details (shared). Never persist per-template.
  delete settings.logoDataUrl;
  delete settings.logoFileName;

  await prisma.templateCustomization.upsert({
    where: {
      shop_documentType_templateId: {
        shop: session.shop,
        documentType: params.documentType,
        templateId: params.templateId,
      },
    },
    update: { settings: settings as unknown as Prisma.InputJsonValue },
    create: {
      shop: session.shop,
      documentType: params.documentType,
      templateId: params.templateId,
      settings: settings as unknown as Prisma.InputJsonValue,
    },
  });

  invalidateDocumentTemplateSettingsCache(session.shop);
  await syncNumberCounter(session.shop, params.templateId, settings.numbering);

  return { saved: true };
}

function withNormalizedTotalLabels(
  value: TemplateEditorSettings,
  templateId?: string,
): TemplateEditorSettings {
  return {
    ...value,
    totals: mergeTotalsSettings(
      value.totals,
      createDefaultSettings(value.name, templateId).totals,
    ),
  };
}

/**
 * Normalize settings the same way the form displays them so opening the editor
 * does not look "dirty" before the merchant edits anything.
 */
function hydrateEditorSettings(
  value: TemplateEditorSettings,
  templateId?: string,
): TemplateEditorSettings {
  const withTotals = withNormalizedTotalLabels(value, templateId);
  return {
    ...withTotals,
    language: normalizeTemplateLanguage(withTotals.language),
    dateFormat: normalizeTemplateDateFormat(withTotals.dateFormat),
    currencyDisplay: normalizeTemplateCurrencyDisplay(
      withTotals.currencyDisplay,
    ),
    billingDetails: normalizeCustomerDetails(
      withTotals.billingDetails,
      defaultBillingDetails,
    ),
    shippingDetails: normalizeCustomerDetails(
      withTotals.shippingDetails,
      defaultShippingDetails,
    ),
    customerBlockDetails: normalizeCustomerDetails(
      withTotals.customerBlockDetails,
      defaultCustomerBlockDetails,
      { allowMetafieldKeys: true },
    ),
  };
}

function displayTotalLabel(value: unknown, fallback: string) {
  // Do NOT trim here — trimming on every keystroke eats trailing spaces while typing.
  if (typeof value !== "string") return fallback;
  if (value === "Discount Amount") return "Discount";
  if (value === "Shipping Price" || value === "Shipping") return "Shipping Charge";
  if (value === "VAT Amount" || value === "VAT Tax" || value === "Tax")
    return "Total Tax";
  return value;
}

/** Keep Space/typing inside inputs from being stolen by parent/admin shortcuts. */
function stopInputShortcutPropagation(
  event: ReactKeyboardEvent<HTMLElement>,
) {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const tag = target.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  ) {
    event.stopPropagation();
  }
}

const sectionItems: EditorSection[] = [
  "general",
  "transaction",
  "table",
  "total",
  "appearance",
  "other",
];

const PAYMENT_STYLE_LABEL_KEYS: Record<
  PaymentStatusStyle,
  TemplateEditorMessageKey
> = {
  boxed: "te.payStyle1",
  underTotal: "te.payStyle2",
  inTotals: "te.payStyle3",
  splitPanels: "te.payStyle4",
  balanceBanner: "te.payStyle5",
};

const LOGO_POSITION_LABEL_KEYS: Record<
  SalesOrderLogoPosition,
  TemplateEditorMessageKey
> = {
  left: "te.pos.left",
  right: "te.pos.right",
  center: "te.pos.center",
};

const META_STYLE_LABEL_KEYS: Record<
  SalesOrderMetaStyle,
  TemplateEditorMessageKey
> = {
  boxed: "te.meta.boxed",
  outline: "te.meta.outline",
  plain: "te.meta.plain",
  strip: "te.meta.strip",
  card: "te.meta.card",
  inverted: "te.meta.inverted",
};

const MARGIN_SIDE_LABEL_KEYS: Record<
  "top" | "bottom" | "left" | "right",
  TemplateEditorMessageKey
> = {
  top: "te.side.top",
  bottom: "te.side.bottom",
  left: "te.side.left",
  right: "te.side.right",
};

const ADDRESS_SECTION_TITLE_KEYS: Record<
  AddressSection,
  TemplateEditorMessageKey
> = {
  billing: "te.tx.billing",
  shipping: "te.tx.shipping",
  customer: "te.tx.customer",
};

const ADDRESS_SECTION_SHOW_KEYS: Record<
  AddressSection,
  TemplateEditorMessageKey
> = {
  billing: "te.tx.showBilling",
  shipping: "te.tx.showShipping",
  customer: "te.tx.showCustomer",
};

export default function TemplateEditorPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { language } = useAdminI18n();
  const fetcher = useFetcher<typeof action>();
  const brandFetcher = useFetcher<{
    name: string;
    logoDataUrl: string | null;
    logoFileName: string | null;
  }>();
  const customFieldsFetcher = useFetcher<{ sources: CustomFieldSource[] }>();
  const [customFieldSources, setCustomFieldSources] = useState<
    CustomFieldSource[]
  >([]);
  const [customFieldsLoadRequested, setCustomFieldsLoadRequested] =
    useState(false);
  const [customFieldsRefreshing, setCustomFieldsRefreshing] = useState(false);
  const customFieldsSawLoadingRef = useRef(false);

  const refreshCustomFieldSources = (fresh = true) => {
    setCustomFieldsLoadRequested(true);
    setCustomFieldsRefreshing(true);
    customFieldsSawLoadingRef.current = false;
    customFieldsFetcher.load(
      fresh
        ? `/app/templates/custom-fields?fresh=1&t=${Date.now()}`
        : "/app/templates/custom-fields",
    );
  };

  useEffect(() => {
    if (!customFieldsRefreshing) return;

    if (
      customFieldsFetcher.state === "loading" ||
      customFieldsFetcher.state === "submitting"
    ) {
      customFieldsSawLoadingRef.current = true;
      return;
    }

    if (
      customFieldsFetcher.state === "idle" &&
      customFieldsSawLoadingRef.current
    ) {
      if (customFieldsFetcher.data?.sources) {
        setCustomFieldSources(customFieldsFetcher.data.sources);
      }
      setCustomFieldsRefreshing(false);
      customFieldsSawLoadingRef.current = false;
    }
  }, [
    customFieldsRefreshing,
    customFieldsFetcher.state,
    customFieldsFetcher.data,
  ]);

  // Store logo is deferred so Edit navigation stays light.
  useEffect(() => {
    if (brandFetcher.state !== "idle" || brandFetcher.data) return;
    brandFetcher.load("/app/templates/store-brand");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const storeBrand = useMemo(
    () => ({
      name: brandFetcher.data?.name || data.storeDetails.name,
      logoDataUrl:
        brandFetcher.data?.logoDataUrl || data.storeDetails.logoDataUrl,
      logoFileName:
        brandFetcher.data?.logoFileName || data.storeDetails.logoFileName,
    }),
    [brandFetcher.data, data.storeDetails],
  );

  const customFieldsLoading = customFieldsRefreshing;
  const customerMetafieldSources = useMemo(
    () => customFieldSources.filter(isCustomerMetafieldSource),
    [customFieldSources],
  );
  const defaultAppearance = useMemo(() => {
    const preset = findTemplatePreset(data.templateId) ?? null;
    return {
      ...baseDefaultAppearance,
      ...(preset?.appearance ?? {}),
    } satisfies TemplateAppearance;
  }, [data.templateId]);
  const adminCaps = useMemo(
    () =>
      findTemplatePreset(data.templateId)
        ? getTemplateAdminCapabilities(data.templateId)
        : {
            productImages: true,
            logoPosition: false,
            metaStyle: false,
            taxSummary:
              data.documentType !== "credit-note" &&
              data.documentType !== "packing-slip" &&
              data.documentType !== "return" &&
              data.documentType !== "draft",
            paymentAmounts:
              data.documentType !== "credit-note" &&
              data.documentType !== "packing-slip" &&
              data.documentType !== "return" &&
              data.documentType !== "draft",
          },
    [data.documentType, data.templateId],
  );
  const isCreditNoteEditor = data.documentType === "credit-note";
  const isPackingSlipEditor =
    data.documentType === "packing-slip" || data.documentType === "return";
  const isSalesOrderEditor = data.documentType === "sales-order";
  const packingMoneyColumnKeys = new Set([
    "rate",
    "discount",
    "discountPercentage",
    "taxPercentage",
    "taxAmount",
    "amount",
  ]);
  const documentTypeBreadcrumb = teDocumentBreadcrumb(
    language,
    data.documentType,
  );
  const paymentStyleOptions = useMemo(() => {
    const allowed = adminCaps.paymentStatusStyles;
    const styles =
      !allowed || allowed.length === 0
        ? PAYMENT_STATUS_STYLES
        : PAYMENT_STATUS_STYLES.filter((style) =>
            allowed.includes(style.value),
          );
    return styles.map((style) => ({
      value: style.value,
      label: teT(language, PAYMENT_STYLE_LABEL_KEYS[style.value]),
    }));
  }, [adminCaps.paymentStatusStyles, language]);
  const logoPositionOptions = useMemo(() => {
    const allowed = adminCaps.logoPositions ?? ["left", "right", "center"];
    return (["left", "right", "center"] as const)
      .filter((value) => allowed.includes(value))
      .map((value) => ({
        value,
        label: teT(language, LOGO_POSITION_LABEL_KEYS[value]),
      }));
  }, [adminCaps.logoPositions, language]);
  const metaStyleOptions = useMemo(() => {
    const allowed =
      adminCaps.metaStyles ??
      (["boxed", "outline", "plain", "strip", "card", "inverted"] as const);
    return (Object.keys(META_STYLE_LABEL_KEYS) as SalesOrderMetaStyle[])
      .filter((value) => allowed.includes(value))
      .map((value) => ({
        value,
        label: teT(language, META_STYLE_LABEL_KEYS[value]),
      }));
  }, [adminCaps.metaStyles, language]);
  const [activeSection, setActiveSection] =
    useState<EditorSection>("general");
  const [settings, setSettings] = useState<TemplateEditorSettings>(() =>
    hydrateEditorSettings(data.settings, data.templateId),
  );
  const [savedSettings, setSavedSettings] = useState<TemplateEditorSettings>(
    () => hydrateEditorSettings(data.settings, data.templateId),
  );
  const [logoError, setLogoError] = useState("");
  const [openHeaderPanel, setOpenHeaderPanel] = useState<string | null>(
    "organization",
  );

  useEffect(() => {
    if (customFieldsLoadRequested) return;
    let cancelled = false;
    const start = () => {
      if (!cancelled) refreshCustomFieldSources(false);
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(start, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(start, 400);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [customFieldsLoadRequested]);

  useEffect(() => {
    if (customerMetafieldSources.length === 0) return;

    const applySync = (current: TemplateEditorSettings) => {
      const nextDetails = syncCustomerMetafieldFields(
        current.customerBlockDetails,
        customerMetafieldSources,
      );
      if (
        JSON.stringify(nextDetails) ===
        JSON.stringify(current.customerBlockDetails)
      ) {
        return current;
      }
      return { ...current, customerBlockDetails: nextDetails };
    };

    // Update live + baseline together so auto-synced metafields do not open Save bar.
    setSettings(applySync);
    setSavedSettings(applySync);
  }, [customerMetafieldSources]);

  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [draggingField, setDraggingField] = useState<{
    section: AddressSection;
    index: number;
  } | null>(null);
  const [dragOverField, setDragOverField] = useState<{
    section: AddressSection;
    index: number;
  } | null>(null);
  const [draggingAddressBlock, setDraggingAddressBlock] =
    useState<AddressBlockKey | null>(null);
  const [dragOverAddressBlock, setDragOverAddressBlock] =
    useState<AddressBlockKey | null>(null);
  const [draggingCustomFieldIndex, setDraggingCustomFieldIndex] = useState<
    number | null
  >(null);
  const [dragOverCustomFieldIndex, setDragOverCustomFieldIndex] = useState<
    number | null
  >(null);
  const [expandedLabel, setExpandedLabel] = useState<{
    section: AddressSection;
    key: string;
  } | null>(null);
  const isSaving = fetcher.state !== "idle";
  const selectedTab = Math.max(
    sectionItems.findIndex((section) => section === activeSection),
    0,
  );
  const pendingSaveRef = useRef<TemplateEditorSettings | null>(null);
  const handledFetcherDataRef = useRef<unknown>(null);
  const loadedFontsRef = useRef<Set<string>>(new Set());
  // Keep form controls instant; defer the heavy document preview paint.
  const deferredSettings = useDeferredValue(settings);
  const previewPending = deferredSettings !== settings;
  /** True only when editor values differ from last saved snapshot (not a sticky flag). */
  const isDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings],
  );

  useEffect(() => {
    if (isDirty) return;
    try {
      shopify?.saveBar?.hide("template-editor-save-bar");
    } catch {
      // ignore
    }
  }, [isDirty]);
  const previewSettings = useMemo(() => {
    const withStoreBrand = {
      ...deferredSettings,
      transactionLabels: {
        ...deferredSettings.transactionLabels,
        organization:
          storeBrand.name ||
          deferredSettings.transactionLabels.organization,
      },
      ...(storeBrand.logoDataUrl
        ? {
            logoDataUrl: storeBrand.logoDataUrl,
            logoFileName: storeBrand.logoFileName,
          }
        : {}),
    };
    if (withStoreBrand.logoDataUrl) return withStoreBrand;
    const preset = findTemplatePreset(data.templateId) ?? null;
    if (!preset) return withStoreBrand;
    return {
      ...withStoreBrand,
      logoDataUrl: templatePreviewLogoDataUrl(preset.accent),
      header: {
        ...withStoreBrand.header,
        showLogo: true,
      },
    };
  }, [storeBrand, data.templateId, deferredSettings]);
  const lastAllocatedSequence =
    (fetcher.data &&
    "lastAllocatedSequence" in fetcher.data &&
    typeof fetcher.data.lastAllocatedSequence === "number"
      ? fetcher.data.lastAllocatedSequence
      : null) ?? data.lastAllocatedSequence;
  const nextSequence = resolveNextSequence(
    previewSettings.numbering,
    lastAllocatedSequence,
  );
  const previewOrder = useMemo(
    () => {
      const sample =
        data.documentType === "credit-note"
          ? sampleCreditNoteForShop(data.shopCurrencyCode)
          : sampleSalesOrderForShop(data.shopCurrencyCode);
      return {
        ...sample,
        documentNumber: formatTransactionNumber(
          previewSettings.numbering,
          nextSequence,
        ),
        // Keep SO- as Ref# in preview (never fall back to INV-/CN-/DFT- document #).
        referenceNumber: sample.referenceNumber || "SO-0001",
      };
    },
    [
      data.documentType,
      data.shopCurrencyCode,
      previewSettings.numbering.prefix,
      previewSettings.numbering.startingNumber,
      previewSettings.numbering.suffix,
      nextSequence,
    ],
  );
  const previewDocumentSettings = useMemo(
    () => ({
      ...previewSettings,
      notes: resolveDocumentNotes({
        savedNote: null,
        orderNote: previewOrder.orderNote,
        defaultNotes: previewSettings.notes,
        preferShopifyOrderNote: previewSettings.preferShopifyOrderNote,
      }),
    }),
    [previewOrder.orderNote, previewSettings],
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (handledFetcherDataRef.current === fetcher.data) return;
    handledFetcherDataRef.current = fetcher.data;

    if ("saved" in fetcher.data && fetcher.data.saved && pendingSaveRef.current) {
      const committed = pendingSaveRef.current;
      pendingSaveRef.current = null;
      setSavedSettings(committed);
      setSettings(committed);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(teT(language, "te.savedToast"));
      }
      try {
        shopify?.saveBar?.hide("template-editor-save-bar");
      } catch {
        // ignore
      }
    }

    if ("error" in fetcher.data && fetcher.data.error) {
      pendingSaveRef.current = null;
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(String(fetcher.data.error), { isError: true });
      }
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    const family = resolveFontFamily(settings.fontFamily);
    const option = fontOptions.find((font) => font.value === family);
    const label = option?.label;
    if (!label) return;
    const systemFonts = new Set([
      "Helvetica",
      "Arial",
      "Georgia",
      "Times New Roman",
    ]);
    if (systemFonts.has(label) || loadedFontsRef.current.has(label)) return;
    loadedFontsRef.current.add(label);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(label)}:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap`;
    document.head.appendChild(link);
  }, [settings.fontFamily]);

  useEffect(() => {
    // Reset editor when switching templates (state survives route param changes).
    const next = hydrateEditorSettings(data.settings, data.templateId);
    setSettings(
      JSON.parse(JSON.stringify(next)) as TemplateEditorSettings,
    );
    setSavedSettings(
      JSON.parse(JSON.stringify(next)) as TemplateEditorSettings,
    );
  }, [data.documentType, data.templateId]);

  const updateSettings = (updates: Partial<TemplateEditorSettings>) => {
    setSettings((current) => ({ ...current, ...updates }));
  };

  const changeTemplateLanguage = (nextLanguage: string) => {
    const language = normalizeTemplateLanguage(nextLanguage, settings.language);
    if (language === settings.language) return;
    setSettings((current) =>
      applyTemplateLanguageLabels(current, language, {
        organizationName: current.transactionLabels.organization,
        documentType: data.documentType,
        translateBodyText: {
          notes: isBuiltInTemplateBody(current.notes),
          terms: isBuiltInTemplateBody(current.terms),
        },
      }),
    );
  };

  const updateAppearance = (
    patch:
      | Partial<TemplateAppearance>
      | ((current: TemplateAppearance) => Partial<TemplateAppearance>),
    options?: { urgent?: boolean },
  ) => {
    const apply = () => {
      setSettings((current) => {
        const nextPatch =
          typeof patch === "function" ? patch(current.appearance) : patch;
        return {
          ...current,
          appearance: { ...current.appearance, ...nextPatch },
        };
      });
    };
    if (options?.urgent) {
      apply();
      return;
    }
    // Color/slider drags: don't block checkbox/text clicks.
    startTransition(apply);
  };

  const save = (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!isDirty || isSaving) return;
    pendingSaveRef.current = settings;
    fetcher.submit(
      { intent: "save", settings: JSON.stringify(settings) },
      { method: "post" },
    );
  };

  const discard = (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    // Never save on discard — drop any in-flight "apply save result" payload.
    pendingSaveRef.current = null;
    setSettings(
      JSON.parse(JSON.stringify(savedSettings)) as TemplateEditorSettings,
    );
    setLogoError("");
    try {
      if (typeof shopify !== "undefined" && shopify.saveBar?.hide) {
        shopify.saveBar.hide("template-editor-save-bar");
      }
    } catch {
      // Admin host may not expose saveBar in some embeds.
    }
  };

  const updateColumn = (
    index: number,
    updates: Partial<TemplateColumn>,
  ) => {
    updateSettings({
      columns: settings.columns.map((column, columnIndex) =>
        columnIndex === index ? { ...column, ...updates } : column,
      ),
    });
  };

  const toggleCustomField = (source: CustomFieldSource, enabled: boolean) => {
    const selected = settings.selectedCustomFields;
    const customColumn = settings.columns.find(
      (column) => column.key === "custom",
    );
    const defaultWidth = Math.max(1, customColumn?.width ?? 12);
    const nextSelected = enabled
      ? selected.some((field) => field.id === source.id)
        ? selected
        : [
            ...selected,
            {
              id: source.id,
              kind: source.kind,
              name: source.name,
              width: defaultWidth,
              namespace: source.namespace,
              key: source.key,
              ownerType: source.ownerType,
              metaobjectType: source.metaobjectType,
            },
          ]
      : selected.filter((field) => field.id !== source.id);

    const customIndex = settings.columns.findIndex(
      (column) => column.key === "custom",
    );
    const nextColumns =
      customIndex >= 0
        ? settings.columns.map((column, index) =>
            index === customIndex
              ? {
                  ...column,
                  enabled: enabled ? true : column.enabled,
                  label:
                    nextSelected.length === 1
                      ? nextSelected[0]!.name.trim() || "Custom"
                      : "Custom",
                }
              : column,
          )
        : settings.columns;

    updateSettings({
      selectedCustomFields: nextSelected,
      columns: nextColumns,
    });
  };

  const updateSelectedCustomFieldWidth = (id: string, width: number) => {
    const nextWidth = Number.isFinite(width) ? Math.max(1, width) : 1;
    updateSettings({
      selectedCustomFields: settings.selectedCustomFields.map((field) =>
        field.id === id ? { ...field, width: nextWidth } : field,
      ),
    });
  };

  const moveSelectedCustomField = (fromIndex: number, toIndex: number) => {
    const fields = settings.selectedCustomFields;
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= fields.length ||
      toIndex >= fields.length
    ) {
      return;
    }
    const next = [...fields];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    updateSettings({ selectedCustomFields: next });
  };

  const getAddressFields = (section: AddressSection) =>
    section === "billing"
      ? settings.billingDetails
      : section === "shipping"
        ? settings.shippingDetails
        : settings.customerBlockDetails;

  const updateAddressField = (
    section: AddressSection,
    index: number,
    updates: Partial<CustomerDetailField>,
  ) => {
    const fields = getAddressFields(section).map((field, fieldIndex) =>
      fieldIndex === index ? { ...field, ...updates } : field,
    );
    updateSettings(
      section === "billing"
        ? { billingDetails: fields }
        : section === "shipping"
          ? { shippingDetails: fields }
          : { customerBlockDetails: fields },
    );
  };

  const moveAddressField = (
    section: AddressSection,
    fromIndex: number,
    toIndex: number,
  ) => {
    const fields = getAddressFields(section);
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= fields.length ||
      toIndex >= fields.length
    ) {
      return;
    }

    const next = [...fields];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    updateSettings(
      section === "billing"
        ? { billingDetails: next }
        : section === "shipping"
          ? { shippingDetails: next }
          : { customerBlockDetails: next },
    );
  };

  const addressBlockOrder = useMemo(
    () =>
      normalizeAddressBlockOrder(
        settings.addressBlockOrder,
        DEFAULT_ADDRESS_BLOCK_ORDER,
      ),
    [settings.addressBlockOrder],
  );

  const moveAddressBlock = (fromKey: AddressBlockKey, toKey: AddressBlockKey) => {
    if (fromKey === toKey) return;
    const order = [...addressBlockOrder];
    const fromIndex = order.indexOf(fromKey);
    const toIndex = order.indexOf(toKey);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = order.splice(fromIndex, 1);
    if (!moved) return;
    order.splice(toIndex, 0, moved);
    updateSettings({ addressBlockOrder: order });
  };

  const toggleHeaderPanel = (panel: string) => {
    setOpenHeaderPanel((current) => (current === panel ? null : panel));
  };

  const renderSectionHeader = (
    panel: string,
    title: string,
    panelId: string,
    options?: {
      draggable?: boolean;
      dragKey?: AddressBlockKey;
    },
  ) => {
    const isOpen = openHeaderPanel === panel;
    const isDragging =
      options?.draggable &&
      options.dragKey != null &&
      draggingAddressBlock === options.dragKey;
    const isDropTarget =
      options?.draggable &&
      options.dragKey != null &&
      dragOverAddressBlock === options.dragKey &&
      draggingAddressBlock != null &&
      draggingAddressBlock !== options.dragKey;

    return (
      <div
        className={[
          "template-editor__accordion-header",
          isDropTarget ? "template-editor__accordion-header--drop" : "",
          isDragging ? "template-editor__accordion-header--dragging" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onDragOver={
          options?.draggable
            ? (event) => {
                event.preventDefault();
                if (options.dragKey && dragOverAddressBlock !== options.dragKey) {
                  setDragOverAddressBlock(options.dragKey);
                }
              }
            : undefined
        }
        onDrop={
          options?.draggable
            ? (event) => {
                event.preventDefault();
                if (draggingAddressBlock && options.dragKey) {
                  moveAddressBlock(draggingAddressBlock, options.dragKey);
                }
                setDraggingAddressBlock(null);
                setDragOverAddressBlock(null);
              }
            : undefined
        }
      >
        {options?.draggable && options.dragKey ? (
          <button
            type="button"
            className="template-editor__drag-handle"
            aria-label={teTf(language, "te.dragReorder", { name: title })}
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              setDraggingAddressBlock(options.dragKey!);
              try {
                event.dataTransfer.setData("text/plain", options.dragKey!);
                event.dataTransfer.effectAllowed = "move";
              } catch {
                // ignore
              }
            }}
            onDragEnd={() => {
              setDraggingAddressBlock(null);
              setDragOverAddressBlock(null);
            }}
          >
            <Icon source={DragHandleIcon} tone="subdued" />
          </button>
        ) : null}
        <button
          type="button"
          className="template-editor__accordion-trigger"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => toggleHeaderPanel(panel)}
        >
          <span className="template-editor__accordion-title">
            <Text as="span" variant="headingMd">
              {title}
            </Text>
          </span>
          <span className="template-editor__accordion-icon" aria-hidden="true">
            <Icon
              source={isOpen ? ChevronUpIcon : ChevronDownIcon}
              tone="base"
            />
          </span>
        </button>
      </div>
    );
  };

  const renderAddressSectionPanel = (
    section: AddressSection,
    title: string,
  ) => {
    const fields = getAddressFields(section);
    const panelId = `${section}-details-panel`;
    const isOpen = openHeaderPanel === section;
    const sectionTitleKey =
      section === "billing"
        ? "customer"
        : section === "shipping"
          ? "shipping"
          : "customerDetails";
    const sectionTitleValue = settings.transactionLabels[sectionTitleKey];
    const visibilityKey =
      section === "billing"
        ? "showBilling"
        : section === "shipping"
          ? "showShipping"
          : "showCustomerDetails";
    const sectionVisible = settings.header[visibilityKey];

    return (
      <Card padding="0">
        {renderSectionHeader(section, title, panelId, {
          draggable: true,
          dragKey: section,
        })}

        <Collapsible id={panelId} open={isOpen}>
          <div className="template-editor__accordion-body">
            <BlockStack gap="400">
              <Checkbox
                label={teT(language, ADDRESS_SECTION_SHOW_KEYS[section])}
                checked={sectionVisible}
                onChange={(checked) => {
                  const nextHeader = {
                    ...settings.header,
                    [visibilityKey]: checked,
                  };
                  updateSettings({
                    header: {
                      ...nextHeader,
                      showCustomer:
                        nextHeader.showBilling ||
                        nextHeader.showShipping ||
                        nextHeader.showCustomerDetails,
                    },
                  });
                }}
              />

              <Text as="p" variant="bodySm" tone="subdued">
                {section === "customer"
                  ? teT(language, "te.tx.dragFieldsCustomer")
                  : teT(language, "te.tx.dragFields")}
              </Text>

              <FormLayout>
                <TextField
                  label={teT(language, "te.tx.sectionTitle")}
                  value={sectionTitleValue}
                  onChange={(value) =>
                    updateSettings({
                      transactionLabels: {
                        ...settings.transactionLabels,
                        [sectionTitleKey]: value,
                      },
                    })
                  }
                  autoComplete="off"
                  helpText={teT(language, "te.tx.sectionTitleHelp")}
                  disabled={!sectionVisible}
                />
              </FormLayout>

              {(() => {
                const standardEntries = fields
                  .map((field, index) => ({ field, index }))
                  .filter(
                    ({ field }) => !isCustomerMetafieldDetailKey(field.key),
                  );
                const metafieldEntries =
                  section === "customer"
                    ? fields
                        .map((field, index) => ({ field, index }))
                        .filter(({ field }) =>
                          isCustomerMetafieldDetailKey(field.key),
                        )
                    : [];
                const allowedDropIndexes = new Set(
                  (draggingField?.section === section
                    ? isCustomerMetafieldDetailKey(
                        fields[draggingField.index]?.key || "",
                      )
                      ? metafieldEntries
                      : standardEntries
                    : standardEntries
                  ).map((entry) => entry.index),
                );

                const renderFieldList = (
                  entries: Array<{
                    field: CustomerDetailField;
                    index: number;
                  }>,
                ) => (
                  <Box
                    borderWidth="025"
                    borderColor="border"
                    borderRadius="200"
                    background="bg-surface"
                    overflowX="hidden"
                    overflowY="hidden"
                  >
                    <BlockStack gap="0">
                      {entries.map(({ field, index }, rowIndex) => {
                        const fieldFallbackTitle =
                          section === "customer"
                            ? customerDetailFieldTitle(
                                field,
                                customerMetafieldSources,
                              )
                            : isCustomerDetailKey(field.key)
                              ? customerDetailFallbacks[field.key]
                              : field.label || field.key;
                        const fieldTitle = teCustomerFieldLabel(
                          language,
                          field.key,
                          fieldFallbackTitle,
                        );
                        const supportsLabel =
                          customerDetailKeysWithLabel.has(
                            field.key as CustomerDetailKey,
                          ) ||
                          (section === "customer" &&
                            isCustomerMetafieldDetailKey(field.key));
                        const isExpanded =
                          supportsLabel &&
                          expandedLabel?.section === section &&
                          expandedLabel.key === field.key;
                        const fieldPanelId = `${section}-field-${field.key}`;
                        const isLast = rowIndex === entries.length - 1;
                        const isDragging =
                          draggingField?.section === section &&
                          draggingField.index === index;
                        const isDropTarget =
                          dragOverField?.section === section &&
                          dragOverField.index === index &&
                          !isDragging;

                        return (
                          <div
                            key={field.key}
                            onDragOver={(event) => {
                              event.preventDefault();
                              if (!allowedDropIndexes.has(index)) return;
                              if (
                                dragOverField?.section !== section ||
                                dragOverField.index !== index
                              ) {
                                setDragOverField({ section, index });
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (
                                draggingField &&
                                draggingField.section === section &&
                                allowedDropIndexes.has(index)
                              ) {
                                moveAddressField(
                                  section,
                                  draggingField.index,
                                  index,
                                );
                              }
                              setDraggingField(null);
                              setDragOverField(null);
                            }}
                          >
                            <Box
                              background={
                                isDropTarget
                                  ? "bg-surface-selected"
                                  : isExpanded
                                    ? "bg-surface-secondary"
                                    : undefined
                              }
                              opacity={isDragging ? "0.55" : undefined}
                            >
                              <Box padding="300">
                                <InlineStack
                                  align="space-between"
                                  blockAlign="center"
                                  wrap={false}
                                  gap="300"
                                >
                                  <InlineStack
                                    gap="200"
                                    blockAlign="center"
                                    wrap={false}
                                  >
                                    <div
                                      className="template-editor__drag-handle"
                                      draggable
                                      role="button"
                                      tabIndex={0}
                                      aria-label={teTf(language, "te.dragReorder", {
                                        name: fieldTitle,
                                      })}
                                      onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed =
                                          "move";
                                        event.dataTransfer.setData(
                                          "text/plain",
                                          String(index),
                                        );
                                        setDraggingField({ section, index });
                                      }}
                                      onDragEnd={() => {
                                        setDraggingField(null);
                                        setDragOverField(null);
                                      }}
                                    >
                                      <Icon
                                        source={DragHandleIcon}
                                        tone="subdued"
                                      />
                                    </div>
                                    <Checkbox
                                      label={teTf(language, "te.showField", {
                                        name: fieldTitle,
                                      })}
                                      checked={field.enabled}
                                      onChange={(enabled) =>
                                        updateAddressField(section, index, {
                                          enabled,
                                        })
                                      }
                                    />
                                  </InlineStack>
                                  {supportsLabel ? (
                                    <Button
                                      variant="tertiary"
                                      icon={
                                        isExpanded
                                          ? ChevronUpIcon
                                          : ChevronDownIcon
                                      }
                                      accessibilityLabel={
                                        isExpanded
                                          ? teTf(language, "te.hideLabelFor", {
                                              name: fieldTitle,
                                            })
                                          : teTf(language, "te.editLabelFor", {
                                              name: fieldTitle,
                                            })
                                      }
                                      ariaExpanded={isExpanded}
                                      ariaControls={fieldPanelId}
                                      onClick={() =>
                                        setExpandedLabel((current) =>
                                          current?.section === section &&
                                          current.key === field.key
                                            ? null
                                            : { section, key: field.key },
                                        )
                                      }
                                    />
                                  ) : null}
                                </InlineStack>

                                {supportsLabel ? (
                                  <Collapsible
                                    id={fieldPanelId}
                                    open={isExpanded}
                                  >
                                    <Box paddingBlockStart="300">
                                      <Bleed marginInline="0">
                                        <TextField
                                          label={teT(language, "te.tx.customLabel")}
                                          value={field.label}
                                          placeholder={fieldTitle}
                                          onChange={(label) =>
                                            updateAddressField(
                                              section,
                                              index,
                                              { label },
                                            )
                                          }
                                          autoComplete="off"
                                          helpText={teT(
                                            language,
                                            "te.tx.customLabelHelp",
                                          )}
                                        />
                                      </Bleed>
                                    </Box>
                                  </Collapsible>
                                ) : null}
                              </Box>
                              {isLast ? null : <Divider />}
                            </Box>
                          </div>
                        );
                      })}
                    </BlockStack>
                  </Box>
                );

                return (
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">
                        {teT(language, "te.tx.visibleFields")}
                      </Text>
                      {renderFieldList(standardEntries)}
                    </BlockStack>
                    {section === "customer" ? (
                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">
                          {teT(language, "te.tx.customerMetafields")}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {teT(language, "te.tx.customerMetafieldsHelp")}
                        </Text>
                        {customFieldsLoading && metafieldEntries.length === 0 ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {teT(language, "te.tx.loadingMetafields")}
                          </Text>
                        ) : metafieldEntries.length > 0 ? (
                          renderFieldList(metafieldEntries)
                        ) : customFieldsLoadRequested ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {teT(language, "te.tx.noMetafields")}
                          </Text>
                        ) : null}
                      </BlockStack>
                    ) : null}
                  </BlockStack>
                );
              })()}
            </BlockStack>
          </div>
        </Collapsible>
      </Card>
    );
  };

  return (
    <AppProvider i18n={enTranslations}>
      <SaveBar id="template-editor-save-bar" open={isDirty}>
        <button
          type="button"
          variant="primary"
          onClick={save}
          disabled={!isDirty || isSaving || undefined}
          loading={isSaving || undefined}
        >
          {isSaving ? teT(language, "te.saving") : teT(language, "te.save")}
        </button>
        <button type="button" onClick={discard} disabled={isSaving || undefined}>
          {teT(language, "te.discard")}
        </button>
      </SaveBar>
      <s-page heading={teT(language, "te.pageTitle")} inlineSize="large">
        <s-link slot="breadcrumb-actions" href="/app/templates">
          {teT(language, "te.breadcrumbTemplates")}
        </s-link>
        <s-link
          slot="breadcrumb-actions"
          href={`/app/templates?type=${encodeURIComponent(data.documentType)}`}
        >
          {documentTypeBreadcrumb}
        </s-link>
        <BlockStack gap="400">
          <div className="template-editor-shell">
            <div className="template-editor">
              <div className="template-editor__tabs">
                <Tabs
                  tabs={sectionItems.map((section) => ({
                    id: section,
                    content: teSectionTabLabel(language, section),
                    panelID: `template-editor-panel-${section}`,
                  }))}
                  selected={selectedTab}
                  onSelect={(index) => {
                    const section = sectionItems[index];
                    if (section) setActiveSection(section);
                  }}
                />
              </div>

              <div
                className="template-editor__properties"
                id={`template-editor-panel-${activeSection}`}
                onKeyDown={stopInputShortcutPropagation}
              >
              <Card>
                {activeSection === "general" ? (
                  <BlockStack gap="500">
                    <Text as="h2" variant="headingLg">
                      {teT(language, "te.general.title")}
                    </Text>
                    <Select
                      label={teT(language, "te.general.language")}
                      options={TEMPLATE_LANGUAGES.map((entry) => ({
                        value: entry.value,
                        label: entry.label,
                      }))}
                      value={normalizeTemplateLanguage(settings.language)}
                      onChange={changeTemplateLanguage}
                      helpText={teT(language, "te.general.languageHelp")}
                    />
                    <Select
                      label={teT(language, "te.general.date")}
                      options={TEMPLATE_DATE_FORMATS.map((entry) => ({
                        value: entry.value,
                        label: entry.label,
                      }))}
                      value={normalizeTemplateDateFormat(settings.dateFormat)}
                      onChange={(dateFormat) =>
                        updateSettings({
                          dateFormat: normalizeTemplateDateFormat(dateFormat),
                        })
                      }
                      helpText={teT(language, "te.general.dateHelp")}
                    />
                    <Select
                      label={teT(language, "te.general.currency")}
                      options={TEMPLATE_CURRENCY_DISPLAYS.map((entry) => ({
                        value: entry.value,
                        label: entry.label,
                      }))}
                      value={normalizeTemplateCurrencyDisplay(
                        settings.currencyDisplay,
                      )}
                      onChange={(currencyDisplay) =>
                        updateSettings({
                          currencyDisplay:
                            normalizeTemplateCurrencyDisplay(currencyDisplay),
                        })
                      }
                      helpText={teT(language, "te.general.currencyHelp")}
                    />
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {teT(language, "te.general.paperSize")}
                      </Text>
                      <InlineStack gap="400">
                        {(["A5", "A4", "Letter"] as const).map((size) => (
                          <RadioButton
                            key={size}
                            label={size}
                            checked={settings.paperSize === size}
                            id={`paper-${size}`}
                            name="paperSize"
                            onChange={() => updateSettings({ paperSize: size })}
                          />
                        ))}
                      </InlineStack>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {teT(language, "te.general.orientation")}
                      </Text>
                      <InlineStack gap="400">
                        {(["portrait", "landscape"] as const).map(
                          (orientation) => (
                            <RadioButton
                              key={orientation}
                              label={teT(
                                language,
                                orientation === "portrait"
                                  ? "te.general.portrait"
                                  : "te.general.landscape",
                              )}
                              checked={settings.orientation === orientation}
                              id={`orientation-${orientation}`}
                              name="orientation"
                              onChange={() =>
                                updateSettings({ orientation })
                              }
                            />
                          ),
                        )}
                      </InlineStack>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        {teT(language, "te.general.margins")}
                      </Text>
                      <InlineGrid columns={4} gap="300">
                        {(["top", "bottom", "left", "right"] as const).map(
                          (side) => (
                            <TextField
                              key={side}
                              label={teT(language, MARGIN_SIDE_LABEL_KEYS[side])}
                              type="number"
                              value={String(settings.margins[side])}
                              onChange={(value) =>
                                updateSettings({
                                  margins: {
                                    ...settings.margins,
                                    [side]: Number(value),
                                  },
                                })
                              }
                              autoComplete="off"
                            />
                          ),
                        )}
                      </InlineGrid>
                    </BlockStack>
                  </BlockStack>
                ) : null}

                {activeSection === "appearance" ? (
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingLg">
                      {teT(language, "te.appearance.title")}
                    </Text>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd">
                        {teT(language, "te.appearance.font")}
                      </Text>
                      <Popover
                        active={fontMenuOpen}
                        fullWidth
                        preferredAlignment="left"
                        onClose={() => setFontMenuOpen(false)}
                        activator={
                          <Button
                            fullWidth
                            textAlign="left"
                            disclosure={fontMenuOpen ? "up" : "down"}
                            onClick={() => setFontMenuOpen((open) => !open)}
                            ariaExpanded={fontMenuOpen}
                            ariaControls="font-family-menu"
                          >
                            {fontOptions.find(
                              (font) =>
                                font.value ===
                                resolveFontFamily(settings.fontFamily),
                            )?.label ?? "Inter"}
                          </Button>
                        }
                      >
                        <div
                          id="font-family-menu"
                          className="template-editor__font-menu"
                        >
                          <OptionList
                            onChange={(selected) => {
                              const next = selected[0];
                              if (next) {
                                updateSettings({ fontFamily: next });
                              }
                              setFontMenuOpen(false);
                            }}
                            options={fontOptions.map((font) => ({
                              value: font.value,
                              label: font.label,
                            }))}
                            selected={[
                              resolveFontFamily(settings.fontFamily),
                            ]}
                          />
                        </div>
                      </Popover>
                    </BlockStack>
                    <Divider />
                    <BlockStack gap="400">
                      {(
                        [
                          {
                            id: "general",
                            titleKey: "te.appearance.cat.general",
                            sizes: [] as const,
                            colors: [
                              [
                                "background",
                                "te.color.background",
                                settings.backgroundColor,
                                "#ffffff",
                              ],
                              [
                                "textColor",
                                "te.color.text",
                                settings.appearance.textColor,
                                defaultAppearance.textColor,
                              ],
                              [
                                "mutedColor",
                                "te.color.muted",
                                settings.appearance.mutedColor,
                                defaultAppearance.mutedColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "document-title",
                            titleKey: "te.appearance.cat.documentTitle",
                            sizes: [
                              ["titleFontSize", "te.sizeLabel.title", 14, 48, 28],
                              [
                                "orderNumberFontSize",
                                "te.sizeLabel.orderNum",
                                8,
                                24,
                                12,
                              ],
                              [
                                "metadataFontSize",
                                "te.sizeLabel.dateRef",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "headingColor",
                                "te.color.heading",
                                settings.appearance.headingColor,
                                defaultAppearance.headingColor,
                              ],
                              [
                                "orderNumberColor",
                                "te.color.orderNumber",
                                settings.appearance.orderNumberColor,
                                defaultAppearance.orderNumberColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "organization",
                            titleKey: "te.appearance.cat.organization",
                            sizes: [
                              [
                                "organizationFontSize",
                                "te.sizeLabel.org",
                                8,
                                24,
                                12,
                              ],
                              [
                                "organizationDetailsFontSize",
                                "te.sizeLabel.address",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "organizationColor",
                                "te.color.organization",
                                settings.appearance.organizationColor,
                                defaultAppearance.organizationColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "addresses",
                            titleKey: "te.appearance.cat.addresses",
                            sizes: [
                              [
                                "addressLabelFontSize",
                                "te.sizeLabel.label",
                                7,
                                18,
                                12,
                              ],
                              [
                                "companyFontSize",
                                "te.sizeLabel.company",
                                8,
                                24,
                                12,
                              ],
                              [
                                "customerNameFontSize",
                                "te.sizeLabel.name",
                                8,
                                24,
                                12,
                              ],
                              [
                                "customerDetailsFontSize",
                                "te.sizeLabel.details",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "companyColor",
                                "te.color.company",
                                settings.appearance.companyColor,
                                defaultAppearance.companyColor,
                              ],
                              [
                                "customerNameColor",
                                "te.color.name",
                                settings.appearance.customerNameColor,
                                defaultAppearance.customerNameColor,
                              ],
                              [
                                "customerDetailsColor",
                                "te.color.details",
                                settings.appearance.customerDetailsColor,
                                defaultAppearance.customerDetailsColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "table",
                            titleKey: "te.appearance.cat.table",
                            sizes: [
                              [
                                "tableHeaderFontSize",
                                "te.sizeLabel.tableHeader",
                                7,
                                18,
                                12,
                              ],
                              [
                                "tableBodyFontSize",
                                "te.sizeLabel.tableBody",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "tableHeaderBackground",
                                "te.color.tableHeader",
                                settings.appearance.tableHeaderBackground,
                                defaultAppearance.tableHeaderBackground,
                              ],
                              [
                                "tableHeaderText",
                                "te.color.tableText",
                                settings.appearance.tableHeaderText,
                                defaultAppearance.tableHeaderText,
                              ],
                              [
                                "tableBorderColor",
                                "te.color.tableBorder",
                                settings.appearance.tableBorderColor,
                                defaultAppearance.tableBorderColor,
                              ],
                              [
                                "unitPriceColor",
                                "te.color.unitPrice",
                                settings.appearance.unitPriceColor,
                                defaultAppearance.unitPriceColor,
                              ],
                              [
                                "comparePriceColor",
                                "te.color.comparePrice",
                                settings.appearance.comparePriceColor,
                                defaultAppearance.comparePriceColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "totals",
                            titleKey: "te.appearance.cat.totals",
                            sizes: [
                              [
                                "totalsFontSize",
                                "te.sizeLabel.totals",
                                8,
                                20,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "totalHighlightBackground",
                                "te.color.totalHighlight",
                                settings.appearance
                                  .totalHighlightBackground,
                                defaultAppearance.totalHighlightBackground,
                              ],
                            ] as const,
                          },
                          {
                            id: "payment-status",
                            titleKey: "te.appearance.cat.paidBalance",
                            sizes: [
                              [
                                "paymentStatusLabelFontSize",
                                "te.sizeLabel.label",
                                7,
                                18,
                                12,
                              ],
                              [
                                "paymentStatusValueFontSize",
                                "te.sizeLabel.value",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "paymentStatusLabelColor",
                                "te.color.label",
                                settings.appearance.paymentStatusLabelColor,
                                defaultAppearance.paymentStatusLabelColor,
                              ],
                              [
                                "paymentStatusValueColor",
                                "te.color.value",
                                settings.appearance.paymentStatusValueColor,
                                defaultAppearance.paymentStatusValueColor,
                              ],
                              [
                                "paymentStatusBorderColor",
                                "te.color.border",
                                settings.appearance.paymentStatusBorderColor,
                                defaultAppearance.paymentStatusBorderColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "tax-summary",
                            titleKey: "te.appearance.cat.taxSummary",
                            sizes: [
                              [
                                "taxSummaryTitleFontSize",
                                "te.sizeLabel.title",
                                7,
                                18,
                                12,
                              ],
                              [
                                "taxSummaryHeaderFontSize",
                                "te.sizeLabel.header",
                                7,
                                18,
                                12,
                              ],
                              [
                                "taxSummaryBodyFontSize",
                                "te.sizeLabel.body",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "taxSummaryTitleColor",
                                "te.color.title",
                                settings.appearance.taxSummaryTitleColor,
                                defaultAppearance.taxSummaryTitleColor,
                              ],
                              [
                                "taxSummaryHeaderBackground",
                                "te.color.headerBg",
                                settings.appearance.taxSummaryHeaderBackground,
                                defaultAppearance.taxSummaryHeaderBackground,
                              ],
                              [
                                "taxSummaryHeaderText",
                                "te.color.headerText",
                                settings.appearance.taxSummaryHeaderText,
                                defaultAppearance.taxSummaryHeaderText,
                              ],
                              [
                                "taxSummaryTextColor",
                                "te.color.bodyText",
                                settings.appearance.taxSummaryTextColor,
                                defaultAppearance.taxSummaryTextColor,
                              ],
                              [
                                "taxSummaryBorderColor",
                                "te.color.border",
                                settings.appearance.taxSummaryBorderColor,
                                defaultAppearance.taxSummaryBorderColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "notes-terms",
                            titleKey: "te.appearance.cat.notesTerms",
                            sizes: [
                              [
                                "notesLabelFontSize",
                                "te.sizeLabel.notesLabel",
                                7,
                                18,
                                12,
                              ],
                              [
                                "notesBodyFontSize",
                                "te.sizeLabel.notesText",
                                7,
                                18,
                                12,
                              ],
                              [
                                "termsLabelFontSize",
                                "te.sizeLabel.termsLabel",
                                7,
                                18,
                                12,
                              ],
                              [
                                "termsBodyFontSize",
                                "te.sizeLabel.termsText",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "notesLabelColor",
                                "te.color.notesLabel",
                                settings.appearance.notesLabelColor,
                                defaultAppearance.notesLabelColor,
                              ],
                              [
                                "notesBodyColor",
                                "te.color.notesText",
                                settings.appearance.notesBodyColor,
                                defaultAppearance.notesBodyColor,
                              ],
                              [
                                "termsLabelColor",
                                "te.color.termsLabel",
                                settings.appearance.termsLabelColor,
                                defaultAppearance.termsLabelColor,
                              ],
                              [
                                "termsBodyColor",
                                "te.color.termsText",
                                settings.appearance.termsBodyColor,
                                defaultAppearance.termsBodyColor,
                              ],
                            ] as const,
                          },
                        ] as const
                      ).map((category, index) => (
                        <BlockStack key={category.id} gap="300">
                          {index > 0 ? <Divider /> : null}
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingSm">
                              {teT(language, category.titleKey)}
                            </Text>
                            {category.sizes.length > 0 ? (
                              <InlineGrid columns={2} gap="200">
                                {category.sizes.map(
                                  ([key, labelKey, min, max, fallback]) => (
                                    <AppearanceSizeField
                                      key={key}
                                      label={teT(language, labelKey)}
                                      min={min}
                                      max={max}
                                      fallback={fallback}
                                      value={settings.appearance[key]}
                                      onChange={(next) =>
                                        updateAppearance(
                                          { [key]: next },
                                          { urgent: true },
                                        )
                                      }
                                    />
                                  ),
                                )}
                              </InlineGrid>
                            ) : null}
                            <InlineGrid columns={2} gap="200">
                              {category.colors.map(
                                ([key, labelKey, value, fallback]) => (
                                  <AppearanceColorField
                                    key={key}
                                    label={teT(language, labelKey)}
                                    value={value}
                                    fallback={fallback}
                                    onChange={(next) => {
                                      if (key === "background") {
                                        updateSettings({
                                          backgroundColor: next,
                                        });
                                        return;
                                      }
                                      if (key === "textColor") {
                                        updateAppearance((appearance) => {
                                          const previous = normalizeHexColor(
                                            appearance.textColor,
                                            defaultAppearance.textColor,
                                          );
                                          const linked = (
                                            current: string,
                                            colorFallback: string,
                                          ) =>
                                            normalizeHexColor(
                                              current,
                                              colorFallback,
                                            ) === previous
                                              ? next
                                              : current;
                                          return {
                                            textColor: next,
                                            customerNameColor: next,
                                            customerDetailsColor: next,
                                            companyColor: linked(
                                              appearance.companyColor,
                                              defaultAppearance.companyColor,
                                            ),
                                            mutedColor: linked(
                                              appearance.mutedColor,
                                              defaultAppearance.mutedColor,
                                            ),
                                            headingColor: linked(
                                              appearance.headingColor,
                                              defaultAppearance.headingColor,
                                            ),
                                            orderNumberColor: linked(
                                              appearance.orderNumberColor,
                                              defaultAppearance.orderNumberColor,
                                            ),
                                          };
                                        });
                                        return;
                                      }
                                      updateAppearance({ [key]: next });
                                    }}
                                  />
                                ),
                              )}
                            </InlineGrid>
                          </BlockStack>
                        </BlockStack>
                      ))}
                    </BlockStack>
                  </BlockStack>
                ) : null}

                {activeSection === "transaction" ? (
                  <BlockStack gap="500">
                    <Text as="h2" variant="headingLg">
                      {teT(language, "te.tx.title")}
                    </Text>
                    <Card padding="0">
                      {renderSectionHeader(
                        "organization",
                        teT(language, "te.tx.orgDetails"),
                        "organization-details-panel",
                      )}
                      <Collapsible
                        id="organization-details-panel"
                        open={openHeaderPanel === "organization"}
                      >
                        <div className="template-editor__accordion-body">
                          <BlockStack gap="300">
                            <Text as="p" variant="bodySm" tone="subdued">
                              {teT(language, "te.tx.orgHelp")}
                            </Text>
                            <Banner tone="info">
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd" fontWeight="semibold">
                                  {data.storeDetails.name ||
                                    teT(language, "te.tx.storeNameUnset")}
                                </Text>
                                {formatStoreAddressLines(data.storeDetails).map(
                                  (line, index) => (
                                    <Text
                                      as="p"
                                      variant="bodySm"
                                      key={`${index}-${line}`}
                                    >
                                      {line}
                                    </Text>
                                  ),
                                )}
                                <Button
                                  onClick={() =>
                                    navigate("/app/settings?section=store-details")
                                  }
                                  size="slim"
                                >
                                  {teT(language, "te.tx.editStore")}
                                </Button>
                              </BlockStack>
                            </Banner>
                            {storeBrand.logoDataUrl ? (
                              <InlineStack
                                gap="300"
                                blockAlign="start"
                                wrap={false}
                              >
                                <Thumbnail
                                  source={storeBrand.logoDataUrl}
                                  alt={
                                    storeBrand.logoFileName ||
                                    teT(language, "te.tx.orgLogoAlt")
                                  }
                                  size="small"
                                />
                                <BlockStack gap="200">
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {teT(language, "te.tx.logoFromStore")}
                                  </Text>
                                  <div className="template-editor__logo-size">
                                    <RangeSlider
                                      label={teT(language, "te.tx.logoSize")}
                                      min={20}
                                      max={100}
                                      step={1}
                                      value={settings.logoSize}
                                      output
                                      suffix={`${settings.logoSize}%`}
                                      onChange={(value) =>
                                        updateSettings({
                                          logoSize:
                                            typeof value === "number"
                                              ? value
                                              : value[0],
                                        })
                                      }
                                    />
                                  </div>
                                </BlockStack>
                              </InlineStack>
                            ) : (
                              <Banner tone="warning">
                                <BlockStack gap="200">
                                  <Text as="p" variant="bodySm">
                                    {teT(language, "te.tx.noLogo")}
                                  </Text>
                                  <Button
                                    onClick={() =>
                                      navigate("/app/settings?section=store-details")
                                    }
                                    size="slim"
                                  >
                                    {teT(language, "te.tx.uploadLogo")}
                                  </Button>
                                  <div className="template-editor__logo-size">
                                    <RangeSlider
                                      label={teT(language, "te.tx.logoSize")}
                                      min={20}
                                      max={100}
                                      step={1}
                                      value={settings.logoSize}
                                      output
                                      suffix={`${settings.logoSize}%`}
                                      onChange={(value) =>
                                        updateSettings({
                                          logoSize:
                                            typeof value === "number"
                                              ? value
                                              : value[0],
                                        })
                                      }
                                    />
                                  </div>
                                </BlockStack>
                              </Banner>
                            )}
                            {adminCaps.logoPosition ? (
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd" fontWeight="semibold">
                                  {teT(language, "te.tx.logoPosition")}
                                </Text>
                                <InlineStack gap="300" wrap>
                                  {logoPositionOptions.map((option) => (
                                    <RadioButton
                                      key={option.value}
                                      label={option.label}
                                      checked={
                                        settings.logoPosition === option.value
                                      }
                                      id={`logo-position-${option.value}`}
                                      name="logoPosition"
                                      onChange={() =>
                                        updateSettings({
                                          logoPosition: option.value,
                                        })
                                      }
                                    />
                                  ))}
                                </InlineStack>
                              </BlockStack>
                            ) : null}
                            {adminCaps.metaStyle ? (
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd" fontWeight="semibold">
                                  {teT(language, "te.tx.metaStyle")}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {isPackingSlipEditor
                                    ? teT(language, "te.tx.metaHelpPacking")
                                    : teT(language, "te.tx.metaHelpDefault")}
                                </Text>
                                <BlockStack gap="100">
                                  {metaStyleOptions.map((option) => (
                                    <RadioButton
                                      key={option.value}
                                      label={option.label}
                                      checked={
                                        settings.metaStyle === option.value
                                      }
                                      id={`meta-style-${option.value}`}
                                      name="metaStyle"
                                      onChange={() =>
                                        updateSettings({
                                          metaStyle: option.value,
                                        })
                                      }
                                    />
                                  ))}
                                </BlockStack>
                              </BlockStack>
                            ) : null}
                          </BlockStack>
                        </div>
                      </Collapsible>
                    </Card>

                    <Text as="p" variant="bodySm" tone="subdued">
                      {teT(language, "te.tx.dragBlocks")}
                    </Text>
                    {addressBlockOrder.map((section) => {
                      if (section === "billing" && !isPackingSlipEditor) {
                        return (
                          <div key={section}>
                            {renderAddressSectionPanel(
                              "billing",
                              teT(language, ADDRESS_SECTION_TITLE_KEYS.billing),
                            )}
                          </div>
                        );
                      }
                      if (section === "shipping" && !isCreditNoteEditor) {
                        return (
                          <div key={section}>
                            {renderAddressSectionPanel(
                              "shipping",
                              teT(language, ADDRESS_SECTION_TITLE_KEYS.shipping),
                            )}
                          </div>
                        );
                      }
                      if (section === "customer") {
                        return (
                          <div key={section}>
                            {renderAddressSectionPanel(
                              "customer",
                              teT(language, ADDRESS_SECTION_TITLE_KEYS.customer),
                            )}
                          </div>
                        );
                      }
                      return null;
                    })}

                    <Card padding="0">
                      {renderSectionHeader(
                        "document",
                        teT(language, "te.tx.document"),
                        "document-details-panel",
                      )}
                      <Collapsible
                        id="document-details-panel"
                        open={openHeaderPanel === "document"}
                      >
                        <div className="template-editor__accordion-body">
                          <BlockStack gap="300">
                            <Text as="p" variant="bodySm" tone="subdued">
                              {teT(language, "te.tx.docLabelsHelp")}
                            </Text>
                            <FormLayout>
                              {(
                                [
                                  ["documentTitle", "te.tx.documentTitle"],
                                  ["orderNumber", "te.tx.orderNumberLabel"],
                                  ["date", "te.tx.dateLabel"],
                                  ...(!isSalesOrderEditor
                                    ? ([
                                        ["reference", "te.tx.referenceLabel"],
                                        [
                                          "shopifyOrder",
                                          "te.tx.shopifyOrderLabel",
                                        ],
                                      ] as const)
                                    : []),
                                  ...(!isCreditNoteEditor
                                    ? ([
                                        [
                                          "expectedShipmentDate",
                                          "te.tx.expectedShipLabel",
                                        ],
                                      ] as const)
                                    : []),
                                  ...(!isCreditNoteEditor && !isPackingSlipEditor
                                    ? ([
                                        [
                                          "paymentMethod",
                                          "te.tx.paymentMethodLabel",
                                        ],
                                      ] as const)
                                    : []),
                                ] as const
                              ).map(([key, labelKey]) => (
                                <TextField
                                  key={key}
                                  label={teT(language, labelKey)}
                                  value={
                                    settings.transactionLabels[
                                      key as keyof typeof settings.transactionLabels
                                    ] || ""
                                  }
                                  onChange={(value) =>
                                    updateSettings({
                                      transactionLabels: {
                                        ...settings.transactionLabels,
                                        [key]: value,
                                      },
                                    })
                                  }
                                  autoComplete="off"
                                />
                              ))}
                              {!isSalesOrderEditor ? (
                                <>
                                  <Checkbox
                                    label={teT(language, "te.tx.showReference")}
                                    checked={
                                      settings.header.showReference !== false
                                    }
                                    helpText={teT(
                                      language,
                                      "te.tx.showReferenceHelp",
                                    )}
                                    onChange={(showReference) =>
                                      updateSettings({
                                        header: {
                                          ...settings.header,
                                          showReference,
                                        },
                                      })
                                    }
                                  />
                                  <Checkbox
                                    label={teT(
                                      language,
                                      "te.tx.showShopifyOrder",
                                    )}
                                    checked={
                                      settings.header.showShopifyOrder === true
                                    }
                                    helpText={teT(
                                      language,
                                      "te.tx.showShopifyOrderHelp",
                                    )}
                                    onChange={(showShopifyOrder) =>
                                      updateSettings({
                                        shopifyOrderDefaultReset: true,
                                        header: {
                                          ...settings.header,
                                          showShopifyOrder,
                                        },
                                      })
                                    }
                                  />
                                </>
                              ) : null}
                              {!isCreditNoteEditor ? (
                                <Checkbox
                                  label={teT(language, "te.tx.showExpectedShip")}
                                  checked={
                                    settings.header.showExpectedShipmentDate
                                  }
                                  onChange={(showExpectedShipmentDate) =>
                                    updateSettings({
                                      header: {
                                        ...settings.header,
                                        showExpectedShipmentDate,
                                      },
                                    })
                                  }
                                />
                              ) : null}
                              {!isCreditNoteEditor && !isPackingSlipEditor ? (
                                <Checkbox
                                  label={teT(language, "te.tx.showPaymentMethod")}
                                  checked={settings.header.showPaymentMethod}
                                  onChange={(showPaymentMethod) =>
                                    updateSettings({
                                      header: {
                                        ...settings.header,
                                        showPaymentMethod,
                                      },
                                    })
                                  }
                                />
                              ) : null}
                            </FormLayout>
                          </BlockStack>
                        </div>
                      </Collapsible>
                    </Card>
                  </BlockStack>
                ) : null}

                {activeSection === "table" ? (
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingLg">
                      {teT(language, "te.table.title")}
                    </Text>
                    <div className="template-editor__table-heading">
                      <span>{teT(language, "te.table.field")}</span>
                      <span>{teT(language, "te.table.widthPct")}</span>
                      <span>{teT(language, "te.table.label")}</span>
                    </div>
                    {settings.columns.map((column, index) =>
                      isPackingSlipEditor &&
                      packingMoneyColumnKeys.has(column.key) ? null : (
                      <div key={column.key}>
                        <div className="template-editor__column-row">
                          <Checkbox
                            label={teColumnFieldLabel(
                              language,
                              column.key,
                              columnFieldLabels[column.key] ??
                                column.key
                                  .replace(/([A-Z])/g, " $1")
                                  .replace(/^./, (letter) =>
                                    letter.toUpperCase(),
                                  ),
                            )}
                            checked={column.enabled}
                            onChange={(enabled) =>
                              updateColumn(index, { enabled })
                            }
                          />
                          {column.key === "custom" ? (
                            <>
                              <span className="template-editor__column-spacer" />
                              <span className="template-editor__column-spacer" />
                            </>
                          ) : (
                            <>
                              <TextField
                                label={teT(language, "te.table.width")}
                                labelHidden
                                type="number"
                                value={String(column.width)}
                                onChange={(value) =>
                                  updateColumn(index, {
                                    width: Number(value),
                                  })
                                }
                                autoComplete="off"
                              />
                              <TextField
                                label={teT(language, "te.table.label")}
                                labelHidden
                                value={column.label}
                                onChange={(label) =>
                                  updateColumn(index, { label })
                                }
                                autoComplete="off"
                              />
                            </>
                          )}
                          {column.key === "rate" ? (
                            <div className="template-editor__column-option">
                              <Checkbox
                                label={teT(language, "te.table.showCompare")}
                                checked={Boolean(column.showComparePrice)}
                                onChange={(showComparePrice) =>
                                  updateColumn(index, { showComparePrice })
                                }
                              />
                            </div>
                          ) : null}
                          {column.key === "sku" || column.key === "barcode" ? (
                            <div className="template-editor__column-option">
                              <Checkbox
                                label={teT(language, "te.table.showBelowTitle")}
                                checked={Boolean(column.showBelowItem)}
                                onChange={(showBelowItem) =>
                                  updateColumn(index, { showBelowItem })
                                }
                              />
                            </div>
                          ) : null}
                          {column.key === "item" && adminCaps.productImages ? (
                            <div className="template-editor__column-option">
                              <BlockStack gap="200">
                                <Checkbox
                                  label={teT(language, "te.table.showImage")}
                                  checked={Boolean(column.showImage)}
                                  onChange={(showImage) =>
                                    updateColumn(index, {
                                      showImage,
                                      imageSize:
                                        column.imageSize ?? "medium",
                                    })
                                  }
                                />
                                {column.showImage ? (
                                  <InlineStack gap="300" wrap={false}>
                                    {(
                                      [
                                        ["small", "te.size.small"],
                                        ["medium", "te.size.medium"],
                                        ["large", "te.size.large"],
                                      ] as const
                                    ).map(([value, labelKey]) => (
                                      <RadioButton
                                        key={value}
                                        label={teT(language, labelKey)}
                                        checked={
                                          (column.imageSize ?? "medium") ===
                                          value
                                        }
                                        id={`item-image-size-${index}-${value}`}
                                        name={`item-image-size-${index}`}
                                        onChange={() =>
                                          updateColumn(index, {
                                            imageSize: value,
                                          })
                                        }
                                      />
                                    ))}
                                  </InlineStack>
                                ) : null}
                              </BlockStack>
                            </div>
                          ) : null}
                        </div>
                        {column.key === "custom" && column.enabled ? (
                          <div className="template-editor__custom-fields">
                            {!customFieldsLoadRequested ? (
                              <BlockStack gap="300">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {teT(language, "te.table.refreshHint")}
                                </Text>
                                <InlineStack gap="200" wrap>
                                  <Button
                                    variant="primary"
                                    onClick={() => refreshCustomFieldSources(true)}
                                    loading={customFieldsLoading}
                                  >
                                    {teT(language, "te.table.refresh")}
                                  </Button>
                                  <Button
                                    url="shopify://admin/settings/custom_data/product/metafields"
                                    target="_top"
                                  >
                                    {teT(language, "te.table.manageMetafields")}
                                  </Button>
                                </InlineStack>
                              </BlockStack>
                            ) : customFieldsLoading &&
                              customFieldSources.length === 0 ? (
                              <Text as="p" variant="bodySm" tone="subdued">
                                {teT(language, "te.table.loadingMetafields")}
                              </Text>
                            ) : customFieldSources.length === 0 ? (
                              <BlockStack gap="300">
                                <Text as="h3" variant="headingSm">
                                  {teT(language, "te.table.setupTitle")}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {teT(language, "te.table.setupBody")}
                                </Text>
                                <ol className="template-editor__setup-steps">
                                  <li>
                                    <strong>
                                      {teT(language, "te.table.setupStep1")}
                                    </strong>
                                  </li>
                                  <li>
                                    <strong>
                                      {teT(language, "te.table.setupStep2")}
                                    </strong>
                                  </li>
                                  <li>
                                    <strong>
                                      {teT(language, "te.table.setupStep3")}
                                    </strong>
                                  </li>
                                </ol>
                                <InlineStack gap="200" wrap>
                                  <Button
                                    variant="primary"
                                    url="shopify://admin/settings/custom_data/product/metafields"
                                    target="_top"
                                  >
                                    {teT(language, "te.table.createMetafield")}
                                  </Button>
                                  <Button
                                    onClick={() => refreshCustomFieldSources(true)}
                                    loading={customFieldsLoading}
                                  >
                                    {teT(language, "te.table.refresh")}
                                  </Button>
                                </InlineStack>
                              </BlockStack>
                            ) : (
                              <BlockStack gap="200">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {teT(language, "te.table.selectMetafields")}
                                </Text>
                                {settings.selectedCustomFields.length > 0 ? (
                                  <div className="template-editor__custom-field-list">
                                    {settings.selectedCustomFields.map(
                                      (field, index) => {
                                        const source =
                                          customFieldSources.find(
                                            (entry) => entry.id === field.id,
                                          ) ?? null;
                                        const label =
                                          source?.name?.trim() ||
                                          field.name.trim() ||
                                          teT(language, "te.table.customField");
                                        const isDragging =
                                          draggingCustomFieldIndex === index;
                                        const isDropTarget =
                                          dragOverCustomFieldIndex === index &&
                                          draggingCustomFieldIndex !== index;

                                        return (
                                          <div
                                            key={field.id}
                                            className={[
                                              "template-editor__custom-field-row",
                                              isDragging
                                                ? "template-editor__custom-field-row--dragging"
                                                : "",
                                              isDropTarget
                                                ? "template-editor__custom-field-row--drop-target"
                                                : "",
                                            ]
                                              .filter(Boolean)
                                              .join(" ")}
                                            onDragOver={(event) => {
                                              event.preventDefault();
                                              if (
                                                dragOverCustomFieldIndex !==
                                                index
                                              ) {
                                                setDragOverCustomFieldIndex(
                                                  index,
                                                );
                                              }
                                            }}
                                            onDrop={(event) => {
                                              event.preventDefault();
                                              if (
                                                draggingCustomFieldIndex !==
                                                null
                                              ) {
                                                moveSelectedCustomField(
                                                  draggingCustomFieldIndex,
                                                  index,
                                                );
                                              }
                                              setDraggingCustomFieldIndex(null);
                                              setDragOverCustomFieldIndex(null);
                                            }}
                                          >
                                            <button
                                              type="button"
                                              className="template-editor__drag-handle"
                                              draggable
                                              aria-label={teTf(
                                                language,
                                                "te.dragReorder",
                                                { name: field.name },
                                              )}
                                              onDragStart={(event) => {
                                                event.dataTransfer.effectAllowed =
                                                  "move";
                                                setDraggingCustomFieldIndex(
                                                  index,
                                                );
                                                setDragOverCustomFieldIndex(
                                                  index,
                                                );
                                              }}
                                              onDragEnd={() => {
                                                setDraggingCustomFieldIndex(
                                                  null,
                                                );
                                                setDragOverCustomFieldIndex(
                                                  null,
                                                );
                                              }}
                                            >
                                              <Icon
                                                source={DragHandleIcon}
                                                tone="subdued"
                                              />
                                            </button>
                                            <Checkbox
                                              label={label}
                                              checked
                                              onChange={(enabled) => {
                                                if (!enabled) {
                                                  if (source) {
                                                    toggleCustomField(
                                                      source,
                                                      false,
                                                    );
                                                  } else {
                                                    updateSettings({
                                                      selectedCustomFields:
                                                        settings.selectedCustomFields.filter(
                                                          (entry) =>
                                                            entry.id !==
                                                            field.id,
                                                        ),
                                                    });
                                                  }
                                                }
                                              }}
                                            />
                                            <div className="template-editor__custom-field-width">
                                              <TextField
                                                label={teT(
                                                  language,
                                                  "te.table.width",
                                                )}
                                                labelHidden
                                                type="number"
                                                value={String(
                                                  field.width ??
                                                    settings.columns.find(
                                                      (column) =>
                                                        column.key === "custom",
                                                    )?.width ??
                                                    12,
                                                )}
                                                onChange={(value) =>
                                                  updateSelectedCustomFieldWidth(
                                                    field.id,
                                                    Number(value),
                                                  )
                                                }
                                                autoComplete="off"
                                              />
                                            </div>
                                          </div>
                                        );
                                      },
                                    )}
                                  </div>
                                ) : null}
                                {customFieldSources
                                  .filter(
                                    (source) =>
                                      !settings.selectedCustomFields.some(
                                        (field) => field.id === source.id,
                                      ),
                                  )
                                  .map((source) => (
                                      <Checkbox
                                        key={source.id}
                                        label={source.name}
                                        checked={false}
                                        onChange={(enabled) =>
                                          toggleCustomField(source, enabled)
                                        }
                                      />
                                    ))}
                                <InlineStack gap="200">
                                  <Button
                                    url="shopify://admin/settings/custom_data/product/metafields"
                                    target="_top"
                                  >
                                    {teT(language, "te.table.manageMetafields")}
                                  </Button>
                                  <Button
                                    onClick={() => refreshCustomFieldSources(true)}
                                    loading={customFieldsLoading}
                                  >
                                    {teT(language, "te.table.refresh")}
                                  </Button>
                                </InlineStack>
                              </BlockStack>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </BlockStack>
                ) : null}

                {activeSection === "total" ? (
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingLg">
                      {teT(language, "te.total.title")}
                    </Text>
                    {!isPackingSlipEditor
                      ? (
                          [
                            [
                              "showSubtotal",
                              "subtotalLabel",
                              "Sub Total",
                              "te.total.subTotal",
                            ],
                          ] as const
                        ).map(([showKey, labelKey, fallback, uiKey]) => (
                      <div className="template-editor__toggle-label" key={showKey}>
                        <Checkbox
                          label={teT(language, uiKey)}
                          checked={Boolean(
                            settings.totals[
                              showKey as keyof typeof settings.totals
                            ],
                          )}
                          onChange={(checked) =>
                            updateSettings({
                              totals: {
                                ...settings.totals,
                                [showKey]: checked,
                              },
                            })
                          }
                        />
                        <TextField
                          label={`${fallback} label`}
                          labelHidden
                          value={displayTotalLabel(
                            settings.totals[
                              labelKey as keyof typeof settings.totals
                            ],
                            fallback,
                          )}
                          onChange={(label) =>
                            updateSettings({
                              totals: {
                                ...settings.totals,
                                [labelKey]: label,
                              },
                            })
                          }
                          autoComplete="off"
                        />
                      </div>
                    ))
                      : null}
                    <div className="template-editor__toggle-label">
                      <Checkbox
                        label={
                          isPackingSlipEditor
                            ? teT(language, "te.total.showItemsPacked")
                            : teT(language, "te.total.showQuantity")
                        }
                        checked={Boolean(settings.totals.showQuantity)}
                        onChange={(showQuantity) =>
                          updateSettings({
                            totals: { ...settings.totals, showQuantity },
                          })
                        }
                      />
                      <TextField
                        label={
                          isPackingSlipEditor
                            ? teT(language, "te.total.itemsPackedLabel")
                            : teT(language, "te.total.itemsInTotalLabel")
                        }
                        labelHidden
                        value={displayTotalLabel(
                          settings.totals.itemsInTotalLabel,
                          isPackingSlipEditor
                            ? "Items packed"
                            : "Items in Total",
                        )}
                        onChange={(itemsInTotalLabel) =>
                          updateSettings({
                            totals: {
                              ...settings.totals,
                              itemsInTotalLabel,
                            },
                          })
                        }
                        autoComplete="off"
                      />
                    </div>
                    {!isPackingSlipEditor ? (
                      <Checkbox
                        label={teT(language, "te.total.showTaxDetails")}
                        checked={Boolean(settings.totals.showTaxLines)}
                        onChange={(showTaxLines) =>
                          updateSettings({
                            totals: { ...settings.totals, showTaxLines },
                          })
                        }
                      />
                    ) : null}
                    {!isPackingSlipEditor
                      ? (
                          [
                            [
                              "showDiscountAmount",
                              "discountAmountLabel",
                              "Discount",
                              "te.total.discount",
                            ],
                            ...(!isCreditNoteEditor
                              ? ([
                                  [
                                    "showShippingPrice",
                                    "shippingPriceLabel",
                                    "Shipping",
                                    "te.total.shipping",
                                  ],
                                ] as const)
                              : []),
                            [
                              "showVatAmount",
                              "vatAmountLabel",
                              "Total Tax",
                              "te.total.totalTax",
                            ],
                          ] as const
                        ).map(([showKey, labelKey, fallback, uiKey]) => (
                      <div className="template-editor__toggle-label" key={showKey}>
                        <Checkbox
                          label={teT(language, uiKey)}
                          checked={Boolean(
                            settings.totals[
                              showKey as keyof typeof settings.totals
                            ],
                          )}
                          onChange={(checked) =>
                            updateSettings({
                              totals: {
                                ...settings.totals,
                                [showKey]: checked,
                              },
                            })
                          }
                        />
                        <TextField
                          label={`${fallback} label`}
                          labelHidden
                          value={displayTotalLabel(
                            settings.totals[
                              labelKey as keyof typeof settings.totals
                            ],
                            fallback,
                          )}
                          onChange={(label) =>
                            updateSettings({
                              totals: {
                                ...settings.totals,
                                [labelKey]: label,
                              },
                            })
                          }
                          autoComplete="off"
                        />
                      </div>
                    ))
                      : null}
                    {!isPackingSlipEditor ? (
                      <TextField
                        label={teT(language, "te.total.totalLabel")}
                        value={settings.totals.totalLabel}
                        onChange={(totalLabel) =>
                          updateSettings({
                            totals: { ...settings.totals, totalLabel },
                          })
                        }
                        autoComplete="off"
                      />
                    ) : null}
                    {adminCaps.paymentAmounts !== false
                      ? (
                          [
                            [
                              "showPaidAmount",
                              "paidAmountLabel",
                              "Paid Amount",
                              "te.total.paidAmount",
                            ],
                            [
                              "showBalanceDue",
                              "balanceDueLabel",
                              "Balance Due",
                              "te.total.balanceDue",
                            ],
                          ] as const
                        ).map(([showKey, labelKey, fallback, uiKey]) => (
                      <div className="template-editor__toggle-label" key={showKey}>
                        <Checkbox
                          label={teT(language, uiKey)}
                          checked={Boolean(
                            settings.totals[
                              showKey as keyof typeof settings.totals
                            ],
                          )}
                          onChange={(checked) =>
                            updateSettings({
                              totals: {
                                ...settings.totals,
                                [showKey]: checked,
                              },
                            })
                          }
                        />
                        <TextField
                          label={`${fallback} label`}
                          labelHidden
                          value={String(
                            settings.totals[
                              labelKey as keyof typeof settings.totals
                            ] || fallback,
                          )}
                          onChange={(label) =>
                            updateSettings({
                              totals: {
                                ...settings.totals,
                                [labelKey]: label,
                              },
                            })
                          }
                          autoComplete="off"
                        />
                      </div>
                    ))
                      : null}

                    {adminCaps.paymentAmounts !== false &&
                    (settings.totals.showPaidAmount ||
                      settings.totals.showBalanceDue) ? (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {teT(language, "te.total.paymentStatusStyle")}
                        </Text>
                        {paymentStyleOptions.map((style) => (
                          <RadioButton
                            key={style.value}
                            label={style.label}
                            checked={
                              (settings.totals.paymentStatusStyle ||
                                "inTotals") === style.value
                            }
                            id={`payment-status-style-${style.value}`}
                            name="paymentStatusStyle"
                            onChange={() =>
                              updateSettings({
                                totals: {
                                  ...settings.totals,
                                  paymentStatusStyle: style.value,
                                },
                              })
                            }
                          />
                        ))}
                      </BlockStack>
                    ) : null}

                    {!isPackingSlipEditor ? <Divider /> : null}

                    {adminCaps.taxSummary !== false ? (
                      <>
                    <Checkbox
                      label={teT(language, "te.total.showTaxSummary")}
                      checked={settings.taxSummary.enabled === true}
                      onChange={(enabled) =>
                        updateSettings({
                          taxSummary: { ...settings.taxSummary, enabled },
                          showTaxSummaryTable: enabled,
                        })
                      }
                    />
                    {settings.taxSummary.enabled === true ? (
                      <>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {teTf(language, "te.total.currencyHint", {
                            currency: "{currency}",
                          })}
                        </Text>
                        <div className="template-editor__tax-summary-row">
                          <Text as="span" variant="bodyMd">
                            {teT(language, "te.total.taxSummaryTitle")}
                          </Text>
                          <span className="template-editor__tax-summary-spacer" />
                          <TextField
                            label={teT(language, "te.total.taxSummaryTitle")}
                            labelHidden
                            value={settings.taxSummary.title}
                            onChange={(title) =>
                              updateSettings({
                                taxSummary: { ...settings.taxSummary, title },
                              })
                            }
                            autoComplete="off"
                          />
                        </div>
                        <div className="template-editor__tax-summary-row">
                          <Text as="span" variant="bodyMd">
                            {teT(language, "te.total.taxDetails")}
                          </Text>
                          <span className="template-editor__tax-summary-spacer" />
                          <TextField
                            label={teT(language, "te.total.taxDetails")}
                            labelHidden
                            value={settings.taxSummary.detailsLabel}
                            onChange={(detailsLabel) =>
                              updateSettings({
                                taxSummary: {
                                  ...settings.taxSummary,
                                  detailsLabel,
                                },
                              })
                            }
                            autoComplete="off"
                          />
                        </div>
                        {(
                          [
                            [
                              "showTaxableAmount",
                              "taxableAmountLabel",
                              "Taxable Amount",
                              "te.total.taxableAmount",
                              "te.total.showTaxableAmount",
                            ],
                            [
                              "showTaxAmount",
                              "taxAmountLabel",
                              "Tax Amount",
                              "te.total.taxAmount",
                              "te.total.showTaxAmount",
                            ],
                            [
                              "showTotalAmount",
                              "totalAmountLabel",
                              "Total Amount",
                              "te.total.totalAmount",
                              "te.total.showTotalAmount",
                            ],
                          ] as const
                        ).map(
                          ([
                            showKey,
                            labelKey,
                            fallback,
                            displayKey,
                            showLabelKey,
                          ]) => (
                          <div
                            className="template-editor__tax-summary-row"
                            key={showKey}
                          >
                            <Text as="span" variant="bodyMd">
                              {teT(language, displayKey)}
                            </Text>
                            <Checkbox
                              label={teT(language, showLabelKey)}
                              labelHidden
                              checked={Boolean(settings.taxSummary[showKey])}
                              onChange={(checked) =>
                                updateSettings({
                                  taxSummary: {
                                    ...settings.taxSummary,
                                    [showKey]: checked,
                                  },
                                })
                              }
                            />
                            <TextField
                              label={`${fallback} label`}
                              labelHidden
                              value={settings.taxSummary[labelKey]}
                              onChange={(label) =>
                                updateSettings({
                                  taxSummary: {
                                    ...settings.taxSummary,
                                    [labelKey]: label,
                                  },
                                })
                              }
                              autoComplete="off"
                              disabled={!settings.taxSummary[showKey]}
                            />
                          </div>
                        ))}
                        <div className="template-editor__tax-summary-row">
                          <Text as="span" variant="bodyMd">
                            {teT(language, "te.total.rowTotal")}
                          </Text>
                          <span className="template-editor__tax-summary-spacer" />
                          <TextField
                            label={teT(language, "te.total.rowTotal")}
                            labelHidden
                            value={settings.taxSummary.totalLabel}
                            onChange={(totalLabel) =>
                              updateSettings({
                                taxSummary: {
                                  ...settings.taxSummary,
                                  totalLabel,
                                },
                              })
                            }
                            autoComplete="off"
                          />
                        </div>
                      </>
                    ) : null}
                      </>
                    ) : null}
                  </BlockStack>
                ) : null}

                {activeSection === "other" ? (
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingLg">
                      {teT(language, "te.other.title")}
                    </Text>
                    <TextField
                      label={teT(language, "te.other.notesLabel")}
                      value={settings.notesLabel}
                      onChange={(notesLabel) => updateSettings({ notesLabel })}
                      autoComplete="off"
                    />
                    <Checkbox
                      label={teT(language, "te.other.preferOrderNote")}
                      helpText={teT(language, "te.other.preferOrderNoteHelp")}
                      checked={settings.preferShopifyOrderNote === true}
                      onChange={(preferShopifyOrderNote) =>
                        updateSettings({ preferShopifyOrderNote })
                      }
                    />
                    <TextField
                      label={teT(language, "te.other.defaultNotes")}
                      helpText={teT(language, "te.other.defaultNotesHelp")}
                      value={settings.notes}
                      onChange={(notes) => updateSettings({ notes })}
                      multiline={4}
                      autoComplete="off"
                    />
                    <TextField
                      label={teT(language, "te.other.termsLabel")}
                      value={settings.termsLabel}
                      onChange={(termsLabel) => updateSettings({ termsLabel })}
                      autoComplete="off"
                    />
                    <TextField
                      label={teT(language, "te.other.defaultTerms")}
                      value={settings.terms}
                      onChange={(terms) => updateSettings({ terms })}
                      multiline={5}
                      autoComplete="off"
                    />
                    <Checkbox
                      label={teT(language, "te.other.showSignature")}
                      checked={settings.showSignature}
                      onChange={(showSignature) =>
                        updateSettings({ showSignature })
                      }
                    />
                    <Checkbox
                      label={teT(language, "te.other.showStamp")}
                      checked={settings.showStamp}
                      onChange={(showStamp) => updateSettings({ showStamp })}
                    />
                  </BlockStack>
                ) : null}
              </Card>
              </div>

              <aside className="template-editor__preview">
              <div className="template-editor__preview-header">
                <Text as="h2" variant="headingMd">
                  {teT(language, "te.preview")}
                </Text>
                <Text as="span" tone="subdued">
                  {settings.paperSize} ·{" "}
                  {teT(
                    language,
                    settings.orientation === "landscape"
                      ? "te.general.landscape"
                      : "te.general.portrait",
                  )}
                </Text>
              </div>
              <div
                className={`template-editor__preview-stage${
                  previewPending ? " template-editor__preview-stage--pending" : ""
                }`}
              >
              <PaperScaleFrame
                key={`${previewSettings.paperSize}-${previewSettings.orientation}`}
              >
              <div
                className={`template-editor__paper template-editor__paper--${previewSettings.orientation} template-editor__paper--${previewSettings.paperSize.toLowerCase()}`}
                style={{
                  backgroundColor: previewSettings.backgroundColor,
                  fontFamily: resolveFontFamily(previewSettings.fontFamily),
                  padding: paperPaddingCss(previewSettings.margins),
                }}
              >
                <Suspense
                  fallback={
                    <div
                      className="template-editor__preview-skeleton"
                      style={{
                        minHeight: "40vh",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
                        borderRadius: 8,
                      }}
                    >
                      <PageLoader label={teT(language, "te.loadingPreview")} />
                    </div>
                  }
                >
                  <SalesOrderLiveDocument
                    settings={previewDocumentSettings}
                    templateId={data.templateId}
                    storeDetails={data.storeDetails}
                    order={previewOrder}
                  />
                </Suspense>
              </div>
              </PaperScaleFrame>
              </div>
              </aside>
            </div>
          </div>
        </BlockStack>
      </s-page>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:template-edit-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
