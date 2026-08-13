import { createRoot, type Root } from "react-dom/client";
import * as JSZipNS from "jszip";

import { SalesOrderLiveDocument } from "./components/sales-order-live-document";
import { recordDocumentActivity } from "./record-document-activity.client";
import {
  paperPaddingCss,
  type SalesOrderDocumentData,
  type TemplateEditorSettings,
} from "./sales-order-document";
import type { StoreDetails } from "./store-details";
import "./template-editor.css";
import "./sales-order-document.css";

export type ExportPayload = {
  ok: true;
  order: SalesOrderDocumentData;
  templateId: string;
  settings: TemplateEditorSettings;
  storeDetails: StoreDetails;
};

type ExportMode = "download" | "print";
type DocumentKind =
  | "sales-order"
  | "invoice"
  | "draft"
  | "credit-note"
  | "packing-slip"
  | "return";

function resolveDocumentFontFamily(value: string | undefined): string {
  if (!value) return "Inter, system-ui, sans-serif";
  return value;
}

function toNumericOrderId(orderGid: string) {
  return orderGid.includes("/")
    ? orderGid.split("/").pop() || orderGid
    : orderGid;
}

function recordExportActivity(
  metric: "downloaded" | "printed",
  payload: ExportPayload,
  documentKind: DocumentKind,
) {
  recordDocumentActivity(metric, {
    documentKind,
    documentNumber: payload.order.documentNumber || null,
    orderGid: payload.order.id,
    orderName: payload.order.name,
    orderId: payload.order.id,
    processType: "manual",
  });
}

async function waitForPaperReady(
  paper: HTMLElement,
  timeoutMs = 8000,
  options?: {
    skipLongFontWait?: boolean;
    /** After this many ms, continue even if some images are still loading. */
    imageGraceMs?: number;
  },
) {
  const started = Date.now();
  const fontBudgetMs = options?.skipLongFontWait ? 100 : 2000;
  const imageGraceMs = options?.imageGraceMs ?? timeoutMs;

  while (Date.now() - started < timeoutMs) {
    const live = paper.querySelector(".live-document");
    const images = Array.from(paper.querySelectorAll("img"));
    const elapsed = Date.now() - started;
    const imagesReady =
      images.length === 0 ||
      images.every((img) => img.complete) ||
      elapsed >= imageGraceMs;
    if (live && paper.offsetHeight > 40 && imagesReady) {
      if (typeof document !== "undefined" && document.fonts?.ready) {
        try {
          await Promise.race([
            document.fonts.ready,
            new Promise<void>((resolve) =>
              window.setTimeout(resolve, fontBudgetMs),
            ),
          ]);
        } catch {
          // ignore font readiness failures
        }
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 24));
  }
}

async function withOffscreenPaperPayload<T>(
  payload: ExportPayload,
  documentKind: DocumentKind,
  run: (paper: HTMLDivElement, payload: ExportPayload) => Promise<T>,
  options?: {
    readyTimeoutMs?: number;
    skipLongFontWait?: boolean;
    imageGraceMs?: number;
    fastMount?: boolean;
    /** When true, caller already warmed jsPDF/fonts. */
    skipWarm?: boolean;
  },
): Promise<T> {
  const warmPromise = options?.skipWarm
    ? Promise.resolve(null)
    : import("./sales-order-pdf").then((mod) => {
        mod.warmDomVectorPdfDeps();
        return mod;
      });

  const { host, paper, root } = mountOffscreenPaper(payload, {
    fastMount: options?.fastMount,
  });

  try {
    await Promise.all([
      waitForPaperReady(paper, options?.readyTimeoutMs ?? 8000, {
        skipLongFontWait: options?.skipLongFontWait,
        imageGraceMs: options?.imageGraceMs,
      }),
      warmPromise,
    ]);
    return await run(paper, payload);
  } finally {
    root.unmount();
    host.remove();
  }
}


