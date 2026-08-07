import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { loader as exportLoader } from "./app.sales-order.export.$orderId";

type ExportPayload = {
  ok: true;
  order: Record<string, unknown> & {
    documentNumber?: string;
    name: string;
  };
  templateId: string;
  settings: Record<string, unknown>;
  storeDetails: Record<string, unknown>;
};

/**
 * Admin UI extension download bridge.
 * Uses the same DOM vector PDF pipeline as in-app Download (not server jsPDF).
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

export async function loader({ request }: LoaderFunctionArgs) {
  const authedRequest = withBearerFromQuery(request);
  await authenticate.admin(authedRequest);

  const url = new URL(request.url);
  const orderId = String(url.searchParams.get("orderId") || "")
    .replace(/^gid:\/\/shopify\/Order\//i, "")
    .trim();
  const documentKind = parseDocumentKind(
    String(url.searchParams.get("document") || "sales-order"),
  );

  if (!orderId || !/^\d+$/.test(orderId)) {
    throw new Response("Order not found", { status: 404 });
  }

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

  const payload = (await exportResponse.json()) as
    | ExportPayload
    | { ok: false; error?: string };

  if (!exportResponse.ok || !payload || payload.ok !== true) {
    const message =
      !payload || payload.ok === true
        ? "Document not found"
        : payload.error || "Document not found";
    throw new Response(message, { status: exportResponse.status || 404 });
  }

  return { payload, documentKind };
}

export default function ExtensionDomDownload() {
  const { payload, documentKind } = useLoaderData<typeof loader>();
  const [status, setStatus] = useState("Preparing PDF…");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { downloadSalesOrderDomPdfFromPayload } = await import(
          "../sales-order-dom-export.client"
        );
        await downloadSalesOrderDomPdfFromPayload(payload, documentKind);
        if (cancelled) return;
        setStatus("Downloaded — you can close this tab.");
        window.setTimeout(() => {
          try {
            window.close();
          } catch {
            // ignore
          }
        }, 900);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Download failed");
        setStatus("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [payload, documentKind]);

  return (
    <main
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        padding: 24,
        color: "#202223",
        maxWidth: 480,
      }}
    >
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Download PDF</h1>
      {error ? (
        <p style={{ color: "#d72c0d", margin: 0 }}>{error}</p>
      ) : (
        <p style={{ margin: 0 }}>{status}</p>
      )}
    </main>
  );
}
