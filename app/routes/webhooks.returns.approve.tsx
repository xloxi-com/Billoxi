import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";
import { ensureReturnFromShopifyEvent } from "../shopify-returns.server";

/**
 * When a return is approved (OPEN) in Shopify, create the Billoxi Return document.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const result = await ensureReturnFromShopifyEvent(shop, admin, payload);
    if (result.created) {
      console.log(
        `returns/approve: return document → ${result.orderGid}`,
      );
    } else {
      console.log(
        `returns/approve: skipped (${result.skipped ?? "unknown"})`,
      );
    }
  } catch (error) {
    console.error("returns/approve: failed", { shop, error });
    throw error;
  }

  return new Response();
};