async function fetchExportPayload(
  orderId: string,
  templateId: string,
  documentKind:
    | "sales-order"
    | "invoice"
    | "draft"
    | "credit-note"
    | "packing-slip"
    | "return" = "sales-order",
): Promise<ExportPayload> {
  const numericId = toNumericOrderId(orderId);
  const params = new URLSearchParams({
    template: templateId,
    document: documentKind,
  });
  const response = await fetch(
    `/app/sales-order/export/${encodeURIComponent(numericId)}?${params}`,
  );
  const payload = (await response.json()) as
    | ExportPayload
    | { ok: false; error?: string };

  if (!response.ok || !payload || payload.ok !== true) {
    const label =
      documentKind === "credit-note"
        ? "credit note"
        : documentKind === "invoice"
          ? "invoice"
          : documentKind === "draft"
            ? "draft"
            : documentKind === "packing-slip"
              ? "packing slip"
              : documentKind === "return"
                ? "return"
                : "sales order";
    throw new Error(
      !payload || payload.ok === true
        ? `Failed to load ${label} for PDF`
        : payload.error || `Failed to load ${label} for PDF`,
    );
  }

  return payload;
}

function mountOffscreenPaper(
  payload: ExportPayload,
  options?: { fastMount?: boolean },
): {
  host: HTMLDivElement;
  paper: HTMLDivElement;
  root: Root;
} {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.className = "sales-order-dom-export-host";
  // Off-screen but opacity:1 so browsers paint layout/fonts faster than opacity:0.
  host.style.cssText = options?.fastMount
    ? [
        "position:fixed",
        "left:-10000px",
        "top:0",
        "opacity:1",
        "pointer-events:none",
        "z-index:-1",
        "overflow:visible",
      ].join(";")
    : [
        "position:fixed",
        "left:0",
        "top:0",
        "opacity:0",
        "pointer-events:none",
        "z-index:-1",
        "overflow:visible",
      ].join(";");

  const stage = document.createElement("div");
  stage.className = "sales-order-document-stage";
  stage.style.cssText = "padding:0;background:transparent;overflow:visible;";

  const paper = document.createElement("div");
  paper.className = [
    "template-editor__paper",
    `template-editor__paper--${payload.settings.orientation}`,
    `template-editor__paper--${payload.settings.paperSize.toLowerCase()}`,
  ].join(" ");
  paper.style.backgroundColor = payload.settings.backgroundColor;
  paper.style.fontFamily = resolveDocumentFontFamily(
    payload.settings.fontFamily,
  );
  paper.style.padding = paperPaddingCss(payload.settings.margins);

  const mountNode = document.createElement("div");
  paper.appendChild(mountNode);
  stage.appendChild(paper);
  host.appendChild(stage);
  document.body.appendChild(host);

  const root = createRoot(mountNode);
  root.render(
    <SalesOrderLiveDocument
      settings={payload.settings}
      templateId={payload.templateId}
      storeDetails={payload.storeDetails}
      order={payload.order}
    />,
  );

  return { host, paper, root };
}

async function withOffscreenPaper<T>(
  orderId: string,
  templateId: string,
  documentKind:
    | "sales-order"
    | "invoice"
    | "draft"
    | "credit-note"
    | "packing-slip"
    | "return",
  run: (paper: HTMLDivElement, payload: ExportPayload) => Promise<T>,
): Promise<T> {
  const payload = await fetchExportPayload(orderId, templateId, documentKind);
  return withOffscreenPaperPayload(payload, documentKind, run);
}

