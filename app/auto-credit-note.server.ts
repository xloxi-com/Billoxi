import { loadCreditNoteSettingsForShop } from "./shop-settings.server";
import {
  getAllInvoicedOrderGids,
  getInvoicedOrderGids,
} from "./order-invoice-status.server";
import {
  getCreditNoteOrderGids,
  markOrderCreditNote,
} from "./order-credit-note-status.server";
import { invalidateSalesOrdersCache } from "./sales-orders.server";
import { unauthenticated } from "./shopify.server";
import { shopHasCapability } from "./plan-access.server";

export type AutoCreditNoteTrigger =
  | "cancel"
  | "refund"
  | "partial-refund";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Create a credit note when Settings flags allow it.
 * Requires an existing invoice (same rule as manual create).
 */
export async function maybeAutoCreateCreditNote(
  shop: string,
  orderGid: string,
  trigger: AutoCreditNoteTrigger,
  reason: string,
): Promise<{ created: boolean; documentNumber?: string; skipped?: string }> {
  if (!(await shopHasCapability(shop, "autoCreditNote"))) {
    return { created: false, skipped: "plan" };
  }

  const settings = await loadCreditNoteSettingsForShop(shop);
  const enabled =
    trigger === "cancel"
      ? settings.autoOnCancel
      : trigger === "refund"
        ? settings.autoOnRefund
        : settings.autoOnPartialRefund;

  if (!enabled) {
    return { created: false, skipped: "setting-disabled" };
  }

  const invoiced = await getInvoicedOrderGids(shop, [orderGid]);
  if (!invoiced.has(orderGid)) {
    return { created: false, skipped: "no-invoice" };
  }

  const existing = await getCreditNoteOrderGids(shop, [orderGid]);
  if (existing.has(orderGid)) {
    return { created: false, skipped: "already-exists" };
  }

  const documentNumber = await markOrderCreditNote(shop, orderGid, { reason });
  invalidateSalesOrdersCache(shop);
  return { created: true, documentNumber };
}

/**
 * Create missing credit notes for invoiced orders that are already
 * refunded / partially refunded (heals orders refunded before the setting
 * was on, or when full vs partial was mis-routed).
 */
export async function ensureAutoCreditNotesForOrders(
  shop: string,
  candidates: Array<{
    orderGid: string;
    financialStatus?: string | null;
    hasInvoice?: boolean;
    hasCreditNote?: boolean;
  }>,
): Promise<{ created: number; orderGids: string[] }> {
  const settings = await loadCreditNoteSettingsForShop(shop);
  if (!settings.autoOnRefund && !settings.autoOnPartialRefund) {
    return { created: 0, orderGids: [] };
  }

  const createdGids: string[] = [];
  for (const row of candidates) {
    if (row.hasCreditNote) continue;
    if (row.hasInvoice === false) continue;
    const status = String(row.financialStatus || "").toUpperCase();
    const trigger: AutoCreditNoteTrigger | null =
      status === "REFUNDED" && settings.autoOnRefund
        ? "refund"
        : status === "PARTIALLY_REFUNDED" && settings.autoOnPartialRefund
          ? "partial-refund"
          : null;
    if (!trigger) continue;

    try {
      const result = await maybeAutoCreateCreditNote(
        shop,
        row.orderGid,
        trigger,
        trigger === "refund" ? "Full refund" : "Partial refund",
      );
      if (result.created) createdGids.push(row.orderGid);
    } catch (error) {
      console.error("ensureAutoCreditNotesForOrders failed", {
        shop,
        orderGid: row.orderGid,
        trigger,
        error,
      });
    }
  }

  return { created: createdGids.length, orderGids: createdGids };
}

/** Backfill from Settings save — scan invoiced orders missing a credit note. */
export async function backfillAutoCreditNotesForShop(
  shop: string,
  admin: AdminGraphqlClient,
  limit = 80,
): Promise<{ created: number }> {
  const settings = await loadCreditNoteSettingsForShop(shop);
  if (!settings.autoOnRefund && !settings.autoOnPartialRefund) {
    return { created: 0 };
  }

  const invoiced = await getAllInvoicedOrderGids(shop);
  if (invoiced.length === 0) return { created: 0 };

  const existing = await getCreditNoteOrderGids(shop, invoiced);
  const missing = invoiced.filter((gid) => !existing.has(gid)).slice(0, limit);
  if (missing.length === 0) return { created: 0 };

  const statusByGid = await fetchOrdersFinancialStatus(admin, missing);
  return ensureAutoCreditNotesForOrders(
    shop,
    missing.map((orderGid) => ({
      orderGid,
      financialStatus: statusByGid.get(orderGid) ?? null,
      hasInvoice: true,
      hasCreditNote: false,
    })),
  );
}

async function fetchOrdersFinancialStatus(
  admin: AdminGraphqlClient,
  orderGids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (orderGids.length === 0) return out;

  const chunkSize = 50;
  for (let i = 0; i < orderGids.length; i += chunkSize) {
    const chunk = orderGids.slice(i, i + chunkSize);
    try {
      const response = await admin.graphql(
        `#graphql
          query OrdersFinancialStatus($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Order {
                id
                displayFinancialStatus
              }
            }
          }
        `,
        { variables: { ids: chunk } },
      );
      const json = (await response.json()) as {
        data?: {
          nodes?: Array<{
            id?: string;
            displayFinancialStatus?: string | null;
          } | null>;
        };
      };
      for (const node of json.data?.nodes ?? []) {
        if (node?.id && node.displayFinancialStatus) {
          out.set(node.id, node.displayFinancialStatus);
        }
      }
    } catch (error) {
      console.warn("fetchOrdersFinancialStatus failed", { error });
    }
  }
  return out;
}

