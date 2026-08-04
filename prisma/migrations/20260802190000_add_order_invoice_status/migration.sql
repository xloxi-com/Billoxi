-- CreateTable
CREATE TABLE "OrderInvoiceStatus" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "invoicedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderInvoiceStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderInvoiceStatus_shop_idx" ON "OrderInvoiceStatus"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "OrderInvoiceStatus_shop_orderGid_key" ON "OrderInvoiceStatus"("shop", "orderGid");
