import { randomUUID } from "node:crypto";
import prisma from "./db.server";
import {
  normalizeAdminUiLanguage,
  type AdminUiLanguage,
} from "./admin-i18n";

export type SetupGuideStepId =
  | "admin-language"
  | "store-details"
  | "templates"
  | "transaction-numbers"
  | "smtp";

export type SetupGuideProgress = Partial<Record<SetupGuideStepId, boolean>> & {
  /** Billoxi admin UI language (menus/pages) — not template/PDF language. */
  adminLanguage?: AdminUiLanguage;
};

const SETUP_GUIDE_STEPS: readonly SetupGuideStepId[] = [
  "admin-language",
  "store-details",
  "templates",
  "transaction-numbers",
  "smtp",
] as const;

const SETUP_GUIDE_TTL_MS = 120_000;
const setupGuideCache = new Map<
  string,
  { expires: number; value: SetupGuideProgress }
>();

function normalizeSetupGuide(value: unknown): SetupGuideProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const next: SetupGuideProgress = {};
  for (const key of SETUP_GUIDE_STEPS) {
    if (raw[key] === true) next[key] = true;
  }
  if (typeof raw.adminLanguage === "string" && raw.adminLanguage.trim()) {
    next.adminLanguage = normalizeAdminUiLanguage(raw.adminLanguage);
    next["admin-language"] = true;
  }
  return next;
}

/** Fill cache from a ShopSettings row already loaded elsewhere. */
export function rememberSetupGuideProgress(
  shop: string,
  raw: unknown,
): SetupGuideProgress {
  const value = normalizeSetupGuide(raw);
  setupGuideCache.set(shop, {
    expires: Date.now() + SETUP_GUIDE_TTL_MS,
    value,
  });
  return value;
}

export async function loadSetupGuideProgress(
  shop: string,
): Promise<SetupGuideProgress> {
  const cached = setupGuideCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const rows = await prisma.$queryRaw<Array<{ setupGuide: unknown }>>`
      SELECT "setupGuide"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    const value = normalizeSetupGuide(rows[0]?.setupGuide);
    setupGuideCache.set(shop, {
      expires: Date.now() + SETUP_GUIDE_TTL_MS,
      value,
    });
    return value;
  } catch {
    return {};
  }
}

export async function loadAdminLanguage(
  shop: string,
): Promise<AdminUiLanguage | null> {
  const progress = await loadSetupGuideProgress(shop);
  return progress.adminLanguage ?? null;
}

async function persistSetupGuide(
  shop: string,
  next: SetupGuideProgress,
): Promise<SetupGuideProgress> {
  try {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "ShopSettings" WHERE shop = ${shop} LIMIT 1
    `;

    if (existing[0]) {
      await prisma.$executeRaw`
        UPDATE "ShopSettings"
        SET "setupGuide" = ${JSON.stringify(next)}::jsonb,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE shop = ${shop}
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO "ShopSettings" (
          id, shop, "storeDetails", "smtpSettings", "setupGuide",
          "createdAt", "updatedAt"
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
  } catch {
    return next;
  }

  setupGuideCache.set(shop, {
    expires: Date.now() + SETUP_GUIDE_TTL_MS,
    value: next,
  });
  return next;
}

export async function markSetupGuideStep(
  shop: string,
  step: SetupGuideStepId,
): Promise<SetupGuideProgress> {
  const current = await loadSetupGuideProgress(shop);
  if (current[step]) return current;

  const next: SetupGuideProgress = { ...current, [step]: true };
  return persistSetupGuide(shop, next);
}

/** Save admin UI language and mark the setup step done. Does not change template/PDF language. */
export async function saveAdminLanguage(
  shop: string,
  language: string,
): Promise<SetupGuideProgress> {
  const current = await loadSetupGuideProgress(shop);
  const adminLanguage = normalizeAdminUiLanguage(language);
  const next: SetupGuideProgress = {
    ...current,
    adminLanguage,
    "admin-language": true,
  };
  return persistSetupGuide(shop, next);
}
