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
import { getLastDraftAllocatedSequence } from "./order-invoice-draft-status.server";
import type { AdminGraphql } from "./sales-order-number.server";

const syncInFlight = new Map<string, Promise<void>>();
/** Process-local cache — skip DB check after first confirmed sync. */
const syncedShops = new Set<string>();

function draftSeriesEntry(entry: NumberSeriesEntry): NumberSeriesEntry {
  return normalizeNumberSeriesEntry(entry, {
    prefix: "DFT-",
    startingNumber: "0001",
    suffix: "",
    entryMode: "auto",
  });
}

async function countAssignedDraftNumbers(shop: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*)::int AS count
    FROM "OrderInvoiceDraftStatus"
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

export async function hasDraftOrderNumbersSynced(
  shop: string,
): Promise<boolean> {
  if (syncedShops.has(shop)) return true;
  try {
    const rows = await prisma.$queryRaw<
      Array<{ draftOrderNumbersSyncedAt: Date | null }>
    >`
      SELECT "draftOrderNumbersSyncedAt"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const synced = Boolean(rows[0]?.draftOrderNumbersSyncedAt);
    if (synced) syncedShops.add(shop);
    else syncedShops.delete(shop);
    return synced;
  } catch {
    syncedShops.delete(shop);
    return false;
  }
}

export type DraftOrderSyncStatus = {
  synced: boolean;
  syncedAt: string | null;
  canReset: boolean;
  assignedCount: number;
};

export async function getDraftOrderNumbersSyncStatus(
  shop: string,
): Promise<DraftOrderSyncStatus> {
  const [synced, assignedCount] = await Promise.all([
    hasDraftOrderNumbersSynced(shop),
    countAssignedDraftNumbers(shop),
  ]);

  let syncedAt: string | null = null;
  if (synced) {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ draftOrderNumbersSyncedAt: Date | null }>
      >`
        SELECT "draftOrderNumbersSyncedAt"
        FROM "ShopSettings"
        WHERE shop = ${shop}
        LIMIT 1
      `;
      const at = rows[0]?.draftOrderNumbersSyncedAt;
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

async function markDraftOrderNumbersSynced(shop: string): Promise<void> {
  const now = new Date();
  try {
    const updated = await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "draftOrderNumbersSyncedAt" = ${now},
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
        "numberSeries", "draftOrderNumbersSyncedAt", "createdAt", "updatedAt"
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
      SET "draftOrderNumbersSyncedAt" = ${now},
          "updatedAt" = CURRENT_TIMESTAMP
    `;
    syncedShops.add(shop);
  } catch (error) {
    console.error(
      "[draft-order-sync] Failed to mark numbers synced",
      shop,
      error,
    );
  }
}

async function clearDraftOrderNumbersSynced(shop: string): Promise<void> {
  syncedShops.delete(shop);
  try {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "draftOrderNumbersSyncedAt" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } catch (error) {
    console.error(
      "[draft-order-sync] Failed to clear numbers synced flag",
      shop,
      error,
    );
  }
}

