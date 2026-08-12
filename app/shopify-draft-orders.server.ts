import type {
  SalesOrderRow,
  SalesOrdersPage,
  SortSelected,
} from "./sales-orders.server";
import { SORT_OPTIONS, parseSalesOrdersSearchParams } from "./sales-orders.server";
import {
  buildTaxSummaryFromLineItems,
  formatPercentOf,
  formatQuantityDisplay,
  reconcilePaymentAmounts,
  reconcileTaxSummaryToOrderTotal,
  type SalesOrderDocumentData,
  type CustomerOrderListItem,
} from "./sales-order-document";
import {
  emptyPartyTaxFields,
  resolveCustomerPartyFromOrder,
} from "./sales-order-document.server";
import {
  loadMultiCurrencySettingsForShop,
} from "./shop-settings.server";
import { usesPresentmentCurrency } from "./multi-currency-settings";
import {
  getDraftMetaByOrderGids,
  markOrderDraft,
} from "./order-invoice-draft-status.server";
import {
  hasDraftOrderNumbersSynced,
  syncDraftOrderNumbersForShop,
} from "./draft-order-number-sync.server";

const PAGE_SIZE = 25;

const DRAFT_DOCUMENT_TTL_MS = 120_000;
const draftDocumentCache = new Map<
  string,
  { expires: number; value: SalesOrderDocumentData }
>();

export function invalidateDraftOrderDocumentCache(
  shop?: string,
  draftOrderGid?: string,
) {
  if (!shop && !draftOrderGid) {
    draftDocumentCache.clear();
    return;
  }
  for (const key of draftDocumentCache.keys()) {
    if (shop && !key.startsWith(`${shop}|`)) continue;
    if (draftOrderGid && !key.endsWith(`|${draftOrderGid}`)) continue;
    draftDocumentCache.delete(key);
  }
}

type Money = {
  amount: string;
  currencyCode: string;
};

type RawDraftOrder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  email?: string | null;
  currencyCode?: string | null;
  customer: {
    displayName: string;
    defaultAddress?: { company?: string | null } | null;
  } | null;
  billingAddress?: { company?: string | null } | null;
  shippingAddress?: { company?: string | null } | null;
  totalPriceSet: { shopMoney: Money };
};

