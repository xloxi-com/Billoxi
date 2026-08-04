-- CreateTable
CREATE TABLE "TemplateCustomization" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateCustomization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateCustomization_shop_idx" ON "TemplateCustomization"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCustomization_shop_documentType_templateId_key"
ON "TemplateCustomization"("shop", "documentType", "templateId");
