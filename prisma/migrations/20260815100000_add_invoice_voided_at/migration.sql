-- AlterTable
ALTER TABLE "OrderInvoiceStatus" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
