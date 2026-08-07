import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertValidShopifyWebhookHmac } from "../webhook-hmac.server";
import { numberingFromSeries } from "../number-series";
import { resolveSalesOrderTemplateId } from "../sales-order-ids";
import { allocateSalesOrderDocumentNumber } from "../sales-order-number.server";
import {
  loadNumberSeriesEntryForShop,
  loadSelectedTemplateForShop,
} from "../shop-settings.server";
import { invalidateSalesOrdersCache } from "../sales-orders.server";

function orderGidFromCreatePayload(payload: unknown): string | null {
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
 * When a Shopify order is created, assign a Sales Order number immediately
 * so the list never shows "—" for new orders.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await assertValidShopifyWebhookHmac(request);
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const orderGid = orderGidFromCreatePayload(payload);
  if (!orderGid) {
    console.warn("orders/create: missing order id", { shop });
    return new Response();
  }

  try {
    const [selectedTemplateIdRaw, series] = await Promise.all([
      loadSelectedTemplateForShop(shop, "sales-order"),
      loadNumberSeriesEntryForShop(shop, "sales-order"),
    ]);
    const templateId = resolveSalesOrderTemplateId(selectedTemplateIdRaw);

    if (series.entryMode !== "manual") {
      const documentNumber = await allocateSalesOrderDocumentNumber(
        shop,
        templateId,
        orderGid,
        numberingFromSeries(series),
      );
      console.log(
        `orders/create: assigned ${documentNumber} → ${orderGid}`,
      );
    } else {
      console.log(
        `orders/create: skipped number (manual mode) → ${orderGid}`,
      );
    }

    invalidateSalesOrdersCache(shop);
  } catch (error) {
    console.error("orders/create: assign number failed", {
      shop,
      orderGid,
      error,
    });
    // Still bust cache so the list can pick up the order; number may assign on next list load.
    invalidateSalesOrdersCache(shop);
    throw error;
  }

  return new Response();
};
