import type { LoaderFunctionArgs } from "react-router";

import { createDomDownloadTicket } from "../extension-dom-download-ticket.server";
import {
  buildExtensionPrintHtml,
  type PrintDocumentPayload,
} from "../extension-print-html.server";
import {
  createExtensionPrintTicket,
  peekExtensionPrintTicket,
} from "../extension-print-ticket.server";
import type {
  SalesOrderDocumentData,
  TemplateEditorSettings,
} from "../sales-order-document";
import type { StoreDetails } from "../store-details";
import { authenticate } from "../shopify.server";

/**
 * Admin print-action document:
 * 1) Authenticated prep (?prep=1) builds static HTML and returns { ticket, src }
 * 2) Ticket GET (?ticket=) serves HTML for the print iframe (no auth / no scripts)
 */
function applyPrintFrameHeaders(headers: Headers, request: Request) {
  const origin = request.headers.get("Origin");
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Requested-With",
  );
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  headers.delete("X-Frame-Options");
  headers.set(
    "Content-Security-Policy",
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://extensions.shopifycdn.com;",
  );
}

function optionsResponse(request: Request) {
  const headers = new Headers();
  applyPrintFrameHeaders(headers, request);
  return new Response(null, { status: 204, headers });
}

function corsJson(request: Request, body: unknown, status = 200) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  applyPrintFrameHeaders(headers, request);
  return new Response(JSON.stringify(body), { status, headers });
}

function throwHtml(request: Request, html: string, status = 200): never {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  applyPrintFrameHeaders(headers, request);
  throw new Response(html, { status, headers });
}

type DocumentKind = "sales-order" | "invoice" | "credit-note" | "packing-slip";

function parseDocumentKinds(value: string): DocumentKind[] {
  const allowed = new Set<DocumentKind>([
    "sales-order",
    "invoice",
    "credit-note",
    "packing-slip",
  ]);
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const kinds: DocumentKind[] = [];
  for (const part of parts) {
    if (allowed.has(part as DocumentKind)) {
      kinds.push(part as DocumentKind);
    }
  }
  if (kinds.length === 0) return ["sales-order"];
  return [...new Set(kinds)];
}

function errorHtml(message: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Print unavailable</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; color: #202223; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { margin: 0; color: #6d7175; }
  </style>
</head>
<body>
  <h1>Print unavailable</h1>
  <p>${message.replace(/</g, "&lt;")}</p>
</body>
</html>`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return optionsResponse(request);
  }

  const url = new URL(request.url);
  const ticketId = String(url.searchParams.get("ticket") || "").trim();

  if (ticketId) {
    const cached = peekExtensionPrintTicket(ticketId);
    if (!cached) {
      console.warn("[extension-document-print] ticket miss", ticketId);
      throwHtml(
        request,
        errorHtml(
          "Print preview expired. Close and open Billoxi print again.",
        ),
        410,
      );
    }
    console.info(
      "[extension-document-print] ticket hit",
      ticketId,
      cached.contentType,
      cached.body.byteLength,
    );
    const headers = new Headers({
      "Content-Type": cached.contentType,
      "Cache-Control": "no-store",
    });
    applyPrintFrameHeaders(headers, request);
    throw new Response(Buffer.from(cached.body), { status: 200, headers });
  }

  const isPrep = url.searchParams.get("prep") === "1";

  let session: Awaited<ReturnType<typeof authenticate.admin>>["session"];

  try {
    ({ session } = await authenticate.admin(request));
  } catch (error) {
    if (error instanceof Response) {
      const status =
        error.status === 302 || error.status === 303 ? 401 : error.status || 401;
      if (isPrep) {
        return corsJson(
          request,
          { ok: false, error: "Authentication required" },
          status,
        );
      }
      throwHtml(
        request,
        errorHtml(
          "Authentication required. Close and open Print → Billoxi again.",
        ),
        status,
      );
    }
    throw error;
  }

  const orderId = String(url.searchParams.get("orderId") || "")
    .replace(/^gid:\/\/shopify\/Order\//i, "")
    .trim();
  const documentKinds = parseDocumentKinds(
    String(url.searchParams.get("document") || "sales-order"),
  );

  if (!orderId || !/^\d+$/.test(orderId)) {
    if (isPrep) {
      return corsJson(request, { ok: false, error: "Order not found" }, 404);
    }
    throwHtml(request, errorHtml("Order not found."), 404);
  }

  try {
    const pages: PrintDocumentPayload[] = [];

    for (const documentKind of documentKinds) {
      const ticketResult = await createDomDownloadTicket({
        request,
        orderId,
        documentKind,
        shop: session.shop,
      });
      if (!("payload" in ticketResult)) {
        throw new Error(ticketResult.error || `${documentKind} not found`);
      }

      pages.push({
        order: ticketResult.payload.order as unknown as SalesOrderDocumentData,
        settings:
          ticketResult.payload.settings as unknown as TemplateEditorSettings,
        storeDetails:
          ticketResult.payload.storeDetails as unknown as StoreDetails,
        templateId: String(ticketResult.payload.templateId || ""),
        documentKind,
      });
    }

    if (pages.length === 0) {
      if (isPrep) {
        return corsJson(request, { ok: false, error: "Document not found" }, 404);
      }
      throwHtml(request, errorHtml("Document not found."), 404);
    }

    const html = await buildExtensionPrintHtml(pages);
    const body = Buffer.from(html);
    const ticket = createExtensionPrintTicket({
      body,
      contentType: "text/html; charset=utf-8",
      fileName: "billoxi-print.html",
      shop: session.shop,
    });
    const src = `/extension-document-print?ticket=${encodeURIComponent(ticket)}`;

    console.info(
      "[extension-document-print] prepared html",
      session.shop,
      orderId,
      documentKinds.join(","),
      ticket,
      body.byteLength,
    );

    if (isPrep) {
      return corsJson(request, { ok: true, ticket, src });
    }

    throwHtml(request, html, 200);
  } catch (error) {
    if (error instanceof Response) throw error;
    const message =
      error instanceof Error ? error.message : "Failed to build print preview";
    console.error("[extension-document-print] failed:", error);
    if (isPrep) {
      return corsJson(request, { ok: false, error: message }, 500);
    }
    throwHtml(request, errorHtml(message), 500);
  }
}
