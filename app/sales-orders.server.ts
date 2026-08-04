import { getSalesOrderDocumentNumbersByOrderGids } from "./sales-order-number.server";
import {
  getAllInvoicedOrderGids,
  getInvoicedMetaByOrderGids,
  ensureInvoiceDocumentNumbers,
} from "./order-invoice-status.server";
import { getPackingSlipOrderGids } from "./order-packing-slip-status.server";
import { DEFAULT_SALES_ORDER_TEMPLATE_ID } from "./sales-order-document";
import {
  INVOICED_VIEW_QUERY,
  SALES_ORDER_VIEWS,
} from "./sales-orders";
import prisma from "./db.server";

const PAGE_SIZE = 25;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 80;
const AVAILABILITY_CACHE_TTL_MS = 90_000;
const SEARCH_MATCH_LIMIT = 50;

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});
const currencyFormatters = new Map<string, Intl.NumberFormat>();

export { INVOICED_VIEW_QUERY, SALES_ORDER_VIEWS };
export type { SalesOrderViewId } from "./sales-orders";

export const SORT_OPTIONS = {
  "order asc": { sortKey: "ORDER_NUMBER", reverse: false },
  "order desc": { sortKey: "ORDER_NUMBER", reverse: true },
  "customer asc": { sortKey: "CUSTOMER_NAME", reverse: false },
  "customer desc": { sortKey: "CUSTOMER_NAME", reverse: true },
  "date asc": { sortKey: "CREATED_AT", reverse: false },
  "date desc": { sortKey: "CREATED_AT", reverse: true },
  "total asc": { sortKey: "CURRENT_TOTAL_PRICE", reverse: false },
  "total desc": { sortKey: "CURRENT_TOTAL_PRICE", reverse: true },
} as const;

export type SortSelected = keyof typeof SORT_OPTIONS;

type Money = {
  amount: string;
  currencyCode: string;
};

type RawSalesOrder = {
  id: string;
  name: string;
  createdAt: string;
  email?: string | null;
  customer: {
    displayName: string;
    defaultAddress?: { company?: string | null } | null;
  } | null;
  billingAddress?: { company?: string | null } | null;
  shippingAddress?: { company?: string | null } | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentTotalPriceSet: { shopMoney: Money };
  totalReceivedSet?: { shopMoney: Money } | null;
  totalOutstandingSet?: { shopMoney: Money } | null;
};

type OrdersResponse = {
  data?: {
    orders: {
      nodes: RawSalesOrder[];
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
      };
    };
  };
  errors?: Array<{ message: string }>;
};

export type SalesOrderRow = {
  id: string;
  name: string;
  salesOrderNumber: string;
  date: string;
  createdAt: string;
  company: string;
  customer: string;
  email: string;
  total: string;
  balanceDue: string;
  invoiced: boolean;
  packingSlip: boolean;
  invoicedAt: string | null;
  invoiceNumber: string;
  paymentStatus: string;
  paymentStatusKey: string;
  fulfillmentStatus: string;
  paymentTone: "success" | "warning" | "info" | "attention" | "critical" | undefined;
  paymentProgress: "complete" | "partiallyComplete" | "incomplete";
  fulfillmentTone: "success" | "warning" | "info" | "attention" | "critical" | undefined;
  fulfillmentProgress: "complete" | "partiallyComplete" | "incomplete";
};

