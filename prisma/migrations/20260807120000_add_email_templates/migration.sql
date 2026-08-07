-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "emailTemplates" JSONB NOT NULL DEFAULT '{}';
