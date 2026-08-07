import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";

/**
 * GDPR compliance: shop/redact
 * Fired ~48 hours after app uninstall — delete all data for the shop.
 *
 * HMAC: assertValidShopifyWebhookHmac + authenticate.webhook (raw body,
 * X-Shopify-Hmac-Sha256, timing-safe). Invalid signatures → HTTP 401.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("shop/redact payload:", JSON.stringify(payload));

  // Delete all shop-scoped app data. Sessions may already be gone after app/uninstalled.
  await Promise.all([
    db.session.deleteMany({ where: { shop } }),
    db.templateCustomization.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
    db.salesOrderNumberCounter.deleteMany({ where: { shop } }),
    db.salesOrderDocumentNumber.deleteMany({ where: { shop } }),
    db.orderInvoiceStatus.deleteMany({ where: { shop } }),
    db.orderPackingSlipStatus.deleteMany({ where: { shop } }),
  ]);
  try {
    await db.$executeRaw`
      DELETE FROM "OrderCreditNoteStatus" WHERE shop = ${shop}
    `;
  } catch {
    // Table may not exist yet on older installs.
  }

  // TODO: Delete any additional shop-scoped data stored outside Prisma
  // (files, object storage, caches, third-party services, logs, etc.).

  return new Response();
};
