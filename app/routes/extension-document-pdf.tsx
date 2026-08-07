import type { LoaderFunctionArgs } from "react-router";

import { extensionPublicOrigin } from "../extension-public-origin.server";
import { getInvoicedOrderGids } from "../order-invoice-status.server";
import { getPackingSlipOrderGids } from "../order-packing-slip-status.server";
import { toOrderGid } from "../sales-order-document";
import { authenticate } from "../shopify.server";

/**
 * Lightweight prep for Admin UI extensions.
 * Returns DOM-PDF download URL, or needsConvert when invoice/packing slip
 * does not exist yet (same gate as in-app).
 */
function extensionCorsHeaders(request: Request): HeadersInit {
  const origin =
    request.headers.get("Origin") || "https://extensions.shopifycdn.com";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function corsJson(request: Request, body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(extensionCorsHeaders(request))) {
    headers.set(key, value);
  }
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return Response.json(body, { ...init, headers });
}

function corsPreflight(request: Request) {
  return new Response(null, {
    status: 204,
    headers: extensionCorsHeaders(request),
  });
}

async function withAdminCors(request: Request) {
  try {
    return await authenticate.admin(request);
  } catch (error) {
    if (error instanceof Response) {
      throw corsJson(
        request,
        { ok: false, error: "Authentication required" },
        { status: error.status || 401 },
      );
    }
    throw error;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflight(request);
  }

  const { session, cors } = await withAdminCors(request);
  const url = new URL(request.url);
  const orderId = String(url.searchParams.get("orderId") || "")
    .replace(/^gid:\/\/shopify\/Order\//i, "")
    .trim();
  const documentKind = String(
    url.searchParams.get("document") || "sales-order",
  );

  if (!orderId || !/^\d+$/.test(orderId)) {
    return cors(
      corsJson(request, { ok: false, error: "Order not found" }, { status: 404 }),
    );
  }

  const orderGid = toOrderGid(orderId);
  let needsConvert = false;

  if (documentKind === "invoice") {
    const invoiced = await getInvoicedOrderGids(session.shop, [orderGid]);
    needsConvert = !invoiced.has(orderGid);
  } else if (documentKind === "packing-slip") {
    const packing = await getPackingSlipOrderGids(session.shop, [orderGid]);
    needsConvert = !packing.has(orderGid);
  }

  const origin = extensionPublicOrigin(request);

  const downloadUrl = new URL("/extension-dom-download", origin);
  downloadUrl.searchParams.set("orderId", orderId);
  downloadUrl.searchParams.set("document", documentKind);

  // Relative path — extension fetch must stay on the HTTPS app proxy.
  const convertPath = needsConvert
    ? `/extension-document-convert?${new URLSearchParams({
        orderId,
        document: documentKind,
      })}`
    : null;

  return cors(
    corsJson(request, {
      ok: true,
      needsConvert,
      fileName: `${documentKind}-${orderId}.pdf`,
      downloadUrl: downloadUrl.toString(),
      convertPath,
    }),
  );
}