async function buildDomPdfBlobFromPaper(
  paper: HTMLDivElement,
  payload: ExportPayload,
  documentKind:
    | "sales-order"
    | "invoice"
    | "draft"
    | "credit-note"
    | "packing-slip"
    | "return",
): Promise<{ blob: Blob; fileName: string }> {
  const { buildSalesOrderDomVectorPdfBlob } = await import("./sales-order-pdf");
  return buildSalesOrderDomVectorPdfBlob(
    paper,
    {
      paperSize: payload.settings.paperSize,
      orientation: payload.settings.orientation,
      backgroundColor: payload.settings.backgroundColor,
      fontFamily: resolveDocumentFontFamily(payload.settings.fontFamily),
      margins: payload.settings.margins,
    },
    payload.order.documentNumber || payload.order.name,
    documentKind === "credit-note"
      ? "credit-note"
      : documentKind === "draft"
        ? "draft"
        : documentKind === "packing-slip"
          ? "packing-slip"
          : documentKind === "return"
            ? "return"
            : documentKind === "invoice"
              ? "invoice"
              : "sales-order",
  );
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const dot = fileName.lastIndexOf(".");
  const uniqueName =
    dot > 0
      ? `${fileName.slice(0, dot)}-${Date.now()}${fileName.slice(dot)}`
      : `${fileName}-${Date.now()}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = uniqueName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  const revokeMs = Math.min(
    120_000,
    Math.max(5_000, Math.ceil(blob.size / 25) + 3_000),
  );
  window.setTimeout(() => URL.revokeObjectURL(url), revokeMs);
}

function createJSZip() {
  const mod = JSZipNS as unknown as {
    default?: new () => import("jszip");
  } & (new () => import("jszip"));
  const Ctor = typeof mod.default === "function" ? mod.default : mod;
  if (typeof Ctor !== "function") {
    throw new Error("JSZip failed to load");
  }
  return new Ctor();
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!, index);
    }
  };
  const pool = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: pool }, () => run()));
  return results;
}

function uniqueZipEntryName(base: string, used: Set<string>) {
  const safeBase = base.replace(/[\\/]+/g, "-").trim() || "document.pdf";
  if (!used.has(safeBase)) {
    used.add(safeBase);
    return safeBase;
  }
  const dot = safeBase.lastIndexOf(".");
  const stem = dot >= 0 ? safeBase.slice(0, dot) : safeBase;
  const ext = dot >= 0 ? safeBase.slice(dot) : "";
  let i = 2;
  let candidate = `${stem}-${i}${ext}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${stem}-${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

function zipFileNameForKind(documentKind: DocumentKind) {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const prefix =
    documentKind === "credit-note"
      ? "credit-notes"
      : documentKind === "invoice"
        ? "invoices"
        : documentKind === "draft"
          ? "drafts"
          : documentKind === "packing-slip"
            ? "packing-slips"
            : documentKind === "return"
              ? "returns"
              : "sales-orders";
  return `${prefix}-${stamp}.zip`;
}

/**
 * Build a zip of DOM vector PDFs — same renderer as single "Download PDF".
 * Prefetches payloads in parallel and renders a few PDFs at a time for speed.
 */
export async function downloadSalesOrdersDomPdfZipFromList(args: {
  orderIds: string[];
  templateId: string;
  documentKind?: DocumentKind;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ count: number; fileName: string }> {
  const documentKind = args.documentKind ?? "sales-order";
  const orderIds = [...new Set(args.orderIds.map(String).filter(Boolean))].slice(
    0,
    50,
  );
  if (orderIds.length === 0) {
    throw new Error("No orders selected");
  }

  const total = orderIds.length;
  args.onProgress?.(0, total);

  // Warm jsPDF/fonts once (not once per order).
  const pdfMod = await import("./sales-order-pdf");
  pdfMod.warmDomVectorPdfDeps();

  // Fetch all export payloads concurrently (network-bound).
  const payloads = await mapPool(orderIds, 8, (orderId) =>
    fetchExportPayload(orderId, args.templateId, documentKind),
  );

  const zip = createJSZip();
  const usedNames = new Set<string>();
  let done = 0;

  // Render a few PDFs at a time — same DOM path, faster ready budget for bulk.
  const bulkReady = {
    readyTimeoutMs: 2200,
    skipLongFontWait: true,
    imageGraceMs: 500,
    fastMount: true,
    skipWarm: true,
  } as const;

  const entries = await mapPool(payloads, 3, async (payload) => {
    const { blob, fileName } = await withOffscreenPaperPayload(
      payload,
      documentKind,
      (paper, p) => buildDomPdfBlobFromPaper(paper, p, documentKind),
      bulkReady,
    );
    done += 1;
    args.onProgress?.(done, total);
    return { blob, fileName, payload };
  });

  for (const entry of entries) {
    zip.file(uniqueZipEntryName(entry.fileName, usedNames), entry.blob);
  }

  // One bulk activity event instead of N sequential posts.
  recordDocumentActivity("downloaded", {
    documentKind,
    count: entries.length,
    processType: "bulk",
  });

  // PDFs are already compressed — STORE is much faster than DEFLATE for zip packing.
  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "STORE",
  });
  const fileName = zipFileNameForKind(documentKind);
  triggerBlobDownload(zipBlob, fileName);
  return { count: entries.length, fileName };
}

export async function buildSalesOrderDomPdfBlobFromPayload(
  payload: ExportPayload,
  documentKind: DocumentKind = "sales-order",
  options?: {
    readyTimeoutMs?: number;
    skipLongFontWait?: boolean;
    imageGraceMs?: number;
    fastMount?: boolean;
  },
): Promise<{ blob: Blob; fileName: string }> {
  return withOffscreenPaperPayload(
    payload,
    documentKind,
    (paper, p) => buildDomPdfBlobFromPaper(paper, p, documentKind),
    options,
  );
}

export async function downloadSalesOrderDomPdfFromPayload(
  payload: ExportPayload,
  documentKind: DocumentKind = "sales-order",
  options?: {
    readyTimeoutMs?: number;
    skipLongFontWait?: boolean;
    imageGraceMs?: number;
    fastMount?: boolean;
  },
) {
  const { blob, fileName } = await buildSalesOrderDomPdfBlobFromPayload(
    payload,
    documentKind,
    options,
  );
  triggerBlobDownload(blob, fileName);
}

/** Gallery / template-card preview PDF (sample order, no activity log). */
export async function downloadTemplatePreviewPdf(args: {
  templateId: string;
  settings: TemplateEditorSettings;
  storeDetails: StoreDetails;
  order: SalesOrderDocumentData;
  documentKind?: DocumentKind;
}) {
  const documentKind = args.documentKind ?? "sales-order";
  await downloadSalesOrderDomPdfFromPayload(
    {
      ok: true,
      order: args.order,
      templateId: args.templateId,
      settings: args.settings,
      storeDetails: args.storeDetails,
    },
    documentKind,
  );
}

export async function buildSalesOrderDomPdfBlobFromList(args: {
  orderId: string;
  templateId: string;
  documentKind?: DocumentKind;
}): Promise<{ blob: Blob; fileName: string }> {
  const documentKind = args.documentKind ?? "sales-order";
  return withOffscreenPaper(
    args.orderId,
    args.templateId,
    documentKind,
    (paper, payload) => buildDomPdfBlobFromPaper(paper, payload, documentKind),
  );
}

export async function downloadSalesOrderDomPdfFromList(args: {
  orderId: string;
  templateId: string;
  documentKind?: DocumentKind;
}) {
  const documentKind = args.documentKind ?? "sales-order";
  await withOffscreenPaper(
    args.orderId,
    args.templateId,
    documentKind,
    async (paper, payload) => {
      const { blob, fileName } = await buildDomPdfBlobFromPaper(
        paper,
        payload,
        documentKind,
      );
      triggerBlobDownload(blob, fileName);
      recordExportActivity("downloaded", payload, documentKind);
    },
  );
}

export async function printSalesOrderDomPdfFromList(args: {
  orderId: string;
  templateId: string;
  documentKind?: DocumentKind;
}) {
  const documentKind = args.documentKind ?? "sales-order";
  await withOffscreenPaper(
    args.orderId,
    args.templateId,
    documentKind,
    async (paper, payload) => {
      const { printSalesOrderDomVectorPdf } = await import("./sales-order-pdf");
      await printSalesOrderDomVectorPdf(paper, {
        paperSize: payload.settings.paperSize,
        orientation: payload.settings.orientation,
        backgroundColor: payload.settings.backgroundColor,
        fontFamily: resolveDocumentFontFamily(payload.settings.fontFamily),
        margins: payload.settings.margins,
      });
      recordExportActivity("printed", payload, documentKind);
    },
  );
}

export type { ExportMode };
