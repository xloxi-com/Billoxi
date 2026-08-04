-- AlterTable
ALTER TABLE "OrderInvoiceStatus" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "OrderInvoiceStatus" ADD COLUMN "documentNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OrderInvoiceStatus_shop_sequence_key" ON "OrderInvoiceStatus"("shop", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OrderInvoiceStatus_shop_documentNumber_key" ON "OrderInvoiceStatus"("shop", "documentNumber");
