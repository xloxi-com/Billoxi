import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Shopify webhook HMAC using the raw request body.
 *
 * Shopify signs the exact bytes of the POST body with SHOPIFY_API_SECRET
 * (HMAC-SHA256, base64). Always hash the raw body — never a re-serialized
 * JSON object — or verification will fail.
 *
 * Uses request.clone() so callers can still pass the original Request to
 * authenticate.webhook (which also reads the body and re-validates).
 *
 * @throws Response with status 401 when verification fails
 */
export async function assertValidShopifyWebhookHmac(
  request: Request,
): Promise<void> {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("SHOPIFY_API_SECRET is not configured");
    throw new Response(undefined, {
      status: 500,
      statusText: "Server misconfigured",
    });
  }

  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) {
    throw new Response(undefined, {
      status: 401,
      statusText: "Unauthorized",
    });
  }

  // Critical: read raw bytes from a clone so authenticate.webhook can still
  // consume the original request body afterward.
  const rawBody = await request.clone().text();

  const computedHmac = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const computed = Buffer.from(computedHmac);
  const provided = Buffer.from(hmacHeader);

  if (
    computed.length !== provided.length ||
    !timingSafeEqual(computed, provided)
  ) {
    throw new Response(undefined, {
      status: 401,
      statusText: "Unauthorized",
    });
  }
}
