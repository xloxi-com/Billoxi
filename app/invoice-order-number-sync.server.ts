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
import { getLastInvoiceAllocatedSequence } from "./order-invoice-status.server";
import type { AdminGraphql } from "./sales-order-number.server";
import { invalidateSalesOrdersCache } from "./sales-orders.server";

const syncInFlight = new Map<string, Promise<void>>();
const syncedShops = new Set<string>();

/** Fully paid Shopify orders — used to backfill invoices for old stores. */
const PAID_ORDERS_QUERY = "financial_status:paid";

function invoiceSeriesEntry(entry: NumberSeriesEntry): NumberSeriesEntry {
  return normalizeNumberSeriesEntry(entry, {
    prefix: "INV-",
    startingNumber: "0001",
    suffix: "",
    entryMode: "auto",
  });
}

async function countAssignedInvoiceNumbers(shop: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*)::int AS count
    FROM "OrderInvoiceStatus"
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

export async function hasInvoiceOrderNumbersSynced(
  shop: string,
): Promise<boolean> {
  if (syncedShops.has(shop)) return true;
  // Always read DB until confirmed — then trust process set (reset clears it).
  try {
    const rows = await prisma.$queryRaw<
      Array<{ invoiceOrderNumbersSyncedAt: Date | null }>
    >`
      SELECT "invoiceOrderNumbersSyncedAt"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const synced = Boolean(rows[0]?.invoiceOrderNumbersSyncedAt);
    if (synced) syncedShops.add(shop);
    else syncedShops.delete(shop);
    return synced;
  } catch {
    syncedShops.delete(shop);
    return false;
  }
}

export type InvoiceOrderSyncStatus = {
  synced: boolean;
  syncedAt: string | null;
  canReset: boolean;
  assignedCount: number;
  /** Invoices created after the last Invoice sync (new paid orders, etc.). */
  postSyncCount: number;
  blockedCount: number;
};

async function countInvoicesCreatedAfter(
  shop: string,
  syncedAt: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*)::int AS count
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND "documentNumber" IS NOT NULL
      AND "createdAt" > ${syncedAt}
  `;
  const count = rows[0]?.count;
  return typeof count === "number"
    ? count
    : typeof count === "bigint"
      ? Number(count)
      : 0;
}

export async function getInvoiceOrderNumbersSyncStatus(
  shop: string,
): Promise<InvoiceOrderSyncStatus> {
  const [synced, assignedCount] = await Promise.all([
    hasInvoiceOrderNumbersSynced(shop),
    countAssignedInvoiceNumbers(shop),
  ]);

  let syncedAt: string | null = null;
  let syncedAtDate: Date | null = null;
  if (synced) {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ invoiceOrderNumbersSyncedAt: Date | null }>
      >`
        SELECT "invoiceOrderNumbersSyncedAt"
        FROM "ShopSettings"
        WHERE shop = ${shop}
        LIMIT 1
      `;
      const at = rows[0]?.invoiceOrderNumbersSyncedAt;
      if (at) {
        syncedAtDate = at;
        syncedAt = at.toISOString();
      }
    } catch {
      syncedAt = null;
      syncedAtDate = null;
    }
  }

  const postSyncCount =
    syncedAtDate != null
      ? await countInvoicesCreatedAfter(shop, syncedAtDate)
      : 0;
  const blockedCount = postSyncCount;
  const canReset =
    (assignedCount > 0 || synced) && blockedCount === 0;

  return {
    synced,
    syncedAt,
    canReset,
    assignedCount,
    postSyncCount,
    blockedCount,
  };
}

