import { randomUUID } from "node:crypto";
import prisma from "./db.server";

export type SetupGuideStepId =
  | "store-details"
  | "templates"
  | "transaction-numbers"
  | "smtp";

export type SetupGuideProgress = Partial<Record<SetupGuideStepId, boolean>>;

function normalizeSetupGuide(value: unknown): SetupGuideProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const next: SetupGuideProgress = {};
  for (const key of [
    "store-details",
    "templates",
    "transaction-numbers",
    "smtp",
  ] as const) {
    if (raw[key] === true) next[key] = true;
  }
  return next;
}

export async function loadSetupGuideProgress(
  shop: string,
): Promise<SetupGuideProgress> {
  try {
    const rows = await prisma.$queryRaw<Array<{ setupGuide: unknown }>>`
      SELECT "setupGuide"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    return normalizeSetupGuide(rows[0]?.setupGuide);
  } catch {
    return {};
  }
}

export async function markSetupGuideStep(
  shop: string,
  step: SetupGuideStepId,
): Promise<SetupGuideProgress> {
  const current = await loadSetupGuideProgress(shop);
  if (current[step]) return current;

  const next: SetupGuideProgress = { ...current, [step]: true };

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
    // Column missing or DB error — don't block the merchant save.
    return current;
  }

  return next;
}
