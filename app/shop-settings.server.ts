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
  emailTemplatesNeedReadySeed,
  normalizeEmailTemplatesSettings,
  type EmailTemplatesSettings,
} from "./email-templates";
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
  emailTemplates?: unknown;
  selectedTemplates?: unknown;
  numberSeries?: unknown;
};

export type SelectedTemplatesMap = Record<string, string>;

const SELECTED_TEMPLATES_TTL_MS = 120_000;
const selectedTemplatesCache = new Map<
  string,
  { expires: number; value: SelectedTemplatesMap }
>();

const NUMBER_SERIES_TTL_MS = 120_000;
const numberSeriesCache = new Map<
  string,
  { expires: number; value: NumberSeriesMap }
>();

const STORE_DETAILS_TTL_MS = 120_000;
const storeDetailsCache = new Map<
  string,
  { expires: number; value: StoreDetails }
>();

function invalidateStoreDetailsCache(shop: string) {
  for (const key of storeDetailsCache.keys()) {
    if (key.startsWith(`${shop}|`)) storeDetailsCache.delete(key);
  }
}

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

  // Blank password means "keep the previously saved password".
  if (!normalized.password && existing[0]?.smtpSettings) {
    const previous = normalizeSmtpSettings(existing[0].smtpSettings);
    if (previous.password) {
      normalized.password = previous.password;
    }
  }

  // Having a host implies SMTP is ready to use.
  normalized.enabled = Boolean(normalized.host);

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

export async function loadEmailTemplatesForShop(
  shop: string,
): Promise<EmailTemplatesSettings> {
  try {
    const rows = await prisma.$queryRaw<ShopSettingsRow[]>`
      SELECT id, shop, "emailTemplates"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const raw = rows[0]?.emailTemplates;
    const normalized = normalizeEmailTemplatesSettings(raw);
    // Persist built-in ready templates for all 4 document types so Send uses them.
    if (emailTemplatesNeedReadySeed(raw)) {
      try {
        await saveEmailTemplatesForShop(shop, normalized);
      } catch {
        // Ignore persist errors (e.g. migration pending); still return ready copy.
      }
    }
    return normalized;
  } catch {
    // Column may not exist until migration runs — fall back to defaults.
    return normalizeEmailTemplatesSettings(null);
  }
}

export async function saveEmailTemplatesForShop(
  shop: string,
  emailTemplates: EmailTemplatesSettings,
): Promise<EmailTemplatesSettings> {
  const normalized = normalizeEmailTemplatesSettings(emailTemplates);
  const existing = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "emailTemplates" = ${JSON.stringify(normalized)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (id, shop, "storeDetails", "smtpSettings", "emailTemplates", "createdAt", "updatedAt")
      VALUES (
        ${randomUUID()},
        ${shop},
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

export async function loadStoreDetailsForShop(
  shop: string,
  admin: { graphql: (query: string) => Promise<Response> },
  options?: { includeLogo?: boolean },
): Promise<StoreDetails> {
  const includeLogo = options?.includeLogo !== false;
  const cacheKey = `${shop}|logo:${includeLogo ? "1" : "0"}`;
  const cached = storeDetailsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  const rows = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT "storeDetails"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  const raw = parseStoreDetailsJson(rows[0]?.storeDetails);
  const fromDb = normalizeStoreDetails(raw);
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

  let result: StoreDetails;

  // Fast path: shop already saved complete store details — skip Shopify GraphQL.
  if (
    rows[0] &&
    rawHasAddress &&
    fromDb.name &&
    !rawHasLegacyAddress
  ) {
    result = fromDb;
  } else {
    const shopDefaults = await fetchShopStoreDefaults(admin, shop);
    const merged = mergeStoreDetails(raw, shopDefaults);
    const filledFromShopify = !rawHasAddress && Boolean(merged.address);

    // Persist migrated / backfilled address so documents keep showing it.
    if (rows[0] && (rawHasLegacyAddress || filledFromShopify)) {
      await saveStoreDetailsForShop(shop, merged);
    }
    result = merged;
  }

  if (!includeLogo) {
    const { logoDataUrl: _logo, logoFileName: _name, ...rest } = result;
    result = rest;
  }

  storeDetailsCache.set(cacheKey, {
    expires: Date.now() + STORE_DETAILS_TTL_MS,
    value: result,
  });
  return result;
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

  invalidateStoreDetailsCache(shop);
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
    ...(current.logoDataUrl
      ? {
          logoDataUrl: current.logoDataUrl,
          ...(current.logoFileName ? { logoFileName: current.logoFileName } : {}),
        }
      : {}),
  };
  return saveStoreDetailsForShop(shop, next);
}

export async function loadSelectedTemplatesForShop(
  shop: string,
): Promise<SelectedTemplatesMap> {
  const cached = selectedTemplatesCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.value;

  const rows = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT "selectedTemplates"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  const value = normalizeSelectedTemplates(rows[0]?.selectedTemplates);
  selectedTemplatesCache.set(shop, {
    expires: Date.now() + SELECTED_TEMPLATES_TTL_MS,
    value,
  });
  return value;
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

  selectedTemplatesCache.set(shop, {
    expires: Date.now() + SELECTED_TEMPLATES_TTL_MS,
    value: next,
  });
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
  const cached = numberSeriesCache.get(shop);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

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

  numberSeriesCache.set(shop, {
    expires: Date.now() + NUMBER_SERIES_TTL_MS,
    value: seeded,
  });
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

  numberSeriesCache.set(shop, {
    expires: Date.now() + NUMBER_SERIES_TTL_MS,
    value: normalized,
  });
  return normalized;
}
