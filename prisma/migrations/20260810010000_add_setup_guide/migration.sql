-- AlterTable
ALTER TABLE "ShopSettings"
ADD COLUMN IF NOT EXISTS "setupGuide" JSONB NOT NULL DEFAULT '{}';
