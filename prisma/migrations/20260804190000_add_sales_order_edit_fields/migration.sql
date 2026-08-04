-- AlterTable
ALTER TABLE "SalesOrderDocumentNumber" ADD COLUMN "documentDate" TIMESTAMP(3);
ALTER TABLE "SalesOrderDocumentNumber" ADD COLUMN "customerNote" TEXT;
ALTER TABLE "SalesOrderDocumentNumber" ADD COLUMN "terms" TEXT;
