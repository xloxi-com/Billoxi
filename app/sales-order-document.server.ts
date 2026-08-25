import prisma from "./db.server";
import {
  loadMultiCurrencySettingsForShop,
  loadNumberSeriesEntryForShop,
  loadStoreDetailsForShop,
} from "./shop-settings.server";
import {
  usesPresentmentCurrency,
} from "./multi-currency-settings";
import {
  defaultTemplateSettings,
  mergeTemplateSettings,
  resolveSalesOrderTemplateId,
  salesOrderTemplateName,
  formatPercentOf,
  buildTaxSummaryFromLineItems,
  reconcileTaxSummaryToOrderTotal,
  reconcilePaymentAmounts,
  adaptDocumentForCreditNote,
  adaptDocumentForReturn,
  formatQuantityDisplay,
  SALES_ORDER_TEMPLATE_PRESETS,
  INVOICE_TEMPLATE_PRESETS,
  DRAFT_TEMPLATE_PRESETS,
  CREDIT_NOTE_TEMPLATE_PRESETS,
  PACKING_SLIP_TEMPLATE_PRESETS,
  RETURN_TEMPLATE_PRESETS,
  buildCustomerMetafieldValueMap,
  type CreditNoteRefundSource,
  type CreditNoteRefundLineSource,
  type ReturnDocumentSource,
  type ReturnDocumentLineSource,
  type SalesOrderDocumentData,
  type TemplateEditorSettings,
  isStorePickupDeliveryMethod,
} from "./sales-order-document";
import {
  applyTemplateLanguageLabels,
  isBuiltInTemplateBody,
  normalizeTemplateLanguage,
} from "./template-labels";
import { numberingFromSeries, type NumberSeriesModuleId } from "./number-series";
import { getSalesOrderDocumentNumbersByOrderGids } from "./sales-order-number.server";
import { getInvoicedOrderGids } from "./order-invoice-status.server";
import type { StoreDetails } from "./store-details";
import type { Prisma } from "@prisma/client";

const ORDER_DOCUMENT_TTL_MS = 300_000;
const orderDocumentCache = new Map<
  string,
  { expires: number; value: SalesOrderDocumentData }
>();

const SIDEBAR_LIST_TTL_MS = 60_000;
const sidebarListCache = new Map<
  string,
  {
    expires: number;
    data: import("./sales-order-document").CustomerOrderListItem[];
  }
>();

type CachedDocumentTemplate = {
  templateId: string;
  templateName: string;
  settings: TemplateEditorSettings;
  storeDetails: StoreDetails;
};

const TEMPLATE_SETTINGS_TTL_MS = 180_000;
const templateSettingsCache = new Map<
  string,
  { expires: number; value: CachedDocumentTemplate }
>();

export function invalidateSalesOrderDocumentCache(
  shop?: string,
  orderGid?: string,
) {
  if (!shop && !orderGid) {
    orderDocumentCache.clear();
    sidebarListCache.clear();
    return;
  }
  for (const key of orderDocumentCache.keys()) {
    if (shop && !key.startsWith(`${shop}|`)) continue;
    if (orderGid && !key.includes(`|${orderGid}|`)) continue;
    orderDocumentCache.delete(key);
  }
  if (shop) {
    for (const key of sidebarListCache.keys()) {
      if (key.startsWith(`${shop}|`)) sidebarListCache.delete(key);
    }
  }
}

export function invalidateDocumentTemplateSettingsCache(shop?: string) {
  if (!shop) {
    templateSettingsCache.clear();
    return;
  }
  for (const key of templateSettingsCache.keys()) {
    if (key.startsWith(`${shop}|`)) templateSettingsCache.delete(key);
  }
}

export type { SalesOrderDocumentData, TemplateEditorSettings };

const columnsReupdateDoneShops = new Set<string>();
const columnsReupdateFailedUntil = new Map<string, number>();
const columnsReupdateInFlight = new Map<
  string,
  Promise<{ updated: number; seeded: number; skipped: boolean }>
>();

function templateSettingsUnchanged(a: unknown, b: unknown) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Re-merge every saved template customization with current code defaults
 * (barcode column, SKU width 12, column order, etc.) for all document types.
 */
export async function reupdateAllShopTemplates(shop: string) {
  const rows = await prisma.templateCustomization.findMany({
    where: {
      shop,
      documentType: {
        in: [
          "sales-order",
          "invoice",
          "draft",
          "credit-note",
          "packing-slip",
          "return",
        ],
      },
    },
    select: {
      id: true,
      documentType: true,
      templateId: true,
      settings: true,
    },
  });

  let updated = 0;
  const dirty: Array<{ id: string; settings: Prisma.InputJsonValue }> = [];
  for (const row of rows) {
    const name = salesOrderTemplateName(row.templateId);
    const merged = mergeTemplateSettings(row.settings, name, row.templateId);
    if (templateSettingsUnchanged(row.settings, merged)) continue;
    dirty.push({
      id: row.id,
      settings: merged as unknown as Prisma.InputJsonValue,
    });
  }

  // Sequential updates on one connection — avoids pool stampede (limit often 1).
  for (const row of dirty) {
    await prisma.templateCustomization.update({
      where: { id: row.id },
      data: { settings: row.settings },
    });
    updated += 1;
  }

  // Seed any missing presets so new templates also exist in DB.
  const existing = new Set(
    rows.map((row) => `${row.documentType}::${row.templateId}`),
  );
  const seedPresets = [
    ...SALES_ORDER_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "sales-order" as const,
      preset,
    })),
    ...INVOICE_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "invoice" as const,
      preset,
    })),
    ...DRAFT_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "draft" as const,
      preset,
    })),
    ...CREDIT_NOTE_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "credit-note" as const,
      preset,
    })),
    ...PACKING_SLIP_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "packing-slip" as const,
      preset,
    })),
    ...RETURN_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "return" as const,
      preset,
    })),
  ];
  const missing = seedPresets.filter(
    ({ documentType, preset }) =>
      !existing.has(`${documentType}::${preset.id}`),
  );
  if (missing.length > 0) {
    await prisma.templateCustomization.createMany({
      data: missing.map(({ documentType, preset }) => ({
        shop,
        documentType,
        templateId: preset.id,
        settings: defaultTemplateSettings(
          preset.name,
          preset.id,
        ) as unknown as Prisma.InputJsonValue,
      })),
    });
  }

  invalidateDocumentTemplateSettingsCache(shop);
  columnsReupdateDoneShops.add(shop);
  return { updated, seeded: missing.length };
}

