import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";

/**
 * GDPR compliance: customers/redact
 *
 * HMAC: assertValidShopifyWebhookHmac + authenticate.webhook (raw body,
 * X-Shopify-Hmac-Sha256, timing-safe). Invalid signatures → HTTP 401.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("customers/redact payload:", JSON.stringify(payload));

  // TODO: Delete or anonymize personal data this app stores for the customer.
  // Payload typically includes:
  //   - shop_id, shop_domain
  //   - customer: { id, email, phone }
  //   - orders_to_redact: number[]
  // Suggested Prisma cleanup for this app (keyed by shop + order GID):
  //   const orderGids = orders_to_redact.map((id) => `gid://shopify/Order/${id}`);
  //   await db.salesOrderDocumentNumber.deleteMany({ where: { shop, orderGid: { in: orderGids } } });
  //   await db.orderInvoiceStatus.deleteMany({ where: { shop, orderGid: { in: orderGids } } });
  //   await db.orderPackingSlipStatus.deleteMany({ where: { shop, orderGid: { in: orderGids } } });
  // Also clear customerNote / terms fields if you retain rows for other reasons.

  return new Response();
};
