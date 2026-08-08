-- CreateTable
CREATE TABLE "ShopMonthlyUsage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "printed" INTEGER NOT NULL DEFAULT 0,
    "downloaded" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "uploaded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopMonthlyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopMonthlyUsage_shop_idx" ON "ShopMonthlyUsage"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopMonthlyUsage_shop_yearMonth_key" ON "ShopMonthlyUsage"("shop", "yearMonth");
