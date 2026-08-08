import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { SalesOrderLiveDocument } from "./components/sales-order-live-document";
import {
  paperPaddingCss,
  type SalesOrderDocumentData,
  type TemplateEditorSettings,
} from "./sales-order-document";
import type { StoreDetails } from "./store-details";

type DocumentKind = "sales-order" | "invoice" | "credit-note" | "packing-slip";

export type PrintDocumentPayload = {
  order: SalesOrderDocumentData;
  settings: TemplateEditorSettings;
  storeDetails: StoreDetails;
  templateId: string;
  documentKind: DocumentKind;
};

let cachedCss: string | null = null;
const IMAGE_FETCH_TIMEOUT_MS = 2500;
const IMAGE_MAX_BYTES = 350_000;
const imageDataUrlCache = new Map<string, string | null>();

async function loadPrintCss() {
  if (cachedCss) return cachedCss;
  const root = process.cwd();
  const [documentCss, editorCss] = await Promise.all([
    readFile(join(root, "app/sales-order-document.css"), "utf8"),
    readFile(join(root, "app/template-editor.css"), "utf8"),
  ]);
  cachedCss = `${editorCss}\n${documentCss}`;
  return cachedCss;
}

function resolveDocumentFontFamily(value: string | undefined): string {
  if (!value) return "Inter, system-ui, sans-serif";
  return value;
}

/**
 * Cloudflare (dev tunnel) email obfuscation turns addresses into
 * "[email protected]". Shopify's print tutorial uses email_off; also
 * encode @ so scanners don't rewrite the text.
 */
function protectEmailsInHtml(html: string) {
  return html.replace(
    /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    (_match, user: string, domain: string) => `${user}&#64;${domain}`,
  );
}

/**
 * Admin print iframe cannot reliably load Shopify CDN images (hangs /
 * blocked). Fetch on the server and embed as data URLs so preview matches
 * PDF download without external subresources.
 */
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  const trimmed = String(url || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return null;

  if (imageDataUrlCache.has(trimmed)) {
    return imageDataUrlCache.get(trimmed) ?? null;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(trimmed, {
      method: "GET",
      signal: ac.signal,
      headers: { Accept: "image/*,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) {
      imageDataUrlCache.set(trimmed, null);
      return null;
    }
    const mime = (res.headers.get("content-type") || "image/jpeg")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!mime || !mime.startsWith("image/")) {
      imageDataUrlCache.set(trimmed, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > IMAGE_MAX_BYTES) {
      // Still embed if slightly over — skip only empty/huge.
      if (!buf.byteLength || buf.byteLength > 1_200_000) {
        imageDataUrlCache.set(trimmed, null);
        return null;
      }
    }
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    imageDataUrlCache.set(trimmed, dataUrl);
    return dataUrl;
  } catch {
    imageDataUrlCache.set(trimmed, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function withInlinedProductImages(
  order: SalesOrderDocumentData,
): Promise<SalesOrderDocumentData> {
  const urls = [
    ...new Set(
      order.lineItems
        .map((item) => String(item.imageUrl || "").trim())
        .filter((url) => /^https?:\/\//i.test(url)),
    ),
  ];
  if (urls.length === 0) return order;

  const resolved = new Map<string, string>();
  await Promise.all(
    urls.map(async (url) => {
      const dataUrl = await fetchImageAsDataUrl(url);
      if (dataUrl) resolved.set(url, dataUrl);
    }),
  );

  return {
    ...order,
    lineItems: order.lineItems.map((item) => {
      const src = String(item.imageUrl || "").trim();
      if (!src) return { ...item, imageUrl: "" };
      if (src.startsWith("data:image/")) return item;
      const dataUrl = resolved.get(src);
      return { ...item, imageUrl: dataUrl || "" };
    }),
  };
}

async function documentPage(payload: PrintDocumentPayload) {
  const { settings, storeDetails, templateId } = payload;
  const order = await withInlinedProductImages(payload.order);
  const markup = protectEmailsInHtml(
    renderToStaticMarkup(
      createElement(SalesOrderLiveDocument, {
        settings,
        templateId,
        storeDetails,
        order,
      }),
    ),
  );

  const paperClass = [
    "template-editor__paper",
    `template-editor__paper--${settings.orientation}`,
    `template-editor__paper--${settings.paperSize.toLowerCase()}`,
  ].join(" ");

  const paperStyle = [
    `background-color:${settings.backgroundColor || "#ffffff"}`,
    `font-family:${resolveDocumentFontFamily(settings.fontFamily)}`,
    `padding:${paperPaddingCss(settings.margins)}`,
  ].join(";");

  return `<main class="print-page">
  <div class="sales-order-document-stage" style="padding:0;background:transparent;overflow:visible;">
    <div class="${paperClass}" style="${paperStyle}">
      ${markup}
    </div>
  </div>
</main>`;
}

/**
 * Same Billoxi live-document markup as Download PDF, as static HTML
 * (Admin print iframe cannot run scripts / PDF embeds).
 */
export async function buildExtensionPrintHtml(pages: PrintDocumentPayload[]) {
  const css = await loadPrintCss();
  const pageBreak = `<div class="page-break" aria-hidden="true"></div>`;
  const renderedPages = await Promise.all(pages.map((page) => documentPage(page)));
  const body = renderedPages.join(pageBreak);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Billoxi print</title>
  <style>
${css}
html, body {
  margin: 0;
  padding: 0;
  background: #e4e5e7;
}
.print-page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 16px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: #e4e5e7;
}
.print-page .template-editor__paper {
  box-shadow: 0 0 0 1px rgba(0,0,0,0.06);
}
.page-break {
  width: 100%;
  height: 20px;
  background: #c9cccf;
}
@media print {
  html, body, .print-page {
    background: #fff !important;
  }
  .print-page {
    min-height: auto;
    padding: 0;
    display: block;
  }
  .print-page .template-editor__paper {
    box-shadow: none;
    margin: 0 auto;
  }
  .page-break {
    height: 0;
    background: none;
    page-break-after: always;
  }
}
  </style>
</head>
<body>
  <!--email_off-->
  ${body}
  <!--/email_off-->
</body>
</html>`;
}
