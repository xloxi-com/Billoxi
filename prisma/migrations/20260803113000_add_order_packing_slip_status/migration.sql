-- CreateTable
CREATE TABLE "OrderPackingSlipStatus" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderPackingSlipStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPackingSlipStatus_shop_idx" ON "OrderPackingSlipStatus"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "OrderPackingSlipStatus_shop_orderGid_key" ON "OrderPackingSlipStatus"("shop", "orderGid");
