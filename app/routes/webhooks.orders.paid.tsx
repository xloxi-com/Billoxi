import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";
import { markOrderInvoiced } from "../order-invoice-status.server";
import { invalidateSalesOrdersCache } from "../sales-orders.server";

function orderGidFromPaidPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as {
    admin_graphql_api_id?: unknown;
    id?: unknown;
  };
  if (
    typeof body.admin_graphql_api_id === "string" &&
    body.admin_graphql_api_id.includes("Order/")
  ) {
    return body.admin_graphql_api_id;
  }
  if (typeof body.id === "number" && Number.isFinite(body.id)) {
    return `gid://shopify/Order/${body.id}`;
  }
  if (typeof body.id === "string" && /^\d+$/.test(body.id)) {
    return `gid://shopify/Order/${body.id}`;
  }
  return null;
}

/**
 * When Shopify marks an order paid, convert it to an invoice automatically
 * (same as manual "Convert to invoice").
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const orderGid = orderGidFromPaidPayload(payload);
  if (!orderGid) {
    console.warn("orders/paid: missing order id", { shop });
    return new Response();
  }

  try {
    const documentNumber = await markOrderInvoiced(shop, orderGid);
    invalidateSalesOrdersCache(shop);
    console.log(
      `orders/paid: auto-invoiced ${orderGid} → ${documentNumber || "(existing)"}`,
    );
  } catch (error) {
    console.error("orders/paid: auto-invoice failed", { shop, orderGid, error });
    throw error;
  }

  return new Response();
};
