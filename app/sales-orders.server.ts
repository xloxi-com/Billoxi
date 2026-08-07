import {
  getSalesOrderDocumentNumbersByOrderGids,
} from "./sales-order-number.server";
import {
  getAllInvoicedOrderGids,
  getInvoicedMetaByOrderGids,
} from "./order-invoice-status.server";
import { getPackingSlipOrderGids, getAllPackingSlipOrderGids, getPackingSlipMetaByOrderGids, ensurePackingSlipDocumentNumbers, type PackingSlipOrderMeta } from "./order-packing-slip-status.server";
import {
  ensureCreditNoteDocumentNumbers,
  getAllCreditNoteOrderGids,
  getCreditNoteMetaByOrderGids,
  getCreditNoteOrderGids,
  type CreditNoteOrderMeta,
} from "./order-credit-note-status.server";
import { DEFAULT_SALES_ORDER_TEMPLATE_ID } from "./sales-order-document";
import {
  INVOICED_VIEW_QUERY,
  SALES_ORDER_VIEWS,
} from "./sales-orders";
import prisma from "./db.server";

const PAGE_SIZE = 25;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 80;
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
  packingSlipNumber: string;
  creditNote: boolean;
  creditNoteNumber: string;
  creditNoteAt: string | null;
  creditNoteReason: string;
  creditNoteVoided: boolean;
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

