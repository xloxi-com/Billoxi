-- Advanced Invoice automation flags (JSON on ShopSettings).
ALTER TABLE "ShopSettings"
ADD COLUMN IF NOT EXISTS "invoiceSettings" JSONB NOT NULL DEFAULT '{}'::jsonb;