/** Run column schema reupdate once per shop per server process. */
export async function reupdateAllShopTemplatesIfNeeded(shop: string) {
  if (columnsReupdateDoneShops.has(shop)) {
    return { updated: 0, seeded: 0, skipped: true as const };
  }
  const failedUntil = columnsReupdateFailedUntil.get(shop) ?? 0;
  if (Date.now() < failedUntil) {
    return { updated: 0, seeded: 0, skipped: true as const };
  }
  const inFlight = columnsReupdateInFlight.get(shop);
  if (inFlight) return inFlight;

  const promise = reupdateAllShopTemplates(shop)
    .then((result) => {
      columnsReupdateDoneShops.add(shop);
      columnsReupdateFailedUntil.delete(shop);
      return { ...result, skipped: false as const };
    })
    .catch((error) => {
      // Avoid retry storms when the pool is saturated (dev connection_limit=1).
      columnsReupdateFailedUntil.set(shop, Date.now() + 60_000);
      throw error;
    })
    .finally(() => {
      columnsReupdateInFlight.delete(shop);
    });

  columnsReupdateInFlight.set(shop, promise);
  return promise;
}

/**
 * Wipe saved customizations and re-seed every document-type preset with the
 * current clean code defaults (margins, appearance, totals, labels, columns).
 */
export async function resetAllTemplatesToCleanDefaults(shop: string) {
  const deleted = await prisma.templateCustomization.deleteMany({
    where: { shop },
  });

  const seedPresets = [
    ...SALES_ORDER_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "sales-order" as const,
      preset,
    })),
    ...INVOICE_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "invoice" as const,
      preset,
    })),
    ...DRAFT_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "draft" as const,
      preset,
    })),
    ...CREDIT_NOTE_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "credit-note" as const,
      preset,
    })),
    ...PACKING_SLIP_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "packing-slip" as const,
      preset,
    })),
    ...RETURN_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "return" as const,
      preset,
    })),
  ];

  await prisma.templateCustomization.createMany({
    data: seedPresets.map(({ documentType, preset }) => ({
      shop,
      documentType,
      templateId: preset.id,
      settings: defaultTemplateSettings(
        preset.name,
        preset.id,
      ) as unknown as Prisma.InputJsonValue,
    })),
  });

  invalidateDocumentTemplateSettingsCache(shop);
  columnsReupdateDoneShops.add(shop);
  return { deleted: deleted.count, seeded: seedPresets.length };
}

function moneyAmount(value: { amount?: string } | null | undefined) {
  const amount = Number(value?.amount ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

/** Copy presentmentMoney → shopMoney so existing mappers keep working. */
function promotePresentmentDeep(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) promotePresentmentDeep(item);
    return;
  }
  const obj = value as Record<string, unknown>;
  const shopMoney = obj.shopMoney;
  const presentmentMoney = obj.presentmentMoney;
  if (
    shopMoney &&
    typeof shopMoney === "object" &&
    presentmentMoney &&
    typeof presentmentMoney === "object"
  ) {
    obj.shopMoney = presentmentMoney;
  }
  for (const child of Object.values(obj)) {
    promotePresentmentDeep(child);
  }
}

/** Accept Money scalar string/number or MoneyV2-like `{ amount }`. */
function parseMoneyValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string") {
    const amount = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(amount) ? amount.toFixed(2) : "";
  }
  if (typeof value === "object" && value !== null && "amount" in value) {
    return parseMoneyValue((value as { amount?: unknown }).amount);
  }
  return "";
}

function resolveCompareAtPrice(
  variant:
    | {
        compareAtPrice?: unknown;
        price?: unknown;
      }
    | null
    | undefined,
  unitRate: string,
): string {
  const rate = Number(unitRate);
  const compareAt = parseMoneyValue(variant?.compareAtPrice);
  if (!compareAt) return "";
  const amount = Number(compareAt);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  // Show when compare-at differs from the charged rate (typical MSRP strike-through).
  if (Number.isFinite(rate) && amount === rate) return "";
  return compareAt;
}

