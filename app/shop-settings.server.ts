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
  normalizeCreditNoteSettings,
  type CreditNoteSettings,
} from "./credit-note-settings";
import {
  normalizeInvoiceSettings,
  type InvoiceSettings,
} from "./invoice-settings";
import {
  normalizeMultiCurrencySettings,
  type MultiCurrencySettings,
} from "./multi-currency-settings";
import {
  emptyStoreDetails,
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
  creditNoteSettings?: unknown;
  invoiceSettings?: unknown;
  multiCurrencySettings?: unknown;
  selectedTemplates?: unknown;
  numberSeries?: unknown;
};

export type SelectedTemplatesMap = Record<string, string>;

const SELECTED_TEMPLATES_TTL_MS = 120_000;
const selectedTemplatesCache = new Map<
  string,
  { expires: number; value: SelectedTemplatesMap }
>();

const SMTP_SETTINGS_TTL_MS = 120_000;
const smtpSettingsCache = new Map<
  string,
  { expires: number; value: SmtpSettings }
>();

const CREDIT_NOTE_SETTINGS_TTL_MS = 120_000;
const creditNoteSettingsCache = new Map<
  string,
  { expires: number; value: CreditNoteSettings }
>();

const INVOICE_SETTINGS_TTL_MS = 120_000;
const invoiceSettingsCache = new Map<
  string,
  { expires: number; value: InvoiceSettings }
>();

const MULTI_CURRENCY_SETTINGS_TTL_MS = 120_000;
const multiCurrencySettingsCache = new Map<
  string,
  { expires: number; value: MultiCurrencySettings }
>();

const EMAIL_TEMPLATES_TTL_MS = 120_000;
const emailTemplatesCache = new Map<
  string,
  { expires: number; value: EmailTemplatesSettings }
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
  const cached = smtpSettingsCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.value;

  const rows = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "smtpSettings"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  const value = normalizeSmtpSettings(rows[0]?.smtpSettings);
  smtpSettingsCache.set(shop, {
    expires: Date.now() + SMTP_SETTINGS_TTL_MS,
    value,
  });
  return value;
}

export async function loadCreditNoteSettingsForShop(
  shop: string,
): Promise<CreditNoteSettings> {
  const cached = creditNoteSettingsCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const rows = await prisma.$queryRaw<
      Array<{ creditNoteSettings: unknown }>
    >`
      SELECT "creditNoteSettings"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const value = normalizeCreditNoteSettings(rows[0]?.creditNoteSettings);
    creditNoteSettingsCache.set(shop, {
      expires: Date.now() + CREDIT_NOTE_SETTINGS_TTL_MS,
      value,
    });
    return value;
  } catch {
    return normalizeCreditNoteSettings(null);
  }
}

export async function saveCreditNoteSettingsForShop(
  shop: string,
  creditNoteSettings: CreditNoteSettings,
): Promise<CreditNoteSettings> {
  const normalized = normalizeCreditNoteSettings(creditNoteSettings);
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "ShopSettings" WHERE shop = ${shop} LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "creditNoteSettings" = ${JSON.stringify(normalized)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (
        id, shop, "storeDetails", "smtpSettings", "creditNoteSettings",
        "createdAt", "updatedAt"
      )
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

  creditNoteSettingsCache.set(shop, {
    expires: Date.now() + CREDIT_NOTE_SETTINGS_TTL_MS,
    value: normalized,
  });
  return normalized;
}

export async function loadInvoiceSettingsForShop(
  shop: string,
): Promise<InvoiceSettings> {
  const cached = invoiceSettingsCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const rows = await prisma.$queryRaw<
      Array<{ invoiceSettings: unknown }>
    >`
      SELECT "invoiceSettings"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const value = normalizeInvoiceSettings(rows[0]?.invoiceSettings);
    invoiceSettingsCache.set(shop, {
      expires: Date.now() + INVOICE_SETTINGS_TTL_MS,
      value,
    });
    return value;
  } catch {
    return normalizeInvoiceSettings(null);
  }
}

