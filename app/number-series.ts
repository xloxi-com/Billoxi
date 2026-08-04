export type NumberSeriesModuleId =
  | "sales-order"
  | "invoice"
  | "credit-note"
  | "packing-slip";

export type NumberSeriesEntryMode = "auto" | "manual";

export type NumberSeriesEntry = {
  prefix: string;
  startingNumber: string;
  suffix: string;
  /** Invoice (and similar): auto-allocate vs merchant types numbers manually. */
  entryMode?: NumberSeriesEntryMode;
};

export type NumberSeriesMap = Record<NumberSeriesModuleId, NumberSeriesEntry>;

export const NUMBER_SERIES_MODULES: Array<{
  id: NumberSeriesModuleId;
  label: string;
  defaults: NumberSeriesEntry;
}> = [
  {
    id: "sales-order",
    label: "Sales Order",
    defaults: {
      prefix: "SO-",
      startingNumber: "0001",
      suffix: "",
      entryMode: "auto",
    },
  },
  {
    id: "invoice",
    label: "Invoice",
    defaults: {
      prefix: "INV-",
      startingNumber: "0001",
      suffix: "",
      entryMode: "auto",
    },
  },
  {
    id: "credit-note",
    label: "Credit Note",
    defaults: { prefix: "CN-", startingNumber: "0001", suffix: "" },
  },
  {
    id: "packing-slip",
    label: "Packing Slip",
    defaults: { prefix: "PS-", startingNumber: "0001", suffix: "" },
  },
];

function digitsOnly(value: unknown, fallback: string): string {
  const raw =
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : fallback;
}

export function defaultNumberSeries(): NumberSeriesMap {
  return NUMBER_SERIES_MODULES.reduce((acc, module) => {
    acc[module.id] = { ...module.defaults };
    return acc;
  }, {} as NumberSeriesMap);
}

export function normalizeNumberSeriesEntry(
  value: unknown,
  defaults: NumberSeriesEntry,
): NumberSeriesEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaults };
  }

  const input = value as Partial<NumberSeriesEntry>;
  const entryMode =
    input.entryMode === "manual" || input.entryMode === "auto"
      ? input.entryMode
      : defaults.entryMode;

  return {
    prefix: typeof input.prefix === "string" ? input.prefix : defaults.prefix,
    startingNumber: digitsOnly(input.startingNumber, defaults.startingNumber),
    suffix: typeof input.suffix === "string" ? input.suffix : defaults.suffix,
    ...(entryMode ? { entryMode } : {}),
  };
}

export function normalizeNumberSeries(value: unknown): NumberSeriesMap {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return NUMBER_SERIES_MODULES.reduce((acc, module) => {
    acc[module.id] = normalizeNumberSeriesEntry(
      record[module.id],
      module.defaults,
    );
    return acc;
  }, {} as NumberSeriesMap);
}

export function formatNumberSeriesPreview(entry: NumberSeriesEntry): string {
  return `${entry.prefix}${entry.startingNumber}${entry.suffix ?? ""}`;
}

export function formatNumberSeriesValue(
  entry: NumberSeriesEntry,
  sequence: number,
): string {
  const padLength = Math.max(entry.startingNumber.length, 1);
  return `${entry.prefix}${String(Math.max(0, sequence)).padStart(padLength, "0")}${entry.suffix ?? ""}`;
}

export function resolveNumberSeriesNextSequence(
  entry: NumberSeriesEntry,
  lastAllocatedSequence: number | null,
): number {
  const startAt = Number.parseInt(entry.startingNumber, 10);
  const start = Number.isFinite(startAt) && startAt >= 0 ? startAt : 1;
  if (lastAllocatedSequence == null) return start;
  return Math.max(start, lastAllocatedSequence + 1);
}

export function numberingFromSeries(
  entry: NumberSeriesEntry,
): {
  prefix: string;
  startingNumber: string;
  suffix: string;
} {
  return {
    prefix: entry.prefix,
    startingNumber: entry.startingNumber,
    suffix: entry.suffix ?? "",
  };
}
