import { createAppPageClientCache } from "./client-page-cache";

/** Shared so Sales Order convert can bust Invoice list client cache immediately. */
export const invoiceListClientCache = createAppPageClientCache();

export function bustInvoiceListClientCache() {
  invoiceListClientCache.bust();
}
