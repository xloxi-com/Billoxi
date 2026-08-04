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
