-- CreateTable
CREATE TABLE "DocumentEventLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "documentKind" TEXT,
    "documentNumber" TEXT,
    "orderGid" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentEventLog_shop_createdAt_idx" ON "DocumentEventLog"("shop", "createdAt");
