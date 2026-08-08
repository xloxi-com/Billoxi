/** Advanced Credit Notes automation (Settings). */

export type CreditNoteSettings = {
  /** Create credit note when a Shopify order is cancelled. */
  autoOnCancel: boolean;
  /** Create credit note on a full refund. */
  autoOnRefund: boolean;
  /** Create credit note on a partial refund. */
  autoOnPartialRefund: boolean;
};

export const defaultCreditNoteSettings: CreditNoteSettings = {
  autoOnCancel: false,
  autoOnRefund: false,
  autoOnPartialRefund: false,
};

export function normalizeCreditNoteSettings(
  value: unknown,
): CreditNoteSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultCreditNoteSettings };
  }
  const input = value as Partial<CreditNoteSettings>;
  return {
    autoOnCancel: input.autoOnCancel === true,
    autoOnRefund: input.autoOnRefund === true,
    autoOnPartialRefund: input.autoOnPartialRefund === true,
  };
}