function formatAddress(
  address:
    | {
        address1?: string | null;
        address2?: string | null;
        city?: string | null;
        province?: string | null;
        provinceCode?: string | null;
        zoneCode?: string | null;
        zip?: string | null;
        country?: string | null;
        countryCodeV2?: string | null;
        countryCode?: string | null;
      }
    | null
    | undefined,
) {
  if (!address) return [];
  const lines: string[] = [];
  if (address.address1?.trim()) lines.push(address.address1.trim());
  if (address.address2?.trim()) lines.push(address.address2.trim());
  const cityLine = [
    address.city?.trim(),
    address.province?.trim() ||
      address.provinceCode?.trim() ||
      address.zoneCode?.trim(),
    address.zip?.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  const country =
    address.country?.trim() ||
    address.countryCodeV2?.trim() ||
    address.countryCode?.trim();
  if (country) lines.push(country);
  return lines;
}

function personName(
  address:
    | {
        firstName?: string | null;
        lastName?: string | null;
        name?: string | null;
      }
    | null
    | undefined,
) {
  if (!address) return "";
  const fromParts = [address.firstName?.trim(), address.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
  if (fromParts) return fromParts;
  return address.name?.trim() || "";
}

type CompanyLocationAddress = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zoneCode?: string | null;
  zip?: string | null;
  country?: string | null;
  countryCode?: string | null;
  phone?: string | null;
};

type ShopifyCompanySource = {
  name?: string | null;
  externalId?: string | null;
  locations?: {
    nodes?: Array<{
      taxSettings?: {
        taxRegistrationId?: string | null;
      } | null;
      billingAddress?: CompanyLocationAddress | null;
    } | null> | null;
  } | null;
};

type PurchasingCompanyEntity = {
  company?: ShopifyCompanySource | null;
  contact?: {
    customer?: {
      displayName?: string | null;
    } | null;
  } | null;
  location?: {
    taxSettings?: {
      taxRegistrationId?: string | null;
    } | null;
    billingAddress?: CompanyLocationAddress | null;
  } | null;
};

type CustomerCompanyProfile = {
  company?: ShopifyCompanySource | null;
};

function firstShopifyCompany(
  purchasing: PurchasingCompanyEntity | null | undefined,
  profiles: CustomerCompanyProfile[] | null | undefined,
): ShopifyCompanySource | null {
  const fromOrder = purchasing?.company;
  if (fromOrder?.name?.trim() || fromOrder?.externalId?.trim()) {
    return fromOrder;
  }
  for (const profile of profiles ?? []) {
    const company = profile?.company;
    if (company?.name?.trim() || company?.externalId?.trim()) {
      return company;
    }
  }
  return null;
}

export function emptyPartyTaxFields() {
  return {
    companyId: "",
    taxId: "",
    vatNumber: "",
  };
}

export function resolveCustomerPartyFromOrder(
  order: {
    email?: string | null;
    phone?: string | null;
    customer?: {
      displayName?: string | null;
      companyContactProfiles?: CustomerCompanyProfile[] | null;
    } | null;
    billingAddress?: {
      company?: string | null;
      phone?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      name?: string | null;
      address1?: string | null;
      address2?: string | null;
      city?: string | null;
      province?: string | null;
      provinceCode?: string | null;
      zoneCode?: string | null;
      zip?: string | null;
      country?: string | null;
      countryCodeV2?: string | null;
      countryCode?: string | null;
    } | null;
    purchasingEntity?: PurchasingCompanyEntity | Record<string, unknown> | null;
  },
  customerName: string,
): SalesOrderDocumentData["customer"] {
  const purchasing = order.purchasingEntity as PurchasingCompanyEntity | null | undefined;
  const company = firstShopifyCompany(
    purchasing,
    order.customer?.companyContactProfiles,
  );
  const locationAddress =
    purchasing?.location?.billingAddress ||
    company?.locations?.nodes?.find((node) => node?.billingAddress)?.billingAddress;
  const companyName = company?.name?.trim() || "";

  return {
    company: companyName,
    companyId: company?.externalId?.trim() || "",
    name:
      purchasing?.contact?.customer?.displayName?.trim() ||
      personName(locationAddress) ||
      customerName,
    address:
      formatAddress(locationAddress).length > 0
        ? formatAddress(locationAddress)
        : formatAddress(order.billingAddress),
    phone:
      locationAddress?.phone?.trim() ||
      order.phone?.trim() ||
      order.billingAddress?.phone?.trim() ||
      "",
    email: order.email?.trim() || "",
    taxId:
      purchasing?.location?.taxSettings?.taxRegistrationId?.trim() ||
      company?.locations?.nodes?.[0]?.taxSettings?.taxRegistrationId?.trim() ||
      "",
    vatNumber: "",
    metafields: {},
  };
}

export async function loadDocumentTemplateSettings(
  shop: string,
  documentType:
    | "sales-order"
    | "invoice"
    | "draft"
    | "credit-note"
    | "packing-slip"
    | "return",
  templateId: string,
  admin: { graphql: (query: string) => Promise<Response> },
  preload?: {
    storeDetails?: StoreDetails;
    numberSeries?: import("./number-series").NumberSeriesEntry;
    /** When set (including null), skips the customization DB lookup. */
    customizationSettings?: unknown | null;
  },
): Promise<{
  templateId: string;
  templateName: string;
  settings: TemplateEditorSettings;
  storeDetails: StoreDetails;
}> {
  const resolvedId =
    documentType === "sales-order"
      ? resolveSalesOrderTemplateId(templateId)
      : templateId;
  const cacheKey = `${shop}|${documentType}|${resolvedId}|so-no-ref`;
  if (!preload) {
    const cached = templateSettingsCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }
  }

  const templateName = salesOrderTemplateName(resolvedId);
  const seriesId: NumberSeriesModuleId =
    documentType === "invoice"
      ? "invoice"
      : documentType === "draft"
        ? "draft"
        : documentType === "credit-note"
          ? "credit-note"
          : documentType === "packing-slip"
            ? "packing-slip"
            : documentType === "return"
              ? "return"
              : "sales-order";

  const hasCustomizationPreload =
    preload != null && "customizationSettings" in preload;

  const [customization, storeDetails, numberSeries] = await Promise.all([
    hasCustomizationPreload
      ? Promise.resolve(
          preload!.customizationSettings != null
            ? { settings: preload!.customizationSettings }
            : null,
        )
      : prisma.templateCustomization.findUnique({
          where: {
            shop_documentType_templateId: {
              shop,
              documentType,
              templateId: resolvedId,
            },
          },
          select: { settings: true },
        }),
    preload?.storeDetails
      ? Promise.resolve(preload.storeDetails)
      : loadStoreDetailsForShop(shop, admin),
    preload?.numberSeries
      ? Promise.resolve(preload.numberSeries)
      : loadNumberSeriesEntryForShop(shop, seriesId),
  ]);

  let settings = mergeTemplateSettings(
    customization?.settings,
    templateName,
    resolvedId,
  );
  // Shop transaction-number series is the source of truth for document numbers.
  settings.numbering = numberingFromSeries(numberSeries);
  // Shop store details are the source of truth for org name + logo.
  if (storeDetails.name) {
    settings.transactionLabels.organization = storeDetails.name;
  }
  if (storeDetails.logoDataUrl) {
    settings.logoDataUrl = storeDetails.logoDataUrl;
    settings.logoFileName = storeDetails.logoFileName;
  }

  const language = normalizeTemplateLanguage(settings.language);
  settings = applyTemplateLanguageLabels(settings, language, {
    documentType,
    organizationName: settings.transactionLabels.organization,
    translateBodyText: {
      notes: isBuiltInTemplateBody(settings.notes),
      terms: isBuiltInTemplateBody(settings.terms),
    },
  });
  const defaults = defaultTemplateSettings(templateName, resolvedId);
  // Merchant header toggles (Ref# / Shopify order / payment) must win over defaults.
  settings.header = { ...defaults.header, ...settings.header };

  // Draft / packing / credit / return: never show paid / balance-due payment rows.
  if (
    documentType === "draft" ||
    documentType === "packing-slip" ||
    documentType === "return" ||
    documentType === "credit-note"
  ) {
    settings.totals = {
      ...settings.totals,
      showPaidAmount: false,
      showBalanceDue: false,
    };
  }
  if (documentType === "draft") {
    settings.header = {
      ...settings.header,
      showPaymentMethod: false,
    };
  }
  if (documentType === "sales-order") {
    // Sales Order# already appears under the title — hide meta Ref# / Shopify rows.
    settings.header = {
      ...settings.header,
      showReference: false,
      showShopifyOrder: false,
    };
  }

  const result = {
    templateId: resolvedId,
    templateName,
    settings,
    storeDetails,
  };
  if (!preload) {
    templateSettingsCache.set(cacheKey, {
      expires: Date.now() + TEMPLATE_SETTINGS_TTL_MS,
      value: result,
    });
  }
  return result;
}

