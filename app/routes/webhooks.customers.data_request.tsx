import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";

/**
 * GDPR compliance: customers/data_request
 *
 * HMAC: assertValidShopifyWebhookHmac + authenticate.webhook (raw body,
 * X-Shopify-Hmac-Sha256, timing-safe). Invalid signatures → HTTP 401.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("customers/data_request payload:", JSON.stringify(payload));

  // TODO: Export / gather any personal data this app stores for the customer
  // and provide it to the store owner. Payload typically includes:
  //   - shop_id, shop_domain
  //   - customer: { id, email, phone }
  //   - orders_requested: number[]
  //   - data_request: { id }
  // This app primarily stores order document metadata (notes, numbers) keyed by
  // shop + order GID — map orders_requested IDs to gid://shopify/Order/{id}
  // and return matching records to the merchant outside this webhook response.

  return new Response();
};
