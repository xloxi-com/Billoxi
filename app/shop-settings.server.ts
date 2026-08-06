import prisma from "./db.server";
import {
  normalizeNumberSeries,
  normalizeNumberSeriesEntry,
  type NumberSeriesEntry,
  type NumberSeriesMap,
  type NumberSeriesModuleId,
} from "./number-series";
import {
  normalizeSmtpSettings,
  type SmtpSettings,
} from "./smtp-settings";
import {
  mergeStoreDetails,
  normalizeStoreDetails,
  type StoreDetails,
} from "./store-details";
import { fetchShopStoreDefaults } from "./store-details.server";
import { randomUUID } from "node:crypto";

type ShopSettingsRow = {
  id: string;
  shop: string;
  storeDetails: unknown;
  smtpSettings?: unknown;
  selectedTemplates?: unknown;
  numberSeries?: unknown;
};

export type SelectedTemplatesMap = Record<string, string>;

function parseJsonObject(value: unknown): Record<string, unknown> {
  const raw =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return {};
          }
        })()
      : value;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function normalizeSelectedTemplates(value: unknown): SelectedTemplatesMap {
  const record = parseJsonObject(value);
  const next: SelectedTemplatesMap = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string" && entry.trim()) {
      next[key] = entry.trim();
    }
  }
  return next;
}

export async function loadSmtpSettingsForShop(shop: string): Promise<SmtpSettings> {
  const rows = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "smtpSettings"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  return normalizeSmtpSettings(rows[0]?.smtpSettings);
}

export async function saveSmtpSettingsForShop(
  shop: string,
  smtpSettings: SmtpSettings,
): Promise<SmtpSettings> {
  const normalized = normalizeSmtpSettings(smtpSettings);
  const existing = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "smtpSettings"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "smtpSettings" = ${JSON.stringify(normalized)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (id, shop, "storeDetails", "smtpSettings", "createdAt", "updatedAt")
      VALUES (
        ${randomUUID()},
        ${shop},
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify(normalized)}::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
  }

  return normalized;
}

export async function loadStoreDetailsForShop(
  shop: string,
  admin: { graphql: (query: string) => Promise<Response> },
): Promise<StoreDetails> {
  const [rows, shopDefaults] = await Promise.all([
    prisma.$queryRaw<ShopSettingsRow[]>`
      SELECT "storeDetails"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `,
    fetchShopStoreDefaults(admin, shop),
  ]);

  const raw = parseStoreDetailsJson(rows[0]?.storeDetails);
  const merged = mergeStoreDetails(raw, shopDefaults);
  const rawRecord =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  const rawHasAddress = asNonEmptyAddress(rawRecord?.address);
  const rawHasLegacyAddress = Boolean(
    !rawHasAddress &&
      (asNonEmptyAddress(rawRecord?.address1) ||
        asNonEmptyAddress(rawRecord?.city) ||
        asNonEmptyAddress(rawRecord?.country)),
  );
  const filledFromShopify = !rawHasAddress && Boolean(merged.address);

  // Persist migrated / backfilled address so documents keep showing it.
  if (rows[0] && (rawHasLegacyAddress || filledFromShopify)) {
    await saveStoreDetailsForShop(shop, merged);
  }

  return merged;
}

function parseStoreDetailsJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

