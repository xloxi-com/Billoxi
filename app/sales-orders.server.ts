import {
  ensureSalesOrderDocumentNumbers,
  getSalesOrderDocumentNumbersByOrderGids,
  hasCompletedSalesOrderNumberSync,
  waitForSalesOrderNumberSync,
} from "./sales-order-number.server";
import { syncSalesOrderNumbersForShop } from "./sales-order-number-sync.server";
import {
  getAllInvoicedMeta,
  getAllInvoicedOrderGids,
  getInvoicedMetaByOrderGids,
  getInvoicedOrderGids,
} from "./order-invoice-status.server";
import { getPackingSlipOrderGids, getAllPackingSlipOrderGids, getAllPackingSlipMeta, getPackingSlipMetaByOrderGids, ensurePackingSlipDocumentNumbers, type PackingSlipOrderMeta } from "./order-packing-slip-status.server";
import {
  ensureReturnDocumentNumbers,
  getAllReturnMeta,
  getAllReturnOrderGids,
  getReturnMetaByOrderGids,
  getReturnOrderGids,
  type ReturnOrderMeta,
} from "./order-return-status.server";
import {
  hasReturnOrderNumbersSynced,
  syncReturnOrderNumbersForShop,
} from "./return-order-number-sync.server";
import {
  hasInvoiceOrderNumbersSynced,
  syncInvoiceOrderNumbersForShop,
} from "./invoice-order-number-sync.server";
import {
  ensureDraftDocumentNumbers,
  getAllDraftMeta,
  getDraftMetaByOrderGids,
  getDraftOrderGids,
  type DraftOrderMeta,
} from "./order-invoice-draft-status.server";
import {
  ensureCreditNoteDocumentNumbers,
  getAllCreditNoteMeta,
  getAllCreditNoteOrderGids,
  getCreditNoteMetaByOrderGids,
  getCreditNoteOrderGids,
  type CreditNoteOrderMeta,
} from "./order-credit-note-status.server";
import { getDocumentActionFlagsByOrderGids } from "./document-event-log.server";
import { DEFAULT_SALES_ORDER_TEMPLATE_ID } from "./sales-order-ids";
import {
  INVOICED_VIEW_QUERY,
  SALES_ORDER_VIEWS,
} from "./sales-orders";
import prisma from "./db.server";

const PAGE_SIZE = 25;
/** Keep list hot while browsing Admin — invalidate on convert/delete/update. */
const CACHE_TTL_MS = 300_000;
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
  "reference asc": { sortKey: "ORDER_NUMBER", reverse: false },
  "reference desc": { sortKey: "ORDER_NUMBER", reverse: true },
  "customer asc": { sortKey: "CUSTOMER_NAME", reverse: false },
  "customer desc": { sortKey: "CUSTOMER_NAME", reverse: true },
  "date asc": { sortKey: "CREATED_AT", reverse: false },
  "date desc": { sortKey: "CREATED_AT", reverse: true },
  "total asc": { sortKey: "CURRENT_TOTAL_PRICE", reverse: false },
  "total desc": { sortKey: "CURRENT_TOTAL_PRICE", reverse: true },
  "balance asc": { sortKey: "CURRENT_TOTAL_PRICE", reverse: false },
  "balance desc": { sortKey: "CURRENT_TOTAL_PRICE", reverse: true },
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
    companyContactProfiles?: Array<{
      company?: { name?: string | null } | null;
    } | null> | null;
  } | null;
  purchasingEntity?: {
    company?: { name?: string | null } | null;
  } | null;
  billingAddress?: { company?: string | null } | null;
  shippingAddress?: { company?: string | null } | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentTotalPriceSet: { shopMoney: Money };
  /** Original order total — stays unchanged after refunds. */
  totalPriceSet?: { shopMoney: Money } | null;
  totalRefundedSet?: { shopMoney: Money } | null;
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
  returnSlip: boolean;
  returnNumber: string;
  returnedAt: string | null;
  draft: boolean;
  draftNumber: string;
  draftedAt: string | null;
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
  printed: boolean;
  downloaded: boolean;
  emailed: boolean;
};

export type DocumentFlagFilter = "" | "yes" | "no";

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
  invoicedFilter?: DocumentFlagFilter;
  packingSlipFilter?: DocumentFlagFilter;
  returnFilter?: DocumentFlagFilter;
  creditNoteFilter?: DocumentFlagFilter;
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

/** Latest store-wide order touch — used to skip full list reloads when idle. */
const listWatermarkByShop = new Map<string, string>();

const ORDERS_WATERMARK_QUERY = `#graphql
  query SalesOrdersWatermark {
    orders(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        updatedAt
      }
    }
  }
`;