export type SalesOrdersPage = {
  orders: SalesOrderRow[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  query: string;
  selectedView: number;
  /** View indexes (into SALES_ORDER_VIEWS) that currently have matching orders. Always includes 0 (All). */
  availableViews: number[];
  paymentStatus: string;
  fulfillmentStatus: string;
  sortSelected: SortSelected;
};

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type CacheEntry = {
  expires: number;
  data: SalesOrdersPage;
};

const listCache = new Map<string, CacheEntry>();
const availabilityCache = new Map<
  string,
  { expires: number; views: number[] }
>();

const SALES_ORDERS_QUERY = `#graphql
  query SalesOrders(
    $first: Int
    $after: String
    $last: Int
    $before: String
    $query: String
    $sortKey: OrderSortKeys!
    $reverse: Boolean!
  ) {
    orders(
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
        email
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
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalReceivedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalOutstandingSet {
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

const CUSTOMERS_SEARCH_QUERY = `#graphql
  query SalesOrdersCustomerSearch($query: String!, $first: Int!) {
    customers(first: $first, query: $query) {
      nodes {
        id
      }
    }
  }
`;

function escapeSearchTerm(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quoteSearchTerm(value: string) {
  return `"${escapeSearchTerm(value)}"`;
}

function orderGidToNumericId(gid: string) {
  return gid.includes("/") ? gid.split("/").pop() || "" : gid;
}

/** Look up sales-order document numbers (SO-0001) that match the search term. */
async function findOrderGidsBySalesOrderNumber(
  shop: string,
  templateId: string,
  term: string,
): Promise<string[]> {
  const cleaned = term.trim();
  if (!cleaned) return [];

  const rows = await prisma.salesOrderDocumentNumber.findMany({
    where: {
      shop,
      templateId,
      documentNumber: {
        contains: cleaned,
        mode: "insensitive",
      },
    },
    take: SEARCH_MATCH_LIMIT,
    select: { orderGid: true },
    orderBy: { sequence: "desc" },
  });
  return rows.map((row) => row.orderGid);
}

/** Find customer GIDs matching name / company text via Shopify customer search. */
async function findCustomerIdsBySearch(
  admin: AdminGraphql,
  term: string,
): Promise<string[]> {
  const cleaned = term.trim();
  if (!cleaned) return [];

  const response = await admin.graphql(CUSTOMERS_SEARCH_QUERY, {
    variables: {
      first: SEARCH_MATCH_LIMIT,
      query: cleaned,
    },
  });
  const result = (await response.json()) as {
    data?: { customers?: { nodes?: Array<{ id: string }> } };
  };
  return (result.data?.customers?.nodes ?? [])
    .map((node) => orderGidToNumericId(node.id))
    .filter(Boolean);
}

/**
 * Build a Shopify orders `query` clause that covers:
 * - Reference / Shopify order name (#1004)
 * - Customer name (default + customer_id matches)
 * - Company (via customer search, which indexes company on addresses)
 * - Sales Order numbers (SO-0001) via local document-number lookup → id:
 */
async function buildSalesOrdersTextSearch(
  admin: AdminGraphql,
  shop: string,
  templateId: string,
  rawQuery: string,
): Promise<string> {
  const term = rawQuery.trim();
  if (!term) return "";

  const withoutHash = term.replace(/^#/, "").trim();
  const clauses: string[] = [];

  // Reference: Shopify order name (#1004 / 1004)
  if (withoutHash) {
    clauses.push(`name:${quoteSearchTerm(withoutHash)}`);
    clauses.push(`name:${quoteSearchTerm(`#${withoutHash}`)}`);
  }

  // Default multi-field search (customer name, email, etc.)
  clauses.push(quoteSearchTerm(term));

  const [soGids, customerIds] = await Promise.all([
    findOrderGidsBySalesOrderNumber(shop, templateId, term),
    findCustomerIdsBySearch(admin, term),
  ]);

  for (const gid of soGids) {
    const id = orderGidToNumericId(gid);
    if (id) clauses.push(`id:${id}`);
  }
  for (const id of customerIds) {
    clauses.push(`customer_id:${id}`);
  }

  if (clauses.length === 0) return quoteSearchTerm(term);
  if (clauses.length === 1) return clauses[0]!;
  return `(${clauses.join(" OR ")})`;
}

/** Always show all tabs — avoids extra Admin GraphQL round-trips on every list load. */
export async function getAvailableSalesOrderViews(
  _admin: AdminGraphql,
  _shop: string,
): Promise<number[]> {
  return SALES_ORDER_VIEWS.map((_, index) => index);
}

function formatStatus(status: string | null) {
  if (!status) return "Unknown";
  const label = status.toLowerCase().replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Labels match Shopify Admin Orders payment status badges. */
function formatPaymentStatus(status: string | null) {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "PARTIALLY_PAID":
      return "Partially paid";
    case "PARTIALLY_REFUNDED":
      return "Partially refunded";
    default:
      return formatStatus(status);
  }
}

/** Labels match Shopify Admin Orders fulfillment status badges. */
function formatFulfillmentStatus(status: string | null) {
  switch (status) {
    case "UNFULFILLED":
      return "Unfulfilled";
    case "PARTIALLY_FULFILLED":
      return "Partially fulfilled";
    case "ON_HOLD":
      return "On hold";
    case "IN_PROGRESS":
      return "In progress";
    case "REQUEST_DECLINED":
      return "Request declined";
    case "PENDING_FULFILLMENT":
      return "Pending fulfillment";
    default:
      return formatStatus(status);
  }
}

function formatDate(date: string) {
  return dateFormatter.format(new Date(date));
}

function formatMoney(money: Money) {
  let formatter = currencyFormatters.get(money.currencyCode);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: money.currencyCode,
    });
    currencyFormatters.set(money.currencyCode, formatter);
  }
  return formatter.format(Number(money.amount));
}

/**
 * Badge tones/progress match Shopify Admin Orders list
 * (default grey for Paid/Voided/Refunded; attention for Pending).
 */
function paymentBadge(status: string | null): Pick<
  SalesOrderRow,
  "paymentTone" | "paymentProgress"
> {
  switch (status) {
    case "PAID":
    case "REFUNDED":
    case "VOIDED":
      return { paymentTone: undefined, paymentProgress: "complete" };
    case "PENDING":
      return { paymentTone: "attention", paymentProgress: "incomplete" };
    case "AUTHORIZED":
      return { paymentTone: "attention", paymentProgress: "partiallyComplete" };
    case "PARTIALLY_PAID":
    case "PARTIALLY_REFUNDED":
      return { paymentTone: "warning", paymentProgress: "partiallyComplete" };
    case "EXPIRED":
    case "UNPAID":
      return { paymentTone: "critical", paymentProgress: "incomplete" };
    default:
      return { paymentTone: undefined, paymentProgress: "incomplete" };
  }
}

/**
 * Badge tones/progress match Shopify Admin Orders fulfillment column
 * (Unfulfilled = warning + hollow pip; Not required / Fulfilled = default grey).
 */
function fulfillmentBadge(status: string): Pick<
  SalesOrderRow,
  "fulfillmentTone" | "fulfillmentProgress"
> {
  switch (status) {
    case "FULFILLED":
    case "RESTOCKED":
      return { fulfillmentTone: undefined, fulfillmentProgress: "complete" };
    case "PARTIALLY_FULFILLED":
      return {
        fulfillmentTone: "warning",
        fulfillmentProgress: "partiallyComplete",
      };
    case "UNFULFILLED":
    case "PENDING_FULFILLMENT":
      return { fulfillmentTone: "warning", fulfillmentProgress: "incomplete" };
    case "IN_PROGRESS":
      return { fulfillmentTone: "info", fulfillmentProgress: "partiallyComplete" };
    case "SCHEDULED":
    case "OPEN":
      return { fulfillmentTone: "info", fulfillmentProgress: "incomplete" };
    case "ON_HOLD":
      return { fulfillmentTone: "attention", fulfillmentProgress: "incomplete" };
    case "REQUEST_DECLINED":
      return { fulfillmentTone: "critical", fulfillmentProgress: "incomplete" };
    default:
      return { fulfillmentTone: undefined, fulfillmentProgress: "complete" };
  }
}

function resolveCompany(order: RawSalesOrder) {
  const billing = order.billingAddress?.company?.trim() || "";
  if (billing) return billing;

  const shipping = order.shippingAddress?.company?.trim() || "";
  if (shipping) return shipping;

  return order.customer?.defaultAddress?.company?.trim() || "—";
}

function resolveBalanceDue(order: RawSalesOrder): Money {
  const currencyCode =
    order.currentTotalPriceSet.shopMoney.currencyCode || "USD";
  const total = Number(order.currentTotalPriceSet.shopMoney.amount) || 0;
  const outstandingRaw = order.totalOutstandingSet?.shopMoney?.amount;
  const receivedRaw = order.totalReceivedSet?.shopMoney?.amount;
  const status = (order.displayFinancialStatus || "").toUpperCase();

  if (status === "PAID" || status === "VOIDED" || status === "REFUNDED") {
    return { amount: "0", currencyCode };
  }

  if (outstandingRaw != null && outstandingRaw !== "") {
    const outstanding = Number(outstandingRaw);
    if (Number.isFinite(outstanding)) {
      return {
        amount: Math.max(0, outstanding).toFixed(2),
        currencyCode:
          order.totalOutstandingSet?.shopMoney?.currencyCode || currencyCode,
      };
    }
  }

  const received = Number(receivedRaw) || 0;
  const balance = Math.max(0, Math.round((total - received) * 100) / 100);
  return { amount: balance.toFixed(2), currencyCode };
}

function toRow(
  order: RawSalesOrder,
  salesOrderNumber?: string | null,
  invoiced = false,
  packingSlip = false,
  invoicedAt: Date | null = null,
  invoiceNumber = "",
): SalesOrderRow {
  const payment = paymentBadge(order.displayFinancialStatus);
  const fulfillment = fulfillmentBadge(order.displayFulfillmentStatus);
  return {
    id: order.id,
    name: order.name,
    salesOrderNumber: salesOrderNumber?.trim() || "",
    date: formatDate(order.createdAt),
    createdAt: order.createdAt,
    company: resolveCompany(order),
    customer: order.customer?.displayName || "Guest customer",
    email: order.email?.trim() || "",
    total: formatMoney(order.currentTotalPriceSet.shopMoney),
    balanceDue: formatMoney(resolveBalanceDue(order)),
    invoiced,
    packingSlip,
    invoicedAt: invoicedAt ? invoicedAt.toISOString() : null,
    invoiceNumber: invoiceNumber.trim(),
    paymentStatus: formatPaymentStatus(order.displayFinancialStatus),
    paymentStatusKey: (order.displayFinancialStatus || "").toUpperCase(),
    fulfillmentStatus: formatFulfillmentStatus(order.displayFulfillmentStatus),
    ...payment,
    ...fulfillment,
  };
}

function pruneCache(now: number) {
  if (listCache.size <= CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of listCache) {
    if (entry.expires <= now) listCache.delete(key);
  }
  while (listCache.size > CACHE_MAX_ENTRIES) {
    const oldest = listCache.keys().next().value;
    if (oldest === undefined) break;
    listCache.delete(oldest);
  }
}

export function parseSalesOrdersSearchParams(url: URL) {
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const query = url.searchParams.get("q")?.trim() ?? "";
  const requestedView = Number(url.searchParams.get("view") ?? "0");
  const selectedView =
    Number.isInteger(requestedView) &&
    requestedView >= 0 &&
    requestedView < SALES_ORDER_VIEWS.length
      ? requestedView
      : 0;
  const paymentStatus = url.searchParams.get("payment") ?? "";
  const fulfillmentStatus = url.searchParams.get("fulfillment") ?? "";
  const requestedSort = url.searchParams.get("sort") ?? "date desc";
  const sortSelected = (
    requestedSort in SORT_OPTIONS ? requestedSort : "date desc"
  ) as SortSelected;
  const bypassCache = url.searchParams.get("fresh") === "1";

  return {
    after,
    before,
    query,
    selectedView,
    paymentStatus,
    fulfillmentStatus,
    sortSelected,
    bypassCache,
  };
}

export async function loadSalesOrdersPage(
  admin: AdminGraphql,
  shop: string,
  params: ReturnType<typeof parseSalesOrdersSearchParams>,
  templateId: string = DEFAULT_SALES_ORDER_TEMPLATE_ID,
): Promise<SalesOrdersPage> {
  const sortConfig = SORT_OPTIONS[params.sortSelected];
  const availableViews = SALES_ORDER_VIEWS.map((_, index) => index);
  const selectedView =
    params.selectedView >= 0 && params.selectedView < SALES_ORDER_VIEWS.length
      ? params.selectedView
      : 0;
  const viewQuery = SALES_ORDER_VIEWS[selectedView]?.query ?? "";
  const isInvoicedView = viewQuery === INVOICED_VIEW_QUERY;

  const emptyPage = (): SalesOrdersPage => ({
    orders: [],
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
    query: params.query,
    selectedView,
    availableViews,
    paymentStatus: params.paymentStatus,
    fulfillmentStatus: params.fulfillmentStatus,
    sortSelected: params.sortSelected,
  });

  let shopifyViewQuery: string = isInvoicedView ? "" : viewQuery;
  if (isInvoicedView) {
    const invoicedGids = await getAllInvoicedOrderGids(shop);
    if (invoicedGids.length === 0) return emptyPage();
    shopifyViewQuery = invoicedGids
      .map((gid) => {
        const numericId = orderGidToNumericId(gid);
        return numericId ? `id:${numericId}` : "";
      })
      .filter(Boolean)
      .join(" OR ");
  }

  const textSearch = params.query.trim()
    ? await buildSalesOrdersTextSearch(admin, shop, templateId, params.query)
    : "";

  const orderQuery = [
    textSearch,
    shopifyViewQuery,
    params.paymentStatus ? `financial_status:${params.paymentStatus}` : "",
    params.fulfillmentStatus
      ? `fulfillment_status:${params.fulfillmentStatus}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cacheKey = [
    shop,
    templateId,
    params.after ?? "",
    params.before ?? "",
    isInvoicedView ? INVOICED_VIEW_QUERY : "",
    orderQuery,
    params.sortSelected,
  ].join("|");

  const now = Date.now();
  if (!params.bypassCache) {
    const cached = listCache.get(cacheKey);
    if (cached && cached.expires > now) {
      return {
        ...cached.data,
        selectedView,
        availableViews,
      };
    }
  }

  const isPreviousPage = Boolean(params.before);
  const response = await admin.graphql(SALES_ORDERS_QUERY, {
    variables: {
      first: isPreviousPage ? undefined : PAGE_SIZE,
      after: isPreviousPage ? undefined : params.after,
      last: isPreviousPage ? PAGE_SIZE : undefined,
      before: isPreviousPage ? params.before : undefined,
      query: orderQuery || undefined,
      sortKey: sortConfig.sortKey,
      reverse: sortConfig.reverse,
    },
  });

  const result = (await response.json()) as OrdersResponse;

  if (!result.data?.orders) {
    const message =
      result.errors?.map((error) => error.message).join(", ") ||
      "Shopify orders could not be loaded.";
    throw new Response(message, { status: 502 });
  }

  const nodes = result.data.orders.nodes;
  const orderGids = nodes.map((order) => order.id);
  const [documentNumbers, invoicedMeta, packingSlipGids] =
    orderGids.length === 0
      ? [
          new Map<string, string>(),
          new Map<
            string,
            { invoicedAt: Date; documentNumber: string | null; sequence: number | null }
          >(),
          new Set<string>(),
        ]
      : await Promise.all([
          getSalesOrderDocumentNumbersByOrderGids(
            shop,
            templateId,
            orderGids,
          ),
          getInvoicedMetaByOrderGids(shop, orderGids),
          getPackingSlipOrderGids(shop, orderGids),
        ]);

  const invoicedGidsNeedingNumbers = orderGids.filter((gid) => {
    const meta = invoicedMeta.get(gid);
    return Boolean(meta) && !meta?.documentNumber;
  });
  const ensuredInvoiceNumbers =
    invoicedGidsNeedingNumbers.length > 0
      ? await ensureInvoiceDocumentNumbers(shop, invoicedGidsNeedingNumbers)
      : new Map<string, string>();

  const data: SalesOrdersPage = {
    orders: nodes.map((order) => {
      const meta = invoicedMeta.get(order.id) ?? null;
      const invoiceNumber =
        meta?.documentNumber ||
        ensuredInvoiceNumbers.get(order.id) ||
        "";
      return toRow(
        order,
        documentNumbers.get(order.id) ?? null,
        isInvoicedView ? true : Boolean(meta),
        packingSlipGids.has(order.id),
        meta?.invoicedAt ?? null,
        invoiceNumber,
      );
    }),
    pageInfo: result.data.orders.pageInfo,
    query: params.query,
    selectedView,
    availableViews,
    paymentStatus: params.paymentStatus,
    fulfillmentStatus: params.fulfillmentStatus,
    sortSelected: params.sortSelected,
  };

  listCache.set(cacheKey, { expires: now + CACHE_TTL_MS, data });
  pruneCache(now);
  return data;
}

export function invalidateSalesOrdersCache(shop?: string) {
  if (!shop) {
    listCache.clear();
    availabilityCache.clear();
    return;
  }
  for (const key of listCache.keys()) {
    if (key.startsWith(`${shop}|`)) listCache.delete(key);
  }
  availabilityCache.delete(shop);
}
