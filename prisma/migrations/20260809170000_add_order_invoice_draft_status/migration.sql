-- CreateTable
CREATE TABLE "OrderInvoiceDraftStatus" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "draftedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" INTEGER,
    "documentNumber" TEXT,
    "customerNote" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderInvoiceDraftStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderInvoiceDraftStatus_shop_idx" ON "OrderInvoiceDraftStatus"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "OrderInvoiceDraftStatus_shop_orderGid_key" ON "OrderInvoiceDraftStatus"("shop", "orderGid");

-- CreateIndex
CREATE UNIQUE INDEX "OrderInvoiceDraftStatus_shop_sequence_key" ON "OrderInvoiceDraftStatus"("shop", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OrderInvoiceDraftStatus_shop_documentNumber_key" ON "OrderInvoiceDraftStatus"("shop", "documentNumber");
