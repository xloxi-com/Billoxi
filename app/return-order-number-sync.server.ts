import { randomUUID } from "node:crypto";

import prisma from "./db.server";
import {
  formatNumberSeriesValue,
  normalizeNumberSeriesEntry,
  resolveNumberSeriesNextSequence,
  widenStartingNumberPad,
  type NumberSeriesEntry,
} from "./number-series";
import {
  loadNumberSeriesForShop,
  saveNumberSeriesForShop,
} from "./shop-settings.server";
import { getLastReturnAllocatedSequence } from "./order-return-status.server";
import type { AdminGraphql } from "./sales-order-number.server";
import { invalidateSalesOrdersCache } from "./sales-orders.server";

const syncInFlight = new Map<string, Promise<void>>();
const syncedShops = new Set<string>();

const RETURNS_ORDER_QUERY =
  "return_status:return_requested OR return_status:in_progress OR return_status:returned";

function returnSeriesEntry(entry: NumberSeriesEntry): NumberSeriesEntry {
  return normalizeNumberSeriesEntry(entry, {
    prefix: "RET-",
    startingNumber: "0001",
    suffix: "",
    entryMode: "auto",
  });
}

async function countAssignedReturnNumbers(shop: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*)::int AS count
    FROM "OrderReturnStatus"
    WHERE shop = ${shop}
      AND "documentNumber" IS NOT NULL
  `;
  const count = rows[0]?.count;
  return typeof count === "number"
    ? count
    : typeof count === "bigint"
      ? Number(count)
      : 0;
}

export async function hasReturnOrderNumbersSynced(
  shop: string,
): Promise<boolean> {
  // Always read DB — process cache alone is wrong after a DB wipe/reset.
  try {
    const rows = await prisma.$queryRaw<
      Array<{ returnOrderNumbersSyncedAt: Date | null }>
    >`
      SELECT "returnOrderNumbersSyncedAt"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const synced = Boolean(rows[0]?.returnOrderNumbersSyncedAt);
    if (synced) syncedShops.add(shop);
    else syncedShops.delete(shop);
    return synced;
  } catch {
    syncedShops.delete(shop);
    return false;
  }
}

export type ReturnOrderSyncStatus = {
  synced: boolean;
  syncedAt: string | null;
  canReset: boolean;
  assignedCount: number;
};

export async function getReturnOrderNumbersSyncStatus(
  shop: string,
): Promise<ReturnOrderSyncStatus> {
  const [synced, assignedCount] = await Promise.all([
    hasReturnOrderNumbersSynced(shop),
    countAssignedReturnNumbers(shop),
  ]);

  let syncedAt: string | null = null;
  if (synced) {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ returnOrderNumbersSyncedAt: Date | null }>
      >`
        SELECT "returnOrderNumbersSyncedAt"
        FROM "ShopSettings"
        WHERE shop = ${shop}
        LIMIT 1
      `;
      const at = rows[0]?.returnOrderNumbersSyncedAt;
      syncedAt = at ? at.toISOString() : null;
    } catch {
      syncedAt = null;
    }
  }

  return {
    synced,
    syncedAt,
    canReset: assignedCount > 0 || synced,
    assignedCount,
  };
}

