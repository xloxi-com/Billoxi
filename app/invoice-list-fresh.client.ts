import { bustInvoiceListClientCache } from "./invoice-list-client-cache";

/** Session flag: Invoice list must bypass stale client/server list caches. */
export const INVOICE_LIST_BUST_KEY = "billoxi:invoice-list-bust";

/** Call after convert/delete so the next Invoice list visit loads fresh data. */
export function markInvoiceListNeedsFreshLoad() {
  if (typeof window === "undefined") return;
  try {
    bustInvoiceListClientCache();
    window.sessionStorage.setItem(INVOICE_LIST_BUST_KEY, "1");
  } catch {
    // Ignore quota / private-mode failures — Reload still works.
  }
}
