-- Return order transaction-number sync flag (Settings → Transaction numbers).
ALTER TABLE "ShopSettings"
ADD COLUMN IF NOT EXISTS "returnOrderNumbersSyncedAt" TIMESTAMP(3);
