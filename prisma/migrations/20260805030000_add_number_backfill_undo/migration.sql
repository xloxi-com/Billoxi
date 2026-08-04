-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "numberBackfillUndo" JSONB;
