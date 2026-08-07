-- AlterTable
ALTER TABLE "OrderPackingSlipStatus" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "OrderPackingSlipStatus" ADD COLUMN "documentNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OrderPackingSlipStatus_shop_sequence_key" ON "OrderPackingSlipStatus"("shop", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPackingSlipStatus_shop_documentNumber_key" ON "OrderPackingSlipStatus"("shop", "documentNumber");
