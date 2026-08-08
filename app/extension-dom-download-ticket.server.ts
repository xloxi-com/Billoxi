import type { LoaderFunctionArgs } from "react-router";

import {
  createExtensionDownloadTicket,
  type ExtensionExportPayload,
} from "./extension-download-ticket.server";
import { loader as exportLoader } from "./routes/app.sales-order.export.$orderId";

type DocumentKind = "sales-order" | "invoice" | "credit-note" | "packing-slip";

/**
 * Load the same export JSON the in-app Download uses, then stash it in a
 * short-lived ticket so /extension-dom-download can skip GraphQL.
 */
export async function createDomDownloadTicket(args: {
  request: Request;
  orderId: string;
  documentKind: DocumentKind;
  shop: string;
}): Promise<
  | { ticket: string; payload: ExtensionExportPayload }
  | { error: string; status: number }
> {
  const exportUrl = new URL(
    `/app/sales-order/export/${encodeURIComponent(args.orderId)}`,
    new URL(args.request.url).origin,
  );
  exportUrl.searchParams.set("document", args.documentKind);

  const exportRequest = new Request(exportUrl.toString(), {
    method: "GET",
    headers: args.request.headers,
  });

  const exportResponse = await exportLoader({
    request: exportRequest,
    params: { orderId: args.orderId },
    context: {},
  } as LoaderFunctionArgs);

  const payload = (await exportResponse.json()) as
    | ExtensionExportPayload
    | { ok: false; error?: string };

  if (!exportResponse.ok || !payload || payload.ok !== true) {
    const message =
      !payload || payload.ok === true
        ? "Document not found"
        : payload.error || "Document not found";
    return { error: message, status: exportResponse.status || 404 };
  }

  const ticket = createExtensionDownloadTicket({
    payload,
    documentKind: args.documentKind,
    shop: args.shop,
  });

  return { ticket, payload };
}
