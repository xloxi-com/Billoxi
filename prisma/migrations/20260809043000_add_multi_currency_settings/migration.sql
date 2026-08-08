-- Multi Currency preference (JSON on ShopSettings).
ALTER TABLE "ShopSettings"
ADD COLUMN IF NOT EXISTS "multiCurrencySettings" JSONB NOT NULL DEFAULT '{}'::jsonb;
