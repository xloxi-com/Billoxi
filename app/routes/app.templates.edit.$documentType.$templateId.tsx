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
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useRouteError,
} from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
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
import {
  defaultColumnsForPreset,
  defaultTemplateSettings,
  findTemplatePreset,
  getSalesOrderTemplatePreset,
  getTemplateAdminCapabilities,
  isPremiumTemplatePreset,
  mergeTaxSummarySettings,
  mergeTotalsSettings,
  paperPaddingCss,
  PAYMENT_STATUS_STYLES,
  PREMIUM_DESIGN_VERSION,
  SALES_ORDER_TEMPLATE_PRESETS,
  INVOICE_TEMPLATE_PRESETS,
  CREDIT_NOTE_TEMPLATE_PRESETS,
  PACKING_SLIP_TEMPLATE_PRESETS,
  salesOrderLogoPosition,
  salesOrderMetaStyle,
  type PaymentStatusStyle,
  type SalesOrderLogoPosition,
  type SalesOrderMetaStyle,
  resolveDocumentNotes,
} from "../sales-order-document";
import {
  syncNumberCounter,
} from "../sales-order-number.server";
import { sampleSalesOrderForShop, sampleCreditNoteForShop } from "../sales-order-sample";
import { PaperScaleFrame } from "../components/paper-scale-frame";
import { templatePreviewLogoDataUrl } from "../template-preview-logo";

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
  namespace?: string;
  key?: string;
  ownerType?: string;
  metaobjectType?: string;
};

type CustomerDetailKey =
  | "company"
  | "name"
  | "address"
  | "taxId"
  | "vatNumber"
  | "phone"
  | "email";

type CustomerDetailField = {
  key: CustomerDetailKey;
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
  paperSize: "A5" | "A4" | "Letter";
  orientation: "portrait" | "landscape";
  margins: { top: number; bottom: number; left: number; right: number };
  /** Premium look upgrade marker (v2 = tax/paid/due + preset colors/fonts). */
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
    showExpectedShipmentDate: boolean;
    showPaymentMethod: boolean;
  };
  billingDetails: CustomerDetailField[];
  shippingDetails: CustomerDetailField[];
  customerBlockDetails: CustomerDetailField[];
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
              aria-label={`Pick ${label} color`}
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
                label="Hex"
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
  { key: "sku", enabled: true, width: 11, label: "SKU" },
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
  { key: "taxId", enabled: false, label: "Tax ID" },
  { key: "vatNumber", enabled: false, label: "VAT number" },
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
  { key: "taxId", enabled: false, label: "Tax ID" },
  { key: "vatNumber", enabled: false, label: "VAT number" },
  { key: "phone", enabled: true, label: "Phone" },
  { key: "email", enabled: true, label: "Email" },
];

const customerDetailFallbacks: Record<CustomerDetailKey, string> = {
  company: "Company",
  name: "First name and last name",
  address: "Address",
  taxId: "Tax ID",
  vatNumber: "VAT number",
  phone: "Phone",
  email: "Email",
};

