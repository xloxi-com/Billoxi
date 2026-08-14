/**
 * Monthly processed-order quota (calendar month, UTC).
 * Print / download / email of an order counts once per order per month.
 * Limits: STARTER 50 · PREMIUM 200 · ULTIMATE unlimited. Resets next month.
 */

import prisma from "./db.server";
import { getPlanById, type PlanId } from "./plan-features";
import { currentYearMonth } from "./shop-monthly-usage.server";

export type OrderQuotaStatus = {
  yearMonth: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  exhausted: boolean;
};

export class OrderQuotaExceededError extends Error {
  readonly status = 403;
  readonly code = "ORDER_QUOTA_EXCEEDED" as const;
  readonly quota: OrderQuotaStatus;

  constructor(quota: OrderQuotaStatus, message?: string) {
    const limitLabel =
      quota.limit == null ? "unlimited" : String(quota.limit);
    super(
      message ||
        `Monthly order limit reached (${quota.used}/${limitLabel}). Upgrade your plan or wait until next month.`,
    );
    this.name = "OrderQuotaExceededError";
    this.quota = quota;
  }
}

function monthBoundsUtc(now: Date) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
  return { start, end };
}

function normalizeOrderGid(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("gid://shopify/")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Order/${raw}`;
  const last = raw.split("/").pop();
  if (last && /^\d+$/.test(last)) {
    if (/draft/i.test(raw)) return `gid://shopify/DraftOrder/${last}`;
    return `gid://shopify/Order/${last}`;
  }
  return raw;
}

/** Distinct orders processed (print/download/email) this calendar month. */
export async function countMonthlyProcessedOrders(
  shop: string,
  now = new Date(),
): Promise<number> {
  if (!shop) return 0;
  const { start, end } = monthBoundsUtc(now);

  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ total: number | bigint }>
    >(
      `SELECT COUNT(*)::int AS total FROM (
         SELECT DISTINCT "orderGid"
         FROM "DocumentEventLog"
         WHERE shop = $1
           AND "createdAt" >= $2
           AND "createdAt" <= $3
           AND action IN ('printed', 'downloaded', 'sent')
           AND "orderGid" IS NOT NULL
           AND TRIM("orderGid") <> ''
       ) AS distinct_orders`,
      shop,
      start,
      end,
    );
    const withGid = Number(rows[0]?.total) || 0;

    // Bulk/legacy rows without orderGid still count toward the limit.
    const anon = await prisma.$queryRawUnsafe<
      Array<{ total: number | bigint }>
    >(
      `SELECT COALESCE(SUM(count), 0) AS total
       FROM "DocumentEventLog"
       WHERE shop = $1
         AND "createdAt" >= $2
         AND "createdAt" <= $3
         AND action IN ('printed', 'downloaded', 'sent')
         AND ("orderGid" IS NULL OR TRIM("orderGid") = '')`,
      shop,
      start,
      end,
    );
    return withGid + (Number(anon[0]?.total) || 0);
  } catch (error) {
    console.error("[order-quota] count failed", shop, error);
    return 0;
  }
}

export async function loadOrderQuotaStatus(
  shop: string,
  planId: PlanId,
  now = new Date(),
): Promise<OrderQuotaStatus> {
  const yearMonth = currentYearMonth(now);
  const limit = getPlanById(planId).monthlyOrderLimit;
  const used = await countMonthlyProcessedOrders(shop, now);
  if (limit == null) {
    return {
      yearMonth,
      used,
      limit: null,
      remaining: null,
      exhausted: false,
    };
  }
  const remaining = Math.max(0, limit - used);
  return {
    yearMonth,
    used,
    limit,
    remaining,
    exhausted: used >= limit,
  };
}

async function findProcessedOrderGids(
  shop: string,
  orderGids: string[],
  now = new Date(),
): Promise<Set<string>> {
  const unique = [
    ...new Set(
      orderGids
        .map((gid) => normalizeOrderGid(gid))
        .filter((gid): gid is string => Boolean(gid)),
    ),
  ];
  if (unique.length === 0) return new Set();

  const { start, end } = monthBoundsUtc(now);
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ orderGid: string }>>(
      `SELECT DISTINCT "orderGid"
       FROM "DocumentEventLog"
       WHERE shop = $1
         AND "createdAt" >= $2
         AND "createdAt" <= $3
         AND action IN ('printed', 'downloaded', 'sent')
         AND "orderGid" = ANY($4::text[])`,
      shop,
      start,
      end,
      unique,
    );
    return new Set(rows.map((row) => row.orderGid));
  } catch (error) {
    console.error("[order-quota] processed lookup failed", shop, error);
    return new Set();
  }
}

/**
 * How many of these order GIDs would newly count against the monthly quota.
 * Already-processed orders this month are free to print/download/email again.
 */
export async function countNewOrdersTowardQuota(
  shop: string,
  orderGids: Array<string | null | undefined>,
  now = new Date(),
): Promise<number> {
  const normalized = orderGids
    .map((gid) => normalizeOrderGid(gid))
    .filter((gid): gid is string => Boolean(gid));
  const unique = [...new Set(normalized)];
  if (unique.length === 0) {
    // No identity → treat as one new order slot (anonymous / bulk blob).
    return orderGids.length > 0 ? 1 : 0;
  }
  const already = await findProcessedOrderGids(shop, unique, now);
  return unique.filter((gid) => !already.has(gid)).length;
}

export async function assertOrderQuotaAllows(
  shop: string,
  planId: PlanId,
  orderGids: Array<string | null | undefined>,
  now = new Date(),
): Promise<OrderQuotaStatus> {
  const quota = await loadOrderQuotaStatus(shop, planId, now);
  if (quota.limit == null) return quota;

  const newCount = await countNewOrdersTowardQuota(shop, orderGids, now);
  if (newCount <= 0) return quota;
  if (quota.used + newCount > quota.limit) {
    throw new OrderQuotaExceededError(quota);
  }
  return quota;
}

export function orderQuotaExceededResponse(error: OrderQuotaExceededError) {
  return Response.json(
    {
      ok: false,
      error: error.message,
      code: error.code,
      quota: error.quota,
    },
    { status: error.status },
  );
}