type DraftOrdersResponse = {
  data?: {
    draftOrders?: {
      nodes: RawDraftOrder[];
      pageInfo: SalesOrdersPage["pageInfo"];
    };
  };
  errors?: Array<{ message: string }>;
};

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const DRAFT_ORDERS_QUERY = `#graphql
  query ShopifyDraftOrders(
    $first: Int
    $after: String
    $last: Int
    $before: String
    $query: String
    $sortKey: DraftOrderSortKeys!
    $reverse: Boolean!
  ) {
    draftOrders(
      first: $first
      after: $after
      last: $last
      before: $before
      query: $query
      sortKey: $sortKey
      reverse: $reverse
    ) {
      nodes {
        id
        name
        createdAt
        updatedAt
        status
        email
        currencyCode
        customer {
          displayName
          defaultAddress {
            company
          }
        }
        billingAddress {
          company
        }
        shippingAddress {
          company
        }
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const currencyFormatters = new Map<string, Intl.NumberFormat>();

function formatMoney(money: Money): string {
  const code = money.currencyCode || "USD";
  let formatter = currencyFormatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    });
    currencyFormatters.set(code, formatter);
  }
  const amount = Number(money.amount);
  return formatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

function resolveCompany(order: RawDraftOrder): string {
  return (
    order.billingAddress?.company ||
    order.shippingAddress?.company ||
    order.customer?.defaultAddress?.company ||
    ""
  );
}

function formatDraftStatus(status: string | null | undefined): string {
  const raw = (status || "").trim();
  if (!raw) return "Open";
  return raw
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function draftStatusTone(
  status: string,
): SalesOrderRow["paymentTone"] {
  switch (status.toUpperCase()) {
    case "COMPLETED":
      return "success";
    case "INVOICE_SENT":
      return "info";
    case "OPEN":
    default:
      return "warning";
  }
}

function toDraftRow(
  order: RawDraftOrder,
  draftNumber?: string | null,
): SalesOrderRow {
  const statusKey = (order.status || "OPEN").toUpperCase();
  const money = order.totalPriceSet.shopMoney;
  const billoxiNumber = draftNumber?.trim() || "";
  return {
    id: order.id,
    name: order.name,
    salesOrderNumber: "",
    date: formatDate(order.createdAt),
    createdAt: order.createdAt,
    company: resolveCompany(order),
    customer: order.customer?.displayName || "Guest customer",
    email: order.email?.trim() || "",
    total: formatMoney(money),
    balanceDue: formatMoney(money),
    invoiced: false,
    packingSlip: false,
    packingSlipNumber: "",
    returnSlip: false,
    returnNumber: "",
    returnedAt: null,
    draft: true,
    // Billoxi DFT- only — Shopify #D… stays in Reference (order.name).
    // Before Sync: empty → list shows "—".
    draftNumber: billoxiNumber,
    draftedAt: order.createdAt,
    creditNote: false,
    creditNoteNumber: "",
    creditNoteAt: null,
    creditNoteReason: "",
    creditNoteVoided: false,
    invoicedAt: null,
    invoiceNumber: "",
    paymentStatus: formatDraftStatus(statusKey),
    paymentStatusKey: statusKey,
    fulfillmentStatus: "—",
    paymentTone: draftStatusTone(statusKey),
    paymentProgress:
      statusKey === "COMPLETED" ? "complete" : "incomplete",
    fulfillmentTone: undefined,
    fulfillmentProgress: "incomplete",
    printed: false,
    downloaded: false,
    emailed: false,
  };
}

/** Map Billoxi list sort keys onto DraftOrderSortKeys. */
function resolveDraftSort(sortSelected: SortSelected): {
  sortKey: string;
  reverse: boolean;
} {
  switch (sortSelected) {
    case "order asc":
    case "reference asc":
      return { sortKey: "NUMBER", reverse: false };
    case "order desc":
    case "reference desc":
      return { sortKey: "NUMBER", reverse: true };
    case "customer asc":
      return { sortKey: "CUSTOMER_NAME", reverse: false };
    case "customer desc":
      return { sortKey: "CUSTOMER_NAME", reverse: true };
    case "total asc":
    case "balance asc":
      return { sortKey: "TOTAL_PRICE", reverse: false };
    case "total desc":
    case "balance desc":
      return { sortKey: "TOTAL_PRICE", reverse: true };
    case "date asc":
      return { sortKey: "UPDATED_AT", reverse: false };
    case "date desc":
    default:
      return { sortKey: "UPDATED_AT", reverse: true };
  }
}

function shopifyAdminDraftOrderUrl(shop: string, draftOrderGid: string): string {
  const handle = shop.replace(/\.myshopify\.com$/i, "");
  const numericId = draftOrderGid.includes("/")
    ? draftOrderGid.split("/").pop() || draftOrderGid
    : draftOrderGid;
  return `https://admin.shopify.com/store/${handle}/draft_orders/${numericId}`;
}

export { shopifyAdminDraftOrderUrl };

type MoneyBag = {
  shopMoney?: Money | null;
  presentmentMoney?: Money | null;
};

type DraftOrderLineNode = {
  title: string;
  variantTitle?: string | null;
  name?: string | null;
  quantity: number;
  originalUnitPriceSet?: MoneyBag | null;
  originalTotalSet?: MoneyBag | null;
  totalDiscountSet?: MoneyBag | null;
  discountedTotalSet?: MoneyBag | null;
  taxLines?: Array<{
    rate?: number | null;
    ratePercentage?: number | null;
    priceSet?: MoneyBag | null;
  }> | null;
  image?: { url?: string | null } | null;
  variant?: {
    sku?: string | null;
    barcode?: string | null;
    title?: string | null;
    compareAtPrice?: string | number | null;
    price?: string | number | null;
    selectedOptions?: Array<{ name: string; value: string }> | null;
    product?: { featuredImage?: { url?: string | null } | null } | null;
  } | null;
};

type DraftOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  note2?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
  currencyCode?: string | null;
  customer?: { id?: string | null; displayName?: string | null } | null;
  purchasingEntity?: Record<string, unknown> | null;
  billingAddress?: {
    company?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
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
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
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
  subtotalPriceSet?: MoneyBag | null;
  totalDiscountsSet?: MoneyBag | null;
  totalShippingPriceSet?: MoneyBag | null;
  totalTaxSet?: MoneyBag | null;
  totalPriceSet?: MoneyBag | null;
  taxLines?: Array<{
    title?: string | null;
    rate?: number | null;
    ratePercentage?: number | null;
    priceSet?: MoneyBag | null;
  }> | null;
  lineItems?: { nodes?: DraftOrderLineNode[] | null } | null;
};

const DRAFT_ORDER_DOCUMENT_QUERY = `#graphql
  query DraftOrderDocument($id: ID!) {
    draftOrder(id: $id) {
      id
      name
      createdAt
      note2
      email
      phone
      status
      currencyCode
      customer { id displayName }
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
      subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
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
          discountedTotalSet { shopMoney { amount } presentmentMoney { amount } }
          taxLines {
            rate
            ratePercentage
            priceSet { shopMoney { amount } presentmentMoney { amount } }
          }
          image { url }
          variant {
            sku
            barcode
            title
            compareAtPrice
            price
            selectedOptions { name value }
            product { featuredImage { url } }
          }
        }
      }
    }
  }
`;

const DRAFT_ORDER_SIDEBAR_QUERY = `#graphql
  query DraftOrderSidebarList {
    draftOrders(first: 20, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        status
        currencyCode
        customer { displayName }
        totalPriceSet {
          shopMoney { amount currencyCode }
          presentmentMoney { amount currencyCode }
        }
      }
    }
  }
`;

