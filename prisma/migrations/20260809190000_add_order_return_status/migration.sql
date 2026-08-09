-- CreateTable
CREATE TABLE IF NOT EXISTS "OrderReturnStatus" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" INTEGER,
    "documentNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderReturnStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderReturnStatus_shop_idx" ON "OrderReturnStatus"("shop");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrderReturnStatus_shop_orderGid_key" ON "OrderReturnStatus"("shop", "orderGid");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrderReturnStatus_shop_sequence_key" ON "OrderReturnStatus"("shop", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrderReturnStatus_shop_documentNumber_key" ON "OrderReturnStatus"("shop", "documentNumber");
