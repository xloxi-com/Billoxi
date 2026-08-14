import { randomUUID } from "node:crypto";
import prisma from "./db.server";
import { resolveSalesOrderTemplateId } from "./sales-order-ids";
import { numberingFromSeries } from "./number-series";
import {
  loadNumberSeriesForShop,
  loadNumberSyncFlagsForShop,
  loadSelectedTemplateForShop,
  saveNumberSeriesForShop,
} from "./shop-settings.server";
import { getInvoicedOrderGids } from "./order-invoice-status.server";
import { getPackingSlipOrderGids } from "./order-packing-slip-status.server";
import {
  backfillSalesOrderDocumentNumbers,
  clearCompletedSalesOrderNumberSyncMemo,
  fetchAllOrderGidsOldestFirst,
  getLastAllocatedSequence,
  isSalesOrderNumberSyncInFlight,
  resetSalesOrderNumberCounter,
  runExclusiveSalesOrderNumberSync,
  type AdminGraphql,
} from "./sales-order-number.server";
import { invalidateSalesOrdersCache } from "./sales-orders.server";

/** Tracks shops that completed a sync this process — cleared when DB says unsynced. */
const syncedShops = new Set<string>();

/** Every order that currently has a Sales Order document number. */
async function listAssignedSalesOrderGids(shop: string): Promise<{
  orderGids: string[];
  templateIds: string[];
}> {
  const rows = await prisma.salesOrderDocumentNumber.findMany({
    where: { shop },
    select: { orderGid: true, templateId: true },
  });
  return {
    orderGids: [...new Set(rows.map((row) => row.orderGid))],
    templateIds: [...new Set(rows.map((row) => row.templateId))],
  };
}

export async function hasSalesOrderNumbersSynced(shop: string): Promise<boolean> {
  // Always read DB — process memo alone is wrong after `prisma migrate reset`.
  try {
    const synced = (await loadNumberSyncFlagsForShop(shop)).salesOrder;
    if (synced) syncedShops.add(shop);
    else syncedShops.delete(shop);
    return synced;
  } catch {
    syncedShops.delete(shop);
    return false;
  }
}

export type SalesOrderSyncStatus = {
  synced: boolean;
  syncedAt: string | null;
  canReset: boolean;
  assignedCount: number;
  invoicedCount: number;
  packingSlipCount: number;
  blockedCount: number;
};

export async function getSalesOrderNumbersSyncStatus(
  shop: string,
): Promise<SalesOrderSyncStatus> {
  const [flagSynced, assigned] = await Promise.all([
    hasSalesOrderNumbersSynced(shop),
    listAssignedSalesOrderGids(shop),
  ]);

  const orderGids = assigned.orderGids;
  const assignedCount = orderGids.length;

  // Numbers exist but flag missing (DB wipe of flag only, or mark failed) —
  // heal so badge shows Synced and Sync stays locked until Reset.
  let synced = flagSynced;
  if (!synced && assignedCount > 0 && !isSalesOrderNumberSyncInFlight(shop)) {
    await markSalesOrderNumbersSynced(shop);
    synced = true;
  }

  let syncedAt: string | null = null;
  if (synced) {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ salesOrderNumbersSyncedAt: Date | null }>
      >`
        SELECT "salesOrderNumbersSyncedAt"
        FROM "ShopSettings"
        WHERE shop = ${shop}
        LIMIT 1
      `;
      const at = rows[0]?.salesOrderNumbersSyncedAt;
      syncedAt = at ? at.toISOString() : null;
    } catch {
      syncedAt = null;
    }
  }

  if (assignedCount === 0) {
    return {
      synced,
      syncedAt,
      canReset: false,
      assignedCount: 0,
      invoicedCount: 0,
      packingSlipCount: 0,
      blockedCount: 0,
    };
  }

  const [invoiced, packing] = await Promise.all([
    getInvoicedOrderGids(shop, orderGids),
    getPackingSlipOrderGids(shop, orderGids),
  ]);
  const invoicedCount = invoiced.size;
  const packingSlipCount = packing.size;
  const blockedCount = new Set([...invoiced, ...packing]).size;

  return {
    synced,
    syncedAt,
    canReset: blockedCount === 0,
    assignedCount,
    invoicedCount,
    packingSlipCount,
    blockedCount,
  };
}

