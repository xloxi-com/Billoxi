import type { ActionFunctionArgs, HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  buildSalesOrderPdfFile,
  buildSalesOrdersPdfZip,
} from "../sales-order-bulk-pdf.server";
import { requireAdminAuth } from "../shopify-context.server";
import { loadSelectedTemplateForShop } from "../shop-settings.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireAdminAuth(request);
  const formData = await request.formData();
  const orderIds = formData
    .getAll("orderIds")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const documentKind = String(formData.get("document") || "sales-order");
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
  const templateId =
    String(formData.get("template") || "") || shopSelectedTemplateId || "";
  const intent = String(formData.get("intent") || "download");

  try {
    if (orderIds.length === 1) {
      const { pdf, fileName } = await buildSalesOrderPdfFile({
        admin,
        shop: session.shop,
        orderId: orderIds[0]!,
        templateId,
        documentKind,
      });

      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${intent === "print" ? "inline" : "attachment"}; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const { zip, fileName } = await buildSalesOrdersPdfZip({
      admin,
      shop: session.shop,
      orderIds,
      templateId,
      documentKind,
    });

    return new Response(Buffer.from(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      const message = await error.text();
      return Response.json(
        { ok: false, error: message || "Download failed" },
        { status: error.status || 500 },
      );
    }
    console.error("Bulk sales-order PDF zip failed:", error);
    return Response.json(
      { ok: false, error: "Failed to build PDF zip" },
      { status: 500 },
    );
  }
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
