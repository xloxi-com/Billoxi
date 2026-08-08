import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";
import {
  maybeAutoCreateCreditNote,
  orderGidFromWebhookPayload,
  resolveRefundTrigger,
} from "../auto-credit-note.server";

/**
 * When a refund is created and Advanced Credit Notes auto-refund flags are on,
 * create a credit note (requires an existing invoice).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const orderGid = orderGidFromWebhookPayload(payload);
  if (!orderGid) {
    console.warn("refunds/create: missing order id", { shop });
    return new Response();
  }

  const trigger = await resolveRefundTrigger(
    shop,
    orderGid,
    payload,
    admin ?? null,
  );
  const reason =
    trigger === "refund" ? "Full refund" : "Partial refund";

  try {
    const result = await maybeAutoCreateCreditNote(
      shop,
      orderGid,
      trigger,
      reason,
    );
    if (result.created) {
      console.log(
        `refunds/create: credit note ${result.documentNumber} (${trigger}) → ${orderGid}`,
      );
    } else {
      console.log(
        `refunds/create: skipped (${result.skipped}, ${trigger}) → ${orderGid}`,
      );
    }
  } catch (error) {
    console.error("refunds/create: auto credit note failed", {
      shop,
      orderGid,
      trigger,
      error,
    });
    throw error;
  }

  return new Response();
};
