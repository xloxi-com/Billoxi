import type { LoaderFunctionArgs } from "react-router";

import { peekExtensionDownloadTicket } from "../extension-download-ticket.server";
import { authenticate } from "../shopify.server";
import { loader as exportLoader } from "./app.sales-order.export.$orderId";

/**
 * Ultra-light PDF bridge — same DOM template as in-app Download.
 * Serves HTML that loads a prebundled /extension-pdf-download.js (fast).
 */
function withBearerFromQuery(request: Request) {
  if (request.headers.get("Authorization")) return request;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request.url, { method: request.method, headers });
}

type DocumentKind = "sales-order" | "invoice" | "credit-note" | "packing-slip";

function parseDocumentKind(value: string): DocumentKind {
  if (
    value === "invoice" ||
    value === "credit-note" ||
    value === "packing-slip"
  ) {
    return value;
  }
  return "sales-order";
}

function escapeJsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function downloadHtmlPage(payloadJson: string) {
  // Cache-bust when merchants re-download in the same session.
  const bust = Date.now();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Downloading…</title>
  <link rel="icon" href="/extension-pdf-favicon.png" type="image/png" />
  <link rel="shortcut icon" href="/extension-pdf-favicon.png" />
  <link rel="preload" href="/fonts/NotoSans-Regular.ttf" as="font" type="font/ttf" crossorigin />
  <link rel="preload" href="/fonts/NotoSans-Bold.ttf" as="font" type="font/ttf" crossorigin />
  <link rel="stylesheet" href="/extension-pdf-download.css?v=${bust}" />
  <link rel="modulepreload" href="/extension-pdf-download.js?v=${bust}" />
  <style>
    body { font-family: system-ui, sans-serif; padding: 20px; color: #202223; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { margin: 0; }
  </style>
  <script type="application/json" id="billoxi-pdf-payload">${payloadJson}</script>
  <script type="module" src="/extension-pdf-download.js?v=${bust}"></script>
</head>
<body>
  <h1>Download PDF</h1>
  <p id="billoxi-pdf-status">Starting download…</p>
</body>
</html>`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const orderId = String(url.searchParams.get("orderId") || "")
    .replace(/^gid:\/\/shopify\/Order\//i, "")
    .trim();
  const documentKind = parseDocumentKind(
    String(url.searchParams.get("document") || "sales-order"),
  );
  const ticketId = String(url.searchParams.get("ticket") || "").trim();

  if (!orderId || !/^\d+$/.test(orderId)) {
    throw new Response("Order not found", { status: 404 });
  }

  let payload: unknown = null;
  let kind: DocumentKind = documentKind;

  if (ticketId) {
    const cached = peekExtensionDownloadTicket(ticketId);
    if (cached) {
      payload = cached.payload;
      kind = cached.documentKind;
    }
  }

  if (!payload) {
    const authedRequest = withBearerFromQuery(request);
    await authenticate.admin(authedRequest);

    const exportUrl = new URL(
      `/app/sales-order/export/${encodeURIComponent(orderId)}`,
      url.origin,
    );
    exportUrl.searchParams.set("document", documentKind);

    const exportRequest = new Request(exportUrl.toString(), {
      method: "GET",
      headers: authedRequest.headers,
    });

    const exportResponse = await exportLoader({
      request: exportRequest,
      params: { orderId },
      context: {},
    } as LoaderFunctionArgs);

    const body = await exportResponse.json();
    if (!exportResponse.ok || !body || body.ok !== true) {
      const message =
        body && typeof body === "object" && "error" in body && body.error
          ? String(body.error)
          : "Document not found";
      throw new Response(message, { status: exportResponse.status || 404 });
    }
    payload = body;
    kind = documentKind;
  }

  const payloadJson = escapeJsonForScript({
    payload,
    documentKind: kind,
  });

  // throw Response short-circuits RR document pipeline (avoids "Body unusable").
  throw new Response(downloadHtmlPage(payloadJson), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
