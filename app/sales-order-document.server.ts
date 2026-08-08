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
  formatQuantityDisplay,
  SALES_ORDER_TEMPLATE_PRESETS,
  INVOICE_TEMPLATE_PRESETS,
  CREDIT_NOTE_TEMPLATE_PRESETS,
  PACKING_SLIP_TEMPLATE_PRESETS,
  type CreditNoteRefundSource,
  type SalesOrderDocumentData,
  type TemplateEditorSettings,
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

export type { SalesOrderDocumentData, TemplateEditorSettings };

/**
 * Wipe saved customizations and re-seed every sales-order + invoice preset with the
 * current clean code defaults (margins, appearance, totals, labels, etc.).
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
    ...CREDIT_NOTE_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "credit-note" as const,
      preset,
    })),
    ...PACKING_SLIP_TEMPLATE_PRESETS.map((preset) => ({
      documentType: "packing-slip" as const,
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
        zip?: string | null;
        country?: string | null;
      }
    | null
    | undefined,
) {
  if (!address) return [];
  const lines: string[] = [];
  if (address.address1) lines.push(address.address1);
  if (address.address2) lines.push(address.address2);
  const cityLine = [address.city, address.province, address.zip]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  if (address.country) lines.push(address.country);
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
  if (address.name) return address.name;
  return [address.firstName, address.lastName].filter(Boolean).join(" ");
}

export async function loadDocumentTemplateSettings(
  shop: string,
  documentType: "sales-order" | "invoice" | "credit-note" | "packing-slip",
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
  const templateName = salesOrderTemplateName(resolvedId);
  const seriesId: NumberSeriesModuleId =
    documentType === "invoice"
      ? "invoice"
      : documentType === "credit-note"
        ? "credit-note"
        : documentType === "packing-slip"
          ? "packing-slip"
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
  settings.header = { ...settings.header, ...defaults.header };

  return {
    templateId: resolvedId,
    templateName,
    settings,
    storeDetails,
  };
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
    } | null> | null;
  } | null;
  transactions?: Array<{
    kind?: string | null;
    status?: string | null;
    gateway?: string | null;
    formattedGateway?: string | null;
    manualPaymentGateway?: boolean | null;
  } | null> | null;
  customer?: { id?: string | null; displayName?: string | null } | null;
  billingAddress?: {
    company?: string | null;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
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
    zip?: string | null;
    country?: string | null;
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
    } | null> | null;
  } | null;
}) {
  try {
    return resolveExpectedShipmentDate(order.fulfillmentOrders?.nodes);
  } catch {
    return "";
  }
}

function creditNoteRefundSourceFromOrder(
  order: OrderNode,
): CreditNoteRefundSource {
  const refundLineItems: CreditNoteRefundSource["refundLineItems"] = [];
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
      refundLineItems.push({
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
      });
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

export async function fetchSalesOrderDocument(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  orderGid: string,
  options?: { asCreditNote?: boolean; shop?: string },
): Promise<SalesOrderDocumentData | null> {
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
            }
          }
          transactions(first: 20) {
            kind
            status
            gateway
            formattedGateway
            manualPaymentGateway
          }
          customer { id displayName }
          billingAddress {
            company
            firstName
            lastName
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          shippingAddress {
            company
            firstName
            lastName
            address1
            address2
            city
            province
            zip
            country
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
      company: order.billingAddress?.company || "",
      name: personName(order.billingAddress) || customerName,
      address: formatAddress(order.billingAddress),
      phone: order.billingAddress?.phone || order.phone || "",
      email: order.email || "",
    },
    shipping: {
      company: order.shippingAddress?.company || "",
      name: personName(order.shippingAddress) || customerName,
      address: formatAddress(order.shippingAddress),
      phone: order.shippingAddress?.phone || order.phone || "",
      email: order.email || "",
    },
    customer: {
      company: order.billingAddress?.company || "",
      name: customerName,
      address: formatAddress(order.billingAddress),
      phone: order.phone || order.billingAddress?.phone || "",
      email: order.email || "",
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
  };

  if (options?.asCreditNote) {
    return adaptDocumentForCreditNote(
      document,
      creditNoteRefundSourceFromOrder(order),
    );
  }

  return document;
}

const SIDEBAR_LIST_TTL_MS = 60_000;
const sidebarListCache = new Map<
  string,
  {
    expires: number;
    data: import("./sales-order-document").CustomerOrderListItem[];
  }
>();

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
