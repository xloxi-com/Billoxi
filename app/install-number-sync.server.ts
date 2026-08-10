import {
  hasDraftOrderNumbersSynced,
  syncDraftOrderNumbersForShop,
} from "./draft-order-number-sync.server";
import {
  hasInvoiceOrderNumbersSynced,
  syncInvoiceOrderNumbersForShop,
} from "./invoice-order-number-sync.server";
import {
  hasReturnOrderNumbersSynced,
  syncReturnOrderNumbersForShop,
} from "./return-order-number-sync.server";
import {
  hasSalesOrderNumbersSynced,
  syncSalesOrderNumbersForShop,
} from "./sales-order-number-sync.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/** In-flight install syncs — allow retry if backfill did not finish. */
const inFlightByShop = new Map<string, Promise<void>>();
const completedShops = new Set<string>();

/**
 * After install / first open: backfill SO / INV / DFT / RET numbers once
 * (oldest → newest). Fire-and-forget; helpers are idempotent when synced.
 * Retries on the next app open if any series is still unsynced.
 */
export function scheduleInstallNumberSync(
  shop: string,
  admin: AdminGraphql,
): void {
  const key = shop.trim().toLowerCase();
  if (!key || completedShops.has(key) || inFlightByShop.has(key)) return;

  const run = (async () => {
    try {
      const [so, invoice, draft, ret] = await Promise.all([
        hasSalesOrderNumbersSynced(shop),
        hasInvoiceOrderNumbersSynced(shop),
        hasDraftOrderNumbersSynced(shop),
        hasReturnOrderNumbersSynced(shop),
      ]);

      if (so && invoice && draft && ret) {
        completedShops.add(key);
        return;
      }

      // Sequential — lower Shopify GraphQL pressure on large catalogs.
      if (!so) {
        try {
          await syncSalesOrderNumbersForShop(shop, admin);
        } catch (error) {
          console.warn("[install-number-sync] sales-order failed", shop, error);
        }
      }
      if (!invoice) {
        try {
          await syncInvoiceOrderNumbersForShop(shop, admin);
        } catch (error) {
          console.warn("[install-number-sync] invoice failed", shop, error);
        }
      }
      if (!draft) {
        try {
          await syncDraftOrderNumbersForShop(shop, admin);
        } catch (error) {
          console.warn("[install-number-sync] draft failed", shop, error);
        }
      }
      if (!ret) {
        try {
          await syncReturnOrderNumbersForShop(shop, admin);
        } catch (error) {
          console.warn("[install-number-sync] return failed", shop, error);
        }
      }

      const [soDone, invDone, draftDone, retDone] = await Promise.all([
        hasSalesOrderNumbersSynced(shop),
        hasInvoiceOrderNumbersSynced(shop),
        hasDraftOrderNumbersSynced(shop),
        hasReturnOrderNumbersSynced(shop),
      ]);
      if (soDone && invDone && draftDone && retDone) {
        completedShops.add(key);
      }
    } catch (error) {
      console.error("[install-number-sync] failed", shop, error);
    }
  })();

  inFlightByShop.set(key, run);
  void run.finally(() => {
    inFlightByShop.delete(key);
  });
}
