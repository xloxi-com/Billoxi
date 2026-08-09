/** Settings → Multi Currency. */

export type MultiCurrencyMode = "off" | "shopify";

export type MultiCurrencySettings = {
  mode: MultiCurrencyMode;
};

export const defaultMultiCurrencySettings: MultiCurrencySettings = {
  // Keep shop currency until the merchant opts into multi-currency.
  mode: "off",
};

export function isMultiCurrencyMode(
  value: unknown,
): value is MultiCurrencyMode {
  return value === "off" || value === "shopify";
}

export function normalizeMultiCurrencySettings(
  value: unknown,
): MultiCurrencySettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultMultiCurrencySettings };
  }
  const input = value as Partial<MultiCurrencySettings> & { mode?: unknown };
  // Legacy "coin" mode used presentment currency the same way Shopify does.
  if (input.mode === "coin") {
    return { mode: "shopify" };
  }
  if (!("mode" in input) || !isMultiCurrencyMode(input.mode)) {
    return { ...defaultMultiCurrencySettings };
  }
  return { mode: input.mode };
}

/** Use checkout/presentment currency when multi-currency is enabled. */
export function usesPresentmentCurrency(mode: MultiCurrencyMode): boolean {
  return mode === "shopify";
}
