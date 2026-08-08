-- Advanced Credit Notes automation flags (JSON on ShopSettings).
ALTER TABLE "ShopSettings"
ADD COLUMN IF NOT EXISTS "creditNoteSettings" JSONB NOT NULL DEFAULT '{}'::jsonb;
