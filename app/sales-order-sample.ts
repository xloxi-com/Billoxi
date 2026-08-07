import type { SalesOrderDocumentData } from "./sales-order-document";

/**
 * Shared sample order for template Preview.
 * Uses real ecommerce-style product photos (CORS-friendly CDNs).
 * Line Amount = Qty × Rate − Discount; tax on amount; totals:
 * Subtotal (gross) − Discount + Shipping + Tax = Total.
 *
 * `currencyCode` is overridden per shop via `sampleSalesOrderForShop()`.
 */
export const sampleSalesOrder: SalesOrderDocumentData = {
  id: "gid://shopify/Order/0",
  name: "#1008",
  createdAt: "2026-07-19T10:00:00.000Z",
  expectedShipmentDate: "25-07-2026",
  paymentMethod: "Bank Transfer",
  email: "xloxi@acme.example",
  phone: "+1 (512) 555-0147",
  customerId: null,
  customerName: "Jane Cooper",
  billing: {
    company: "Acme Retail Co.",
    name: "Jane Cooper",
    address: ["742 Evergreen Avenue", "Austin, TX 78701", "USA"],
    phone: "+1 (512) 555-0147",
    email: "xloxi@acme.example",
  },
  shipping: {
    company: "Acme Retail Co.",
    name: "Jane Cooper",
    address: ["88 Harbor Lane", "Austin, TX 78702", "USA"],
    phone: "+1 (512) 555-0199",
    email: "xloxi@acme.example",
  },
  customer: {
    company: "Acme Retail Co.",
    name: "Jane Cooper",
    address: ["742 Evergreen Avenue", "Austin, TX 78701", "USA"],
    phone: "+1 (512) 555-0147",
    email: "xloxi@acme.example",
  },
  terms: "Due on Receipt",
  orderNote: "Please gift-wrap and include the packing slip.",
  lineItems: [
    {
      title: "Classic Leather Watch",
      variantTitle: "Brown strap / Silver dial",
      imageUrl:
        "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png",
      quantity: "1.00",
      // Unit before discount — Show Compare Price → 270.00 + strike 300.00
      rate: "300.00",
      compareAtPrice: "350.00",
      discount: "30.00",
      discountPercentage: "10.00%",
      taxPercentage: "5.20%",
      taxAmount: "14.04",
      amount: "270.00",
      sku: "WATCH-CL-01",
    },
    {
      title: "Wireless Headphones",
      variantTitle: "Matte black / Noise cancelling",
      imageUrl:
        "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-2_large.png",
      quantity: "1.00",
      rate: "250.00",
      compareAtPrice: "299.00",
      discount: "0.00",
      discountPercentage: "0.00%",
      taxPercentage: "5.20%",
      taxAmount: "13.00",
      amount: "250.00",
      sku: "AUDIO-WH-02",
    },
    {
      title: "Running Sneakers",
      variantTitle: "Size 42 / Crimson red",
      imageUrl:
        "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-3_large.png",
      quantity: "1.00",
      rate: "80.00",
      compareAtPrice: "95.00",
      discount: "0.00",
      discountPercentage: "0.00%",
      taxPercentage: "5.20%",
      taxAmount: "4.16",
      amount: "80.00",
      sku: "SHOE-RN-03",
    },
  ],
  // Gross of line rates (300+250+80)
  subtotal: "630.00",
  discount: "0.00",
  shippingPrice: "0.00",
  tax: "32.75",
  // 630 + 11.75 + 21.00
  total: "662.75",
  paidAmount: "662.75",
  balanceDue: "0.00",
  refundedAmount: "0.00",
  currencyCode: "USD",
  taxSummary: [
    {
      title: "Sample Tax1",
      rate: "4.70%",
      taxableAmount: "250.00",
      taxAmount: "11.75",
    },
    {
      title: "Sample Tax2",
      rate: "7.00%",
      taxableAmount: "300.00",
      taxAmount: "21.00",
    },
  ],
};

/** Sample preview order using the shop's Shopify currency. */
export function sampleSalesOrderForShop(
  currencyCode?: string | null,
): SalesOrderDocumentData {
  const code = (currencyCode || "USD").trim().toUpperCase() || "USD";
  return {
    ...sampleSalesOrder,
    currencyCode: code,
  };
}

/** Sample credit-note preview — shows credit/refund amount on totals. */
export function sampleCreditNoteForShop(
  currencyCode?: string | null,
): SalesOrderDocumentData {
  const base = sampleSalesOrderForShop(currencyCode);
  return {
    ...base,
    financialStatus: "REFUNDED",
    paidAmount: "0.00",
    balanceDue: "0.00",
    refundedAmount: base.total,
    shippingPrice: "0.00",
    // Invoice Ref# on credit notes — never the Shopify order name.
    referenceNumber: "INV-0001",
  };
}