export async function loadSalesOrderTemplateSettings(
  shop: string,
  templateId: string,
  admin: { graphql: (query: string) => Promise<Response> },
): Promise<{
  templateId: string;
  templateName: string;
  settings: TemplateEditorSettings;
  storeDetails: StoreDetails;
}> {
  return loadDocumentTemplateSettings(shop, "sales-order", templateId, admin);
}

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  note?: string | null;
  email?: string | null;
  phone?: string | null;
  paymentGatewayNames?: string[] | null;
  displayFinancialStatus?: string | null;
  fulfillmentOrders?: {
    nodes?: Array<{
      fulfillAt?: string | null;
      fulfillBy?: string | null;
      deliveryMethod?: {
        methodType?: string | null;
        presentedName?: string | null;
      } | null;
    } | null> | null;
  } | null;
  shippingLines?: {
    nodes?: Array<{ title?: string | null } | null> | null;
  } | null;
  transactions?: Array<{
    kind?: string | null;
    status?: string | null;
    gateway?: string | null;
    formattedGateway?: string | null;
    manualPaymentGateway?: boolean | null;
  } | null> | null;
  customer?: {
    id?: string | null;
    displayName?: string | null;
    metafields?: {
      nodes?: Array<{
        namespace?: string | null;
        key?: string | null;
        value?: string | null;
        type?: string | null;
      } | null> | null;
    } | null;
    companyContactProfiles?: CustomerCompanyProfile[] | null;
  } | null;
  purchasingEntity?: Record<string, unknown> | null;
  billingAddress?: {
    company?: string | null;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    provinceCode?: string | null;
    zip?: string | null;
    country?: string | null;
    countryCodeV2?: string | null;
    phone?: string | null;
  } | null;
  shippingAddress?: {
    company?: string | null;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    provinceCode?: string | null;
    zip?: string | null;
    country?: string | null;
    countryCodeV2?: string | null;
    phone?: string | null;
  } | null;
  currentSubtotalPriceSet?: { shopMoney?: { amount: string; currencyCode: string } };
  currentTotalDiscountsSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalShippingPriceSet?: { shopMoney?: { amount: string; currencyCode: string } };
  currentTotalTaxSet?: { shopMoney?: { amount: string; currencyCode: string } };
  currentTotalPriceSet?: { shopMoney?: { amount: string; currencyCode: string } };
  /** Original order amounts (unchanged after refunds). */
  subtotalPriceSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalDiscountsSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalTaxSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalPriceSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalReceivedSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalOutstandingSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalRefundedSet?: { shopMoney?: { amount: string; currencyCode: string } };
  refunds?: Array<{
    id?: string | null;
    totalRefundedSet?: { shopMoney?: { amount: string; currencyCode: string } };
    refundLineItems?: {
      nodes?: Array<{
        quantity?: number | null;
        subtotalSet?: { shopMoney?: { amount: string } } | null;
        totalTaxSet?: { shopMoney?: { amount: string } } | null;
        lineItem?: {
          title?: string | null;
          variantTitle?: string | null;
          name?: string | null;
          sku?: string | null;
          image?: { url?: string | null } | null;
          variant?: {
            sku?: string | null;
            barcode?: string | null;
            product?: {
              featuredImage?: { url?: string | null } | null;
            } | null;
          } | null;
        } | null;
      } | null> | null;
    } | null;
    orderAdjustments?: {
      nodes?: Array<{
        amountSet?: { shopMoney?: { amount: string } } | null;
        reason?: string | null;
      } | null> | null;
    } | null;
    refundShippingLines?: {
      nodes?: Array<{
        subtotalAmountSet?: { shopMoney?: { amount: string } } | null;
      } | null> | null;
    } | null;
  } | null> | null;
  returns?: {
    nodes?: Array<{
      id?: string | null;
      name?: string | null;
      status?: string | null;
      returnLineItems?: {
        nodes?: Array<{
          quantity?: number | null;
          withCodeDiscountedTotalPriceSet?: {
            shopMoney?: { amount: string; currencyCode?: string };
            presentmentMoney?: { amount: string; currencyCode?: string };
          } | null;
          fulfillmentLineItem?: {
            lineItem?: {
              title?: string | null;
              variantTitle?: string | null;
              name?: string | null;
              sku?: string | null;
              originalUnitPriceSet?: {
                shopMoney?: { amount: string };
                presentmentMoney?: { amount: string };
              } | null;
              image?: { url?: string | null } | null;
              variant?: {
                sku?: string | null;
                barcode?: string | null;
                product?: {
                  featuredImage?: { url?: string | null } | null;
                } | null;
              } | null;
            } | null;
          } | null;
        } | null> | null;
      } | null;
    } | null> | null;
  } | null;
  taxLines?: Array<{
    title?: string | null;
    rate?: number | null;
    ratePercentage?: number | null;
    priceSet?: { shopMoney?: { amount: string } };
  }>;
  lineItems?: {
    nodes: Array<{
      title: string;
      variantTitle?: string | null;
      name?: string | null;
      quantity: number;
      originalUnitPriceSet?: { shopMoney?: { amount: string } };
      discountedTotalSet?: { shopMoney?: { amount: string } };
      originalTotalSet?: { shopMoney?: { amount: string } };
      totalDiscountSet?: { shopMoney?: { amount: string } };
      priceAfterAllDiscountsBeforeTaxesSet?: { shopMoney?: { amount: string } };
      discountAllocations?: Array<{
        allocatedAmountSet?: { shopMoney?: { amount: string } };
      }>;
      taxLines?: Array<{
        rate?: number | null;
        ratePercentage?: number | null;
        priceSet?: { shopMoney?: { amount: string } };
      }>;
      image?: { url?: string | null } | null;
      variant?: {
        sku?: string | null;
        barcode?: string | null;
        title?: string | null;
        compareAtPrice?: unknown;
        price?: unknown;
        selectedOptions?: Array<{ name: string; value: string }> | null;
        product?: {
          featuredImage?: { url?: string | null } | null;
        } | null;
      } | null;
    }>;
  };
};

function resolveVariantTitle(item: {
  title: string;
  variantTitle?: string | null;
  name?: string | null;
  variant?: {
    title?: string | null;
    selectedOptions?: Array<{ name: string; value: string }> | null;
  } | null;
}): string {
  const productTitle = item.title?.trim() || "";
  const candidates = [
    item.variantTitle?.trim() || "",
    item.variant?.title?.trim() || "",
  ];

  for (const raw of candidates) {
    if (
      raw &&
      raw.toLowerCase() !== "default title" &&
      raw.toLowerCase() !== productTitle.toLowerCase()
    ) {
      return raw;
    }
  }

  const options = (item.variant?.selectedOptions ?? [])
    .filter(
      (option) =>
        option.value &&
        option.value.toLowerCase() !== "default title" &&
        option.value.toLowerCase() !== "default" &&
        option.value.toLowerCase() !== productTitle.toLowerCase(),
    )
    .map((option) =>
      option.name ? `${option.name}: ${option.value}` : option.value,
    );
  if (options.length > 0) return options.join(" / ");

  // Fall back to "Product - Variant" style name when title alone is incomplete.
  const fullName = item.name?.trim() || "";
  if (fullName && fullName !== productTitle && fullName.startsWith(productTitle)) {
    const leftover = fullName.slice(productTitle.length).replace(/^[\s\-–—]+/, "");
    if (leftover && leftover.toLowerCase() !== "default title") return leftover;
  }

  return "";
}