async function markSalesOrderNumbersSynced(shop: string): Promise<void> {
  const now = new Date();
  try {
    const updated = await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "salesOrderNumbersSyncedAt" = ${now},
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
        "numberSeries", "salesOrderNumbersSyncedAt", "createdAt", "updatedAt"
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
      SET "salesOrderNumbersSyncedAt" = ${now},
          "updatedAt" = CURRENT_TIMESTAMP
    `;
    syncedShops.add(shop);
  } catch (error) {
    console.error(
      "[sales-order-sync] Failed to mark numbers synced",
      shop,
      error,
    );
  }
}

async function clearSalesOrderNumbersSynced(shop: string): Promise<void> {
  syncedShops.delete(shop);
  clearCompletedSalesOrderNumberSyncMemo(shop);
  try {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "salesOrderNumbersSyncedAt" = NULL,
          "numberBackfillUndo" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } catch (error) {
    console.error(
      "[sales-order-sync] Failed to clear numbers synced flag",
      shop,
      error,
    );
  }
}

/**
 * Merchant-triggered sync: assign SO numbers to existing Shopify orders
 * using the saved Prefix + Starting number (oldest → newest).
 */
export async function syncSalesOrderNumbersForShop(
  shop: string,
  admin: AdminGraphql,
): Promise<{
  assigned: number;
  skipped: number;
  lastNumber: string | null;
  lastAllocatedSequence: number | null;
  canReset: boolean;
  salesOrderSync: SalesOrderSyncStatus;
  numberSeries: Awaited<ReturnType<typeof loadNumberSeriesForShop>>;
}> {
  const exclusive = await runExclusiveSalesOrderNumberSync(shop, async () => {
    const [selectedTemplateId, numberSeries, orderGids] = await Promise.all([
      loadSelectedTemplateForShop(shop, "sales-order"),
      loadNumberSeriesForShop(shop),
      fetchAllOrderGidsOldestFirst(admin),
    ]);
    const templateId = resolveSalesOrderTemplateId(selectedTemplateId);
    const soSeries = numberSeries["sales-order"];

    if (soSeries.entryMode === "manual") {
      throw new Error(
        "Sales Order numbering is set to manual. Switch to auto before syncing existing orders.",
      );
    }

    const alreadySynced = await getSalesOrderNumbersSyncStatus(shop);
    // Stale syncedAt after a DB wipe (numbers gone, flag/memo still set): re-sync.
    if (alreadySynced.assignedCount === 0 && alreadySynced.synced) {
      await clearSalesOrderNumbersSynced(shop);
    } else if (alreadySynced.synced || alreadySynced.assignedCount > 0) {
      throw new Error(
        "Sales Order sync already completed. Reset sync first to sync again.",
      );
    }

    const numbering = numberingFromSeries(soSeries);

    // Align counter to saved series before assigning (prefix + starting number).
    const lastBefore = await getLastAllocatedSequence(shop);
    if (lastBefore == null) {
      await resetSalesOrderNumberCounter(shop, templateId, numbering);
    }

    const backfill = await backfillSalesOrderDocumentNumbers(
      shop,
      templateId,
      numbering,
      orderGids,
      { persistUndo: true },
    );
    await markSalesOrderNumbersSynced(shop);
    invalidateSalesOrdersCache(shop);
    const salesOrderSync = await getSalesOrderNumbersSyncStatus(shop);

    return {
      assigned: backfill.assigned,
      skipped: backfill.skipped,
      lastNumber: backfill.lastNumber,
      lastAllocatedSequence: backfill.lastAllocatedSequence,
      canReset: salesOrderSync.canReset,
      salesOrderSync,
      numberSeries,
    };
  });

  if (!exclusive.ran) {
    const [lastAllocatedSequence, salesOrderSync, numberSeries] =
      await Promise.all([
        getLastAllocatedSequence(shop),
        getSalesOrderNumbersSyncStatus(shop),
        loadNumberSeriesForShop(shop),
      ]);
    return {
      assigned: 0,
      skipped: 0,
      lastNumber: null,
      lastAllocatedSequence,
      canReset: salesOrderSync.canReset,
      salesOrderSync,
      numberSeries,
    };
  }

  return exclusive.value;
}

/**
 * Reset Sales Order sync: wipe all SO numbers + counter so the next Sync
 * starts from the saved Prefix and Starting number.
 * Disabled when any numbered order has an invoice or packing slip.
 */
export async function resetSalesOrderNumbersSync(shop: string): Promise<
  | {
      ok: true;
      reverted: number;
      lastAllocatedSequence: number | null;
      salesOrderSync: SalesOrderSyncStatus;
      numberSeries: Awaited<ReturnType<typeof loadNumberSeriesForShop>>;
    }
  | {
      ok: false;
      error: string;
      invoicedCount: number;
      packingSlipCount: number;
      blockedCount: number;
    }
> {
  const assigned = await listAssignedSalesOrderGids(shop);
  const [selectedTemplateId, numberSeries] = await Promise.all([
    loadSelectedTemplateForShop(shop, "sales-order"),
    loadNumberSeriesForShop(shop),
  ]);
  const templateId = resolveSalesOrderTemplateId(selectedTemplateId);
  const numbering = numberingFromSeries(numberSeries["sales-order"]);

  if (assigned.orderGids.length === 0) {
    await resetSalesOrderNumberCounter(shop, templateId, numbering);
    const clearedSo = { ...numberSeries["sales-order"] };
    delete (clearedSo as { nextSequence?: number }).nextSequence;
    const savedSeries = await saveNumberSeriesForShop(shop, {
      ...numberSeries,
      "sales-order": clearedSo,
    });
    await clearSalesOrderNumbersSynced(shop);
    invalidateSalesOrdersCache(shop);
    return {
      ok: true,
      reverted: 0,
      lastAllocatedSequence: null,
      salesOrderSync: await getSalesOrderNumbersSyncStatus(shop),
      numberSeries: savedSeries,
    };
  }

  const [invoiced, packing] = await Promise.all([
    getInvoicedOrderGids(shop, assigned.orderGids),
    getPackingSlipOrderGids(shop, assigned.orderGids),
  ]);
  const blockedCount = new Set([...invoiced, ...packing]).size;
  if (blockedCount > 0) {
    const parts: string[] = [];
    if (invoiced.size > 0) {
      parts.push(
        `${invoiced.size} invoice${invoiced.size === 1 ? "" : "s"}`,
      );
    }
    if (packing.size > 0) {
      parts.push(
        `${packing.size} packing slip${packing.size === 1 ? "" : "s"}`,
      );
    }
    return {
      ok: false,
      error: `Cannot reset: synced orders were converted (${parts.join(" and ")}). Delete those documents first, then reset.`,
      invoicedCount: invoiced.size,
      packingSlipCount: packing.size,
      blockedCount,
    };
  }

  // Delete every SO number for this shop (all templates).
  const result = await prisma.salesOrderDocumentNumber.deleteMany({
    where: { shop },
  });

  // Reset counters for every template that had numbers + active template.
  const templateIds = new Set(assigned.templateIds);
  templateIds.add(templateId);
  for (const id of templateIds) {
    await resetSalesOrderNumberCounter(shop, id, numbering);
  }

  const clearedSo = { ...numberSeries["sales-order"] };
  delete (clearedSo as { nextSequence?: number }).nextSequence;
  const savedSeries = await saveNumberSeriesForShop(shop, {
    ...numberSeries,
    "sales-order": clearedSo,
  });

  await clearSalesOrderNumbersSynced(shop);
  invalidateSalesOrdersCache(shop);

  return {
    ok: true,
    reverted: result.count,
    lastAllocatedSequence: null,
    salesOrderSync: await getSalesOrderNumbersSyncStatus(shop),
    numberSeries: savedSeries,
  };
}

/** @deprecated Prefer resetSalesOrderNumbersSync */
export async function undoSalesOrderNumbersSync(shop: string) {
  return resetSalesOrderNumbersSync(shop);
}
