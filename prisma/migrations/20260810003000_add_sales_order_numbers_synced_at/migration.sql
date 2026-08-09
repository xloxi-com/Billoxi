-- AlterTable
ALTER TABLE "ShopSettings"
ADD COLUMN IF NOT EXISTS "salesOrderNumbersSyncedAt" TIMESTAMP(3);
