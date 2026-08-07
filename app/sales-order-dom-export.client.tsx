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

type ExportPayload = {
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

async function waitForPaperReady(paper: HTMLElement, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const live = paper.querySelector(".live-document");
    const images = Array.from(paper.querySelectorAll("img"));
    const imagesReady = images.every((img) => img.complete);
    if (live && paper.offsetHeight > 40 && imagesReady) {
      if (typeof document !== "undefined" && document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // ignore font readiness failures
        }
      }
      // One more frame so layout settles after images/fonts.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

async function fetchExportPayload(
  orderId: string,
  templateId: string,
  documentKind: "sales-order" | "invoice" | "credit-note" = "sales-order",
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
          : "sales order";
    throw new Error(
      !payload || payload.ok === true
        ? `Failed to load ${label} for PDF`
        : payload.error || `Failed to load ${label} for PDF`,
    );
  }

  return payload;
}

function mountOffscreenPaper(payload: ExportPayload): {
  host: HTMLDivElement;
  paper: HTMLDivElement;
  root: Root;
} {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.className = "sales-order-dom-export-host";
  host.style.cssText = [
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
  documentKind: "sales-order" | "invoice" | "credit-note",
  run: (paper: HTMLDivElement, payload: ExportPayload) => Promise<T>,
): Promise<T> {
  const payload = await fetchExportPayload(orderId, templateId, documentKind);
  const { host, paper, root } = mountOffscreenPaper(payload);

  try {
    await waitForPaperReady(paper);
    return await run(paper, payload);
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function downloadSalesOrderDomPdfFromList(args: {
  orderId: string;
  templateId: string;
  documentKind?: "sales-order" | "invoice" | "credit-note";
}) {
  const documentKind = args.documentKind ?? "sales-order";
  await withOffscreenPaper(
    args.orderId,
    args.templateId,
    documentKind,
    async (paper, payload) => {
      const { downloadSalesOrderDomVectorPdf } = await import(
        "./sales-order-pdf"
      );
      await downloadSalesOrderDomVectorPdf(
        paper,
        {
          paperSize: payload.settings.paperSize,
          orientation: payload.settings.orientation,
          backgroundColor: payload.settings.backgroundColor,
          fontFamily: resolveDocumentFontFamily(payload.settings.fontFamily),
          margins: payload.settings.margins,
        },
        payload.order.documentNumber || payload.order.name,
        documentKind === "credit-note" ? "invoice" : documentKind,
      );
    },
  );
}

export async function printSalesOrderDomPdfFromList(args: {
  orderId: string;
  templateId: string;
  documentKind?: "sales-order" | "invoice" | "credit-note";
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
