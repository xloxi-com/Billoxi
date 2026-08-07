import prisma from "./db.server";
import {
  loadNumberSeriesEntryForShop,
  loadStoreDetailsForShop,
} from "./shop-settings.server";
import {
  defaultTemplateSettings,
  mergeTemplateSettings,
  resolveSalesOrderTemplateId,
  salesOrderTemplateName,
  formatPercentOf,
  formatOrderDate,
  buildTaxSummaryFromLineItems,
  reconcileTaxSummaryToOrderTotal,
  reconcilePaymentAmounts,
  formatQuantityDisplay,
  SALES_ORDER_TEMPLATE_PRESETS,
  INVOICE_TEMPLATE_PRESETS,
  CREDIT_NOTE_TEMPLATE_PRESETS,
  PACKING_SLIP_TEMPLATE_PRESETS,
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
  if (
    storeDetails.name &&
    (!settings.transactionLabels.organization ||
      settings.transactionLabels.organization === "Northstar Commerce" ||
      settings.transactionLabels.organization === "Organization")
  ) {
    settings.transactionLabels.organization = storeDetails.name;
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
  totalReceivedSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalOutstandingSet?: { shopMoney?: { amount: string; currencyCode: string } };
  totalRefundedSet?: { shopMoney?: { amount: string; currencyCode: string } };
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
  return formatOrderDate(dates[0]);
}

/** Soft-fail: missing fulfillment scopes must not break the document. */
async function fetchExpectedShipmentDate(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  orderGid: string,
) {
  try {
    const response = await admin.graphql(
      `#graphql
        query SalesOrderShipmentDate($id: ID!) {
          order(id: $id) {
            fulfillmentOrders(first: 10) {
              nodes {
                fulfillAt
                fulfillBy
              }
            }
          }
        }`,
      { variables: { id: orderGid } },
    );
    const payload = await response.json();
    if (payload?.errors?.length) return "";
    const nodes = payload?.data?.order?.fulfillmentOrders?.nodes as
      | Array<{ fulfillAt?: string | null; fulfillBy?: string | null } | null>
      | undefined;
    return resolveExpectedShipmentDate(nodes);
  } catch {
    return "";
  }
}

export async function fetchSalesOrderDocument(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  orderGid: string,
): Promise<SalesOrderDocumentData | null> {
  const [response, expectedShipmentDate] = await Promise.all([
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
          currentSubtotalPriceSet { shopMoney { amount currencyCode } }
          currentTotalDiscountsSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          currentTotalTaxSet { shopMoney { amount currencyCode } }
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          totalReceivedSet { shopMoney { amount currencyCode } }
          totalOutstandingSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount currencyCode } }
          taxLines {
            title
            rate
            ratePercentage
            priceSet { shopMoney { amount } }
          }
          lineItems(first: 100) {
            nodes {
              title
              variantTitle
              name
              quantity
              originalUnitPriceSet { shopMoney { amount } }
              originalTotalSet { shopMoney { amount } }
              totalDiscountSet { shopMoney { amount } }
              discountedTotalSet(withCodeDiscounts: true) { shopMoney { amount } }
              priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount } }
              discountAllocations {
                allocatedAmountSet { shopMoney { amount } }
              }
              taxLines {
                rate
                ratePercentage
                priceSet { shopMoney { amount } }
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
    fetchExpectedShipmentDate(admin, orderGid),
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

  const currencyCode =
    order.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD";
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

  return {
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
      const net = Number(order.currentSubtotalPriceSet?.shopMoney?.amount ?? 0);
      const discounts = Number(
        order.currentTotalDiscountsSet?.shopMoney?.amount ?? 0,
      );
      // Show gross subtotal so Subtotal − Discount + Tax = Total reads correctly.
      const gross = net + discounts;
      return Number.isFinite(gross) && gross > 0
        ? gross.toFixed(2)
        : moneyAmount(order.currentSubtotalPriceSet?.shopMoney);
    })(),
    discount: moneyAmount(order.currentTotalDiscountsSet?.shopMoney),
    shippingPrice: moneyAmount(order.totalShippingPriceSet?.shopMoney),
    tax: moneyAmount(order.currentTotalTaxSet?.shopMoney),
    total: moneyAmount(order.currentTotalPriceSet?.shopMoney),
    ...reconcilePaymentAmounts(
      moneyAmount(order.currentTotalPriceSet?.shopMoney),
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
      moneyAmount(order.currentTotalPriceSet?.shopMoney),
      moneyAmount(order.currentTotalTaxSet?.shopMoney),
    ),
  };
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
  const cacheKey = `${options?.shop || ""}|${options?.templateId || ""}`;
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
            currentTotalPriceSet { shopMoney { amount currencyCode } }
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

    return {
      id: node.id,
      name: node.name,
      documentNumber: documentNumbers.get(node.id) ?? null,
      customer: customerName,
      createdAt: node.createdAt,
      total: moneyAmount(node.currentTotalPriceSet?.shopMoney),
      currencyCode: node.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD",
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
