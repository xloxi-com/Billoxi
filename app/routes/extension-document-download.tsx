import type { LoaderFunctionArgs } from "react-router";

import { buildSalesOrderPdfFile } from "../sales-order-bulk-pdf.server";
import { authenticate } from "../shopify.server";
import { loadSelectedTemplateForShop } from "../shop-settings.server";

/**
 * Save PDF from Admin UI extensions.
 * Extension sandboxes often swallow Content-Disposition downloads for href
 * navigations. Returning a tiny HTML page that runs in a normal browser tab
 * and triggers a data: download is reliable.
 */
function withBearerFromQuery(request: Request) {
  if (request.headers.get("Authorization")) return request;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request.url, { method: request.method, headers });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFileName(value: string) {
  return value.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "document.pdf";
}

function downloadHtmlPage(fileName: string, pdfBase64: string) {
  const safeName = safeFileName(fileName);
  const label = escapeHtml(safeName);
  // Keep script minimal; page runs outside the admin-extension sandbox.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Downloading ${label}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; color: #202223; }
    a { color: #2c6ecb; }
  </style>
</head>
<body>
  <p>Downloading <strong>${label}</strong>…</p>
  <p>If nothing happens, <a id="dl" download="${label}" href="data:application/pdf;base64,${pdfBase64}">tap here to save the PDF</a>.</p>
  <script>
    (function () {
      var link = document.getElementById("dl");
      if (!link) return;
      try { link.click(); } catch (e) {}
      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, 1200);
    })();
  </script>
</body>
</html>`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const wantRaw = url.searchParams.get("raw") === "1";
  const authedRequest = withBearerFromQuery(request);
  const { admin, session } = await authenticate.admin(authedRequest);

  const orderId = String(url.searchParams.get("orderId") || "")
    .replace(/^gid:\/\/shopify\/Order\//i, "")
    .trim();
  const documentKind = String(
    url.searchParams.get("document") || "sales-order",
  );

  if (!orderId || !/^\d+$/.test(orderId)) {
    return new Response("Order not found", { status: 404 });
  }

  const shopSelectedTemplateId = await loadSelectedTemplateForShop(
    session.shop,
    documentKind === "invoice"
      ? "invoice"
      : documentKind === "credit-note"
        ? "credit-note"
        : documentKind === "packing-slip"
          ? "packing-slip"
          : "sales-order",
  );

  try {
    const started = Date.now();
    const { pdf, fileName } = await buildSalesOrderPdfFile({
      admin,
      shop: session.shop,
      orderId,
      templateId: shopSelectedTemplateId || "",
      documentKind,
    });
    console.info("[extension-document-download] built", {
      shop: session.shop,
      orderId,
      documentKind,
      fileName,
      bytes: pdf.byteLength,
      ms: Date.now() - started,
      mode: wantRaw ? "raw" : "html",
    });

    if (wantRaw) {
      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeFileName(fileName)}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(
      downloadHtmlPage(fileName, Buffer.from(pdf).toString("base64")),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("[extension-document-download] build failed:", error);
    const message =
      error instanceof Error
        ? error.message
        : error instanceof Response
          ? await error.text()
          : "Failed to build PDF";
    return new Response(message || "Failed to build PDF", { status: 500 });
  }
}