async function markInvoiceOrderNumbersSynced(shop: string): Promise<void> {
  const now = new Date();
  try {
    const updated = await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "invoiceOrderNumbersSyncedAt" = ${now},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
    if (Number(updated) > 0) {
      syncedShops.add(shop);
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (
        id, shop, "storeDetails", "smtpSettings", "emailTemplates",
        "selectedTemplates", "numberSeries", "invoiceOrderNumbersSyncedAt",
        "createdAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${shop},
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        ${now},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (shop) DO UPDATE
      SET "invoiceOrderNumbersSyncedAt" = ${now},
          "updatedAt" = CURRENT_TIMESTAMP
    `;
    syncedShops.add(shop);
  } catch (error) {
    console.error(
      "[invoice-order-sync] Failed to mark numbers synced",
      shop,
      error,
    );
    syncedShops.add(shop);
  }
}

async function clearInvoiceOrderNumbersSynced(shop: string): Promise<void> {
  syncedShops.delete(shop);
  try {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "invoiceOrderNumbersSyncedAt" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } catch (error) {
    console.error(
      "[invoice-order-sync] Failed to clear numbers synced flag",
      shop,
      error,
    );
  }
}

/** Clear INV- numbers for every invoice row (keeps notes/terms). */
async function clearAllInvoiceDocumentNumbers(shop: string): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE "OrderInvoiceStatus"
    SET
      sequence = NULL,
      "documentNumber" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE shop = ${shop}
      AND ("documentNumber" IS NOT NULL OR sequence IS NOT NULL)
  `;
  return Number(result);
}

/** Delete every Billoxi invoice for this shop (Invoice list becomes empty). */
async function deleteAllInvoicesForShop(shop: string): Promise<number> {
  const result = await prisma.$executeRaw`
    DELETE FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
  `;
  return Number(result);
}

/**
 * Paid Shopify order GIDs oldest → newest (by createdAt).
 * Used to create Billoxi invoices for an old store's paid history.
 */
async function fetchAllPaidOrderGidsByCreatedAtOldestFirst(
  admin: AdminGraphql,
): Promise<string[]> {
  const rows: Array<{ id: string; createdAt: string }> = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query SyncPaidOrderIds($first: Int!, $after: String, $query: String) {
          orders(
            first: $first
            after: $after
            query: $query
            sortKey: CREATED_AT
            reverse: false
          ) {
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
          query: PAID_ORDERS_QUERY,
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
          nodes?: Array<{ id?: string | null; createdAt?: string | null }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(
        payload.errors.map((error) => error.message).join("; ") ||
          "Failed to load paid Shopify orders for invoice numbering.",
      );
    }

    const connection = payload.data?.orders;
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
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return ids;
}

async function upsertInvoiceNumber(
  shop: string,
  orderGid: string,
  sequence: number,
  documentNumber: string,
): Promise<void> {
  const updated = await prisma.$executeRaw`
    UPDATE "OrderInvoiceStatus"
    SET
      sequence = ${sequence},
      "documentNumber" = ${documentNumber},
      "invoicedAt" = COALESCE("invoicedAt", CURRENT_TIMESTAMP),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
  `;
  if (Number(updated) > 0) return;

  await prisma.$executeRaw`
    INSERT INTO "OrderInvoiceStatus" (
      id, shop, "orderGid", "invoicedAt", sequence, "documentNumber",
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
 * Merchant-triggered sync: create/renumber invoices for all paid Shopify orders
 * using saved Prefix + Starting number (oldest → newest). Replaces existing INV- numbers.
 */
export async function syncInvoiceOrderNumbersForShop(
  shop: string,
  admin: AdminGraphql,
): Promise<{
  assigned: number;
  skipped: number;
  lastNumber: string | null;
  lastAllocatedSequence: number | null;
  invoiceOrderSync: InvoiceOrderSyncStatus;
  numberSeries: Awaited<ReturnType<typeof loadNumberSeriesForShop>>;
}> {
  const existing = syncInFlight.get(shop);
  if (existing) {
    await existing;
    const [lastAllocatedSequence, invoiceOrderSync, numberSeries] =
      await Promise.all([
        getLastInvoiceAllocatedSequence(shop),
        getInvoiceOrderNumbersSyncStatus(shop),
        loadNumberSeriesForShop(shop),
      ]);
    return {
      assigned: 0,
      skipped: 0,
      lastNumber: null,
      lastAllocatedSequence,
      invoiceOrderSync,
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
      fetchAllPaidOrderGidsByCreatedAtOldestFirst(admin),
    ]);
    const series = invoiceSeriesEntry(numberSeries.invoice);

    if (series.entryMode === "manual") {
      throw new Error(
        "Invoice numbering is set to manual. Switch to auto before syncing existing invoices.",
      );
    }

    if (await hasInvoiceOrderNumbersSynced(shop)) {
      throw new Error(
        "Invoice sync already completed. Reset sync first to sync again.",
      );
    }

    await clearAllInvoiceDocumentNumbers(shop);

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
      await upsertInvoiceNumber(shop, orderGid, sequence, documentNumber);
      assigned += 1;
      lastNumber = documentNumber;
      lastSequence = sequence;
      sequence += 1;
    }

    const clearedInvoice = { ...numberSeries.invoice };
    delete (clearedInvoice as { nextSequence?: number }).nextSequence;
    const savedSeries = await saveNumberSeriesForShop(shop, {
      ...numberSeries,
      invoice: clearedInvoice,
    });

    await markInvoiceOrderNumbersSynced(shop);
    invalidateSalesOrdersCache(shop);
    const invoiceOrderSync = await getInvoiceOrderNumbersSyncStatus(shop);

    return {
      assigned,
      skipped: 0,
      lastNumber,
      lastAllocatedSequence: lastSequence,
      invoiceOrderSync,
      numberSeries: savedSeries,
    };
  } finally {
    syncInFlight.delete(shop);
    resolveInFlight();
  }
}

/**
 * Reset Invoice sync: delete all Billoxi invoices for this shop and clear the
 * sync flag so the next Sync recreates INV- from Prefix + Starting number
 * (paid orders oldest → newest).
 *
 * Locked when any invoice was created after the last sync (new paid orders).
 */
export async function resetInvoiceOrderNumbersSync(shop: string): Promise<
  | {
      ok: true;
      reverted: number;
      lastAllocatedSequence: number | null;
      invoiceOrderSync: InvoiceOrderSyncStatus;
      numberSeries: Awaited<ReturnType<typeof loadNumberSeriesForShop>>;
    }
  | {
      ok: false;
      error: string;
      postSyncCount: number;
      blockedCount: number;
      invoiceOrderSync: InvoiceOrderSyncStatus;
    }
> {
  const status = await getInvoiceOrderNumbersSyncStatus(shop);
  if (!status.canReset) {
    return {
      ok: false,
      error:
        status.blockedCount > 0
          ? `Reset disabled: ${status.blockedCount} invoice${status.blockedCount === 1 ? "" : "s"} created after sync (new paid orders). Delete those invoices to unlock reset.`
          : "Invoice sync reset is locked.",
      postSyncCount: status.postSyncCount,
      blockedCount: status.blockedCount,
      invoiceOrderSync: status,
    };
  }

  const numberSeries = await loadNumberSeriesForShop(shop);
  const reverted = await deleteAllInvoicesForShop(shop);

  const clearedInvoice = { ...numberSeries.invoice };
  delete (clearedInvoice as { nextSequence?: number }).nextSequence;
  const savedSeries = await saveNumberSeriesForShop(shop, {
    ...numberSeries,
    invoice: clearedInvoice,
  });

  await clearInvoiceOrderNumbersSynced(shop);
  invalidateSalesOrdersCache(shop);

  return {
    ok: true,
    reverted,
    lastAllocatedSequence: null,
    invoiceOrderSync: await getInvoiceOrderNumbersSyncStatus(shop),
    numberSeries: savedSeries,
  };
}
