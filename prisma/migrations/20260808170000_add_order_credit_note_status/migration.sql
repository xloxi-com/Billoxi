-- CreateTable
CREATE TABLE "OrderCreditNoteStatus" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" INTEGER,
    "documentNumber" TEXT,
    "reason" TEXT,
    "customerNote" TEXT,
    "terms" TEXT,
    "creditAmount" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderCreditNoteStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderCreditNoteStatus_shop_idx" ON "OrderCreditNoteStatus"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCreditNoteStatus_shop_orderGid_key" ON "OrderCreditNoteStatus"("shop", "orderGid");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCreditNoteStatus_shop_sequence_key" ON "OrderCreditNoteStatus"("shop", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCreditNoteStatus_shop_documentNumber_key" ON "OrderCreditNoteStatus"("shop", "documentNumber");