function isGenericShopifyPaymentsLabel(label: string) {
  const normalized = label.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return (
    normalized === "shopifypayments" ||
    normalized === "bogus" ||
    normalized === "bogusgateway"
  );
}

function resolvePaymentMethod(order: {
  paymentGatewayNames?: string[] | null;
  transactions?: Array<{
    kind?: string | null;
    status?: string | null;
    gateway?: string | null;
    formattedGateway?: string | null;
    manualPaymentGateway?: boolean | null;
  } | null> | null;
}) {
  const paymentKinds = new Set(["SALE", "AUTHORIZATION", "CAPTURE"]);
  const usableStatuses = new Set(["SUCCESS", "PENDING", "AWAITING_RESPONSE"]);
  const transactions = (order.transactions ?? []).filter(
    (tx): tx is NonNullable<typeof tx> => Boolean(tx),
  );

  // Prefer the checkout method actually used (Bank Transfer / COD / card),
  // especially manual payment gateways — not a generic "Shopify Payments" label.
  const ranked = transactions
    .filter(
      (tx) =>
        paymentKinds.has(String(tx.kind || "").toUpperCase()) &&
        usableStatuses.has(String(tx.status || "").toUpperCase()),
    )
    .sort((a, b) => {
      const aManual = a.manualPaymentGateway ? 1 : 0;
      const bManual = b.manualPaymentGateway ? 1 : 0;
      return bManual - aManual;
    });

  const fromTransactions = [
    ...new Set(
      ranked
        .map((tx) => tx.formattedGateway?.trim() || tx.gateway?.trim() || "")
        .filter(Boolean),
    ),
  ];
  const specificFromTx = fromTransactions.filter(
    (label) => !isGenericShopifyPaymentsLabel(label),
  );
  if (specificFromTx.length > 0) return specificFromTx.join(", ");
  if (fromTransactions.length > 0) return fromTransactions.join(", ");

  const fromNames = (order.paymentGatewayNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean);
  const specificFromNames = fromNames.filter(
    (name) => !isGenericShopifyPaymentsLabel(name),
  );
  if (specificFromNames.length > 0) return specificFromNames.join(", ");
  return fromNames.join(", ");
}

function resolveExpectedShipmentDate(
  nodes: Array<{
    fulfillAt?: string | null;
    fulfillBy?: string | null;
  } | null> | null | undefined,
) {
  const dates = (nodes ?? [])
    .flatMap((node) => [node?.fulfillBy, node?.fulfillAt])
    .filter((value): value is string => Boolean(value?.trim()));
  if (dates.length === 0) return "";
  dates.sort();
  // Keep ISO / raw Shopify timestamp — format with template dateFormat at render.
  return dates[0];
}

/** Soft-fail: missing fulfillment scopes must not break the document. */
function expectedShipmentDateFromOrder(order: {
  fulfillmentOrders?: {
    nodes?: Array<{
      fulfillAt?: string | null;
      fulfillBy?: string | null;
      deliveryMethod?: { methodType?: string | null } | null;
    } | null> | null;
  } | null;
}) {
  try {
    return resolveExpectedShipmentDate(order.fulfillmentOrders?.nodes);
  } catch {
    return "";
  }
}