async function markReturnOrderNumbersSynced(shop: string): Promise<void> {
  const now = new Date();
  try {
    const updated = await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "returnOrderNumbersSyncedAt" = ${now},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
    if (Number(updated) > 0) {
      syncedShops.add(shop);
      return;
    }

    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (
        id, shop, "storeDetails", "smtpSettings", "selectedTemplates",
        "numberSeries", "returnOrderNumbersSyncedAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${shop},
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        ${now},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (shop) DO UPDATE
      SET "returnOrderNumbersSyncedAt" = ${now},
          "updatedAt" = CURRENT_TIMESTAMP
    `;
    syncedShops.add(shop);
  } catch (error) {
    console.error(
      "[return-order-sync] Failed to mark numbers synced",
      shop,
      error,
    );
  }
}

async function clearReturnOrderNumbersSynced(shop: string): Promise<void> {
  syncedShops.delete(shop);
  try {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "returnOrderNumbersSyncedAt" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } catch (error) {
    console.error(
      "[return-order-sync] Failed to clear numbers synced flag",
      shop,
      error,
    );
  }
}

async function clearAllReturnDocumentNumbers(shop: string): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE "OrderReturnStatus"
    SET
      sequence = NULL,
      "documentNumber" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE shop = ${shop}
      AND ("documentNumber" IS NOT NULL OR sequence IS NOT NULL)
  `;
  return Number(result);
}

/**
 * Oldest → newest Shopify order GIDs that have a return.
 */
async function fetchAllReturnOrderGidsByCreatedAtOldestFirst(
  admin: AdminGraphql,
): Promise<string[]> {
  const rows: Array<{ id: string; createdAt: string }> = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query SyncReturnOrderIds($first: Int!, $after: String, $query: String) {
          orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: false) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              createdAt
              returns(first: 1) {
                nodes { id }
              }
            }
          }
        }`,
      {
        variables: {
          first: 50,
          after,
          query: RETURNS_ORDER_QUERY,
        },
      },
    );

    const payload = (await response.json()) as {
      data?: {
        orders?: {
          pageInfo?: {
            hasNextPage?: boolean;
            endCursor?: string | null;
          };
          nodes?: Array<{
            id?: string | null;
            createdAt?: string | null;
            returns?: { nodes?: Array<{ id?: string | null }> } | null;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      const message =
        payload.errors.map((error) => error.message).join("; ") ||
        "Failed to load Shopify returns for numbering.";
      if (/access denied|ACCESS_DENIED|read_returns/i.test(message)) {
        throw new Error(
          "Missing read_returns permission. Update app scopes, then sync again.",
        );
      }
      throw new Error(message);
    }

    const connection = payload.data?.orders;
    for (const node of connection?.nodes ?? []) {
      if (
        node?.id &&
        node.createdAt &&
        (node.returns?.nodes?.length ?? 0) > 0
      ) {
        rows.push({ id: node.id, createdAt: node.createdAt });
      }
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
    if (!hasNextPage || !after) break;
    if (rows.length >= 5000) break;
  }

  rows.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      a.id.localeCompare(b.id),
  );
  // Dedupe while preserving oldest-first order.
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return ids;
}

async function upsertReturnNumber(
  shop: string,
  orderGid: string,
  sequence: number,
  documentNumber: string,
): Promise<void> {
  const updated = await prisma.$executeRaw`
    UPDATE "OrderReturnStatus"
    SET
      sequence = ${sequence},
      "documentNumber" = ${documentNumber},
      "convertedAt" = COALESCE("convertedAt", CURRENT_TIMESTAMP),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
  `;
  if (Number(updated) > 0) return;

  await prisma.$executeRaw`
    INSERT INTO "OrderReturnStatus" (
      id, shop, "orderGid", "convertedAt", sequence, "documentNumber",
      "createdAt", "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${shop},
      ${orderGid},
      CURRENT_TIMESTAMP,
      ${sequence},
      ${documentNumber},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (shop, "orderGid") DO UPDATE
    SET
      sequence = EXCLUDED.sequence,
      "documentNumber" = EXCLUDED."documentNumber",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

/**
 * Merchant-triggered sync: assign RET- numbers to all Shopify orders with returns
 * using saved Prefix + Starting number (oldest → newest). Replaces existing RET- numbers.
 */
export async function syncReturnOrderNumbersForShop(
  shop: string,
  admin: AdminGraphql,
): Promise<{
  assigned: number;
  skipped: number;
  lastNumber: string | null;
  lastAllocatedSequence: number | null;
  returnOrderSync: ReturnOrderSyncStatus;
  numberSeries: Awaited<ReturnType<typeof loadNumberSeriesForShop>>;
}> {
  const existing = syncInFlight.get(shop);
  if (existing) {
    await existing;
    const [lastAllocatedSequence, returnOrderSync, numberSeries] =
      await Promise.all([
        getLastReturnAllocatedSequence(shop),
        getReturnOrderNumbersSyncStatus(shop),
        loadNumberSeriesForShop(shop),
      ]);
    return {
      assigned: 0,
      skipped: 0,
      lastNumber: null,
      lastAllocatedSequence,
      returnOrderSync,
      numberSeries,
    };
  }

  let resolveInFlight!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    resolveInFlight = resolve;
  });
  syncInFlight.set(shop, inFlight);

  try {
    const [numberSeries, orderGids] = await Promise.all([
      loadNumberSeriesForShop(shop),
      fetchAllReturnOrderGidsByCreatedAtOldestFirst(admin),
    ]);
    const series = returnSeriesEntry(numberSeries.return);

    if (series.entryMode === "manual") {
      throw new Error(
        "Return numbering is set to manual. Switch to auto before syncing existing returns.",
      );
    }

    if (await hasReturnOrderNumbersSynced(shop)) {
      throw new Error(
        "Return sync already completed. Reset sync first to sync again.",
      );
    }

    await clearAllReturnDocumentNumbers(shop);

    let sequence = resolveNumberSeriesNextSequence(series, null);
    const digitWidth = Math.max(
      series.startingNumber.replace(/\D/g, "").length,
      String(sequence + Math.max(0, orderGids.length - 1)).length,
      1,
    );
    const paddedEntry = {
      ...series,
      startingNumber: widenStartingNumberPad(series.startingNumber, digitWidth),
    };

    let assigned = 0;
    let lastNumber: string | null = null;
    let lastSequence: number | null = null;

    for (const orderGid of orderGids) {
      const documentNumber = formatNumberSeriesValue(paddedEntry, sequence);
      await upsertReturnNumber(shop, orderGid, sequence, documentNumber);
      assigned += 1;
      lastNumber = documentNumber;
      lastSequence = sequence;
      sequence += 1;
    }

    const clearedReturn = { ...numberSeries.return };
    delete (clearedReturn as { nextSequence?: number }).nextSequence;
    const savedSeries = await saveNumberSeriesForShop(shop, {
      ...numberSeries,
      return: clearedReturn,
    });

    await markReturnOrderNumbersSynced(shop);
    invalidateSalesOrdersCache(shop);
    const returnOrderSync = await getReturnOrderNumbersSyncStatus(shop);

    return {
      assigned,
      skipped: 0,
      lastNumber,
      lastAllocatedSequence: lastSequence,
      returnOrderSync,
      numberSeries: savedSeries,
    };
  } finally {
    syncInFlight.delete(shop);
    resolveInFlight();
  }
}

/**
 * Reset Return sync: clear all RET- numbers so the next Sync starts from
 * saved Prefix and Starting number.
 */
export async function resetReturnOrderNumbersSync(shop: string): Promise<{
  ok: true;
  reverted: number;
  lastAllocatedSequence: number | null;
  returnOrderSync: ReturnOrderSyncStatus;
  numberSeries: Awaited<ReturnType<typeof loadNumberSeriesForShop>>;
}> {
  const numberSeries = await loadNumberSeriesForShop(shop);
  const reverted = await clearAllReturnDocumentNumbers(shop);

  const clearedReturn = { ...numberSeries.return };
  delete (clearedReturn as { nextSequence?: number }).nextSequence;
  const savedSeries = await saveNumberSeriesForShop(shop, {
    ...numberSeries,
    return: clearedReturn,
  });

  await clearReturnOrderNumbersSynced(shop);
  invalidateSalesOrdersCache(shop);

  return {
    ok: true,
    reverted,
    lastAllocatedSequence: null,
    returnOrderSync: await getReturnOrderNumbersSyncStatus(shop),
    numberSeries: savedSeries,
  };
}
