import type { LoaderFunctionArgs } from "react-router";

import {
  isCustomerDownloadDocumentType,
  normalizeCustomerDownloadShop,
  verifyCustomerDownloadHash,
  type CustomerDownloadDocumentType,
} from "../customer-download-links.server";
import { getCreditNoteOrderGids } from "../order-credit-note-status.server";
import { getDraftMetaByOrderGids } from "../order-invoice-draft-status.server";
import { getInvoicedOrderGids } from "../order-invoice-status.server";
import { getPackingSlipOrderGids } from "../order-packing-slip-status.server";
import { getReturnOrderGids } from "../order-return-status.server";
import {
  resolveSalesOrderTemplateId,
  toDraftOrderGid,
  toOrderGid,
} from "../sales-order-ids";
import { ensureSalesOrderDocumentNumbers } from "../sales-order-number.server";
import { incrementShopMonthlyUsage } from "../shop-monthly-usage.server";
import { buildSalesOrderPdfFile } from "../sales-order-bulk-pdf.server";
import { loadSelectedTemplateForShop } from "../shop-settings.server";
import { unauthenticated } from "../shopify.server";
import { shopHasCapability } from "../plan-access.server";

function safeFileName(value: string) {
  return value.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "document.pdf";
}

function unavailableHtml(title: string, message: string) {
  const safeTitle = title.replace(/[<>&]/g, "");
  const safeMessage = message.replace(/[<>&]/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <link rel="icon" href="/billoxi-favicon.svg" type="image/svg+xml" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1.25rem; color: #202223; line-height: 1.5; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
    p { margin: 0; color: #6d7175; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${safeMessage}</p>
</body>
</html>`;
}

function unavailableResponse(title: string, message: string) {
  return new Response(unavailableHtml(title, message), {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Document must already exist in Billoxi (converted) — never auto-create on
 * customer click. Sales order only ensures numbering.
 */
async function assertDocumentAvailableForDownload(
  shop: string,
  orderId: string,
  type: CustomerDownloadDocumentType,
) {
  if (type === "sales-order") {
    const selected = await loadSelectedTemplateForShop(shop, "sales-order");
    await ensureSalesOrderDocumentNumbers(
      shop,
      resolveSalesOrderTemplateId(selected),
      [toOrderGid(orderId)],
    );
    return;
  }

  if (type === "draft") {
    const gid = toDraftOrderGid(orderId);
    const meta = await getDraftMetaByOrderGids(shop, [gid]);
    if (!meta.get(gid)?.documentNumber?.trim()) {
      throw unavailableResponse(
        "Draft not available yet",
        "This draft PDF is available after the document is created in Billoxi.",
      );
    }
    return;
  }

  const gid = toOrderGid(orderId);

  if (type === "invoice") {
    const existing = await getInvoicedOrderGids(shop, [gid]);
    if (!existing.has(gid)) {
      throw unavailableResponse(
        "Invoice not available yet",
        "Your invoice download is available after the order is converted to an invoice in Billoxi. For COD or custom payment orders, use the sales order download link until then.",
      );
    }
    return;
  }

  if (type === "packing-slip") {
    const existing = await getPackingSlipOrderGids(shop, [gid]);
    if (!existing.has(gid)) {
      throw unavailableResponse(
        "Packing slip not available yet",
        "This packing slip is available after it is created in Billoxi.",
      );
    }
    return;
  }

  if (type === "return") {
    const existing = await getReturnOrderGids(shop, [gid]);
    if (!existing.has(gid)) {
      throw unavailableResponse(
        "Return form not available yet",
        "This return form is available after it is created in Billoxi.",
      );
    }
    return;
  }

  if (type === "credit-note") {
    const existing = await getCreditNoteOrderGids(shop, [gid]);
    if (!existing.has(gid)) {
      throw unavailableResponse(
        "Credit note not available yet",
        "This credit note is available after it is created in Billoxi.",
      );
    }
  }
}

/**
 * Customer-facing PDF download used from Shopify notification Liquid links.
 * Invoice / CN / packing / return require an existing Billoxi document
 * (convert first). Same PDF builder as email attach / bulk download.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const hash = String(url.searchParams.get("hash") || "");
  const shop = normalizeCustomerDownloadShop(
    String(url.searchParams.get("shop") || ""),
  );
  const orderIdParam = String(url.searchParams.get("order_id") || "").trim();
  const typeRaw = String(url.searchParams.get("type") || "sales-order");
  const type = isCustomerDownloadDocumentType(typeRaw) ? typeRaw : "sales-order";

  const verified = verifyCustomerDownloadHash({
    hash,
    shop,
    orderId: orderIdParam || null,
  });
  if (!verified.ok) {
    return new Response("Invalid or expired download link.", { status: 403 });
  }

  if (orderIdParam && orderIdParam !== verified.orderId) {
    return new Response("Invalid download link.", { status: 403 });
  }

  if (!(await shopHasCapability(shop, "customerDownloadLinks"))) {
    return new Response(
      unavailableHtml(
        "Download not available",
        "Customer download links need the ULTIMATE plan.",
      ),
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    await assertDocumentAvailableForDownload(shop, verified.orderId, type);

    const templateId = await loadSelectedTemplateForShop(shop, type);
    const file = await buildSalesOrderPdfFile({
      admin,
      shop,
      orderId: verified.orderId,
      templateId,
      documentKind: type,
    });

    const orderGid =
      type === "draft"
        ? `gid://shopify/DraftOrder/${verified.orderId}`
        : `gid://shopify/Order/${verified.orderId}`;

    void incrementShopMonthlyUsage(shop, "downloaded", 1, {
      documentKind: type,
      documentNumber: file.documentNumber,
      orderGid,
      orderName: file.orderName,
      processType: "extension",
    }).catch(() => undefined);

    const name = safeFileName(file.fileName);
    return new Response(Buffer.from(file.pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[public.document-download] failed", {
      shop,
      type,
      orderId: verified.orderId,
      error,
    });
    return unavailableResponse(
      "Document could not be downloaded",
      "Please try again later, or contact the store if this keeps happening.",
    );
  }
}
