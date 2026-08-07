/** Lightweight order/template ID helpers — safe for list routes (no preset/label payload). */

export const DEFAULT_SALES_ORDER_TEMPLATE_ID = "sales-standard";
export const DEFAULT_INVOICE_TEMPLATE_ID = "invoice-professional";
export const DEFAULT_CREDIT_NOTE_TEMPLATE_ID = "credit-standard";
export const DEFAULT_PACKING_SLIP_TEMPLATE_ID = "packing-standard";

export const SALES_ORDER_TEMPLATE_STORAGE_KEY =
  "invoice-app:selected-template:sales-order";

export function toOrderGid(orderIdParam: string) {
  if (orderIdParam.startsWith("gid://")) return orderIdParam;
  return `gid://shopify/Order/${orderIdParam}`;
}

/** Prefer known sales-* ids; fall back to default without loading template presets. */
export function resolveSalesOrderTemplateId(value: string | null | undefined) {
  if (value?.startsWith("sales-")) return value;
  return DEFAULT_SALES_ORDER_TEMPLATE_ID;
}

export function resolveInvoiceTemplateId(value: string | null | undefined) {
  if (value?.startsWith("invoice-")) return value;
  return DEFAULT_INVOICE_TEMPLATE_ID;
}

export function resolveCreditNoteTemplateId(value: string | null | undefined) {
  if (value?.startsWith("credit-")) return value;
  // Fall back to invoice layout if a legacy invoice template was selected.
  if (value?.startsWith("invoice-")) return value;
  return DEFAULT_CREDIT_NOTE_TEMPLATE_ID;
}

export function resolvePackingSlipTemplateId(value: string | null | undefined) {
  if (value?.startsWith("packing-")) return value;
  return DEFAULT_PACKING_SLIP_TEMPLATE_ID;
}
