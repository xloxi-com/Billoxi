-- CreateTable
CREATE TABLE "SalesOrderNumberCounter" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL,
    "padLength" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderNumberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderDocumentNumber" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderDocumentNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesOrderNumberCounter_shop_idx" ON "SalesOrderNumberCounter"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderNumberCounter_shop_templateId_key" ON "SalesOrderNumberCounter"("shop", "templateId");

-- CreateIndex
CREATE INDEX "SalesOrderDocumentNumber_shop_templateId_idx" ON "SalesOrderDocumentNumber"("shop", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderDocumentNumber_shop_templateId_orderGid_key" ON "SalesOrderDocumentNumber"("shop", "templateId", "orderGid");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderDocumentNumber_shop_templateId_sequence_key" ON "SalesOrderDocumentNumber"("shop", "templateId", "sequence");