function isStorePickupFromOrder(order: {
  fulfillmentOrders?: {
    nodes?: Array<{
      deliveryMethod?: { methodType?: string | null } | null;
    } | null> | null;
  } | null;
}) {
  try {
    for (const node of order.fulfillmentOrders?.nodes ?? []) {
      if (isStorePickupDeliveryMethod(node?.deliveryMethod?.methodType)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function resolveDeliveryMethodNameFromOrder(order: {
  shippingLines?: {
    nodes?: Array<{ title?: string | null } | null> | null;
  } | null;
  fulfillmentOrders?: {
    nodes?: Array<{
      deliveryMethod?: {
        methodType?: string | null;
        presentedName?: string | null;
      } | null;
    } | null> | null;
  } | null;
}) {
  try {
    for (const line of order.shippingLines?.nodes ?? []) {
      const title = line?.title?.trim();
      if (title) return title;
    }
    for (const node of order.fulfillmentOrders?.nodes ?? []) {
      const presented = node?.deliveryMethod?.presentedName?.trim();
      if (presented) return presented;
    }
    return "";
  } catch {
    return "";
  }
}

function creditNoteRefundSourceFromOrder(
  order: OrderNode,
): CreditNoteRefundSource {
  const refundLineItems: CreditNoteRefundLineSource[] = [];
  let shippingRefunded = 0;

  for (const refund of order.refunds ?? []) {
    if (!refund) continue;
    for (const node of refund.refundLineItems?.nodes ?? []) {
      if (!node) continue;
      const line = node.lineItem;
      const title = line?.title?.trim() || line?.name?.trim() || "Refunded item";
      const variantTitle = (() => {
        const raw = line?.variantTitle?.trim() || "";
        if (
          !raw ||
          raw.toLowerCase() === "default title" ||
          raw.toLowerCase() === title.toLowerCase()
        ) {
          return "";
        }
        return raw;
      })();
      const entry: CreditNoteRefundLineSource = {
        quantity: Number(node.quantity) || 0,
        subtotal: moneyAmount(node.subtotalSet?.shopMoney),
        tax: moneyAmount(node.totalTaxSet?.shopMoney),
        title,
        variantTitle,
        imageUrl:
          line?.image?.url?.trim() ||
          line?.variant?.product?.featuredImage?.url?.trim() ||
          "",
        sku: line?.variant?.sku?.trim() || line?.sku?.trim() || "",
        barcode: line?.variant?.barcode?.trim() || "",
      };
      refundLineItems.push(entry);
    }
    for (const ship of refund.refundShippingLines?.nodes ?? []) {
      if (!ship) continue;
      const amount = Number(ship.subtotalAmountSet?.shopMoney?.amount ?? 0);
      if (Number.isFinite(amount) && amount > 0) shippingRefunded += amount;
    }
  }

  return {
    refundLineItems,
    shippingRefunded: Math.round(shippingRefunded * 100) / 100,
  };
}

const SKIPPED_RETURN_STATUSES = new Set(["CANCELED", "CANCELLED", "DECLINED"]);

function returnDocumentSourceFromOrder(order: OrderNode): ReturnDocumentSource {
  const returnLineItems: ReturnDocumentLineSource[] = [];

  for (const ret of order.returns?.nodes ?? []) {
    if (!ret) continue;
    const status = String(ret.status || "").toUpperCase();
    if (SKIPPED_RETURN_STATUSES.has(status)) continue;

    for (const node of ret.returnLineItems?.nodes ?? []) {
      if (!node) continue;
      const qty = Number(node.quantity) || 0;
      if (qty <= 0) continue;

      const line = node.fulfillmentLineItem?.lineItem;
      const title =
        line?.title?.trim() || line?.name?.trim() || "Returned item";
      const variantTitle = (() => {
        const raw = line?.variantTitle?.trim() || "";
        if (
          !raw ||
          raw.toLowerCase() === "default title" ||
          raw.toLowerCase() === title.toLowerCase()
        ) {
          return "";
        }
        return raw;
      })();

      const discounted = moneyAmount(
        node.withCodeDiscountedTotalPriceSet?.shopMoney,
      );
      const unit = moneyAmount(line?.originalUnitPriceSet?.shopMoney);
      const unitN = Number(unit) || 0;
      const subtotal =
        discounted && Number(discounted) > 0
          ? discounted
          : unitN > 0
            ? (unitN * qty).toFixed(2)
            : "0.00";

      returnLineItems.push({
        quantity: qty,
        subtotal,
        tax: "0.00",
        title,
        variantTitle,
        imageUrl:
          line?.image?.url?.trim() ||
          line?.variant?.product?.featuredImage?.url?.trim() ||
          "",
        sku: line?.variant?.sku?.trim() || line?.sku?.trim() || "",
        barcode: line?.variant?.barcode?.trim() || "",
      });
    }
  }

  // Open returns may not have refunds yet; closed/refunded returns still prefer
  // returnLineItems. If Shopify returns are empty, fall back to refund lines.
  if (returnLineItems.length === 0) {
    const refundSource = creditNoteRefundSourceFromOrder(order);
    return { returnLineItems: refundSource.refundLineItems };
  }

  return { returnLineItems };
}

export async function fetchSalesOrderDocument(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  orderGid: string,
  options?: {
    asCreditNote?: boolean;
    asReturn?: boolean;
    shop?: string;
    bypassCache?: boolean;
  },
): Promise<SalesOrderDocumentData | null> {
  const shopKey = options?.shop || "_";
  const cacheKey = `${shopKey}|${orderGid}|cn:${options?.asCreditNote ? "1" : "0"}|ret:${options?.asReturn ? "1" : "0"}`;
  if (!options?.bypassCache) {
    const cached = orderDocumentCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }
  }

  const [response, multiCurrency] = await Promise.all([
    admin.graphql(
    `#graphql
      query SalesOrderDocument($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          note
          email
          phone
          paymentGatewayNames
          displayFinancialStatus
          fulfillmentOrders(first: 10) {
            nodes {
              fulfillAt
              fulfillBy
              deliveryMethod {
                methodType
                presentedName
              }
            }
          }
          shippingLines(first: 5) {
            nodes {
              title
            }
          }
          transactions(first: 20) {
            kind
            status
            gateway
            formattedGateway
            manualPaymentGateway
          }
          customer {
            id
            displayName
            metafields(first: 50) {
              nodes {
                namespace
                key
                value
                type
              }
            }
            companyContactProfiles {
              company {
                name
                externalId
                locations(first: 1) {
                  nodes {
                    taxSettings {
                      taxRegistrationId
                    }
                    billingAddress {
                      firstName
                      lastName
                      address1
                      address2
                      city
                      province
                      zoneCode
                      zip
                      country
                      countryCode
                      phone
                    }
                  }
                }
              }
            }
          }
          purchasingEntity {
            ... on PurchasingCompany {
              company {
                name
                externalId
              }
              contact {
                customer {
                  displayName
                }
              }
              location {
                taxSettings {
                  taxRegistrationId
                }
                billingAddress {
                  firstName
                  lastName
                  address1
                  address2
                  city
                  province
                  zoneCode
                  zip
                  country
                  countryCode
                  phone
                }
              }
            }
          }
          billingAddress {
            company
            name
            firstName
            lastName
            address1
            address2
            city
            province
            provinceCode
            zip
            country
            countryCodeV2
            phone
          }
          shippingAddress {
            company
            name
            firstName
            lastName
            address1
            address2
            city
            province
            provinceCode
            zip
            country
            countryCodeV2
            phone
          }
          currentSubtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          currentTotalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          currentTotalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          currentTotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          totalReceivedSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          totalOutstandingSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          refunds(first: 50) {
            id
            totalRefundedSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            refundLineItems(first: 100) {
              nodes {
                quantity
                subtotalSet { shopMoney { amount } presentmentMoney { amount } }
                totalTaxSet { shopMoney { amount } presentmentMoney { amount } }
                lineItem {
                  title
                  variantTitle
                  name
                  sku
                  image { url }
                  variant {
                    sku
                    barcode
                    product {
                      featuredImage { url }
                    }
                  }
                }
              }
            }
            orderAdjustments(first: 20) {
              nodes {
                amountSet { shopMoney { amount } presentmentMoney { amount } }
                reason
              }
            }
            refundShippingLines(first: 10) {
              nodes {
                subtotalAmountSet { shopMoney { amount } presentmentMoney { amount } }
              }
            }
          }
          returns(first: 20) {
            nodes {
              id
              name
              status
              returnLineItems(first: 100) {
                nodes {
                  ... on ReturnLineItem {
                    quantity
                    withCodeDiscountedTotalPriceSet {
                      shopMoney { amount currencyCode }
                      presentmentMoney { amount currencyCode }
                    }
                    fulfillmentLineItem {
                      lineItem {
                        title
                        variantTitle
                        name
                        sku
                        originalUnitPriceSet {
                          shopMoney { amount }
                          presentmentMoney { amount }
                        }
                        image { url }
                        variant {
                          sku
                          barcode
                          product {
                            featuredImage { url }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          taxLines {
            title
            rate
            ratePercentage
            priceSet { shopMoney { amount } presentmentMoney { amount } }
          }
          lineItems(first: 100) {
            nodes {
              title
              variantTitle
              name
              quantity
              originalUnitPriceSet { shopMoney { amount } presentmentMoney { amount } }
              originalTotalSet { shopMoney { amount } presentmentMoney { amount } }
              totalDiscountSet { shopMoney { amount } presentmentMoney { amount } }
              discountedTotalSet(withCodeDiscounts: true) { shopMoney { amount } presentmentMoney { amount } }
              priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount } presentmentMoney { amount } }
              discountAllocations {
                allocatedAmountSet { shopMoney { amount } presentmentMoney { amount } }
              }
              taxLines {
                rate
                ratePercentage
                priceSet { shopMoney { amount } presentmentMoney { amount } }
              }
              image {
                url
              }
              variant {
                sku
                barcode
                title
                compareAtPrice
                price
                selectedOptions {
                  name
                  value
                }
                product {
                  featuredImage {
                    url
                  }
                }
              }
            }
          }
        }
      }`,
    { variables: { id: orderGid } },
    ),
    options?.shop
      ? loadMultiCurrencySettingsForShop(options.shop)
      : Promise.resolve(null),
  ]);

  const payload = await response.json();
  if (payload?.errors?.length) {
    console.error(
      "Sales order document GraphQL errors:",
      JSON.stringify(payload.errors, null, 2),
    );
  }
  const order = payload?.data?.order as OrderNode | null | undefined;
  if (!order) return null;

  if (
    multiCurrency &&
    usesPresentmentCurrency(multiCurrency.mode)
  ) {
    promotePresentmentDeep(order);
  }

  const expectedShipmentDate = expectedShipmentDateFromOrder(order);
  // Prefer original order money bags so full refunds do not zero Subtotal/Total.
  const documentSubtotalSet =
    order.subtotalPriceSet ?? order.currentSubtotalPriceSet;
  const documentDiscountSet =
    order.totalDiscountsSet ?? order.currentTotalDiscountsSet;
  const documentTaxSet = order.totalTaxSet ?? order.currentTotalTaxSet;
  const documentTotalSet = order.totalPriceSet ?? order.currentTotalPriceSet;
  const currencyCode =
    documentTotalSet?.shopMoney?.currencyCode ??
    order.currentTotalPriceSet?.shopMoney?.currencyCode ??
    "USD";
  const customerName =
    order.customer?.displayName ||
    personName(order.billingAddress) ||
    "Guest customer";

  const lineItems = (order.lineItems?.nodes ?? []).map((item) => {
      const original = Number(item.originalTotalSet?.shopMoney?.amount ?? 0);
      const allocationDiscount = (item.discountAllocations ?? []).reduce(
        (sum, allocation) =>
          sum + Number(allocation.allocatedAmountSet?.shopMoney?.amount ?? 0),
        0,
      );
      const reportedDiscount = Number(
        item.totalDiscountSet?.shopMoney?.amount ?? 0,
      );
      const afterAllDiscounts = Number(
        item.priceAfterAllDiscountsBeforeTaxesSet?.shopMoney?.amount ?? 0,
      );
      const discountedWithCodes = Number(
        item.discountedTotalSet?.shopMoney?.amount ?? 0,
      );
      // Prefer allocated amounts — Shopify often leaves totalDiscountSet /
      // discountedTotalSet unchanged for code and automatic discounts.
      const discountFromTotals =
        original > 0 && afterAllDiscounts > 0
          ? Math.max(0, original - afterAllDiscounts)
          : original > 0 && discountedWithCodes > 0
            ? Math.max(0, original - discountedWithCodes)
            : 0;
      const discount = Math.max(
        0,
        allocationDiscount > 0
          ? allocationDiscount
          : reportedDiscount > 0
            ? reportedDiscount
            : discountFromTotals,
      );
      // Amount = line total after discounts (Qty × Rate − Discount).
      const unitPrice = Number(item.originalUnitPriceSet?.shopMoney?.amount ?? 0);
      const gross =
        original > 0
          ? original
          : Math.max(0, unitPrice * Number(item.quantity ?? 0));
      const amount =
        afterAllDiscounts > 0
          ? afterAllDiscounts
          : discountedWithCodes > 0
            ? discountedWithCodes
            : Math.max(0, gross - discount);
      const rate = moneyAmount(item.originalUnitPriceSet?.shopMoney);
      const taxLines = item.taxLines ?? [];
      const taxAmountNum = taxLines.reduce(
        (sum, line) => sum + Number(line.priceSet?.shopMoney?.amount ?? 0),
        0,
      );
      const taxRatePercentage = taxLines.reduce((sum, line) => {
        if (typeof line.ratePercentage === "number" && Number.isFinite(line.ratePercentage)) {
          return sum + line.ratePercentage;
        }
        if (typeof line.rate === "number" && Number.isFinite(line.rate)) {
          return sum + line.rate * 100;
        }
        return sum;
      }, 0);
      const taxableBase =
        afterAllDiscounts > 0
          ? afterAllDiscounts
          : Math.max(0, (original || amount) - discount);
      const taxPercentage =
        taxRatePercentage > 0
          ? `${taxRatePercentage.toFixed(2)}%`
          : formatPercentOf(String(taxAmountNum), String(taxableBase));
      return {
        title: item.title,
        variantTitle: resolveVariantTitle(item),
        imageUrl:
          item.image?.url?.trim() ||
          item.variant?.product?.featuredImage?.url?.trim() ||
          "",
        quantity: formatQuantityDisplay(item.quantity),
        rate,
        compareAtPrice:
          resolveCompareAtPrice(item.variant, rate) ||
          (discount > 0.0001 ? rate : ""),
        discount: discount.toFixed(2),
        discountPercentage: formatPercentOf(String(discount), String(gross || original)),
        taxPercentage,
        taxAmount: taxAmountNum.toFixed(2),
        amount: Number.isFinite(amount) ? amount.toFixed(2) : "0.00",
        sku: item.variant?.sku || "",
        barcode: item.variant?.barcode?.trim() || "",
      };
    });

  const orderTaxSummary = (order.taxLines ?? [])
    .map((line) => {
      const taxAmount = Number(line.priceSet?.shopMoney?.amount ?? 0);
      if (!Number.isFinite(taxAmount) || taxAmount <= 0) return null;
      const ratePercentage =
        typeof line.ratePercentage === "number" && Number.isFinite(line.ratePercentage)
          ? line.ratePercentage
          : typeof line.rate === "number" && Number.isFinite(line.rate)
            ? line.rate * 100
            : 0;
      const rate =
        ratePercentage > 0 ? `${ratePercentage.toFixed(2)}%` : "0.00%";
      const taxableAmount =
        ratePercentage > 0
          ? Math.round((taxAmount / (ratePercentage / 100)) * 100) / 100
          : 0;
      return {
        title: line.title?.trim() || `Tax ${rate}`,
        rate,
        taxableAmount: taxableAmount > 0 ? taxableAmount.toFixed(2) : "0.00",
        taxAmount: taxAmount.toFixed(2),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const document: SalesOrderDocumentData = {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    expectedShipmentDate,
    paymentMethod: resolvePaymentMethod(order),
    email: order.email ?? null,
    phone: order.phone ?? null,
    customerId: order.customer?.id ?? null,
    customerName,
    billing: {
      company: order.billingAddress?.company?.trim() || "",
      name: personName(order.billingAddress),
      address: formatAddress(order.billingAddress),
      phone: order.billingAddress?.phone?.trim() || "",
      email: order.billingAddress ? order.email?.trim() || "" : "",
      ...emptyPartyTaxFields(),
    },
    shipping: {
      company: order.shippingAddress?.company?.trim() || "",
      name: personName(order.shippingAddress),
      address: formatAddress(order.shippingAddress),
      phone: order.shippingAddress?.phone?.trim() || "",
      email: order.shippingAddress ? order.email?.trim() || "" : "",
      ...emptyPartyTaxFields(),
    },
    customer: {
      ...resolveCustomerPartyFromOrder(order, customerName),
      metafields: buildCustomerMetafieldValueMap(
        order.customer?.metafields?.nodes,
      ),
    },
    terms: "Due on Receipt",
    orderNote: (order.note || "").trim(),
    lineItems,
    subtotal: (() => {
      const net = Number(documentSubtotalSet?.shopMoney?.amount ?? 0);
      const discounts = Number(documentDiscountSet?.shopMoney?.amount ?? 0);
      // Show gross subtotal so Subtotal − Discount + Tax = Total reads correctly.
      const gross = net + discounts;
      return Number.isFinite(gross) && gross > 0
        ? gross.toFixed(2)
        : moneyAmount(documentSubtotalSet?.shopMoney);
    })(),
    discount: moneyAmount(documentDiscountSet?.shopMoney),
    shippingPrice: moneyAmount(order.totalShippingPriceSet?.shopMoney),
    tax: moneyAmount(documentTaxSet?.shopMoney),
    total: moneyAmount(documentTotalSet?.shopMoney),
    ...reconcilePaymentAmounts(
      moneyAmount(documentTotalSet?.shopMoney),
      moneyAmount(order.totalReceivedSet?.shopMoney),
      moneyAmount(order.totalOutstandingSet?.shopMoney),
      order.displayFinancialStatus,
      moneyAmount(order.totalRefundedSet?.shopMoney),
    ),
    financialStatus: order.displayFinancialStatus ?? null,
    currencyCode,
    taxSummary: reconcileTaxSummaryToOrderTotal(
      orderTaxSummary.length > 0
        ? orderTaxSummary
        : buildTaxSummaryFromLineItems(lineItems),
      moneyAmount(documentTotalSet?.shopMoney),
      moneyAmount(documentTaxSet?.shopMoney),
    ),
    isStorePickup: isStorePickupFromOrder(order),
    deliveryMethodName: resolveDeliveryMethodNameFromOrder(order),
  };

  if (options?.asCreditNote) {
    const creditNoteDoc = adaptDocumentForCreditNote(
      document,
      creditNoteRefundSourceFromOrder(order),
    );
    orderDocumentCache.set(cacheKey, {
      expires: Date.now() + ORDER_DOCUMENT_TTL_MS,
      value: creditNoteDoc,
    });
    return creditNoteDoc;
  }

  if (options?.asReturn) {
    const returnDoc = adaptDocumentForReturn(
      document,
      returnDocumentSourceFromOrder(order),
    );
    orderDocumentCache.set(cacheKey, {
      expires: Date.now() + ORDER_DOCUMENT_TTL_MS,
      value: returnDoc,
    });
    return returnDoc;
  }

  orderDocumentCache.set(cacheKey, {
    expires: Date.now() + ORDER_DOCUMENT_TTL_MS,
    value: document,
  });
  return document;
}

export async function fetchSalesOrderList(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  options?: {
    shop?: string;
    templateId?: string;
  },
): Promise<import("./sales-order-document").CustomerOrderListItem[]> {
  const cacheKey = `${options?.shop || ""}|${options?.templateId || ""}|v3-original-total`;
  const now = Date.now();
  if (options?.shop) {
    const hit = sidebarListCache.get(cacheKey);
    if (hit && hit.expires > now) return hit.data;
  }

  const response = await admin.graphql(
    `#graphql
      query SalesOrderSidebarList {
        orders(first: 20, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            name
            createdAt
            displayFinancialStatus
            customer {
              displayName
            }
            billingAddress {
              company
              name
            }
            currentTotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          }
        }
      }`,
  );

  const payload = await response.json();
  if (payload?.errors?.length) {
    console.error(
      "Sales order list GraphQL errors:",
      JSON.stringify(payload.errors, null, 2),
    );
  }

  const nodes = (payload?.data?.orders?.nodes ?? []) as Array<{
    id: string;
    name: string;
    createdAt: string;
    displayFinancialStatus?: string | null;
    customer?: { displayName?: string | null } | null;
    billingAddress?: {
      company?: string | null;
      name?: string | null;
    } | null;
    currentTotalPriceSet?: {
      shopMoney?: { amount: string; currencyCode: string };
      presentmentMoney?: { amount: string; currencyCode: string };
    };
    totalPriceSet?: {
      shopMoney?: { amount: string; currencyCode: string };
      presentmentMoney?: { amount: string; currencyCode: string };
    };
    totalRefundedSet?: {
      shopMoney?: { amount: string; currencyCode: string };
      presentmentMoney?: { amount: string; currencyCode: string };
    };
  }>;

  const orderGids = nodes.map((node) => node.id);
  const [documentNumbers, invoicedGids] = await Promise.all([
    options?.shop && options.templateId && orderGids.length > 0
      ? getSalesOrderDocumentNumbersByOrderGids(
          options.shop,
          options.templateId,
          orderGids,
        )
      : Promise.resolve(new Map<string, string>()),
    options?.shop && orderGids.length > 0
      ? getInvoicedOrderGids(options.shop, orderGids)
      : Promise.resolve(new Set<string>()),
  ]);

  const list = nodes.map((node) => {
    const company = node.billingAddress?.company?.trim() || "";
    const customerName =
      company ||
      node.customer?.displayName?.trim() ||
      node.billingAddress?.name?.trim() ||
      "Guest customer";
    const refunded = moneyAmount(node.totalRefundedSet?.shopMoney);
    const totalMoney =
      node.totalPriceSet?.shopMoney ?? node.currentTotalPriceSet?.shopMoney;

    return {
      id: node.id,
      name: node.name,
      documentNumber: documentNumbers.get(node.id) ?? null,
      customer: customerName,
      createdAt: node.createdAt,
      total: moneyAmount(totalMoney),
      refundedTotal: refunded,
      currencyCode:
        node.totalRefundedSet?.shopMoney?.currencyCode ||
        totalMoney?.currencyCode ||
        "USD",
      paymentStatus: node.displayFinancialStatus ?? null,
      invoiced: invoicedGids.has(node.id),
    };
  });

  if (options?.shop) {
    sidebarListCache.set(cacheKey, {
      expires: Date.now() + SIDEBAR_LIST_TTL_MS,
      data: list,
    });
  }

  return list;
}