export function orderGidFromWebhookPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    admin_graphql_api_id?: unknown;
    id?: unknown;
    order_id?: unknown;
    order?: { admin_graphql_api_id?: unknown; id?: unknown };
  };

  if (
    typeof body.admin_graphql_api_id === "string" &&
    body.admin_graphql_api_id.includes("Order/")
  ) {
    return body.admin_graphql_api_id;
  }

  if (
    typeof body.order?.admin_graphql_api_id === "string" &&
    body.order.admin_graphql_api_id.includes("Order/")
  ) {
    return body.order.admin_graphql_api_id;
  }

  // refunds/create: order_id is the order; payload.id is the refund.
  const fromOrderId =
    typeof body.order_id === "number" && Number.isFinite(body.order_id)
      ? body.order_id
      : typeof body.order_id === "string" && /^\d+$/.test(body.order_id)
        ? Number(body.order_id)
        : typeof body.order?.id === "number" && Number.isFinite(body.order.id)
          ? body.order.id
          : typeof body.order?.id === "string" && /^\d+$/.test(body.order.id)
            ? Number(body.order.id)
            : null;
  if (fromOrderId != null) {
    return `gid://shopify/Order/${fromOrderId}`;
  }

  // orders/cancelled (and similar): payload.id is the order.
  if (typeof body.id === "number" && Number.isFinite(body.id)) {
    return `gid://shopify/Order/${body.id}`;
  }
  if (typeof body.id === "string" && /^\d+$/.test(body.id)) {
    return `gid://shopify/Order/${body.id}`;
  }

  return null;
}

function refundedAmountFromPayload(payload: unknown): number {
  if (!payload || typeof payload !== "object") return NaN;
  const body = payload as { transactions?: unknown };
  let refunded = 0;
  let found = false;
  if (Array.isArray(body.transactions)) {
    for (const tx of body.transactions) {
      if (!tx || typeof tx !== "object") continue;
      const row = tx as { kind?: unknown; amount?: unknown; status?: unknown };
      const kind = String(row.kind || "").toLowerCase();
      const status = String(row.status || "").toLowerCase();
      if (kind === "refund" && (status === "success" || status === "")) {
        const amount = Number(row.amount);
        if (Number.isFinite(amount)) {
          refunded += amount;
          found = true;
        }
      }
    }
  }
  return found ? refunded : NaN;
}

/**
 * Best-effort full vs partial from refunds/create payload alone.
 * Returns null when the payload cannot decide reliably
 * (typical: no nested order, so do not guess "full").
 */
export function isFullRefundPayload(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    refund_line_items?: unknown;
    order?: {
      current_total_price?: unknown;
      total_price?: unknown;
      financial_status?: unknown;
    };
  };

  const financial = String(body.order?.financial_status || "").toLowerCase();
  if (financial === "refunded") return true;
  if (financial === "partially_refunded") return false;

  const orderTotal = Number(body.order?.total_price ?? NaN);
  const refunded = refundedAmountFromPayload(payload);

  if (Number.isFinite(orderTotal) && orderTotal > 0 && Number.isFinite(refunded)) {
    return refunded + 0.009 >= orderTotal;
  }

  return null;
}

async function fetchOrderRefundKind(
  admin: AdminGraphqlClient,
  orderGid: string,
): Promise<"refund" | "partial-refund" | null> {
  const response = await admin.graphql(
    `#graphql
      query OrderRefundStatus($id: ID!) {
        order(id: $id) {
          displayFinancialStatus
          totalPriceSet {
            shopMoney {
              amount
            }
          }
          totalRefundedSet {
            shopMoney {
              amount
            }
          }
        }
      }
    `,
    { variables: { id: orderGid } },
  );
  const json = (await response.json()) as {
    data?: {
      order?: {
        displayFinancialStatus?: string | null;
        totalPriceSet?: { shopMoney?: { amount?: string | null } | null } | null;
        totalRefundedSet?: {
          shopMoney?: { amount?: string | null } | null;
        } | null;
      } | null;
    };
  };

  const order = json.data?.order;
  if (!order) return null;

  const total = Number(order.totalPriceSet?.shopMoney?.amount ?? NaN);
  const refunded = Number(order.totalRefundedSet?.shopMoney?.amount ?? NaN);
  // Prefer money totals — status can lag briefly after refunds/create.
  if (
    Number.isFinite(total) &&
    total > 0 &&
    Number.isFinite(refunded) &&
    refunded > 0
  ) {
    return refunded + 0.009 >= total ? "refund" : "partial-refund";
  }

  const status = String(order.displayFinancialStatus || "").toUpperCase();
  if (status === "PARTIALLY_REFUNDED") return "partial-refund";
  if (status === "REFUNDED") return "refund";

  return null;
}

/**
 * Resolve full vs partial refund using Admin API when available.
 * Falls back to payload heuristics; defaults to partial when still unknown.
 */
export async function resolveRefundTrigger(
  shop: string,
  orderGid: string,
  payload: unknown,
  admin?: AdminGraphqlClient | null,
): Promise<"refund" | "partial-refund"> {
  let client = admin ?? null;
  if (!client) {
    try {
      const ctx = await unauthenticated.admin(shop);
      client = ctx.admin;
    } catch {
      client = null;
    }
  }

  if (client) {
    try {
      const fromApi = await fetchOrderRefundKind(client, orderGid);
      if (fromApi) return fromApi;
    } catch (error) {
      console.warn("resolveRefundTrigger: order lookup failed", {
        shop,
        orderGid,
        error,
      });
    }
  }

  const fromPayload = isFullRefundPayload(payload);
  if (fromPayload === true) return "refund";
  if (fromPayload === false) return "partial-refund";

  return "partial-refund";
}
