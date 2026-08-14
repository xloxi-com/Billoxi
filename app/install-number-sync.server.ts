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

/**
 * After install / first open / DB reset: backfill SO / INV / DFT / RET numbers
 * (oldest → newest). Fire-and-forget; helpers are idempotent when synced.
 * Always re-checks DB flags so a process-local memo cannot skip after reset.
 */
export function scheduleInstallNumberSync(
  shop: string,
  admin: AdminGraphql,
): void {
  const key = shop.trim().toLowerCase();
  if (!key || inFlightByShop.has(key)) return;

  const run = (async () => {
    try {
      const [so, invoice, draft, ret] = await Promise.all([
        hasSalesOrderNumbersSynced(shop),
        hasInvoiceOrderNumbersSynced(shop),
        hasDraftOrderNumbersSynced(shop),
        hasReturnOrderNumbersSynced(shop),
      ]);

      if (so && invoice && draft && ret) {
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
    } catch (error) {
      console.error("[install-number-sync] failed", shop, error);
    }
  })();

  inFlightByShop.set(key, run);
  void run.finally(() => {
    inFlightByShop.delete(key);
  });
}
