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
  /**
   * Next sequence to assign when higher than lastAllocated+1.
   * Set from editable Preview in Settings.
   */
  nextSequence?: number;
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
    ...(typeof input.nextSequence === "number" &&
    Number.isFinite(input.nextSequence) &&
    input.nextSequence >= 0
      ? { nextSequence: Math.floor(input.nextSequence) }
      : {}),
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

/** Next number that will actually be assigned (uses last allocated sequence). */
export function formatNumberSeriesNextPreview(
  entry: NumberSeriesEntry,
  lastAllocatedSequence: number | null,
): string {
  const next = resolveNumberSeriesNextSequence(entry, lastAllocatedSequence);
  return formatNumberSeriesValue(entry, next);
}

/**
 * Extract the numeric sequence from a document number using series prefix/suffix.
 * e.g. INV-00015 + { prefix: "INV-", suffix: "" } → 15
 */
export function parseNumberSeriesSequence(
  documentNumber: string,
  entry: NumberSeriesEntry,
): number | null {
  return parseNumberSeriesDigits(documentNumber, entry)?.sequence ?? null;
}

/**
 * Parse sequence + digit width (keeps leading-zero width from merchant input).
 * e.g. INV-000100 → { sequence: 100, digitWidth: 6 }
 */
export function parseNumberSeriesDigits(
  documentNumber: string,
  entry: NumberSeriesEntry,
): { sequence: number; digitWidth: number } | null {
  let body = documentNumber.trim();
  if (!body) return null;

  const prefix = entry.prefix ?? "";
  const suffix = entry.suffix ?? "";
  if (prefix) {
    const lower = body.toLowerCase();
    const prefixLower = prefix.toLowerCase();
    if (lower.startsWith(prefixLower)) {
      body = body.slice(prefix.length);
    }
  }
  if (suffix) {
    const lower = body.toLowerCase();
    const suffixLower = suffix.toLowerCase();
    if (lower.endsWith(suffixLower)) {
      body = body.slice(0, body.length - suffix.length);
    }
  }

  const digits = body.replace(/\D/g, "");
  if (!digits) return null;
  const sequence = Number.parseInt(digits, 10);
  if (!Number.isFinite(sequence) || sequence < 0) return null;
  return { sequence, digitWidth: digits.length };
}

/** Widen startingNumber pad so future auto numbers match a manually entered width. */
export function widenStartingNumberPad(
  startingNumber: string,
  digitWidth: number,
): string {
  const startAt = Number.parseInt(startingNumber.replace(/\D/g, ""), 10);
  const start = Number.isFinite(startAt) && startAt >= 0 ? startAt : 1;
  const width = Math.max(digitWidth, startingNumber.replace(/\D/g, "").length, 1);
  return String(start).padStart(width, "0");
}

export function formatNumberSeriesValue(
  entry: NumberSeriesEntry,
  sequence: number,
): string {
  const padLength = Math.max(
    entry.startingNumber.length,
    String(Math.max(0, sequence)).length,
    1,
  );
  return `${entry.prefix}${String(Math.max(0, sequence)).padStart(padLength, "0")}${entry.suffix ?? ""}`;
}

export function resolveNumberSeriesNextSequence(
  entry: NumberSeriesEntry,
  lastAllocatedSequence: number | null,
): number {
  const startAt = Number.parseInt(entry.startingNumber, 10);
  const start = Number.isFinite(startAt) && startAt >= 0 ? startAt : 1;
  const fromLast =
    lastAllocatedSequence == null ? start : lastAllocatedSequence + 1;
  const seeded =
    typeof entry.nextSequence === "number" &&
    Number.isFinite(entry.nextSequence) &&
    entry.nextSequence >= 0
      ? Math.floor(entry.nextSequence)
      : null;
  if (seeded == null) return Math.max(start, fromLast);
  return Math.max(start, fromLast, seeded);
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
