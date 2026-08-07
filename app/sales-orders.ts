/** Shared sales-order list view config (safe for client + server). */

/** Sentinel for app-owned Invoiced view (not a Shopify search term). */
export const INVOICED_VIEW_QUERY = "__invoiced__";

export const SALES_ORDER_VIEWS = [
  { id: "all", label: "All", query: "" },
  { id: "unpaid", label: "Unpaid", query: "financial_status:unpaid" },
  { id: "paid", label: "Paid", query: "financial_status:paid" },
  { id: "voided", label: "Voided", query: "financial_status:voided" },
  { id: "invoiced", label: "Invoiced", query: INVOICED_VIEW_QUERY },
  { id: "open", label: "Open", query: "status:open" },
] as const;

export type SalesOrderViewId = (typeof SALES_ORDER_VIEWS)[number]["id"];

export const INVOICED_VIEW_INDEX = SALES_ORDER_VIEWS.findIndex(
  (view) => view.id === "invoiced",
);

export const VIEW_QUERIES = SALES_ORDER_VIEWS.map((view) => view.query);

/** Invoice list tabs — filter by payment status (list is already invoiced-only). */
export const INVOICE_LIST_VIEWS = [
  { id: "all", label: "All", payment: "" },
  { id: "unpaid", label: "Unpaid", payment: "unpaid" },
  { id: "paid", label: "Paid", payment: "paid" },
  { id: "voided", label: "Voided", payment: "voided" },
  { id: "refunded", label: "Refunded", payment: "refunded" },
] as const;

/** Credit note list tabs — same payment filters as invoice list. */
export const CREDIT_NOTE_LIST_VIEWS = INVOICE_LIST_VIEWS;
