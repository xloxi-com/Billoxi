import type { LoaderFunctionArgs } from "react-router";

import { createDomDownloadTicket } from "../extension-dom-download-ticket.server";
import { extensionPublicOrigin } from "../extension-public-origin.server";
import { markOrderInvoiced } from "../order-invoice-status.server";
import { markOrderPackingSlip } from "../order-packing-slip-status.server";
import { toOrderGid } from "../sales-order-document";
import { invalidateSalesOrdersCache } from "../sales-orders.server";
import { authenticate } from "../shopify.server";

/**
 * Convert order → invoice / packing slip for Admin UI extensions
 * (same as in-app Convert). GET avoids cross-origin CSRF on extension fetch.
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
  const documentKind = String(url.searchParams.get("document") || "");

  if (!orderId || !/^\d+$/.test(orderId)) {
    return cors(
      corsJson(request, { ok: false, error: "Order not found" }, { status: 404 }),
    );
  }

  if (documentKind !== "invoice" && documentKind !== "packing-slip") {
    return cors(
      corsJson(
        request,
        { ok: false, error: "Unsupported document type" },
        { status: 400 },
      ),
    );
  }

  const orderGid = toOrderGid(orderId);

  try {
    if (documentKind === "invoice") {
      await markOrderInvoiced(session.shop, orderGid);
    } else {
      await markOrderPackingSlip(session.shop, orderGid);
    }
    invalidateSalesOrdersCache(session.shop);
  } catch (error) {
    console.error("[extension-document-convert] failed:", error);
    return cors(
      corsJson(
        request,
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : `Could not convert to ${documentKind}`,
        },
        { status: 500 },
      ),
    );
  }

  const downloadUrl = new URL(
    "/extension-dom-download",
    extensionPublicOrigin(request),
  );
  downloadUrl.searchParams.set("orderId", orderId);
  downloadUrl.searchParams.set("document", documentKind);

  const ticketResult = await createDomDownloadTicket({
    request,
    orderId,
    documentKind,
    shop: session.shop,
  });
  if ("ticket" in ticketResult) {
    downloadUrl.searchParams.set("ticket", ticketResult.ticket);
  }

  return cors(
    corsJson(request, {
      ok: true,
      converted: true,
      document: documentKind,
      downloadUrl: downloadUrl.toString(),
      fileName: `${documentKind}-${orderId}.pdf`,
    }),
  );
}