export async function saveInvoiceSettingsForShop(
  shop: string,
  invoiceSettings: InvoiceSettings,
): Promise<InvoiceSettings> {
  const normalized = normalizeInvoiceSettings(invoiceSettings);
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "ShopSettings" WHERE shop = ${shop} LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "invoiceSettings" = ${JSON.stringify(normalized)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (
        id, shop, "storeDetails", "smtpSettings", "creditNoteSettings",
        "invoiceSettings", "createdAt", "updatedAt"
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

  invoiceSettingsCache.set(shop, {
    expires: Date.now() + INVOICE_SETTINGS_TTL_MS,
    value: normalized,
  });
  return normalized;
}

export async function loadMultiCurrencySettingsForShop(
  shop: string,
): Promise<MultiCurrencySettings> {
  const cached = multiCurrencySettingsCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const rows = await prisma.$queryRaw<
      Array<{ multiCurrencySettings: unknown }>
    >`
      SELECT "multiCurrencySettings"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const value = normalizeMultiCurrencySettings(
      rows[0]?.multiCurrencySettings,
    );
    multiCurrencySettingsCache.set(shop, {
      expires: Date.now() + MULTI_CURRENCY_SETTINGS_TTL_MS,
      value,
    });
    return value;
  } catch {
    return normalizeMultiCurrencySettings(null);
  }
}

export async function saveMultiCurrencySettingsForShop(
  shop: string,
  multiCurrencySettings: MultiCurrencySettings,
): Promise<MultiCurrencySettings> {
  const normalized = normalizeMultiCurrencySettings(multiCurrencySettings);
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "ShopSettings" WHERE shop = ${shop} LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "multiCurrencySettings" = ${JSON.stringify(normalized)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (
        id, shop, "storeDetails", "smtpSettings", "creditNoteSettings",
        "invoiceSettings", "multiCurrencySettings", "createdAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${shop},
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify(normalized)}::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
  }

  multiCurrencySettingsCache.set(shop, {
    expires: Date.now() + MULTI_CURRENCY_SETTINGS_TTL_MS,
    value: normalized,
  });
  return normalized;
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

  smtpSettingsCache.delete(shop);
  return normalized;
}

export async function loadEmailTemplatesForShop(
  shop: string,
): Promise<EmailTemplatesSettings> {
  const cached = emailTemplatesCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.value;

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
    } else {
      emailTemplatesCache.set(shop, {
        expires: Date.now() + EMAIL_TEMPLATES_TTL_MS,
        value: normalized,
      });
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

  emailTemplatesCache.set(shop, {
    expires: Date.now() + EMAIL_TEMPLATES_TTL_MS,
    value: normalized,
  });
  return normalized;
}

export async function loadStoreDetailsForShop(
  shop: string,
  admin: { graphql: (query: string) => Promise<Response> },
  options?: { includeLogo?: boolean },
): Promise<StoreDetails> {
  // `admin` kept for call-site compatibility; Shopify data is only loaded via
  // explicit "Load from Shopify store" (resetStoreDetailsFromShopify).
  void admin;

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

  // First install: empty until merchant Save or Load from Shopify.
  if (!isMerchantSavedStoreDetails(raw)) {
    const empty = {
      ...emptyStoreDetails,
      customFields: [] as StoreDetails["customFields"],
    };
    storeDetailsCache.set(cacheKey, {
      expires: Date.now() + STORE_DETAILS_TTL_MS,
      value: empty,
    });
    return empty;
  }

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

  let result: StoreDetails = fromDb;

  if (rows[0] && rawHasLegacyAddress && fromDb.address) {
    await saveStoreDetailsForShop(shop, fromDb);
    result = fromDb;
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

/** True only after merchant Save or Load from Shopify — not auto-fill. */
function isMerchantSavedStoreDetails(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as { merchantSaved?: unknown }).merchantSaved === true;
}

export async function saveStoreDetailsForShop(
  shop: string,
  storeDetails: StoreDetails,
): Promise<StoreDetails> {
  const normalized = normalizeStoreDetails(storeDetails);
  const payload = { ...normalized, merchantSaved: true };
  const existing = await prisma.$queryRaw<ShopSettingsRow[]>`
    SELECT id, shop, "storeDetails"
    FROM "ShopSettings"
    WHERE shop = ${shop}
    LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE "ShopSettings"
      SET "storeDetails" = ${JSON.stringify(payload)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (id, shop, "storeDetails", "smtpSettings", "createdAt", "updatedAt")
      VALUES (
        ${randomUUID()},
        ${shop},
        ${JSON.stringify(payload)}::jsonb,
        ${JSON.stringify({})}::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
  }

  invalidateStoreDetailsCache(shop);
  // Template document payload embeds storeDetails (logo/name) — bust that cache too.
  const { invalidateDocumentTemplateSettingsCache } = await import(
    "./sales-order-document.server"
  );
  invalidateDocumentTemplateSettingsCache(shop);
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
