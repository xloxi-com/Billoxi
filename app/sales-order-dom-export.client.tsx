import { createRoot, type Root } from "react-dom/client";

import { SalesOrderLiveDocument } from "./components/sales-order-live-document";
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

function resolveDocumentFontFamily(value: string | undefined): string {
  if (!value) return "Inter, system-ui, sans-serif";
  return value;
}

function toNumericOrderId(orderGid: string) {
  return orderGid.includes("/")
    ? orderGid.split("/").pop() || orderGid
    : orderGid;
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
  documentKind: "sales-order" | "invoice" | "credit-note" | "packing-slip",
  run: (paper: HTMLDivElement, payload: ExportPayload) => Promise<T>,
  options?: {
    readyTimeoutMs?: number;
    skipLongFontWait?: boolean;
    imageGraceMs?: number;
    fastMount?: boolean;
  },
): Promise<T> {
  // Warm PDF fonts/jsPDF in parallel with mounting the live document.
  const warmPromise = import("./sales-order-pdf").then((mod) => {
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
    | "credit-note"
    | "packing-slip" = "sales-order",
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
          : documentKind === "packing-slip"
            ? "packing slip"
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
  documentKind: "sales-order" | "invoice" | "credit-note" | "packing-slip",
  run: (paper: HTMLDivElement, payload: ExportPayload) => Promise<T>,
): Promise<T> {
  const payload = await fetchExportPayload(orderId, templateId, documentKind);
  return withOffscreenPaperPayload(payload, documentKind, run);
}

async function buildDomPdfBlobFromPaper(
  paper: HTMLDivElement,
  payload: ExportPayload,
  documentKind: "sales-order" | "invoice" | "credit-note" | "packing-slip",
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
    documentKind === "credit-note" ? "credit-note" : documentKind,
  );
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function buildSalesOrderDomPdfBlobFromPayload(
  payload: ExportPayload,
  documentKind:
    | "sales-order"
    | "invoice"
    | "credit-note"
    | "packing-slip" = "sales-order",
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
  documentKind:
    | "sales-order"
    | "invoice"
    | "credit-note"
    | "packing-slip" = "sales-order",
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

export async function buildSalesOrderDomPdfBlobFromList(args: {
  orderId: string;
  templateId: string;
  documentKind?: "sales-order" | "invoice" | "credit-note" | "packing-slip";
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
  documentKind?: "sales-order" | "invoice" | "credit-note" | "packing-slip";
}) {
  const { blob, fileName } = await buildSalesOrderDomPdfBlobFromList(args);
  triggerBlobDownload(blob, fileName);
}

export async function printSalesOrderDomPdfFromList(args: {
  orderId: string;
  templateId: string;
  documentKind?: "sales-order" | "invoice" | "credit-note" | "packing-slip";
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
    },
  );
}

export type { ExportMode };