async function readOrdersWatermark(admin: AdminGraphql): Promise<string> {
  try {
    const response = await admin.graphql(ORDERS_WATERMARK_QUERY);
    const json = (await response.json()) as {
      data?: {
        orders?: { nodes?: Array<{ id?: string; updatedAt?: string } | null> };
      };
    };
    const node = json.data?.orders?.nodes?.[0];
    if (!node?.id) return "empty";
    return `${node.id}:${node.updatedAt || ""}`;
  } catch {
    return `error:${Date.now()}`;
  }
}

/**
 * Cheap poll helper: true when orders may have changed since the last list load.
 * Unknown watermark → true (force refresh).
 */
export async function salesOrdersListMayHaveChanged(
  admin: AdminGraphql,
  shop: string,
): Promise<boolean> {
  const previous = listWatermarkByShop.get(shop);
  const next = await readOrdersWatermark(admin);
  listWatermarkByShop.set(shop, next);
  if (!previous) return true;
  return previous !== next;
}

export async function rememberSalesOrdersWatermark(
  admin: AdminGraphql,
  shop: string,
): Promise<void> {
  listWatermarkByShop.set(shop, await readOrdersWatermark(admin));
}

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
          companyContactProfiles {
            company {
              name
            }
          }
        }
        purchasingEntity {
          ... on PurchasingCompany {
            company {
              name
            }
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
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalRefundedSet {
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
          companyContactProfiles {
            company {
              name
            }
          }
        }
        purchasingEntity {
          ... on PurchasingCompany {
            company {
              name
            }
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
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalRefundedSet {
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

function numericDocRank(value: string): number {
  return Number((value || "").replace(/\D/g, "")) || 0;
}

function sortRawOrders(
  orders: RawSalesOrder[],
  sortSelected: SortSelected,
  invoicedAtByGid: Map<string, number>,
  extras?: {
    documentNumberByGid?: Map<string, string>;
    referenceByGid?: Map<string, string>;
  },
): RawSalesOrder[] {
  const sorted = [...orders];
  const reverse = SORT_OPTIONS[sortSelected].reverse;
  const dir = reverse ? -1 : 1;

  sorted.sort((a, b) => {
    switch (sortSelected) {
      case "order asc":
      case "order desc": {
        const aName = numericDocRank(
          extras?.documentNumberByGid?.get(a.id) || a.name || "",
        );
        const bName = numericDocRank(
          extras?.documentNumberByGid?.get(b.id) || b.name || "",
        );
        return (aName - bName) * dir;
      }
      case "reference asc":
      case "reference desc": {
        const aRef = extras?.referenceByGid?.get(a.id) || a.name || "";
        const bRef = extras?.referenceByGid?.get(b.id) || b.name || "";
        const aNum = numericDocRank(aRef);
        const bNum = numericDocRank(bRef);
        if (aNum !== bNum) return (aNum - bNum) * dir;
        return aRef.localeCompare(bRef) * dir;
      }
      case "customer asc":
      case "customer desc": {
        const aName = (a.customer?.displayName || "").toLowerCase();
        const bName = (b.customer?.displayName || "").toLowerCase();
        return aName.localeCompare(bName) * dir;
      }
      case "total asc":
      case "total desc": {
        const aTotal =
          Number(
            (a.totalPriceSet?.shopMoney ?? a.currentTotalPriceSet.shopMoney)
              .amount,
          ) || 0;
        const bTotal =
          Number(
            (b.totalPriceSet?.shopMoney ?? b.currentTotalPriceSet.shopMoney)
              .amount,
          ) || 0;
        return (aTotal - bTotal) * dir;
      }
      case "balance asc":
      case "balance desc": {
        const aBal = Number(resolveBalanceDue(a).amount) || 0;
        const bBal = Number(resolveBalanceDue(b).amount) || 0;
        return (aBal - bBal) * dir;
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
  const fromOrder = order.purchasingEntity?.company?.name?.trim() || "";
  if (fromOrder) return fromOrder;

  for (const profile of order.customer?.companyContactProfiles ?? []) {
    const name = profile?.company?.name?.trim() || "";
    if (name) return name;
  }

  const fromBilling = order.billingAddress?.company?.trim() || "";
  if (fromBilling) return fromBilling;

  const fromShipping = order.shippingAddress?.company?.trim() || "";
  if (fromShipping) return fromShipping;

  const fromDefault = order.customer?.defaultAddress?.company?.trim() || "";
  if (fromDefault) return fromDefault;

  return "—";
}

function resolveBalanceDue(order: RawSalesOrder): Money {
  const listTotalMoney =
    order.totalPriceSet?.shopMoney ?? order.currentTotalPriceSet.shopMoney;
  const currencyCode = listTotalMoney.currencyCode || "USD";
  const total = Number(listTotalMoney.amount) || 0;
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

function orderListTotalMoney(order: RawSalesOrder): Money {
  return order.totalPriceSet?.shopMoney ?? order.currentTotalPriceSet.shopMoney;
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
  /** Credit note index: Amount column = Credit Total (refunded), not order total. */
  useCreditNoteAmount = false,
  draft = false,
  draftNumber = "",
  draftedAt: Date | null = null,
  returnSlip = false,
  returnNumber = "",
  returnedAt: Date | null = null,
): SalesOrderRow {
  const payment = paymentBadge(order.displayFinancialStatus);
  const fulfillment = fulfillmentBadge(order.displayFulfillmentStatus);
  const documentDate =
    useDocumentDate && creditNote && creditNoteAt
      ? creditNoteAt
      : useDocumentDate && packingSlip && packingSlipAt
        ? packingSlipAt
        : useDocumentDate && returnSlip && returnedAt
          ? returnedAt
          : useDocumentDate && draft && draftedAt
            ? draftedAt
            : useDocumentDate && invoicedAt
              ? invoicedAt
              : null;
  const displayDateIso = documentDate
    ? documentDate.toISOString()
    : order.createdAt;
  const creditTotalMoney = order.totalRefundedSet?.shopMoney;
  const creditTotalAmount = Number(creditTotalMoney?.amount ?? NaN);
  const listTotal =
    useCreditNoteAmount &&
    Number.isFinite(creditTotalAmount) &&
    creditTotalAmount > 0
      ? formatMoney(creditTotalMoney!)
      : formatMoney(orderListTotalMoney(order));
  return {
    id: order.id,
    name: order.name,
    salesOrderNumber: salesOrderNumber?.trim() || "",
    date: formatDate(displayDateIso),
    createdAt: order.createdAt,
    company: resolveCompany(order),
    customer: order.customer?.displayName || "Guest customer",
    email: order.email?.trim() || "",
    total: listTotal,
    balanceDue: formatMoney(resolveBalanceDue(order)),
    invoiced,
    packingSlip,
    packingSlipNumber: packingSlipNumber.trim(),
    returnSlip,
    returnNumber: returnNumber.trim(),
    returnedAt: returnedAt ? returnedAt.toISOString() : null,
    draft,
    draftNumber: draftNumber.trim(),
    draftedAt: draftedAt ? draftedAt.toISOString() : null,
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
    printed: false,
    downloaded: false,
    emailed: false,
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
  const invoicedFilter = parseDocumentFlagFilter(url.searchParams.get("invoiced"));
  const packingSlipFilter = parseDocumentFlagFilter(
    url.searchParams.get("packing"),
  );
  const returnFilter = parseDocumentFlagFilter(url.searchParams.get("return"));
  const creditNoteFilter = parseDocumentFlagFilter(url.searchParams.get("credit"));
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
    invoicedFilter,
    packingSlipFilter,
    returnFilter,
    creditNoteFilter,
    sortSelected,
    bypassCache,
  };
}

function parseDocumentFlagFilter(value: string | null): DocumentFlagFilter {
  return value === "yes" || value === "no" ? value : "";
}

function listDocumentKind(args: {
  invoiced?: boolean;
  creditNote?: boolean;
  packingSlip?: boolean;
  draft?: boolean;
  returnSlip?: boolean;
}): string {
  if (args.creditNote) return "credit-note";
  if (args.packingSlip) return "packing-slip";
  if (args.returnSlip) return "return";
  if (args.draft) return "draft";
  if (args.invoiced) return "invoice";
  return "sales-order";
}

async function withActionFlags(
  shop: string,
  data: SalesOrdersPage,
  documentKind: string,
): Promise<SalesOrdersPage> {
  const flags = await getDocumentActionFlagsByOrderGids(
    shop,
    data.orders.map((order) => order.id),
    documentKind,
  );
  if (flags.size === 0) return data;
  return {
    ...data,
    orders: data.orders.map((order) => {
      const flag = flags.get(order.id);
      if (!flag) return order;
      return {
        ...order,
        printed: flag.printed,
        downloaded: flag.downloaded,
        emailed: flag.sent,
      };
    }),
  };
}

function applyFlagToGids(
  source: string[],
  typedGids: string[],
  filter: DocumentFlagFilter,
): string[] {
  if (!filter) return source;
  const typed = new Set(typedGids);
  return filter === "yes"
    ? source.filter((id) => typed.has(id))
    : source.filter((id) => !typed.has(id));
}

export async function loadSalesOrdersPage(
  admin: AdminGraphql,
  shop: string,
  params: ReturnType<typeof parseSalesOrdersSearchParams>,
  templateId: string = DEFAULT_SALES_ORDER_TEMPLATE_ID,
  options?: {
    listFilter?: "invoiced" | "credit-note" | "packing-slip" | "return" | "draft";
  },
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
  const isReturnView = options?.listFilter === "return";
  const isDraftView = options?.listFilter === "draft";

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
    invoicedFilter: params.invoicedFilter,
    packingSlipFilter: params.packingSlipFilter,
    returnFilter: params.returnFilter,
    creditNoteFilter: params.creditNoteFilter,
  });

  const cacheKeyBase = [
    shop,
    templateId,
    params.after ?? "",
    params.before ?? "",
    isDraftView
      ? "draft"
      : isReturnView
        ? "return"
        : isPackingSlipView
          ? "packing-slip"
          : isCreditNoteView
            ? "credit-note"
            : isInvoicedView
              ? INVOICED_VIEW_QUERY
              : viewQuery,
    params.query,
    params.paymentStatus,
    params.fulfillmentStatus,
    params.invoicedFilter,
    params.packingSlipFilter,
    params.returnFilter,
    params.creditNoteFilter,
    params.sortSelected,
    "company-b2b-billing-v1",
  ].join("|");

  const now = Date.now();
  if (!params.bypassCache) {
    const cached = listCache.get(cacheKeyBase);
    if (cached && cached.expires > now) {
      // Sales Orders list: heal "—" gaps on cached pages (new orders / missed webhook).
      if (
        !isInvoicedView &&
        !isCreditNoteView &&
        !isPackingSlipView &&
        !isReturnView &&
        !isDraftView &&
        cached.data.orders.some(
          (order) => !String(order.salesOrderNumber || "").trim(),
        )
      ) {
        const missingGids = cached.data.orders
          .filter((order) => !String(order.salesOrderNumber || "").trim())
          .map((order) => order.id);
        if (missingGids.length > 0) {
          await waitForSalesOrderNumberSync(shop);
          const synced = await hasCompletedSalesOrderNumberSync(shop);
          if (synced) {
            const ensured = await ensureSalesOrderDocumentNumbers(
              shop,
              templateId,
              missingGids,
            );
            let changed = false;
            const orders = cached.data.orders.map((order) => {
              const next = ensured.get(order.id)?.trim();
              if (!next || order.salesOrderNumber === next) return order;
              changed = true;
              return { ...order, salesOrderNumber: next };
            });
            if (changed) {
              const data = { ...cached.data, orders };
              listCache.set(cacheKeyBase, {
                expires: now + CACHE_TTL_MS,
                data,
              });
              return { ...data, selectedView, availableViews };
            }
          }
        }
      }

      // Flags are stored on the cached page. Print/download/email bust this cache.
      return { ...cached.data, selectedView, availableViews };
    }
  }

  const hasDocumentFlagFilter = Boolean(
    params.invoicedFilter ||
      params.packingSlipFilter ||
      params.returnFilter ||
      params.creditNoteFilter,
  );

  const isPreviousPage = Boolean(params.before);
  let salesOrdersGraphqlPromise: Promise<Response> | null = null;
  if (
    !isInvoicedView &&
    !isCreditNoteView &&
    !isPackingSlipView &&
    !isReturnView &&
    !isDraftView &&
    !hasDocumentFlagFilter &&
    !params.query.trim()
  ) {
    const prefetchQuery = [
      viewQuery,
      params.paymentStatus ? `financial_status:${params.paymentStatus}` : "",
      params.fulfillmentStatus
        ? `fulfillment_status:${params.fulfillmentStatus}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    salesOrdersGraphqlPromise = admin.graphql(SALES_ORDERS_QUERY, {
      variables: {
        first: isPreviousPage ? undefined : PAGE_SIZE,
        after: isPreviousPage ? undefined : params.after,
        last: isPreviousPage ? PAGE_SIZE : undefined,
        before: isPreviousPage ? params.before : undefined,
        query: prefetchQuery || undefined,
        sortKey: sortConfig.sortKey,
        reverse: sortConfig.reverse,
      },
    });
  }

  // After DB reset / install: assign numbers on first list open (idempotent).
  // Runs only on cache miss so warm polls/navigations skip the sync-flag queries.
  // Overlaps Shopify GraphQL (kicked off above) with these DB flag checks.
  try {
    if (
      !isInvoicedView &&
      !isCreditNoteView &&
      !isPackingSlipView &&
      !isReturnView &&
      !isDraftView &&
      !(await hasCompletedSalesOrderNumberSync(shop))
    ) {
      await syncSalesOrderNumbersForShop(shop, admin);
    } else if (
      isInvoicedView &&
      !(await hasInvoiceOrderNumbersSynced(shop))
    ) {
      await syncInvoiceOrderNumbersForShop(shop, admin);
    } else if (
      isReturnView &&
      !(await hasReturnOrderNumbersSynced(shop))
    ) {
      await syncReturnOrderNumbersForShop(shop, admin);
    }
  } catch (error) {
    console.warn("[sales-orders] auto number sync failed:", shop, error);
  }

  const buildPage = async (
    nodes: RawSalesOrder[],
    pageInfo: SalesOrdersPage["pageInfo"],
    forceInvoiced: boolean,
    forceCreditNote = false,
    forcePackingSlip = false,
    forceDraft = false,
    forceReturn = false,
  ): Promise<SalesOrdersPage> => {
    const orderGids = nodes.map((order) => order.id);

    let documentNumbers = new Map<string, string>();
    let invoicedMeta = new Map<
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
    >();
    let packingSlipGids = new Set<string>();
    let packingSlipMeta = new Map<string, PackingSlipOrderMeta>();
    let returnGids = new Set<string>();
    let returnMeta = new Map<string, ReturnOrderMeta>();
    let creditNoteGids = new Set<string>();
    let creditNoteMeta = new Map<string, CreditNoteOrderMeta>();
    let draftGids = new Set<string>();
    let draftMeta = new Map<string, DraftOrderMeta>();

    if (orderGids.length > 0) {
      if (forceInvoiced) {
        const [soNumbers, invMeta, cnGids, cnMeta] = await Promise.all([
          getSalesOrderDocumentNumbersByOrderGids(shop, templateId, orderGids),
          getInvoicedMetaByOrderGids(shop, orderGids),
          getCreditNoteOrderGids(shop, orderGids),
          getCreditNoteMetaByOrderGids(shop, orderGids),
        ]);
        documentNumbers = soNumbers;
        invoicedMeta = invMeta;
        creditNoteGids = cnGids;
        creditNoteMeta = cnMeta;
      } else if (forceCreditNote) {
        const [soNumbers, invMeta, cnMeta] = await Promise.all([
          getSalesOrderDocumentNumbersByOrderGids(shop, templateId, orderGids),
          getInvoicedMetaByOrderGids(shop, orderGids),
          getCreditNoteMetaByOrderGids(shop, orderGids),
        ]);
        documentNumbers = soNumbers;
        invoicedMeta = invMeta;
        creditNoteMeta = cnMeta;
        creditNoteGids = new Set(cnMeta.keys());
      } else if (forcePackingSlip) {
        const [soNumbers, invMeta, packingMeta] = await Promise.all([
          getSalesOrderDocumentNumbersByOrderGids(shop, templateId, orderGids),
          getInvoicedMetaByOrderGids(shop, orderGids),
          getPackingSlipMetaByOrderGids(shop, orderGids),
        ]);
        documentNumbers = soNumbers;
        invoicedMeta = invMeta;
        packingSlipMeta = packingMeta;
        packingSlipGids = new Set(packingMeta.keys());
      } else if (forceReturn) {
        const [soNumbers, invMeta, retMeta] = await Promise.all([
          getSalesOrderDocumentNumbersByOrderGids(shop, templateId, orderGids),
          getInvoicedMetaByOrderGids(shop, orderGids),
          getReturnMetaByOrderGids(shop, orderGids),
        ]);
        documentNumbers = soNumbers;
        invoicedMeta = invMeta;
        returnMeta = retMeta;
        returnGids = new Set(retMeta.keys());
      } else if (forceDraft) {
        const [soNumbers, invMeta, drafts] = await Promise.all([
          getSalesOrderDocumentNumbersByOrderGids(shop, templateId, orderGids),
          getInvoicedMetaByOrderGids(shop, orderGids),
          getDraftMetaByOrderGids(shop, orderGids),
        ]);
        documentNumbers = soNumbers;
        invoicedMeta = invMeta;
        draftMeta = drafts;
        draftGids = new Set(drafts.keys());
      } else {
        // Sales Orders list: flags only — skip heavy meta / number writes.
        const [
          soNumbers,
          invoicedGids,
          packingGids,
          returnOrderGids,
          cnGids,
          draftOrderGids,
        ] = await Promise.all([
          getSalesOrderDocumentNumbersByOrderGids(shop, templateId, orderGids),
          getInvoicedOrderGids(shop, orderGids),
          getPackingSlipOrderGids(shop, orderGids),
          getReturnOrderGids(shop, orderGids),
          getCreditNoteOrderGids(shop, orderGids),
          getDraftOrderGids(shop, orderGids),
        ]);
        documentNumbers = soNumbers;
        packingSlipGids = packingGids;
        returnGids = returnOrderGids;
        creditNoteGids = cnGids;
        draftGids = draftOrderGids;
        for (const gid of invoicedGids) {
          invoicedMeta.set(gid, {
            invoicedAt: new Date(0),
            createdAt: new Date(0),
            updatedAt: new Date(0),
            documentNumber: null,
            sequence: null,
            customerNote: null,
            terms: null,
          });
        }
      }
    }

    // Do not invent historical numbers newest-first (list is date desc).
    // Before Sync: leave "—" — Settings Sync assigns oldest → newest (FS-0001…).
    // After Sync: only fill gaps, oldest-first among this page.
    if (
      !forceInvoiced &&
      !forceCreditNote &&
      !forcePackingSlip &&
      !forceReturn &&
      !forceDraft &&
      orderGids.length > 0
    ) {
      const missing = orderGids.filter(
        (gid) => !documentNumbers.get(gid)?.trim(),
      );
      if (missing.length > 0) {
        await waitForSalesOrderNumberSync(shop);
        const synced = await hasCompletedSalesOrderNumberSync(shop);
        if (synced) {
          const missingOldestFirst = nodes
            .filter((order) => missing.includes(order.id))
            .sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            )
            .map((order) => order.id);
          const ensured = await ensureSalesOrderDocumentNumbers(
            shop,
            templateId,
            missingOldestFirst,
          );
          for (const [gid, num] of ensured) {
            if (num?.trim()) documentNumbers.set(gid, num);
          }
        }
      }
    }

    const ensuredInvoiceNumbers = new Map<string, string>();

    // Credit note / packing slip / return / draft lists: never block navigation on allocate.
    // Missing numbers backfill in background; next load / detail shows them.
    let ensuredCreditNoteNumbers = new Map<string, string>();
    if (forceCreditNote && orderGids.length > 0) {
      const missing = orderGids.filter((gid) => {
        const num = creditNoteMeta.get(gid)?.documentNumber?.trim();
        return !num;
      });
      if (missing.length > 0) {
        void ensureCreditNoteDocumentNumbers(shop, missing).catch((error) => {
          console.error("Background credit-note number ensure failed:", error);
        });
      }
    }

    let ensuredPackingSlipNumbers = new Map<string, string>();
    if (forcePackingSlip && orderGids.length > 0) {
      const missing = orderGids.filter((gid) => {
        const num = packingSlipMeta.get(gid)?.documentNumber?.trim();
        return !num;
      });
      if (missing.length > 0) {
        void ensurePackingSlipDocumentNumbers(shop, missing).catch((error) => {
          console.error("Background packing-slip number ensure failed:", error);
        });
      }
    }

    let ensuredReturnNumbers = new Map<string, string>();
    // After Return sync: fill gaps. Auto-sync above runs first if needed.
    if (
      forceReturn &&
      orderGids.length > 0 &&
      (await hasReturnOrderNumbersSynced(shop))
    ) {
      const missing = orderGids.filter((gid) => {
        const num = returnMeta.get(gid)?.documentNumber?.trim();
        return !num;
      });
      if (missing.length > 0) {
        void ensureReturnDocumentNumbers(shop, missing).catch((error) => {
          console.error("Background return number ensure failed:", error);
        });
      }
    }

    let ensuredDraftNumbers = new Map<string, string>();
    if (forceDraft && orderGids.length > 0) {
      const missing = orderGids.filter((gid) => {
        const num = draftMeta.get(gid)?.documentNumber?.trim();
        return !num;
      });
      if (missing.length > 0) {
        void ensureDraftDocumentNumbers(shop, missing).catch((error) => {
          console.error("Background draft number ensure failed:", error);
        });
      }
    }

    const page: SalesOrdersPage = {
      orders: nodes.map((order) => {
        const meta = invoicedMeta.get(order.id) ?? null;
        const cnMeta = creditNoteMeta.get(order.id) ?? null;
        const psMeta = packingSlipMeta.get(order.id) ?? null;
        const retMeta = returnMeta.get(order.id) ?? null;
        const dMeta = draftMeta.get(order.id) ?? null;
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
        const hasReturn =
          forceReturn || returnGids.has(order.id) || Boolean(retMeta);
        const returnNumber =
          retMeta?.documentNumber ||
          ensuredReturnNumbers.get(order.id) ||
          "";
        const hasDraft =
          forceDraft || draftGids.has(order.id) || Boolean(dMeta);
        const draftNumber =
          dMeta?.documentNumber ||
          ensuredDraftNumbers.get(order.id) ||
          "";
        return toRow(
          order,
          documentNumbers.get(order.id) ?? null,
          forceInvoiced || Boolean(meta),
          hasPackingSlip,
          meta?.invoicedAt && meta.invoicedAt.getTime() > 0
            ? meta.invoicedAt
            : null,
          invoiceNumber,
          forceInvoiced ||
            forceCreditNote ||
            forcePackingSlip ||
            forceReturn ||
            forceDraft,
          meta?.createdAt && meta.createdAt.getTime() > 0
            ? meta.createdAt
            : meta?.invoicedAt && meta.invoicedAt.getTime() > 0
              ? meta.invoicedAt
              : null,
          isCreditNote,
          creditNoteNumber,
          cnMeta?.convertedAt ?? null,
          cnMeta?.reason || "",
          Boolean(cnMeta?.voidedAt),
          packingSlipNumber,
          psMeta?.convertedAt ?? null,
          forceCreditNote,
          hasDraft,
          draftNumber,
          dMeta?.draftedAt ?? null,
          hasReturn,
          returnNumber,
          retMeta?.convertedAt ?? null,
        );
      }),
      pageInfo,
      query: params.query,
      selectedView,
      availableViews,
      paymentStatus: params.paymentStatus,
      fulfillmentStatus: params.fulfillmentStatus,
      sortSelected: params.sortSelected,
      invoicedFilter: params.invoicedFilter,
      packingSlipFilter: params.packingSlipFilter,
      returnFilter: params.returnFilter,
      creditNoteFilter: params.creditNoteFilter,
    };
    return withActionFlags(
      shop,
      page,
      listDocumentKind({
        invoiced: forceInvoiced,
        creditNote: forceCreditNote,
        packingSlip: forcePackingSlip,
        draft: forceDraft,
        returnSlip: forceReturn,
      }),
    );
  };

  const filterAndPaginateDocumentOrders = async (
    sourceGids: string[],
    metaForSort: Map<string, { sortAt: number; searchNumber?: string }>,
    forceInvoiced: boolean,
    forceCreditNote: boolean,
    forcePackingSlip = false,
    forceDraft = false,
    forceReturn = false,
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
    const documentNumberByGid = new Map<string, string>();
    for (const [gid, meta] of metaForSort) {
      dateByGid.set(gid, meta.sortAt);
      if (meta.searchNumber) documentNumberByGid.set(gid, meta.searchNumber);
    }
    let referenceByGid: Map<string, string> | undefined;
    if (sortSelected === "reference asc" || sortSelected === "reference desc") {
      if (forceInvoiced || forceCreditNote) {
        referenceByGid = await getSalesOrderDocumentNumbersByOrderGids(
          shop,
          templateId,
          orders.map((order) => order.id),
        );
      }
    }
    orders = sortRawOrders(orders, sortSelected, dateByGid, {
      documentNumberByGid,
      referenceByGid,
    });
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
      forceDraft,
      forceReturn,
    );
    listCache.set(cacheKeyBase, { expires: now + CACHE_TTL_MS, data });
    pruneCache(now);
    return data;
  };

  // Credit note list: fetch by GID via nodes().
  if (isCreditNoteView) {
    const meta = await getAllCreditNoteMeta(shop);
    const creditNoteGids = [...meta.keys()];
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
    const meta = await getAllPackingSlipMeta(shop);
    const packingGids = [...meta.keys()];
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

  // Return list: fetch by GID via nodes().
  if (isReturnView) {
    const meta = await getAllReturnMeta(shop);
    const returnOrderGids = [...meta.keys()];
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
      returnOrderGids,
      metaForSort,
      false,
      false,
      false,
      false,
      true,
    );
  }

  // Draft invoice list: fetch by GID via nodes().
  if (isDraftView) {
    const meta = await getAllDraftMeta(shop);
    const draftGids = [...meta.keys()];
    const metaForSort = new Map<
      string,
      { sortAt: number; searchNumber?: string }
    >();
    for (const [gid, row] of meta) {
      metaForSort.set(gid, {
        sortAt: row.draftedAt?.getTime() ?? row.createdAt?.getTime() ?? 0,
        searchNumber: row.documentNumber || undefined,
      });
    }
    return filterAndPaginateDocumentOrders(
      draftGids,
      metaForSort,
      false,
      false,
      false,
      true,
    );
  }

  // Invoice list: fetch by GID via nodes() — Shopify search `id: OR id:` drops rows.
  if (isInvoicedView) {
    const metaForSortRaw = await getAllInvoicedMeta(shop);
    const invoicedGids = [...metaForSortRaw.keys()];
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

  if (hasDocumentFlagFilter) {
    const [invoicedGids, packingGids, returnGids, creditGids] =
      await Promise.all([
        params.invoicedFilter
          ? getAllInvoicedOrderGids(shop)
          : Promise.resolve([] as string[]),
        params.packingSlipFilter
          ? getAllPackingSlipOrderGids(shop)
          : Promise.resolve([] as string[]),
        params.returnFilter
          ? getAllReturnOrderGids(shop)
          : Promise.resolve([] as string[]),
        params.creditNoteFilter
          ? getAllCreditNoteOrderGids(shop)
          : Promise.resolve([] as string[]),
      ]);

    const yesSets: string[][] = [];
    if (params.invoicedFilter === "yes") yesSets.push(invoicedGids);
    if (params.packingSlipFilter === "yes") yesSets.push(packingGids);
    if (params.returnFilter === "yes") yesSets.push(returnGids);
    if (params.creditNoteFilter === "yes") yesSets.push(creditGids);

    if (yesSets.length > 0) {
      let sourceGids = yesSets[0];
      for (let i = 1; i < yesSets.length; i++) {
        sourceGids = applyFlagToGids(sourceGids, yesSets[i], "yes");
      }
      if (params.invoicedFilter === "no") {
        sourceGids = applyFlagToGids(sourceGids, invoicedGids, "no");
      }
      if (params.packingSlipFilter === "no") {
        sourceGids = applyFlagToGids(sourceGids, packingGids, "no");
      }
      if (params.returnFilter === "no") {
        sourceGids = applyFlagToGids(sourceGids, returnGids, "no");
      }
      if (params.creditNoteFilter === "no") {
        sourceGids = applyFlagToGids(sourceGids, creditGids, "no");
      }
      return filterAndPaginateDocumentOrders(
        sourceGids,
        new Map(),
        false,
        false,
      );
    }

    const textSearchNo = params.query.trim()
      ? await buildSalesOrdersTextSearch(admin, shop, templateId, params.query)
      : "";
    const orderQueryNo = [
      textSearchNo,
      viewQuery,
      params.paymentStatus ? `financial_status:${params.paymentStatus}` : "",
      params.fulfillmentStatus
        ? `fulfillment_status:${params.fulfillmentStatus}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const noFilterResponse = await admin.graphql(SALES_ORDERS_QUERY, {
      variables: {
        first: MAX_INVOICED_FETCH,
        query: orderQueryNo || undefined,
        sortKey: sortConfig.sortKey,
        reverse: sortConfig.reverse,
      },
    });
    const noFilterResult = (await noFilterResponse.json()) as OrdersResponse;
    if (!noFilterResult.data?.orders) {
      const message =
        noFilterResult.errors?.map((error) => error.message).join(", ") ||
        "Shopify orders could not be loaded.";
      throw new Response(message, { status: 502 });
    }
    let filteredNodes = noFilterResult.data.orders.nodes;
    const exclude = (typedGids: string[], filter: DocumentFlagFilter) => {
      if (filter !== "no") return;
      const typed = new Set(typedGids);
      filteredNodes = filteredNodes.filter((order) => !typed.has(order.id));
    };
    exclude(invoicedGids, params.invoicedFilter);
    exclude(packingGids, params.packingSlipFilter);
    exclude(returnGids, params.returnFilter);
    exclude(creditGids, params.creditNoteFilter);
    const { pageItems, pageInfo } = paginateItems(
      filteredNodes,
      params.after,
      params.before,
    );
    const data = await buildPage(pageItems, pageInfo, false);
    listCache.set(cacheKeyBase, { expires: now + CACHE_TTL_MS, data });
    pruneCache(now);
    void rememberSalesOrdersWatermark(admin, shop);
    return data;
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

  const response = await (salesOrdersGraphqlPromise ??
    admin.graphql(SALES_ORDERS_QUERY, {
      variables: {
        first: isPreviousPage ? undefined : PAGE_SIZE,
        after: isPreviousPage ? undefined : params.after,
        last: isPreviousPage ? PAGE_SIZE : undefined,
        before: isPreviousPage ? params.before : undefined,
        query: orderQuery || undefined,
        sortKey: sortConfig.sortKey,
        reverse: sortConfig.reverse,
      },
    }));

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
  void rememberSalesOrdersWatermark(admin, shop);
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