const SALES_ORDERS_BY_IDS_QUERY = `#graphql
  query SalesOrdersByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
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

const INVOICE_NODES_CHUNK = 50;
const MAX_INVOICED_FETCH = 100;

function escapeSearchTerm(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quoteSearchTerm(value: string) {
  return `"${escapeSearchTerm(value)}"`;
}

function orderGidToNumericId(gid: string) {
  return gid.includes("/") ? gid.split("/").pop() || "" : gid;
}

type OrdersByIdsResponse = {
  data?: {
    nodes?: Array<RawSalesOrder | null>;
  };
  errors?: Array<{ message: string }>;
};

/** Fetch orders by GID via `nodes(ids:)` — reliable vs search `id: OR id:`. */
async function loadOrdersByGids(
  admin: AdminGraphql,
  gids: string[],
): Promise<RawSalesOrder[]> {
  if (gids.length === 0) return [];

  const byId = new Map<string, RawSalesOrder>();
  const chunks: string[][] = [];
  for (let i = 0; i < gids.length; i += INVOICE_NODES_CHUNK) {
    chunks.push(gids.slice(i, i + INVOICE_NODES_CHUNK));
  }

  const CHUNK_CONCURRENCY = 3;
  let nextChunk = 0;
  async function worker() {
    while (nextChunk < chunks.length) {
      const index = nextChunk;
      nextChunk += 1;
      const chunk = chunks[index]!;
      const response = await admin.graphql(SALES_ORDERS_BY_IDS_QUERY, {
        variables: { ids: chunk },
      });
      const result = (await response.json()) as OrdersByIdsResponse;
      if (result.errors?.length && !result.data?.nodes) {
        throw new Response(
          result.errors.map((error) => error.message).join(", ") ||
            "Shopify orders could not be loaded.",
          { status: 502 },
        );
      }
      for (const node of result.data?.nodes ?? []) {
        if (node?.id) byId.set(node.id, node);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CHUNK_CONCURRENCY, chunks.length) },
      () => worker(),
    ),
  );

  return gids
    .map((gid) => byId.get(gid))
    .filter((order): order is RawSalesOrder => Boolean(order));
}

function paginateItems<T extends { id: string }>(
  items: T[],
  after: string | null,
  before: string | null,
): {
  pageItems: T[];
  pageInfo: SalesOrdersPage["pageInfo"];
} {
  let start = 0;
  let end = items.length;

  if (after) {
    const idx = items.findIndex((item) => item.id === after);
    start = idx >= 0 ? idx + 1 : 0;
  }
  if (before) {
    const idx = items.findIndex((item) => item.id === before);
    end = idx >= 0 ? idx : items.length;
  }

  const window = items.slice(start, end);
  let pageItems: T[];
  let pageStart: number;

  if (before && !after) {
    pageItems = window.slice(-PAGE_SIZE);
    pageStart = start + Math.max(0, window.length - PAGE_SIZE);
  } else {
    pageItems = window.slice(0, PAGE_SIZE);
    pageStart = start;
  }

  return {
    pageItems,
    pageInfo: {
      hasNextPage: pageStart + pageItems.length < items.length,
      hasPreviousPage: pageStart > 0,
      startCursor: pageItems[0]?.id ?? null,
      endCursor: pageItems[pageItems.length - 1]?.id ?? null,
    },
  };
}

function sortRawOrders(
  orders: RawSalesOrder[],
  sortSelected: SortSelected,
  invoicedAtByGid: Map<string, number>,
): RawSalesOrder[] {
  const sorted = [...orders];
  const reverse = SORT_OPTIONS[sortSelected].reverse;

  sorted.sort((a, b) => {
    switch (sortSelected) {
      case "order asc":
      case "order desc": {
        const aName = Number((a.name || "").replace(/\D/g, "")) || 0;
        const bName = Number((b.name || "").replace(/\D/g, "")) || 0;
        return (aName - bName) * (reverse ? -1 : 1);
      }
      case "customer asc":
      case "customer desc": {
        const aName = (a.customer?.displayName || "").toLowerCase();
        const bName = (b.customer?.displayName || "").toLowerCase();
        return aName.localeCompare(bName) * (reverse ? -1 : 1);
      }
      case "total asc":
      case "total desc": {
        const aTotal = Number(a.currentTotalPriceSet.shopMoney.amount) || 0;
        const bTotal = Number(b.currentTotalPriceSet.shopMoney.amount) || 0;
        return (aTotal - bTotal) * (reverse ? -1 : 1);
      }
      case "date asc":
      case "date desc":
      default: {
        const aInv = invoicedAtByGid.get(a.id);
        const bInv = invoicedAtByGid.get(b.id);
        if (aInv != null && bInv != null && aInv !== bInv) {
          return (aInv - bInv) * (sortSelected === "date asc" ? 1 : -1);
        }
        const aTime = new Date(a.createdAt).getTime() || 0;
        const bTime = new Date(b.createdAt).getTime() || 0;
        return (aTime - bTime) * (sortSelected === "date asc" ? 1 : -1);
      }
    }
  });

  return sorted;
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
  /** Invoice / credit-note / packing-slip list: show document date instead of order createdAt. */
  useDocumentDate = false,
  _invoiceCreatedAt: Date | null = null,
  creditNote = false,
  creditNoteNumber = "",
  creditNoteAt: Date | null = null,
  creditNoteReason = "",
  creditNoteVoided = false,
  packingSlipNumber = "",
  packingSlipAt: Date | null = null,
): SalesOrderRow {
  const payment = paymentBadge(order.displayFinancialStatus);
  const fulfillment = fulfillmentBadge(order.displayFulfillmentStatus);
  const documentDate =
    useDocumentDate && creditNote && creditNoteAt
      ? creditNoteAt
      : useDocumentDate && packingSlip && packingSlipAt
        ? packingSlipAt
        : useDocumentDate && invoicedAt
          ? invoicedAt
          : null;
  const displayDateIso = documentDate
    ? documentDate.toISOString()
    : order.createdAt;
  return {
    id: order.id,
    name: order.name,
    salesOrderNumber: salesOrderNumber?.trim() || "",
    date: formatDate(displayDateIso),
    createdAt: order.createdAt,
    company: resolveCompany(order),
    customer: order.customer?.displayName || "Guest customer",
    email: order.email?.trim() || "",
    total: formatMoney(order.currentTotalPriceSet.shopMoney),
    balanceDue: formatMoney(resolveBalanceDue(order)),
    invoiced,
    packingSlip,
    packingSlipNumber: packingSlipNumber.trim(),
    creditNote,
    creditNoteNumber: creditNoteNumber.trim(),
    creditNoteAt: creditNoteAt ? creditNoteAt.toISOString() : null,
    creditNoteReason: creditNoteReason.trim(),
    creditNoteVoided,
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
  options?: { listFilter?: "invoiced" | "credit-note" | "packing-slip" },
): Promise<SalesOrdersPage> {
  const sortConfig = SORT_OPTIONS[params.sortSelected];
  const availableViews = SALES_ORDER_VIEWS.map((_, index) => index);
  const selectedView =
    params.selectedView >= 0 && params.selectedView < SALES_ORDER_VIEWS.length
      ? params.selectedView
      : 0;
  const viewQuery = SALES_ORDER_VIEWS[selectedView]?.query ?? "";
  const isInvoicedView =
    options?.listFilter === "invoiced" || viewQuery === INVOICED_VIEW_QUERY;
  const isCreditNoteView = options?.listFilter === "credit-note";
  const isPackingSlipView = options?.listFilter === "packing-slip";

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

  const cacheKeyBase = [
    shop,
    templateId,
    params.after ?? "",
    params.before ?? "",
    isPackingSlipView
      ? "packing-slip"
      : isCreditNoteView
        ? "credit-note"
        : isInvoicedView
          ? INVOICED_VIEW_QUERY
          : viewQuery,
    params.query,
    params.paymentStatus,
    params.fulfillmentStatus,
    params.sortSelected,
  ].join("|");

  const now = Date.now();
  if (!params.bypassCache) {
    const cached = listCache.get(cacheKeyBase);
    if (cached && cached.expires > now) {
      return {
        ...cached.data,
        selectedView,
        availableViews,
      };
    }
  }

  const buildPage = async (
    nodes: RawSalesOrder[],
    pageInfo: SalesOrdersPage["pageInfo"],
    forceInvoiced: boolean,
    forceCreditNote = false,
    forcePackingSlip = false,
  ): Promise<SalesOrdersPage> => {
    const orderGids = nodes.map((order) => order.id);
    const [
      documentNumbers,
      invoicedMeta,
      packingSlipGids,
      packingSlipMeta,
      creditNoteGids,
      creditNoteMeta,
    ] =
      orderGids.length === 0
        ? [
            new Map<string, string>(),
            new Map<
              string,
              {
                invoicedAt: Date;
                createdAt: Date;
                updatedAt: Date;
                documentNumber: string | null;
                sequence: number | null;
                customerNote: string | null;
                terms: string | null;
              }
            >(),
            new Set<string>(),
            new Map<string, PackingSlipOrderMeta>(),
            new Set<string>(),
            new Map<string, CreditNoteOrderMeta>(),
          ]
        : await Promise.all([
            getSalesOrderDocumentNumbersByOrderGids(
              shop,
              templateId,
              orderGids,
            ),
            getInvoicedMetaByOrderGids(shop, orderGids),
            getPackingSlipOrderGids(shop, orderGids),
            forcePackingSlip
              ? getPackingSlipMetaByOrderGids(shop, orderGids)
              : Promise.resolve(new Map<string, PackingSlipOrderMeta>()),
            getCreditNoteOrderGids(shop, orderGids),
            getCreditNoteMetaByOrderGids(shop, orderGids),
          ]);

    // Keep list reads cheap under load — do not allocate/write SO numbers here.
    // Install sync + detail/export loaders assign missing numbers.
    // (Same policy as invoice numbers below.)

    // List reads must stay cheap under load — do not allocate/write invoice
    // numbers here. Detail + export loaders still call ensureInvoiceDocumentNumbers.
    const ensuredInvoiceNumbers = new Map<string, string>();

    // Credit note list: backfill missing CN- numbers so the document column
    // never falls back to the invoice number.
    const ensuredCreditNoteNumbers = forceCreditNote
      ? await ensureCreditNoteDocumentNumbers(shop, orderGids)
      : new Map<string, string>();

    // Packing slip list: backfill missing PS- numbers.
    const ensuredPackingSlipNumbers = forcePackingSlip
      ? await ensurePackingSlipDocumentNumbers(shop, orderGids)
      : new Map<string, string>();

    return {
      orders: nodes.map((order) => {
        const meta = invoicedMeta.get(order.id) ?? null;
        const cnMeta = creditNoteMeta.get(order.id) ?? null;
        const psMeta = packingSlipMeta.get(order.id) ?? null;
        const invoiceNumber =
          meta?.documentNumber ||
          ensuredInvoiceNumbers.get(order.id) ||
          "";
        const isCreditNote =
          forceCreditNote || creditNoteGids.has(order.id) || Boolean(cnMeta);
        const creditNoteNumber =
          cnMeta?.documentNumber ||
          ensuredCreditNoteNumbers.get(order.id) ||
          "";
        const hasPackingSlip =
          forcePackingSlip ||
          packingSlipGids.has(order.id) ||
          Boolean(psMeta);
        const packingSlipNumber =
          psMeta?.documentNumber ||
          ensuredPackingSlipNumbers.get(order.id) ||
          "";
        return toRow(
          order,
          documentNumbers.get(order.id) ?? null,
          forceInvoiced || Boolean(meta),
          hasPackingSlip,
          meta?.invoicedAt ?? null,
          invoiceNumber,
          forceInvoiced || forceCreditNote || forcePackingSlip,
          meta?.createdAt ?? meta?.invoicedAt ?? null,
          isCreditNote,
          creditNoteNumber,
          cnMeta?.convertedAt ?? null,
          cnMeta?.reason || "",
          Boolean(cnMeta?.voidedAt),
          packingSlipNumber,
          psMeta?.convertedAt ?? null,
        );
      }),
      pageInfo,
      query: params.query,
      selectedView,
      availableViews,
      paymentStatus: params.paymentStatus,
      fulfillmentStatus: params.fulfillmentStatus,
      sortSelected: params.sortSelected,
    };
  };

  const filterAndPaginateDocumentOrders = async (
    sourceGids: string[],
    metaForSort: Map<string, { sortAt: number; searchNumber?: string }>,
    forceInvoiced: boolean,
    forceCreditNote: boolean,
    forcePackingSlip = false,
  ) => {
    if (sourceGids.length === 0) return emptyPage();

    const gidsToFetch = sourceGids.slice(0, MAX_INVOICED_FETCH);
    let orders = await loadOrdersByGids(admin, gidsToFetch);

    if (params.paymentStatus) {
      const wanted = params.paymentStatus.toUpperCase();
      const unpaidStatuses = new Set([
        "PENDING",
        "AUTHORIZED",
        "PARTIALLY_PAID",
        "EXPIRED",
      ]);
      orders = orders.filter((order) => {
        const status = (order.displayFinancialStatus || "").toUpperCase();
        if (wanted === "UNPAID") return unpaidStatuses.has(status);
        return status === wanted;
      });
    }
    if (params.fulfillmentStatus) {
      const wanted = params.fulfillmentStatus.toUpperCase();
      orders = orders.filter((order) => {
        const status = (order.displayFulfillmentStatus || "").toUpperCase();
        if (wanted === "PARTIAL" || wanted === "PARTIALLY_FULFILLED") {
          return status === "PARTIALLY_FULFILLED";
        }
        return status === wanted;
      });
    }
    if (params.query.trim()) {
      const q = params.query.trim().toLowerCase();
      const qCompact = q.replace(/\s+/g, "");
      const soGids = new Set(
        await findOrderGidsBySalesOrderNumber(shop, templateId, params.query),
      );
      orders = orders.filter((order) => {
        if (soGids.has(order.id)) return true;
        const meta = metaForSort.get(order.id);
        const docNumber = (meta?.searchNumber || "").toLowerCase();
        const haystack = [
          order.name,
          order.email,
          order.customer?.displayName,
          resolveCompany(order),
          docNumber,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return (
          haystack.includes(q) ||
          docNumber.replace(/\s+/g, "").includes(qCompact)
        );
      });
    }

    const sortSelected =
      params.sortSelected in SORT_OPTIONS
        ? params.sortSelected
        : ("date desc" as SortSelected);
    const dateByGid = new Map<string, number>();
    for (const [gid, meta] of metaForSort) {
      dateByGid.set(gid, meta.sortAt);
    }
    orders = sortRawOrders(orders, sortSelected, dateByGid);
    const { pageItems, pageInfo } = paginateItems(
      orders,
      params.after,
      params.before,
    );
    const data = await buildPage(
      pageItems,
      pageInfo,
      forceInvoiced,
      forceCreditNote,
      forcePackingSlip,
    );
    listCache.set(cacheKeyBase, { expires: now + CACHE_TTL_MS, data });
    pruneCache(now);
    return data;
  };

  // Credit note list: fetch by GID via nodes().
  if (isCreditNoteView) {
    const creditNoteGids = await getAllCreditNoteOrderGids(shop);
    const meta = await getCreditNoteMetaByOrderGids(shop, creditNoteGids);
    const metaForSort = new Map<
      string,
      { sortAt: number; searchNumber?: string }
    >();
    for (const [gid, row] of meta) {
      metaForSort.set(gid, {
        sortAt: row.convertedAt?.getTime() ?? row.createdAt?.getTime() ?? 0,
        searchNumber: row.documentNumber || undefined,
      });
    }
    return filterAndPaginateDocumentOrders(
      creditNoteGids,
      metaForSort,
      false,
      true,
    );
  }

  // Packing slip list: fetch by GID via nodes().
  if (isPackingSlipView) {
    const packingGids = await getAllPackingSlipOrderGids(shop);
    const meta = await getPackingSlipMetaByOrderGids(shop, packingGids);
    const metaForSort = new Map<
      string,
      { sortAt: number; searchNumber?: string }
    >();
    for (const [gid, row] of meta) {
      metaForSort.set(gid, {
        sortAt: row.convertedAt?.getTime() ?? row.createdAt?.getTime() ?? 0,
        searchNumber: row.documentNumber || undefined,
      });
    }
    return filterAndPaginateDocumentOrders(
      packingGids,
      metaForSort,
      false,
      false,
      true,
    );
  }

  // Invoice list: fetch by GID via nodes() — Shopify search `id: OR id:` drops rows.
  if (isInvoicedView) {
    const invoicedGids = await getAllInvoicedOrderGids(shop);
    const metaForSortRaw = await getInvoicedMetaByOrderGids(shop, invoicedGids);
    const metaForSort = new Map<
      string,
      { sortAt: number; searchNumber?: string }
    >();
    for (const [gid, row] of metaForSortRaw) {
      metaForSort.set(gid, {
        sortAt: row.invoicedAt?.getTime() ?? row.createdAt?.getTime() ?? 0,
        searchNumber: row.documentNumber || undefined,
      });
    }
    return filterAndPaginateDocumentOrders(
      invoicedGids,
      metaForSort,
      true,
      false,
    );
  }

  const textSearch = params.query.trim()
    ? await buildSalesOrdersTextSearch(admin, shop, templateId, params.query)
    : "";

  const orderQuery = [
    textSearch,
    viewQuery,
    params.paymentStatus ? `financial_status:${params.paymentStatus}` : "",
    params.fulfillmentStatus
      ? `fulfillment_status:${params.fulfillmentStatus}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

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

  const data = await buildPage(
    result.data.orders.nodes,
    result.data.orders.pageInfo,
    false,
  );
  listCache.set(cacheKeyBase, { expires: now + CACHE_TTL_MS, data });
  pruneCache(now);
  return data;
}

export function invalidateSalesOrdersCache(shop?: string) {
  if (!shop) {
    listCache.clear();
    return;
  }
  for (const key of listCache.keys()) {
    if (key.startsWith(`${shop}|`)) listCache.delete(key);
  }
}
