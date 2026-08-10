import type { LoaderFunctionArgs } from "react-router";

import { createDomDownloadTicket } from "../extension-dom-download-ticket.server";
import { extensionPublicOrigin } from "../extension-public-origin.server";
import { getInvoicedOrderGids } from "../order-invoice-status.server";
import { getPackingSlipOrderGids } from "../order-packing-slip-status.server";
import { getReturnOrderGids } from "../order-return-status.server";
import { toOrderGid } from "../sales-order-document";
import { authenticate } from "../shopify.server";

/**
 * Prep for Admin UI extensions.
 * Prefetches export payload into a ticket so Save PDF's tab skips GraphQL
 * (same DOM template — just faster).
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

type DocumentKind =
  | "sales-order"
  | "invoice"
  | "draft"
  | "credit-note"
  | "packing-slip"
  | "return";

function parseDocumentKind(value: string): DocumentKind {
  if (
    value === "invoice" ||
    value === "draft" ||
    value === "credit-note" ||
    value === "packing-slip" ||
    value === "return"
  ) {
    return value;
  }
  return "sales-order";
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return corsPreflight(request);
  }

  const { session, cors } = await withAdminCors(request);
  const url = new URL(request.url);
  const orderId = String(url.searchParams.get("orderId") || "")
    .replace(/^gid:\/\/shopify\/(?:DraftOrder|Order)\//i, "")
    .trim();
  const documentKind = parseDocumentKind(
    String(url.searchParams.get("document") || "sales-order"),
  );

  if (!orderId || !/^\d+$/.test(orderId)) {
    return cors(
      corsJson(request, { ok: false, error: "Order not found" }, { status: 404 }),
    );
  }

  const orderGid = toOrderGid(orderId);
  let needsConvert = false;
  let isConverted = false;

  // Shopify DraftOrder docs never need convert — export uses document=draft.
  if (documentKind === "invoice") {
    const invoiced = await getInvoicedOrderGids(session.shop, [orderGid]);
    isConverted = invoiced.has(orderGid);
    needsConvert = !isConverted;
  } else if (documentKind === "packing-slip") {
    const packing = await getPackingSlipOrderGids(session.shop, [orderGid]);
    isConverted = packing.has(orderGid);
    needsConvert = !isConverted;
  } else if (documentKind === "return") {
    const returns = await getReturnOrderGids(session.shop, [orderGid]);
    isConverted = returns.has(orderGid);
    needsConvert = !isConverted;
  }

  const origin = extensionPublicOrigin(request);
  const downloadUrl = new URL("/extension-dom-download", origin);
  downloadUrl.searchParams.set("orderId", orderId);
  downloadUrl.searchParams.set("document", documentKind);

  const convertPath =
    documentKind === "invoice" ||
    documentKind === "packing-slip" ||
    documentKind === "return"
      ? `/extension-document-convert?${new URLSearchParams({
          orderId,
          document: documentKind,
        })}`
      : null;

  const statusOnly = url.searchParams.get("statusOnly") === "1";

  // Prefetch export while the merchant reads the modal (skip when convert first
  // or when caller only needs needsConvert / isConverted).
  if (!needsConvert && !statusOnly) {
    const ticketResult = await createDomDownloadTicket({
      request,
      orderId,
      documentKind,
      shop: session.shop,
    });
    if ("ticket" in ticketResult) {
      downloadUrl.searchParams.set("ticket", ticketResult.ticket);
    } else {
      console.warn("[extension-document-pdf] ticket prefetch failed", ticketResult);
    }
  }

  return cors(
    corsJson(request, {
      ok: true,
      needsConvert,
      isConverted,
      fileName: `${documentKind}-${orderId}.pdf`,
      downloadUrl: downloadUrl.toString(),
      convertPath,
      // Extension can warm these while the merchant reads the modal.
      warmUrls: [
        "/fonts/NotoSans-Regular.ttf",
        "/fonts/NotoSans-Bold.ttf",
        "/extension-pdf-download.js",
        "/extension-pdf-download.css",
      ],
    }),
  );
}
