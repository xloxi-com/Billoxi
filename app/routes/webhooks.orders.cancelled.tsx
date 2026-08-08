import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";
import {
  maybeAutoCreateCreditNote,
  orderGidFromWebhookPayload,
} from "../auto-credit-note.server";

/**
 * When an order is cancelled and Advanced Credit Notes → Auto on cancel is on,
 * create a credit note (requires an existing invoice).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const orderGid = orderGidFromWebhookPayload(payload);
  if (!orderGid) {
    console.warn("orders/cancelled: missing order id", { shop });
    return new Response();
  }

  try {
    const result = await maybeAutoCreateCreditNote(
      shop,
      orderGid,
      "cancel",
      "Order cancelled",
    );
    if (result.created) {
      console.log(
        `orders/cancelled: credit note ${result.documentNumber} → ${orderGid}`,
      );
    } else {
      console.log(
        `orders/cancelled: skipped (${result.skipped}) → ${orderGid}`,
      );
    }
  } catch (error) {
    console.error("orders/cancelled: auto credit note failed", {
      shop,
      orderGid,
      error,
    });
    throw error;
  }

  return new Response();
};