const customerDetailKeysWithLabel: ReadonlySet<CustomerDetailKey> = new Set([
  "taxId",
  "vatNumber",
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
): CustomerDetailField[] {
  if (Array.isArray(value)) {
    const seen = new Set<CustomerDetailKey>();
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

      if (!isCustomerDetailKey(field.key) || seen.has(field.key)) continue;
      // Keep only keys that belong in this section's defaults.
      if (!defaults.some((item) => item.key === field.key)) continue;
      seen.add(field.key);
      normalized.push({
        key: field.key,
        enabled: field.enabled !== false,
        label:
          typeof field.label === "string" && field.label.trim()
            ? field.label
            : customerDetailFallbacks[field.key],
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
  return defaultTemplateSettings(name, templateId ?? "sales-standard");
}

function expectedDocumentTitle(documentType: string): string {
  switch (documentType) {
    case "invoice":
      return "INVOICE";
    case "credit-note":
      return "CREDIT NOTE";
    case "packing-slip":
      return "PACKING SLIP";
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

  // Always pin document-type header defaults (billing/shipping/payment toggles).
  next = {
    ...next,
    header: { ...next.header, ...defaults.header },
  };

  // Repair stale saves where title/order labels belong to another document type.
  const expectedEn = expectedDocumentTitle(documentType);
  const title = settings.transactionLabels.documentTitle?.trim() ?? "";
  const orderLabel = settings.transactionLabels.orderNumber?.trim() ?? "";
  const knownTitles = new Set([
    "SALES ORDER",
    "INVOICE",
    "CREDIT NOTE",
    "PACKING SLIP",
  ]);
  const titleMismatch =
    knownTitles.has(title) && title !== expectedEn;
  const orderMismatch =
    (orderLabel === "Sales Order#" && documentType !== "sales-order") ||
    (orderLabel === "Invoice#" && documentType !== "invoice") ||
    (orderLabel === "Credit Note#" && documentType !== "credit-note") ||
    (orderLabel === "Packing Slip#" && documentType !== "packing-slip");

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
      header: { ...next.header, ...defaults.header },
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
    return defaults;
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
    designVersion: isPremiumSales
      ? PREMIUM_DESIGN_VERSION
      : Number(restInput.designVersion ?? 1) || 1,
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
                      key: "sku",
                      label:
                        column.label === "EAN" || !column.label.trim()
                          ? "SKU"
                          : column.label,
                      enabled: true,
                    }
                  : column;
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
    normalized.push({
      id: field.id,
      kind: "metafield",
      name:
        typeof field.name === "string" && field.name.trim()
          ? field.name.trim()
          : field.key || "Custom field",
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

function getTemplate(documentType: string | undefined, templateId: string | undefined) {
  if (!documentType || !templateId) return null;
  const template = templateDefinitions[templateId];
  return template?.documentType === documentType ? template : null;
}

export function shouldRevalidate({
  formMethod,
  currentParams,
  nextParams,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
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
  // Critical path only — metafields load after paint via /app/templates/custom-fields.
  const [customization, storeDetails, lastAllocated, numberSeries] =
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
      loadStoreDetailsForShop(session.shop, admin),
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
          : params.documentType === "credit-note"
            ? "credit-note"
            : params.documentType === "packing-slip"
              ? "packing-slip"
              : "sales-order",
      ),
    ]);

  // Usually a cache hit after store-details warm-up.
  const shopCurrencyCode = await fetchShopCurrencyCode(admin, session.shop);

  let settings = mergeSettings(
    customization?.settings,
    template.name,
    params.templateId,
  );
  // Shop store details own the org name + logo for every template.
  if (storeDetails.name) {
    settings.transactionLabels.organization = storeDetails.name;
  }
  if (storeDetails.logoDataUrl) {
    settings.logoDataUrl = storeDetails.logoDataUrl;
    settings.logoFileName = storeDetails.logoFileName;
  }
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
      : params.documentType === "credit-note"
        ? "credit-note"
        : params.documentType === "packing-slip"
          ? "packing-slip"
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

const sectionItems: Array<{
  id: EditorSection;
  label: string;
}> = [
  { id: "general", label: "General" },
  { id: "transaction", label: "Transaction Details" },
  { id: "table", label: "Table" },
  { id: "total", label: "Total" },
  { id: "appearance", label: "Appearance" },
  { id: "other", label: "Other Details" },
];

export default function TemplateEditorPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const customFieldsFetcher = useFetcher<{ sources: CustomFieldSource[] }>();
  const revalidator = useRevalidator();
  const customFieldsRequestedRef = useRef(false);

  useEffect(() => {
    if (customFieldsRequestedRef.current) return;
    customFieldsRequestedRef.current = true;
    customFieldsFetcher.load("/app/templates/custom-fields");
  }, [customFieldsFetcher]);

  const customFieldSources =
    customFieldsFetcher.data?.sources ?? data.customFieldSources;
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
              data.documentType !== "packing-slip",
            paymentAmounts:
              data.documentType !== "credit-note" &&
              data.documentType !== "packing-slip",
          },
    [data.documentType, data.templateId],
  );
  const isCreditNoteEditor = data.documentType === "credit-note";
  const isPackingSlipEditor = data.documentType === "packing-slip";
  const packingMoneyColumnKeys = new Set([
    "rate",
    "discount",
    "discountPercentage",
    "taxPercentage",
    "taxAmount",
    "amount",
  ]);
  const documentTypeBreadcrumb =
    (
      {
        "sales-order": "SALES ORDER",
        invoice: "INVOICE",
        "credit-note": "CREDIT NOTE",
        "packing-slip": "PACKING SLIP",
      } as Record<string, string>
    )[data.documentType] || data.documentType.toUpperCase();
  const paymentStyleOptions = useMemo(() => {
    const allowed = adminCaps.paymentStatusStyles;
    if (!allowed || allowed.length === 0) return PAYMENT_STATUS_STYLES;
    return PAYMENT_STATUS_STYLES.filter((style) =>
      allowed.includes(style.value),
    );
  }, [adminCaps.paymentStatusStyles]);
  const logoPositionOptions = useMemo(() => {
    const allowed = adminCaps.logoPositions ?? ["left", "right", "center"];
    return (
      [
        { value: "left" as const, label: "Left" },
        { value: "right" as const, label: "Right" },
        { value: "center" as const, label: "Center" },
      ] as const
    ).filter((option) => allowed.includes(option.value));
  }, [adminCaps.logoPositions]);
  const metaStyleOptions = useMemo(() => {
    const allowed =
      adminCaps.metaStyles ??
      (["boxed", "outline", "plain", "strip", "card", "inverted"] as const);
    const labels: Record<SalesOrderMetaStyle, string> = {
      boxed: "Boxed (gray)",
      outline: "Outline",
      plain: "Plain",
      strip: "Accent strip",
      card: "Card",
      inverted: "Inverted",
    };
    return (Object.keys(labels) as SalesOrderMetaStyle[])
      .filter((value) => allowed.includes(value))
      .map((value) => ({ value, label: labels[value] }));
  }, [adminCaps.metaStyles]);
  const [activeSection, setActiveSection] =
    useState<EditorSection>("general");
  const [settings, setSettings] = useState<TemplateEditorSettings>(() =>
    withNormalizedTotalLabels(data.settings, data.templateId),
  );
  const [savedSettings, setSavedSettings] = useState<TemplateEditorSettings>(
    () => withNormalizedTotalLabels(data.settings, data.templateId),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [openHeaderPanel, setOpenHeaderPanel] = useState<string | null>(
    "organization",
  );
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [draggingField, setDraggingField] = useState<{
    section: AddressSection;
    index: number;
  } | null>(null);
  const [dragOverField, setDragOverField] = useState<{
    section: AddressSection;
    index: number;
  } | null>(null);
  const [expandedLabel, setExpandedLabel] = useState<{
    section: AddressSection;
    key: CustomerDetailKey;
  } | null>(null);
  const isSaving = fetcher.state !== "idle";
  const selectedTab = Math.max(
    sectionItems.findIndex((section) => section.id === activeSection),
    0,
  );
  const pendingSaveRef = useRef<TemplateEditorSettings | null>(null);
  const handledFetcherDataRef = useRef<unknown>(null);
  const loadedFontsRef = useRef<Set<string>>(new Set());
  /** Prevents RangeSlider/etc. onChange during Discard from flipping dirty back on. */
  const suppressDirtyRef = useRef(false);
  // Keep form controls instant; defer the heavy document preview paint.
  const deferredSettings = useDeferredValue(settings);
  const previewPending = deferredSettings !== settings;
  const previewSettings = useMemo(() => {
    const withStoreBrand = {
      ...deferredSettings,
      transactionLabels: {
        ...deferredSettings.transactionLabels,
        organization:
          data.storeDetails.name ||
          deferredSettings.transactionLabels.organization,
      },
      ...(data.storeDetails.logoDataUrl
        ? {
            logoDataUrl: data.storeDetails.logoDataUrl,
            logoFileName: data.storeDetails.logoFileName,
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
  }, [data.storeDetails, data.templateId, deferredSettings]);
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
    () => ({
      ...(data.documentType === "credit-note"
        ? sampleCreditNoteForShop(data.shopCurrencyCode)
        : sampleSalesOrderForShop(data.shopCurrencyCode)),
      documentNumber: formatTransactionNumber(
        previewSettings.numbering,
        nextSequence,
      ),
    }),
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
      setSavedSettings(pendingSaveRef.current);
      pendingSaveRef.current = null;
      setIsDirty(false);
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show("Template settings saved");
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
    setSettings((current) => {
      const next = {
        ...current,
        billingDetails: normalizeCustomerDetails(
          current.billingDetails,
          defaultBillingDetails,
        ),
        shippingDetails: normalizeCustomerDetails(
          current.shippingDetails,
          defaultShippingDetails,
        ),
        customerBlockDetails: normalizeCustomerDetails(
          current.customerBlockDetails,
          defaultCustomerBlockDetails,
        ),
      };
      setSavedSettings(next);
      return next;
    });
  }, []);

  const markDirty = () => {
    if (suppressDirtyRef.current) return;
    setIsDirty(true);
  };

  const updateSettings = (updates: Partial<TemplateEditorSettings>) => {
    setSettings((current) => ({ ...current, ...updates }));
    markDirty();
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
    markDirty();
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
      markDirty();
    };
    if (options?.urgent) {
      apply();
      return;
    }
    // Color/slider drags: don't block checkbox/text clicks.
    startTransition(apply);
  };

  const save = () => {
    pendingSaveRef.current = settings;
    fetcher.submit(
      { intent: "save", settings: JSON.stringify(settings) },
      { method: "post" },
    );
  };

  const discard = () => {
    suppressDirtyRef.current = true;
    setSettings(savedSettings);
    setLogoError("");
    setIsDirty(false);
    try {
      if (typeof shopify !== "undefined" && shopify.saveBar?.hide) {
        shopify.saveBar.hide("template-editor-save-bar");
      }
    } catch {
      // Admin host may not expose saveBar in some embeds.
    }
    // Allow one paint cycle so controlled RangeSliders can settle without re-dirtying.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressDirtyRef.current = false;
      });
    });
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
    const nextSelected = enabled
      ? selected.some((field) => field.id === source.id)
        ? selected
        : [
            ...selected,
            {
              id: source.id,
              kind: source.kind,
              name: source.name,
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
      enabled && customIndex >= 0
        ? settings.columns.map((column, index) =>
            index === customIndex ? { ...column, enabled: true } : column,
          )
        : settings.columns;

    updateSettings({
      selectedCustomFields: nextSelected,
      columns: nextColumns,
    });
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

  const toggleHeaderPanel = (panel: string) => {
    setOpenHeaderPanel((current) => (current === panel ? null : panel));
  };

  const renderSectionHeader = (
    panel: string,
    title: string,
    panelId: string,
  ) => {
    const isOpen = openHeaderPanel === panel;

    return (
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
        {renderSectionHeader(section, title, panelId)}

        <Collapsible id={panelId} open={isOpen}>
          <div className="template-editor__accordion-body">
            <BlockStack gap="400">
              <Checkbox
                label={`Show ${title.toLowerCase()} on document`}
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
                Drag to reorder fields. Expand Tax ID, VAT, Phone, or Email to
                set an optional custom label.
              </Text>

              <FormLayout>
                <TextField
                  label="Section title"
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
                  helpText="Appears above this block on the document."
                  disabled={!sectionVisible}
                />
              </FormLayout>

              <BlockStack gap="200">
                <Text as="h4" variant="headingSm">
                  Visible fields
                </Text>
                <Box
                  borderWidth="025"
                  borderColor="border"
                  borderRadius="200"
                  background="bg-surface"
                  overflowX="hidden"
                  overflowY="hidden"
                >
                  <BlockStack gap="0">
                    {fields.map((field, index) => {
                      const supportsLabel = customerDetailKeysWithLabel.has(
                        field.key,
                      );
                      const isExpanded =
                        supportsLabel &&
                        expandedLabel?.section === section &&
                        expandedLabel.key === field.key;
                      const fieldPanelId = `${section}-field-${field.key}`;
                      const isLast = index === fields.length - 1;
                      const isDragging =
                        draggingField?.section === section &&
                        draggingField.index === index;
                      const isDropTarget =
                        dragOverField?.section === section &&
                        dragOverField.index === index &&
                        !(
                          draggingField?.section === section &&
                          draggingField.index === index
                        );

                      return (
                        <div
                          key={field.key}
                          onDragOver={(event) => {
                            event.preventDefault();
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
                              draggingField.section === section
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
                                    aria-label={`Drag to reorder ${customerDetailFallbacks[field.key]}`}
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
                                    label={`Show ${customerDetailFallbacks[field.key]}`}
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
                                        ? `Hide label for ${customerDetailFallbacks[field.key]}`
                                        : `Edit label for ${customerDetailFallbacks[field.key]}`
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
                                        label="Custom label"
                                        value={field.label}
                                        placeholder={
                                          customerDetailFallbacks[field.key]
                                        }
                                        onChange={(label) =>
                                          updateAddressField(section, index, {
                                            label,
                                          })
                                        }
                                        autoComplete="off"
                                        helpText="Optional. Leave blank to use the default name."
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
              </BlockStack>
            </BlockStack>
          </div>
        </Collapsible>
      </Card>
    );
  };

  return (
    <AppProvider i18n={enTranslations}>
      <SaveBar id="template-editor-save-bar" open={isDirty} discardConfirmation>
        <button
          variant="primary"
          onClick={save}
          disabled={!isDirty || isSaving || undefined}
          loading={isSaving || undefined}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button onClick={discard} disabled={isSaving || undefined}>
          Discard
        </button>
      </SaveBar>
      <s-page heading="Edit Template" inlineSize="large">
        <s-link slot="breadcrumb-actions" href="/app/templates">
          Templates
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
                    id: section.id,
                    content: section.label,
                    panelID: `template-editor-panel-${section.id}`,
                  }))}
                  selected={selectedTab}
                  onSelect={(index) => {
                    const section = sectionItems[index];
                    if (section) setActiveSection(section.id);
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
                      Template Properties
                    </Text>
                    <TextField
                      label="Template Name"
                      value={settings.name}
                      onChange={(name) => updateSettings({ name })}
                      autoComplete="off"
                    />
                    <Select
                      label="Language"
                      options={TEMPLATE_LANGUAGES.map((entry) => ({
                        value: entry.value,
                        label: entry.label,
                      }))}
                      value={normalizeTemplateLanguage(settings.language)}
                      onChange={changeTemplateLanguage}
                      helpText="Translates all document labels (Bill To, totals, columns, notes title, and more)."
                    />
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Paper Size
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
                        Orientation
                      </Text>
                      <InlineStack gap="400">
                        {(["portrait", "landscape"] as const).map(
                          (orientation) => (
                            <RadioButton
                              key={orientation}
                              label={
                                orientation[0].toUpperCase() +
                                orientation.slice(1)
                              }
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
                        Margins (in inches)
                      </Text>
                      <InlineGrid columns={4} gap="300">
                        {(["top", "bottom", "left", "right"] as const).map(
                          (side) => (
                            <TextField
                              key={side}
                              label={side[0].toUpperCase() + side.slice(1)}
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
                      Appearance
                    </Text>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd">
                        Font
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
                            title: "General",
                            sizes: [] as const,
                            colors: [
                              [
                                "background",
                                "Background",
                                settings.backgroundColor,
                                "#ffffff",
                              ],
                              [
                                "textColor",
                                "Text",
                                settings.appearance.textColor,
                                defaultAppearance.textColor,
                              ],
                              [
                                "mutedColor",
                                "Muted",
                                settings.appearance.mutedColor,
                                defaultAppearance.mutedColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "document-title",
                            title: "Document title",
                            sizes: [
                              ["titleFontSize", "Title", 14, 48, 28],
                              ["orderNumberFontSize", "Order #", 8, 24, 12],
                              ["metadataFontSize", "Date / Ref#", 7, 18, 12],
                            ] as const,
                            colors: [
                              [
                                "headingColor",
                                "Heading",
                                settings.appearance.headingColor,
                                defaultAppearance.headingColor,
                              ],
                              [
                                "orderNumberColor",
                                "Sales order #",
                                settings.appearance.orderNumberColor,
                                defaultAppearance.orderNumberColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "organization",
                            title: "Organization",
                            sizes: [
                              ["organizationFontSize", "Org", 8, 24, 12],
                              [
                                "organizationDetailsFontSize",
                                "Address",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "organizationColor",
                                "Organization",
                                settings.appearance.organizationColor,
                                defaultAppearance.organizationColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "addresses",
                            title: "Addresses",
                            sizes: [
                              ["addressLabelFontSize", "Label", 7, 18, 12],
                              ["companyFontSize", "Company", 8, 24, 12],
                              ["customerNameFontSize", "Name", 8, 24, 12],
                              [
                                "customerDetailsFontSize",
                                "Details",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "companyColor",
                                "Company",
                                settings.appearance.companyColor,
                                defaultAppearance.companyColor,
                              ],
                              [
                                "customerNameColor",
                                "Name",
                                settings.appearance.customerNameColor,
                                defaultAppearance.customerNameColor,
                              ],
                              [
                                "customerDetailsColor",
                                "Details",
                                settings.appearance.customerDetailsColor,
                                defaultAppearance.customerDetailsColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "table",
                            title: "Table",
                            sizes: [
                              [
                                "tableHeaderFontSize",
                                "Table header",
                                7,
                                18,
                                12,
                              ],
                              ["tableBodyFontSize", "Table body", 7, 18, 12],
                            ] as const,
                            colors: [
                              [
                                "tableHeaderBackground",
                                "Table header",
                                settings.appearance.tableHeaderBackground,
                                defaultAppearance.tableHeaderBackground,
                              ],
                              [
                                "tableHeaderText",
                                "Table text",
                                settings.appearance.tableHeaderText,
                                defaultAppearance.tableHeaderText,
                              ],
                              [
                                "tableBorderColor",
                                "Table border",
                                settings.appearance.tableBorderColor,
                                defaultAppearance.tableBorderColor,
                              ],
                              [
                                "unitPriceColor",
                                "Unit price",
                                settings.appearance.unitPriceColor,
                                defaultAppearance.unitPriceColor,
                              ],
                              [
                                "comparePriceColor",
                                "Compare price",
                                settings.appearance.comparePriceColor,
                                defaultAppearance.comparePriceColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "totals",
                            title: "Totals",
                            sizes: [
                              ["totalsFontSize", "Totals", 8, 20, 12],
                            ] as const,
                            colors: [
                              [
                                "totalHighlightBackground",
                                "Total highlight",
                                settings.appearance
                                  .totalHighlightBackground,
                                defaultAppearance.totalHighlightBackground,
                              ],
                            ] as const,
                          },
                          {
                            id: "payment-status",
                            title: "Paid Amount / Balance Due",
                            sizes: [
                              [
                                "paymentStatusLabelFontSize",
                                "Label",
                                7,
                                18,
                                12,
                              ],
                              [
                                "paymentStatusValueFontSize",
                                "Value",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "paymentStatusLabelColor",
                                "Label",
                                settings.appearance.paymentStatusLabelColor,
                                defaultAppearance.paymentStatusLabelColor,
                              ],
                              [
                                "paymentStatusValueColor",
                                "Value",
                                settings.appearance.paymentStatusValueColor,
                                defaultAppearance.paymentStatusValueColor,
                              ],
                              [
                                "paymentStatusBorderColor",
                                "Border",
                                settings.appearance.paymentStatusBorderColor,
                                defaultAppearance.paymentStatusBorderColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "tax-summary",
                            title: "Tax Summary",
                            sizes: [
                              [
                                "taxSummaryTitleFontSize",
                                "Title",
                                7,
                                18,
                                12,
                              ],
                              [
                                "taxSummaryHeaderFontSize",
                                "Header",
                                7,
                                18,
                                12,
                              ],
                              [
                                "taxSummaryBodyFontSize",
                                "Body",
                                7,
                                18,
                                12,
                              ],
                            ] as const,
                            colors: [
                              [
                                "taxSummaryTitleColor",
                                "Title",
                                settings.appearance.taxSummaryTitleColor,
                                defaultAppearance.taxSummaryTitleColor,
                              ],
                              [
                                "taxSummaryHeaderBackground",
                                "Header background",
                                settings.appearance.taxSummaryHeaderBackground,
                                defaultAppearance.taxSummaryHeaderBackground,
                              ],
                              [
                                "taxSummaryHeaderText",
                                "Header text",
                                settings.appearance.taxSummaryHeaderText,
                                defaultAppearance.taxSummaryHeaderText,
                              ],
                              [
                                "taxSummaryTextColor",
                                "Body text",
                                settings.appearance.taxSummaryTextColor,
                                defaultAppearance.taxSummaryTextColor,
                              ],
                              [
                                "taxSummaryBorderColor",
                                "Border",
                                settings.appearance.taxSummaryBorderColor,
                                defaultAppearance.taxSummaryBorderColor,
                              ],
                            ] as const,
                          },
                          {
                            id: "notes-terms",
                            title: "Notes & Terms",
                            sizes: [
                              ["notesLabelFontSize", "Notes label", 7, 18, 12],
                              ["notesBodyFontSize", "Notes text", 7, 18, 12],
                              ["termsLabelFontSize", "Terms label", 7, 18, 12],
                              ["termsBodyFontSize", "Terms text", 7, 18, 12],
                            ] as const,
                            colors: [
                              [
                                "notesLabelColor",
                                "Notes label",
                                settings.appearance.notesLabelColor,
                                defaultAppearance.notesLabelColor,
                              ],
                              [
                                "notesBodyColor",
                                "Notes text",
                                settings.appearance.notesBodyColor,
                                defaultAppearance.notesBodyColor,
                              ],
                              [
                                "termsLabelColor",
                                "Terms label",
                                settings.appearance.termsLabelColor,
                                defaultAppearance.termsLabelColor,
                              ],
                              [
                                "termsBodyColor",
                                "Terms text",
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
                              {category.title}
                            </Text>
                            {category.sizes.length > 0 ? (
                              <InlineGrid columns={2} gap="200">
                                {category.sizes.map(
                                  ([key, label, min, max, fallback]) => (
                                    <AppearanceSizeField
                                      key={key}
                                      label={label}
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
                                ([key, label, value, fallback]) => (
                                  <AppearanceColorField
                                    key={key}
                                    label={label}
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
                      Transaction Details
                    </Text>
                    <Card padding="0">
                      {renderSectionHeader(
                        "organization",
                        "Organization details",
                        "organization-details-panel",
                      )}
                      <Collapsible
                        id="organization-details-panel"
                        open={openHeaderPanel === "organization"}
                      >
                        <div className="template-editor__accordion-body">
                          <BlockStack gap="300">
                            <Text as="p" variant="bodySm" tone="subdued">
                              Organization name and logo come from Settings →
                              Store details and apply to every template. Only
                              logo size is set here.
                            </Text>
                            <Banner tone="info">
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd" fontWeight="semibold">
                                  {data.storeDetails.name || "Store name not set"}
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
                                  url="/app/settings?section=store-details"
                                  size="slim"
                                >
                                  Edit store details
                                </Button>
                              </BlockStack>
                            </Banner>
                            {data.storeDetails.logoDataUrl ? (
                              <InlineStack
                                gap="300"
                                blockAlign="start"
                                wrap={false}
                              >
                                <Thumbnail
                                  source={data.storeDetails.logoDataUrl}
                                  alt={
                                    data.storeDetails.logoFileName ||
                                    "Organization logo"
                                  }
                                  size="small"
                                />
                                <BlockStack gap="200">
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Logo from Store details
                                  </Text>
                                  <div className="template-editor__logo-size">
                                    <RangeSlider
                                      label="Logo size"
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
                                    No store logo yet. Upload one in Settings →
                                    Store details to show it on all templates.
                                  </Text>
                                  <Button
                                    url="/app/settings?section=store-details"
                                    size="slim"
                                  >
                                    Upload store logo
                                  </Button>
                                  <div className="template-editor__logo-size">
                                    <RangeSlider
                                      label="Logo size"
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
                                  Logo position
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
                                  Details box style
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {isPackingSlipEditor
                                    ? "Order Date and Ref# block."
                                    : "Order Date, Ref#, and Payment Method block."}
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

                    {!isPackingSlipEditor
                      ? renderAddressSectionPanel("billing", "Billing details")
                      : null}
                    {!isCreditNoteEditor
                      ? renderAddressSectionPanel(
                          "shipping",
                          "Shipping details",
                        )
                      : null}
                    {renderAddressSectionPanel("customer", "Customer details")}

                    <Card padding="0">
                      {renderSectionHeader(
                        "document",
                        "Document details",
                        "document-details-panel",
                      )}
                      <Collapsible
                        id="document-details-panel"
                        open={openHeaderPanel === "document"}
                      >
                        <div className="template-editor__accordion-body">
                          <BlockStack gap="300">
                            <Text as="p" variant="bodySm" tone="subdued">
                              Customize document labels. Values are filled from
                              the Shopify order.
                            </Text>
                            <FormLayout>
                              {(
                                [
                                  ["documentTitle", "Document title"],
                                  ["orderNumber", "Order number label"],
                                  ["date", "Date label"],
                                  ["reference", "Reference label"],
                                  ...(!isCreditNoteEditor
                                    ? ([
                                        [
                                          "expectedShipmentDate",
                                          "Expected shipment date label",
                                        ],
                                      ] as const)
                                    : []),
                                  ...(!isCreditNoteEditor && !isPackingSlipEditor
                                    ? ([
                                        [
                                          "paymentMethod",
                                          "Payment method label",
                                        ],
                                      ] as const)
                                    : []),
                                ] as const
                              ).map(([key, label]) => (
                                <TextField
                                  key={key}
                                  label={label}
                                  value={settings.transactionLabels[key]}
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
                              {!isCreditNoteEditor ? (
                                <Checkbox
                                  label="Show Expected Shipment Date"
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
                                  label="Show Payment Method"
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
                      Table Properties
                    </Text>
                    <div className="template-editor__table-heading">
                      <span>Field</span>
                      <span>Width (%)</span>
                      <span>Label</span>
                    </div>
                    {settings.columns.map((column, index) =>
                      isPackingSlipEditor &&
                      packingMoneyColumnKeys.has(column.key) ? null : (
                      <div key={column.key}>
                        <div className="template-editor__column-row">
                          <Checkbox
                            label={
                              columnFieldLabels[column.key] ??
                              column.key
                                .replace(/([A-Z])/g, " $1")
                                .replace(/^./, (letter) => letter.toUpperCase())
                            }
                            checked={column.enabled}
                            onChange={(enabled) =>
                              updateColumn(index, { enabled })
                            }
                          />
                          <TextField
                            label="Width"
                            labelHidden
                            type="number"
                            value={String(column.width)}
                            onChange={(value) =>
                              updateColumn(index, { width: Number(value) })
                            }
                            autoComplete="off"
                          />
                          <TextField
                            label="Label"
                            labelHidden
                            value={column.label}
                            onChange={(label) =>
                              updateColumn(index, { label })
                            }
                            autoComplete="off"
                          />
                          {column.key === "rate" ? (
                            <div className="template-editor__column-option">
                              <Checkbox
                                label="Show Compare Price"
                                checked={Boolean(column.showComparePrice)}
                                onChange={(showComparePrice) =>
                                  updateColumn(index, { showComparePrice })
                                }
                              />
                            </div>
                          ) : null}
                          {column.key === "item" && adminCaps.productImages ? (
                            <div className="template-editor__column-option">
                              <BlockStack gap="200">
                                <Checkbox
                                  label="Show Image"
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
                                        ["small", "Small"],
                                        ["medium", "Medium"],
                                        ["large", "Large"],
                                      ] as const
                                    ).map(([value, label]) => (
                                      <RadioButton
                                        key={value}
                                        label={label}
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
                            {customFieldSources.length === 0 ? (
                              <BlockStack gap="300">
                                <Text as="h3" variant="headingSm">
                                  Set up product metafields
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  This column shows product metafields you
                                  create in Shopify. None are set up yet —
                                  follow these steps:
                                </Text>
                                <ol className="template-editor__setup-steps">
                                  <li>
                                    Open{" "}
                                    <strong>Settings → Custom data → Products</strong>
                                  </li>
                                  <li>
                                    Click <strong>Add definition</strong>, name
                                    your field, choose a type, then save
                                  </li>
                                  <li>
                                    Come back here and click{" "}
                                    <strong>Refresh list</strong> to select it
                                  </li>
                                </ol>
                                <InlineStack gap="200" wrap>
                                  <Button
                                    variant="primary"
                                    url="shopify://admin/settings/custom_data/product/metafields"
                                    target="_top"
                                  >
                                    Create product metafield
                                  </Button>
                                  <Button
                                    onClick={() => revalidator.revalidate()}
                                    loading={revalidator.state === "loading"}
                                  >
                                    Refresh list
                                  </Button>
                                </InlineStack>
                              </BlockStack>
                            ) : (
                              <BlockStack gap="200">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Select product metafields to show in this
                                  column.
                                </Text>
                                {customFieldSources.map((source) => {
                                  const checked =
                                    settings.selectedCustomFields.some(
                                      (field) => field.id === source.id,
                                    );
                                  const detail = `${source.namespace}.${source.key}`;
                                  return (
                                    <Checkbox
                                      key={source.id}
                                      label={`${source.name} (${detail})`}
                                      checked={checked}
                                      onChange={(enabled) =>
                                        toggleCustomField(source, enabled)
                                      }
                                    />
                                  );
                                })}
                                <InlineStack gap="200">
                                  <Button
                                    url="shopify://admin/settings/custom_data/product/metafields"
                                    target="_top"
                                  >
                                    Manage metafields
                                  </Button>
                                  <Button
                                    onClick={() => revalidator.revalidate()}
                                    loading={revalidator.state === "loading"}
                                  >
                                    Refresh list
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
                      Total Properties
                    </Text>
                    {!isPackingSlipEditor
                      ? (
                          [
                            ["showSubtotal", "subtotalLabel", "Sub Total"],
                          ] as const
                        ).map(([showKey, labelKey, fallback]) => (
                      <div className="template-editor__toggle-label" key={showKey}>
                        <Checkbox
                          label={fallback}
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
                            ? "Show items packed"
                            : "Show quantity"
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
                            ? "Items packed label"
                            : "Items in Total label"
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
                        label="Show tax details"
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
                            ],
                            ...(!isCreditNoteEditor
                              ? ([
                                  [
                                    "showShippingPrice",
                                    "shippingPriceLabel",
                                    "Shipping",
                                  ],
                                ] as const)
                              : []),
                            ["showVatAmount", "vatAmountLabel", "Total Tax"],
                          ] as const
                        ).map(([showKey, labelKey, fallback]) => (
                      <div className="template-editor__toggle-label" key={showKey}>
                        <Checkbox
                          label={fallback}
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
                        label="Total label"
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
                            ["showPaidAmount", "paidAmountLabel", "Paid Amount"],
                            ["showBalanceDue", "balanceDueLabel", "Balance Due"],
                          ] as const
                        ).map(([showKey, labelKey, fallback]) => (
                      <div className="template-editor__toggle-label" key={showKey}>
                        <Checkbox
                          label={fallback}
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
                          Payment status style
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
                      label="Show Tax Summary table"
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
                          Use {"{currency}"} in labels to insert €, $, etc.
                        </Text>
                        <div className="template-editor__tax-summary-row">
                          <Text as="span" variant="bodyMd">
                            Tax Summary Title
                          </Text>
                          <span className="template-editor__tax-summary-spacer" />
                          <TextField
                            label="Tax Summary Title"
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
                            Tax Details
                          </Text>
                          <span className="template-editor__tax-summary-spacer" />
                          <TextField
                            label="Tax Details"
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
                            ],
                            ["showTaxAmount", "taxAmountLabel", "Tax Amount"],
                            [
                              "showTotalAmount",
                              "totalAmountLabel",
                              "Total Amount",
                            ],
                          ] as const
                        ).map(([showKey, labelKey, fallback]) => (
                          <div
                            className="template-editor__tax-summary-row"
                            key={showKey}
                          >
                            <Text as="span" variant="bodyMd">
                              {fallback}
                            </Text>
                            <Checkbox
                              label={`Show ${fallback}`}
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
                            Total
                          </Text>
                          <span className="template-editor__tax-summary-spacer" />
                          <TextField
                            label="Total"
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
                      Other Details
                    </Text>
                    <TextField
                      label="Notes label"
                      value={settings.notesLabel}
                      onChange={(notesLabel) => updateSettings({ notesLabel })}
                      autoComplete="off"
                    />
                    <Checkbox
                      label="Prefer Shopify order note"
                      helpText="When enabled, the note from the Shopify order is shown in Notes. Default notes are used only when the order has no note."
                      checked={settings.preferShopifyOrderNote === true}
                      onChange={(preferShopifyOrderNote) =>
                        updateSettings({ preferShopifyOrderNote })
                      }
                    />
                    <TextField
                      label="Default notes"
                      helpText="Fallback text when Prefer Shopify order note is off, or the order has no note."
                      value={settings.notes}
                      onChange={(notes) => updateSettings({ notes })}
                      multiline={4}
                      autoComplete="off"
                    />
                    <TextField
                      label="Terms & Conditions label"
                      value={settings.termsLabel}
                      onChange={(termsLabel) => updateSettings({ termsLabel })}
                      autoComplete="off"
                    />
                    <TextField
                      label="Default terms"
                      value={settings.terms}
                      onChange={(terms) => updateSettings({ terms })}
                      multiline={5}
                      autoComplete="off"
                    />
                    <Checkbox
                      label="Show signature area"
                      checked={settings.showSignature}
                      onChange={(showSignature) =>
                        updateSettings({ showSignature })
                      }
                    />
                    <Checkbox
                      label="Show stamp"
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
                  Preview
                </Text>
                <Text as="span" tone="subdued">
                  {settings.paperSize} · {settings.orientation}
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
                      aria-hidden="true"
                      style={{
                        minHeight: "40vh",
                        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
                        borderRadius: 8,
                      }}
                    />
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
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
