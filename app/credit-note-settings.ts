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
  autoOnCancel: true,
  autoOnRefund: true,
  autoOnPartialRefund: true,
};

export function normalizeCreditNoteSettings(
  value: unknown,
): CreditNoteSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultCreditNoteSettings };
  }
  const input = value as Partial<CreditNoteSettings>;
  return {
    // Missing key keeps default on — explicit false only turns off.
    autoOnCancel:
      "autoOnCancel" in input
        ? input.autoOnCancel === true
        : defaultCreditNoteSettings.autoOnCancel,
    autoOnRefund:
      "autoOnRefund" in input
        ? input.autoOnRefund === true
        : defaultCreditNoteSettings.autoOnRefund,
    autoOnPartialRefund:
      "autoOnPartialRefund" in input
        ? input.autoOnPartialRefund === true
        : defaultCreditNoteSettings.autoOnPartialRefund,
  };
}