function moneyAmount(value: { amount?: string } | null | undefined) {
  const amount = Number(value?.amount ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

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

function formatDraftAddress(
  address: DraftOrderNode["billingAddress"] | DraftOrderNode["shippingAddress"],
): string[] {
  if (!address) return [];
  const lines: string[] = [];
  if (address.address1?.trim()) lines.push(address.address1.trim());
  if (address.address2?.trim()) lines.push(address.address2.trim());
  const cityLine = [
    address.city?.trim(),
    address.province?.trim() || address.provinceCode?.trim(),
    address.zip?.trim(),
  ]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  const country = address.country?.trim() || address.countryCodeV2?.trim();
  if (country) lines.push(country);
  return lines;
}

function draftPersonName(
  address: DraftOrderNode["billingAddress"],
): string {
  if (!address) return "";
  const fromParts = [address.firstName?.trim(), address.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
  if (fromParts) return fromParts;
  return address.name?.trim() || "";
}

function resolveDraftVariantTitle(item: DraftOrderLineNode): string {
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
  return "";
}

/**
 * Fetch a Shopify DraftOrder and map it into SalesOrderDocumentData
 * for Billoxi draft document preview / export.
 */
export async function fetchDraftOrderDocument(
  admin: AdminGraphql,
  draftOrderGid: string,
  options?: { shop?: string; bypassCache?: boolean },
): Promise<SalesOrderDocumentData | null> {
  const shopKey = options?.shop || "_";
  const cacheKey = `${shopKey}|${draftOrderGid}`;
  if (!options?.bypassCache) {
    const cached = draftDocumentCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }
  }

  const [response, multiCurrency] = await Promise.all([
    admin.graphql(DRAFT_ORDER_DOCUMENT_QUERY, {
      variables: { id: draftOrderGid },
    }),
    options?.shop
      ? loadMultiCurrencySettingsForShop(options.shop)
      : Promise.resolve(null),
  ]);

  const payload = await response.json();
  if (payload?.errors?.length) {
    console.error(
      "Draft order document GraphQL errors:",
      JSON.stringify(payload.errors, null, 2),
    );
  }

  const order = payload?.data?.draftOrder as DraftOrderNode | null | undefined;
  if (!order) return null;

  if (multiCurrency && usesPresentmentCurrency(multiCurrency.mode)) {
    promotePresentmentDeep(order);
  }

  const documentSubtotalSet = order.subtotalPriceSet;
  const documentDiscountSet = order.totalDiscountsSet;
  const documentTaxSet = order.totalTaxSet;
  const documentTotalSet = order.totalPriceSet;
  const currencyCode =
    documentTotalSet?.shopMoney?.currencyCode ||
    order.currencyCode ||
    "USD";
  const customerName =
    order.customer?.displayName ||
    draftPersonName(order.billingAddress) ||
    "Guest customer";

  const lineItems = (order.lineItems?.nodes ?? []).map((item) => {
    const original = Number(item.originalTotalSet?.shopMoney?.amount ?? 0);
    const reportedDiscount = Number(
      item.totalDiscountSet?.shopMoney?.amount ?? 0,
    );
    const discountedWithCodes = Number(
      item.discountedTotalSet?.shopMoney?.amount ?? 0,
    );
    const unitPrice = Number(item.originalUnitPriceSet?.shopMoney?.amount ?? 0);
    const gross =
      original > 0
        ? original
        : Math.max(0, unitPrice * Number(item.quantity ?? 0));
    const discountFromTotals =
      original > 0 && discountedWithCodes > 0
        ? Math.max(0, original - discountedWithCodes)
        : 0;
    const discount = Math.max(
      0,
      reportedDiscount > 0 ? reportedDiscount : discountFromTotals,
    );
    const amount =
      discountedWithCodes > 0
        ? discountedWithCodes
        : Math.max(0, gross - discount);
    const rate = moneyAmount(item.originalUnitPriceSet?.shopMoney);
    const taxLines = item.taxLines ?? [];
    const taxAmountNum = taxLines.reduce(
      (sum, line) => sum + Number(line.priceSet?.shopMoney?.amount ?? 0),
      0,
    );
    const taxRatePercentage = taxLines.reduce((sum, line) => {
      if (
        typeof line.ratePercentage === "number" &&
        Number.isFinite(line.ratePercentage)
      ) {
        return sum + line.ratePercentage;
      }
      if (typeof line.rate === "number" && Number.isFinite(line.rate)) {
        return sum + line.rate * 100;
      }
      return sum;
    }, 0);
    const taxableBase = Math.max(0, (original || amount) - discount);
    const taxPercentage =
      taxRatePercentage > 0
        ? `${taxRatePercentage.toFixed(2)}%`
        : formatPercentOf(String(taxAmountNum), String(taxableBase));

    return {
      title: item.title,
      variantTitle: resolveDraftVariantTitle(item),
      imageUrl:
        item.image?.url?.trim() ||
        item.variant?.product?.featuredImage?.url?.trim() ||
        "",
      quantity: formatQuantityDisplay(item.quantity),
      rate,
      compareAtPrice: discount > 0.0001 ? rate : "",
      discount: discount.toFixed(2),
      discountPercentage: formatPercentOf(
        String(discount),
        String(gross || original),
      ),
      taxPercentage,
      taxAmount: taxAmountNum.toFixed(2),
      amount: Number.isFinite(amount) ? amount.toFixed(2) : "0.00",
      sku: item.variant?.sku || "",
      barcode: item.variant?.barcode || "",
    };
  });

  const orderTaxSummary = (order.taxLines ?? [])
    .map((line) => {
      const taxAmount = Number(line.priceSet?.shopMoney?.amount ?? 0);
      if (!Number.isFinite(taxAmount) || taxAmount <= 0) return null;
      const ratePercentage =
        typeof line.ratePercentage === "number" &&
        Number.isFinite(line.ratePercentage)
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

  const total = moneyAmount(documentTotalSet?.shopMoney);

  const document: SalesOrderDocumentData = {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    expectedShipmentDate: "",
    paymentMethod: "",
    email: order.email ?? null,
    phone: order.phone ?? null,
    customerId: order.customer?.id ?? null,
    customerName,
    billing: {
      company: order.billingAddress?.company?.trim() || "",
      name: draftPersonName(order.billingAddress),
      address: formatDraftAddress(order.billingAddress),
      phone: order.billingAddress?.phone?.trim() || "",
      email: order.billingAddress ? order.email?.trim() || "" : "",
      ...emptyPartyTaxFields(),
    },
    shipping: {
      company: order.shippingAddress?.company?.trim() || "",
      name: draftPersonName(order.shippingAddress),
      address: formatDraftAddress(order.shippingAddress),
      phone: order.shippingAddress?.phone?.trim() || "",
      email: order.shippingAddress ? order.email?.trim() || "" : "",
      ...emptyPartyTaxFields(),
    },
    customer: resolveCustomerPartyFromOrder(order, customerName),
    terms: "Due on Receipt",
    orderNote: (order.note2 || "").trim(),
    lineItems,
    subtotal: (() => {
      const net = Number(documentSubtotalSet?.shopMoney?.amount ?? 0);
      const discounts = Number(documentDiscountSet?.shopMoney?.amount ?? 0);
      const gross = net + discounts;
      return Number.isFinite(gross) && gross > 0
        ? gross.toFixed(2)
        : moneyAmount(documentSubtotalSet?.shopMoney);
    })(),
    discount: moneyAmount(documentDiscountSet?.shopMoney),
    shippingPrice: moneyAmount(order.totalShippingPriceSet?.shopMoney),
    tax: moneyAmount(documentTaxSet?.shopMoney),
    total,
    ...reconcilePaymentAmounts(total, "0.00", total, "PENDING", "0.00"),
    financialStatus: "PENDING",
    currencyCode,
    taxSummary: reconcileTaxSummaryToOrderTotal(
      orderTaxSummary.length > 0
        ? orderTaxSummary
        : buildTaxSummaryFromLineItems(lineItems),
      total,
      moneyAmount(documentTaxSet?.shopMoney),
    ),
  };

  draftDocumentCache.set(cacheKey, {
    expires: Date.now() + DRAFT_DOCUMENT_TTL_MS,
    value: document,
  });
  return document;
}

/** Recent Shopify draft orders for the document sidebar. */
export async function fetchDraftOrderSidebarList(
  admin: AdminGraphql,
  shop?: string,
): Promise<CustomerOrderListItem[]> {
  try {
    const response = await admin.graphql(DRAFT_ORDER_SIDEBAR_QUERY);
    const payload = await response.json();
    if (payload?.errors?.length) {
      console.error(
        "Draft order sidebar GraphQL errors:",
        JSON.stringify(payload.errors, null, 2),
      );
    }
    const nodes = (payload?.data?.draftOrders?.nodes ?? []) as Array<{
      id: string;
      name: string;
      createdAt: string;
      status?: string | null;
      currencyCode?: string | null;
      customer?: { displayName?: string | null } | null;
      totalPriceSet?: MoneyBag | null;
    }>;

    let draftMeta = new Map<
      string,
      { documentNumber: string | null }
    >();
    if (shop && nodes.length > 0) {
      draftMeta = await getDraftMetaByOrderGids(
        shop,
        nodes.map((node) => node.id),
      );
    }

    return nodes.map((node) => {
      const money = node.totalPriceSet?.shopMoney;
      const billoxiNumber = draftMeta.get(node.id)?.documentNumber?.trim();
      return {
        id: node.id,
        name: node.name,
        documentNumber: billoxiNumber || node.name,
        customer: node.customer?.displayName || "Guest customer",
        createdAt: node.createdAt,
        total: money?.amount || "0.00",
        currencyCode: money?.currencyCode || node.currencyCode || "USD",
        paymentStatus: formatDraftStatus(node.status),
        invoiced: false,
      };
    });
  } catch (error) {
    console.error("Draft order sidebar load failed:", error);
    return [];
  }
}

/**
 * Load Shopify Admin draft orders into the shared list page shape.
 * Requires `read_draft_orders` (and typically `read_customers`) scope.
 */
export async function loadShopifyDraftOrdersPage(
  admin: AdminGraphql,
  shop: string,
  params: ReturnType<typeof parseSalesOrdersSearchParams>,
): Promise<SalesOrdersPage & { scopeError?: string }> {
  const empty = (scopeError?: string): SalesOrdersPage & { scopeError?: string } => ({
    orders: [],
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
    query: params.query,
    selectedView: 0,
    availableViews: [0],
    paymentStatus: params.paymentStatus,
    fulfillmentStatus: params.fulfillmentStatus,
    sortSelected:
      params.sortSelected in SORT_OPTIONS
        ? params.sortSelected
        : ("date desc" as SortSelected),
    ...(scopeError ? { scopeError } : {}),
  });

  const sortSelected =
    params.sortSelected in SORT_OPTIONS
      ? params.sortSelected
      : ("date desc" as SortSelected);
  const { sortKey, reverse } = resolveDraftSort(sortSelected);

  const statusFilter = params.paymentStatus.trim().toLowerCase();
  const statusQuery =
    statusFilter === "open" ||
    statusFilter === "invoice_sent" ||
    statusFilter === "completed"
      ? `status:${statusFilter}`
      : "";

  const orderQuery = [params.query.trim(), statusQuery]
    .filter(Boolean)
    .join(" ");

  const isPreviousPage = Boolean(params.before);

  try {
    const response = await admin.graphql(DRAFT_ORDERS_QUERY, {
      variables: {
        first: isPreviousPage ? undefined : PAGE_SIZE,
        after: isPreviousPage ? undefined : params.after,
        last: isPreviousPage ? PAGE_SIZE : undefined,
        before: isPreviousPage ? params.before : undefined,
        query: orderQuery || undefined,
        sortKey,
        reverse,
      },
    });

    const result = (await response.json()) as DraftOrdersResponse & {
      errors?: Array<{ message?: string; extensions?: { code?: string } }>;
    };

    const gqlErrors = result.errors || [];
    const accessDenied = gqlErrors.some((error) =>
      /access denied|ACCESS_DENIED/i.test(String(error.message || "")),
    );
    if (accessDenied) {
      return empty(
        "Missing read_draft_orders permission. Update the app scopes, then reopen Billoxi.",
      );
    }

    if (!result.data?.draftOrders) {
      const message =
        gqlErrors.map((error) => error.message).filter(Boolean).join(", ") ||
        "Shopify draft orders could not be loaded.";
      return empty(message);
    }

    const nodes = result.data.draftOrders.nodes;
    const gids = nodes.map((node) => node.id);

    // After DB reset / install: assign DFT- numbers on first Draft list load.
    if (!(await hasDraftOrderNumbersSynced(shop))) {
      try {
        await syncDraftOrderNumbersForShop(shop, admin);
      } catch (error) {
        console.warn(
          "[draft-orders] auto number sync failed:",
          shop,
          error,
        );
      }
    }

    // Fill any new drafts missing a DFT- number (Reference keeps Shopify #D…).
    if (gids.length > 0 && (await hasDraftOrderNumbersSynced(shop))) {
      let draftMeta = await getDraftMetaByOrderGids(shop, gids);
      const missing = gids.filter(
        (gid) => !draftMeta.get(gid)?.documentNumber?.trim(),
      );
      if (missing.length > 0) {
        for (const gid of missing) {
          try {
            await markOrderDraft(shop, gid);
          } catch (error) {
            console.error("Draft number allocate failed:", gid, error);
          }
        }
        draftMeta = await getDraftMetaByOrderGids(shop, gids);
      }
      return {
        orders: nodes.map((node) =>
          toDraftRow(node, draftMeta.get(node.id)?.documentNumber),
        ),
        pageInfo: result.data.draftOrders.pageInfo,
        query: params.query,
        selectedView: 0,
        availableViews: [0],
        paymentStatus: params.paymentStatus,
        fulfillmentStatus: params.fulfillmentStatus,
        sortSelected,
      };
    }

    const draftMeta =
      gids.length > 0
        ? await getDraftMetaByOrderGids(shop, gids)
        : new Map();

    return {
      orders: nodes.map((node) =>
        toDraftRow(node, draftMeta.get(node.id)?.documentNumber),
      ),
      pageInfo: result.data.draftOrders.pageInfo,
      query: params.query,
      selectedView: 0,
      availableViews: [0],
      paymentStatus: params.paymentStatus,
      fulfillmentStatus: params.fulfillmentStatus,
      sortSelected,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/access denied|draftOrders/i.test(message)) {
      return empty(
        "Missing read_draft_orders permission. Update the app scopes, then reopen Billoxi.",
      );
    }
    return empty(message || "Shopify draft orders could not be loaded.");
  }
}
