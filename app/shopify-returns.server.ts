import { markOrderReturn } from "./order-return-status.server";
import { invalidateSalesOrdersCache } from "./sales-orders.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const ORDERS_WITH_RETURNS_QUERY = `#graphql
  query OrdersWithReturns($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        returns(first: 5) {
          nodes {
            id
            status
          }
        }
      }
    }
  }
`;

const RETURN_ORDER_QUERY = `#graphql
  query ReturnOrder($id: ID!) {
    return(id: $id) {
      id
      status
      order {
        id
      }
    }
  }
`;

/** Shopify order search for any active/completed return. */
const RETURNS_ORDER_QUERY =
  "return_status:return_requested OR return_status:in_progress OR return_status:returned";

function isAccessDenied(message: string) {
  return /access denied|ACCESS_DENIED|read_returns/i.test(message);
}

/**
 * Resolve Order GID from a returns/* webhook payload.
 */
export function orderGidFromReturnWebhookPayload(
  payload: unknown,
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    order?: { admin_graphql_api_id?: unknown; id?: unknown };
    order_id?: unknown;
    admin_graphql_api_order_id?: unknown;
  };

  const orderGid =
    (typeof body.order?.admin_graphql_api_id === "string" &&
      body.order.admin_graphql_api_id) ||
    (typeof body.admin_graphql_api_order_id === "string" &&
      body.admin_graphql_api_order_id) ||
    null;
  if (orderGid && orderGid.includes("Order/")) return orderGid;

  const orderId = body.order?.id ?? body.order_id;
  if (typeof orderId === "number" && Number.isFinite(orderId)) {
    return `gid://shopify/Order/${orderId}`;
  }
  if (typeof orderId === "string" && /^\d+$/.test(orderId)) {
    return `gid://shopify/Order/${orderId}`;
  }
  return null;
}

/** Resolve Return GID from webhook payload. */
export function returnGidFromWebhookPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    admin_graphql_api_id?: unknown;
    id?: unknown;
  };
  if (
    typeof body.admin_graphql_api_id === "string" &&
    body.admin_graphql_api_id.includes("Return/")
  ) {
    return body.admin_graphql_api_id;
  }
  if (typeof body.id === "number" && Number.isFinite(body.id)) {
    return `gid://shopify/Return/${body.id}`;
  }
  if (typeof body.id === "string" && /^\d+$/.test(body.id)) {
    return `gid://shopify/Return/${body.id}`;
  }
  return null;
}

/**
 * Look up the parent order for a Shopify Return GID.
 */
export async function fetchOrderGidForReturn(
  admin: AdminGraphql,
  returnGid: string,
): Promise<string | null> {
  const response = await admin.graphql(RETURN_ORDER_QUERY, {
    variables: { id: returnGid },
  });
  const payload = (await response.json()) as {
    data?: { return?: { order?: { id?: string | null } | null } | null };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    const message = payload.errors.map((e) => e.message).filter(Boolean).join("; ");
    if (isAccessDenied(message)) {
      throw new Error(
        "Missing read_returns permission. Update app scopes, then reopen Billoxi.",
      );
    }
    throw new Error(message || "Failed to load Shopify return.");
  }
  return payload.data?.return?.order?.id ?? null;
}

const RETURN_SYNC_TTL_MS = 180_000;
const lastReturnSyncAt = new Map<string, number>();
const returnSyncInFlight = new Map<
  string,
  Promise<{ marked: number; scopeError?: string }>
>();

/**
 * Create/refresh Billoxi Return docs for every Shopify order that has a return.
 * Called from Return list load (backfill) and after webhooks.
 */
export async function syncShopifyReturnsForShop(
  admin: AdminGraphql,
  shop: string,
): Promise<{ marked: number; scopeError?: string }> {
  const key = shop.trim().toLowerCase();
  const lastAt = lastReturnSyncAt.get(key);
  if (lastAt && Date.now() - lastAt < RETURN_SYNC_TTL_MS) {
    return { marked: 0 };
  }
  const inFlight = returnSyncInFlight.get(key);
  if (inFlight) return inFlight;

  const run = syncShopifyReturnsForShopUncached(admin, shop);
  returnSyncInFlight.set(key, run);
  try {
    const result = await run;
    if (!result.scopeError) {
      lastReturnSyncAt.set(key, Date.now());
    }
    return result;
  } finally {
    returnSyncInFlight.delete(key);
  }
}

async function syncShopifyReturnsForShopUncached(
  admin: AdminGraphql,
  shop: string,
): Promise<{ marked: number; scopeError?: string }> {
  let marked = 0;
  let after: string | null = null;
  let hasNextPage = true;
  const seen = new Set<string>();

  try {
    while (hasNextPage) {
      const response = await admin.graphql(ORDERS_WITH_RETURNS_QUERY, {
        variables: {
          first: 50,
          after,
          query: RETURNS_ORDER_QUERY,
        },
      });
      const payload = (await response.json()) as {
        data?: {
          orders?: {
            pageInfo?: {
              hasNextPage?: boolean;
              endCursor?: string | null;
            };
            nodes?: Array<{
              id?: string | null;
              returns?: {
                nodes?: Array<{ id?: string | null; status?: string | null }>;
              } | null;
            }>;
          };
        };
        errors?: Array<{ message?: string }>;
      };

      if (payload.errors?.length) {
        const message = payload.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join("; ");
        if (isAccessDenied(message)) {
          return {
            marked: 0,
            scopeError:
              "Missing read_returns permission. Update app scopes, then reopen Return.",
          };
        }
        throw new Error(message || "Failed to sync Shopify returns.");
      }

      const connection = payload.data?.orders;
      for (const node of connection?.nodes ?? []) {
        const orderGid = node?.id;
        if (!orderGid || seen.has(orderGid)) continue;
        const returns = node.returns?.nodes ?? [];
        if (returns.length === 0) continue;
        seen.add(orderGid);
        try {
          await markOrderReturn(shop, orderGid);
          marked += 1;
        } catch (error) {
          console.error("syncShopifyReturns: mark failed", orderGid, error);
        }
      }

      hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
      after = connection?.pageInfo?.endCursor ?? null;
      if (!hasNextPage || !after) break;
      if (seen.size >= 500) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAccessDenied(message)) {
      return {
        marked: 0,
        scopeError:
          "Missing read_returns permission. Update app scopes, then reopen Return.",
      };
    }
    throw error;
  }

  if (marked > 0) {
    invalidateSalesOrdersCache(shop);
  }
  return { marked };
}

/**
 * Ensure a Billoxi Return exists for the order linked to a Shopify return event.
 */
export async function ensureReturnFromShopifyEvent(
  shop: string,
  admin: AdminGraphql | null | undefined,
  payload: unknown,
): Promise<{ created: boolean; orderGid?: string; skipped?: string }> {
  let orderGid = orderGidFromReturnWebhookPayload(payload);
  if (!orderGid && admin) {
    const returnGid = returnGidFromWebhookPayload(payload);
    if (returnGid) {
      orderGid = await fetchOrderGidForReturn(admin, returnGid);
    }
  }
  if (!orderGid) {
    return { created: false, skipped: "missing-order" };
  }

  const documentNumber = await markOrderReturn(shop, orderGid);
  invalidateSalesOrdersCache(shop);
  return {
    created: Boolean(documentNumber),
    orderGid,
  };
}
