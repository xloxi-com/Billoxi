/**
 * Minimal boot for /extension-dom-download HTML bridge.
 * Same DOM PDF pipeline as in-app Download — start ASAP.
 */
import { downloadSalesOrderDomPdfFromPayload } from "./sales-order-dom-export.client";
import { warmDomVectorPdfDeps } from "./sales-order-pdf";

warmDomVectorPdfDeps();

function setStatus(text: string) {
  const el = document.getElementById("billoxi-pdf-status");
  if (el) el.textContent = text;
}

const raw = document.getElementById("billoxi-pdf-payload")?.textContent || "";

(async () => {
  try {
    const data = JSON.parse(raw) as {
      payload: Parameters<typeof downloadSalesOrderDomPdfFromPayload>[0];
      documentKind: Parameters<typeof downloadSalesOrderDomPdfFromPayload>[1];
    };
    setStatus("Building PDF…");
    await downloadSalesOrderDomPdfFromPayload(data.payload, data.documentKind, {
      readyTimeoutMs: 400,
      skipLongFontWait: true,
      imageGraceMs: 120,
      fastMount: true,
    });
    setStatus("Downloaded — closing…");
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // ignore
      }
    }, 250);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Download failed");
  }
})();
