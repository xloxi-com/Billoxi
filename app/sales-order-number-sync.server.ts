import { randomUUID } from "node:crypto";
import prisma from "./db.server";
import { resolveSalesOrderTemplateId } from "./sales-order-document";
import { numberingFromSeries } from "./number-series";
import {
  loadNumberSeriesForShop,
  loadSelectedTemplateForShop,
} from "./shop-settings.server";
import {
  backfillSalesOrderDocumentNumbers,
  fetchAllOrderGidsOldestFirst,
  type AdminGraphql,
} from "./sales-order-number.server";
import { invalidateSalesOrdersCache } from "./sales-orders.server";

const syncInFlight = new Map<string, Promise<void>>();
/** Process-local cache — skip DB check after first confirmed sync. */
const syncedShops = new Set<string>();

async function hasSalesOrderNumbersSynced(shop: string): Promise<boolean> {
  if (syncedShops.has(shop)) return true;
  try {
    const rows = await prisma.$queryRaw<
      Array<{ salesOrderNumbersSyncedAt: Date | null }>
    >`
      SELECT "salesOrderNumbersSyncedAt"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const synced = Boolean(rows[0]?.salesOrderNumbersSyncedAt);
    if (synced) syncedShops.add(shop);
    return synced;
  } catch {
    return false;
  }
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
    if (Number(updated) > 0) return;

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
  } catch (error) {
    console.error(
      "[sales-order-sync] Failed to mark numbers synced",
      shop,
      error,
    );
  }
}

/**
 * One-time sync: assign SO numbers to existing Shopify orders (oldest first).
 * Safe to call on every request — no-ops after the first successful run.
 */
export async function ensureSalesOrderNumbersSynced(
  shop: string,
  admin: AdminGraphql,
): Promise<void> {
  const existing = syncInFlight.get(shop);
  if (existing) return existing;

  const run = (async () => {
    if (await hasSalesOrderNumbersSynced(shop)) return;

    const [selectedTemplateId, numberSeries, orderGids] = await Promise.all([
      loadSelectedTemplateForShop(shop, "sales-order"),
      loadNumberSeriesForShop(shop),
      fetchAllOrderGidsOldestFirst(admin),
    ]);
    const templateId = resolveSalesOrderTemplateId(selectedTemplateId);

    await backfillSalesOrderDocumentNumbers(
      shop,
      templateId,
      numberingFromSeries(numberSeries["sales-order"]),
      orderGids,
    );
    await markSalesOrderNumbersSynced(shop);
    syncedShops.add(shop);
    invalidateSalesOrdersCache(shop);
  })()
    .catch((error) => {
      console.error(
        "[sales-order-sync] Failed to sync existing order numbers",
        shop,
        error,
      );
    })
    .finally(() => {
      syncInFlight.delete(shop);
    });

  syncInFlight.set(shop, run);
  await run;
}
