/** Advanced Invoice automation (Settings → Advanced). */

export type InvoiceSettings = {
  /** Auto-convert sales order → invoice when Shopify marks the order paid. */
  autoOnPaid: boolean;
};

export const defaultInvoiceSettings: InvoiceSettings = {
  // Match previous always-on orders/paid behavior.
  autoOnPaid: true,
};

export function normalizeInvoiceSettings(value: unknown): InvoiceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultInvoiceSettings };
  }
  const input = value as Partial<InvoiceSettings>;
  // Explicit false only — missing key keeps default on.
  if (!("autoOnPaid" in input)) {
    return { ...defaultInvoiceSettings };
  }
  return {
    autoOnPaid: input.autoOnPaid === true,
  };
}