function asNonEmptyAddress(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function saveStoreDetailsForShop(
  shop: string,
  storeDetails: StoreDetails,
): Promise<StoreDetails> {
  const normalized = normalizeStoreDetails(storeDetails);
  const existing = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "storeDetails"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "storeDetails" = ${JSON.stringify(normalized)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (id, shop, "storeDetails", "smtpSettings", "createdAt", "updatedAt")
      VALUES (
        ${randomUUID()},
        ${shop},
        ${JSON.stringify(normalized)}::jsonb,
        ${JSON.stringify({})}::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
  }

  return normalized;
}

export async function resetStoreDetailsFromShopify(
  shop: string,
  admin: { graphql: (query: string) => Promise<Response> },
): Promise<StoreDetails> {
  const [shopDefaults, rows] = await Promise.all([
    fetchShopStoreDefaults(admin, shop),
    prisma.$queryRaw<ShopSettingsRow[]>`
      SELECT "storeDetails"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `,
  ]);
  const current = normalizeStoreDetails(parseStoreDetailsJson(rows[0]?.storeDetails));
  const next: StoreDetails = {
    ...shopDefaults,
    customFields: current.customFields,
  };
  return saveStoreDetailsForShop(shop, next);
}

export async function loadSelectedTemplatesForShop(
  shop: string,
): Promise<SelectedTemplatesMap> {
  const rows = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "selectedTemplates"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  return normalizeSelectedTemplates(rows[0]?.selectedTemplates);
}

export async function loadSelectedTemplateForShop(
  shop: string,
  documentType: string,
): Promise<string | null> {
  const selected = await loadSelectedTemplatesForShop(shop);
  return selected[documentType] || null;
}

export async function saveSelectedTemplateForShop(
  shop: string,
  documentType: string,
  templateId: string,
): Promise<SelectedTemplatesMap> {
  const trimmedType = documentType.trim();
  const trimmedTemplate = templateId.trim();
  if (!trimmedType || !trimmedTemplate) {
    return loadSelectedTemplatesForShop(shop);
  }

  const existing = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "selectedTemplates"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  const current = normalizeSelectedTemplates(existing[0]?.selectedTemplates);
  const next: SelectedTemplatesMap = {
    ...current,
    [trimmedType]: trimmedTemplate,
  };

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "selectedTemplates" = ${JSON.stringify(next)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (
        id,
        shop,
        "storeDetails",
        "smtpSettings",
        "selectedTemplates",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${shop},
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify(next)}::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
  }

  return next;
}

function numberingFromUnknown(value: unknown): NumberSeriesEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<NumberSeriesEntry>;
  if (
    typeof input.prefix !== "string" &&
    typeof input.startingNumber !== "string" &&
    typeof input.startingNumber !== "number"
  ) {
    return null;
  }
  return normalizeNumberSeriesEntry(input, {
    prefix: "SO-",
    startingNumber: "0001",
    suffix: "",
  });
}

async function seedNumberSeriesFromTemplates(
  shop: string,
  raw: unknown,
  current: NumberSeriesMap,
): Promise<NumberSeriesMap> {
  const record = parseJsonObject(raw);
  // Only seed when the shop has never saved a series (empty JSON).
  if (Object.keys(record).length > 0) return current;

  const selected = await loadSelectedTemplatesForShop(shop);
  const templateId = selected["sales-order"];
  if (!templateId) return current;

  const customization = await prisma.templateCustomization.findUnique({
    where: {
      shop_documentType_templateId: {
        shop,
        documentType: "sales-order",
        templateId,
      },
    },
    select: { settings: true },
  });

  const settings =
    customization?.settings &&
    typeof customization.settings === "object" &&
    !Array.isArray(customization.settings)
      ? (customization.settings as { numbering?: unknown })
      : null;
  const seeded = numberingFromUnknown(settings?.numbering);
  if (!seeded) return current;

  return {
    ...current,
    "sales-order": seeded,
  };
}

export async function loadNumberSeriesForShop(
  shop: string,
): Promise<NumberSeriesMap> {
  const rows = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "numberSeries"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  const raw = rows[0]?.numberSeries;
  const normalized = normalizeNumberSeries(raw);
  const seeded = await seedNumberSeriesFromTemplates(shop, raw, normalized);

  // Persist seed once so Settings and document allocation stay aligned.
  if (JSON.stringify(seeded) !== JSON.stringify(normalized) && rows[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "numberSeries" = ${JSON.stringify(seeded)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  }

  return seeded;
}

export async function loadNumberSeriesEntryForShop(
  shop: string,
  moduleId: NumberSeriesModuleId,
): Promise<NumberSeriesEntry> {
  const series = await loadNumberSeriesForShop(shop);
  return series[moduleId];
}

export async function saveNumberSeriesEntryMode(
  shop: string,
  moduleId: NumberSeriesModuleId,
  entryMode: "auto" | "manual",
): Promise<NumberSeriesEntry> {
  const series = await loadNumberSeriesForShop(shop);
  const next: NumberSeriesMap = {
    ...series,
    [moduleId]: {
      ...series[moduleId],
      entryMode,
    },
  };
  const saved = await saveNumberSeriesForShop(shop, next);
  return saved[moduleId];
}

/** @deprecated Prefer saveNumberSeriesEntryMode(shop, "invoice", mode) */
export async function saveInvoiceNumberEntryMode(
  shop: string,
  entryMode: "auto" | "manual",
): Promise<NumberSeriesEntry> {
  return saveNumberSeriesEntryMode(shop, "invoice", entryMode);
}

export async function saveNumberSeriesForShop(
  shop: string,
  numberSeries: NumberSeriesMap,
): Promise<NumberSeriesMap> {
  const normalized = normalizeNumberSeries(numberSeries);
  const existing = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "numberSeries"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "numberSeries" = ${JSON.stringify(normalized)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (
        id,
        shop,
        "storeDetails",
        "smtpSettings",
        "selectedTemplates",
        "numberSeries",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${shop},
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify(normalized)}::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
  }

  return normalized;
}