/** Clear DFT- numbers for every draft row (keeps notes/terms rows). */
async function clearAllDraftDocumentNumbers(shop: string): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE "OrderInvoiceDraftStatus"
    SET
      sequence = NULL,
      "documentNumber" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE shop = ${shop}
      AND ("documentNumber" IS NOT NULL OR sequence IS NOT NULL)
  `;
  return Number(result);
}

/** Oldest → newest Shopify DraftOrder GIDs (by createdAt). */
async function fetchAllDraftOrderGidsByCreatedAtOldestFirst(
  admin: AdminGraphql,
): Promise<string[]> {
  const rows: Array<{ id: string; createdAt: string }> = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query SyncDraftOrderIds($first: Int!, $after: String) {
          draftOrders(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              createdAt
            }
          }
        }`,
      {
        variables: {
          first: 100,
          after,
        },
      },
    );

    const payload = (await response.json()) as {
      data?: {
        draftOrders?: {
          pageInfo?: {
            hasNextPage?: boolean;
            endCursor?: string | null;
          };
          nodes?: Array<{ id?: string | null; createdAt?: string | null }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      const message =
        payload.errors.map((error) => error.message).join("; ") ||
        "Failed to load Shopify draft orders for numbering.";
      if (/access denied|ACCESS_DENIED/i.test(message)) {
        throw new Error(
          "Missing read_draft_orders permission. Update app scopes, then sync again.",
        );
      }
      throw new Error(message);
    }

    const connection = payload.data?.draftOrders;
    for (const node of connection?.nodes ?? []) {
      if (node?.id && node.createdAt) {
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
  return rows.map((row) => row.id);
}

async function upsertDraftNumber(
  shop: string,
  orderGid: string,
  sequence: number,
  documentNumber: string,
): Promise<void> {
  const updated = await prisma.$executeRaw`
    UPDATE "OrderInvoiceDraftStatus"
    SET
      sequence = ${sequence},
      "documentNumber" = ${documentNumber},
      "draftedAt" = COALESCE("draftedAt", CURRENT_TIMESTAMP),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
  `;
  if (Number(updated) > 0) return;

  await prisma.$executeRaw`
    INSERT INTO "OrderInvoiceDraftStatus" (
      id, shop, "orderGid", "draftedAt", sequence, "documentNumber",
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
 * Merchant-triggered sync: assign DFT- numbers to all Shopify draft orders
 * using saved Prefix + Starting number (oldest → newest). Replaces existing DFT- numbers.
 */
export async function syncDraftOrderNumbersForShop(
  shop: string,
  admin: AdminGraphql,
): Promise<{
  assigned: number;
  skipped: number;
  lastNumber: string | null;
  lastAllocatedSequence: number | null;
  draftOrderSync: DraftOrderSyncStatus;
  numberSeries: Awaited<ReturnType<typeof loadNumberSeriesForShop>>;
}> {
  const existing = syncInFlight.get(shop);
  if (existing) {
    await existing;
    const [lastAllocatedSequence, draftOrderSync, numberSeries] =
      await Promise.all([
        getLastDraftAllocatedSequence(shop),
        getDraftOrderNumbersSyncStatus(shop),
        loadNumberSeriesForShop(shop),
      ]);
    return {
      assigned: 0,
      skipped: 0,
      lastNumber: null,
      lastAllocatedSequence,
      draftOrderSync,
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
      fetchAllDraftOrderGidsByCreatedAtOldestFirst(admin),
    ]);
    const series = draftSeriesEntry(numberSeries.draft);

    if (series.entryMode === "manual") {
      throw new Error(
        "Draft numbering is set to manual. Switch to auto before syncing existing draft orders.",
      );
    }

    if (await hasDraftOrderNumbersSynced(shop)) {
      throw new Error(
        "Draft sync already completed. Reset sync first to sync again.",
      );
    }

    // Replace any partial / out-of-order numbers so sync always starts from series.
    await clearAllDraftDocumentNumbers(shop);

    const startLast: number | null = null;
    let sequence = resolveNumberSeriesNextSequence(series, startLast);
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
      await upsertDraftNumber(shop, orderGid, sequence, documentNumber);
      assigned += 1;
      lastNumber = documentNumber;
      lastSequence = sequence;
      sequence += 1;
    }

    // Clear nextSequence override so Preview follows last allocated + 1.
    const clearedDraft = { ...numberSeries.draft };
    delete (clearedDraft as { nextSequence?: number }).nextSequence;
    const savedSeries = await saveNumberSeriesForShop(shop, {
      ...numberSeries,
      draft: clearedDraft,
    });

    await markDraftOrderNumbersSynced(shop);
    const draftOrderSync = await getDraftOrderNumbersSyncStatus(shop);

    return {
      assigned,
      skipped: 0,
      lastNumber,
      lastAllocatedSequence: lastSequence,
      draftOrderSync,
      numberSeries: savedSeries,
    };
  } finally {
    syncInFlight.delete(shop);
    resolveInFlight();
  }
}

/**
 * Reset Draft sync: clear all DFT- numbers so the next Sync starts from
 * saved Prefix and Starting number.
 */
export async function resetDraftOrderNumbersSync(shop: string): Promise<{
  ok: true;
  reverted: number;
  lastAllocatedSequence: number | null;
  draftOrderSync: DraftOrderSyncStatus;
  numberSeries: Awaited<ReturnType<typeof loadNumberSeriesForShop>>;
}> {
  const numberSeries = await loadNumberSeriesForShop(shop);
  const reverted = await clearAllDraftDocumentNumbers(shop);

  const clearedDraft = { ...numberSeries.draft };
  delete (clearedDraft as { nextSequence?: number }).nextSequence;
  const savedSeries = await saveNumberSeriesForShop(shop, {
    ...numberSeries,
    draft: clearedDraft,
  });

  await clearDraftOrderNumbersSynced(shop);

  return {
    ok: true,
    reverted,
    lastAllocatedSequence: null,
    draftOrderSync: await getDraftOrderNumbersSyncStatus(shop),
    numberSeries: savedSeries,
  };
}
