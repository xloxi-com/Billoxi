export type CustomerDownloadDocumentType =
  | "sales-order"
  | "invoice"
  | "draft"
  | "return"
  | "credit-note"
  | "packing-slip";

export const CUSTOMER_DOWNLOAD_DOCUMENT_TYPES: Array<{
  id: CustomerDownloadDocumentType;
  label: string;
  linkLabel: string;
}> = [
  {
    id: "sales-order",
    label: "Sales Orders",
    linkLabel: "Download your sales order",
  },
  { id: "invoice", label: "Invoice", linkLabel: "Download your invoice" },
  { id: "draft", label: "Draft", linkLabel: "Download your draft" },
  { id: "return", label: "Return", linkLabel: "Download your return form" },
  {
    id: "credit-note",
    label: "Credit Note",
    linkLabel: "Download your credit note",
  },
  {
    id: "packing-slip",
    label: "Packing Slip",
    linkLabel: "Download your packing slip",
  },
];

export function isCustomerDownloadDocumentType(
  value: string,
): value is CustomerDownloadDocumentType {
  return CUSTOMER_DOWNLOAD_DOCUMENT_TYPES.some((item) => item.id === value);
}
