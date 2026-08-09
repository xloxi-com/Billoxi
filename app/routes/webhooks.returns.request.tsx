import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";
import { ensureReturnFromShopifyEvent } from "../shopify-returns.server";

/**
 * When a return is requested in Shopify Admin / customer portal,
 * create the Billoxi Return document for that order.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const result = await ensureReturnFromShopifyEvent(shop, admin, payload);
    if (result.created) {
      console.log(
        `returns/request: return document → ${result.orderGid}`,
      );
    } else {
      console.log(
        `returns/request: skipped (${result.skipped ?? "unknown"})`,
      );
    }
  } catch (error) {
    console.error("returns/request: failed", { shop, error });
    throw error;
  }

  return new Response();
};
