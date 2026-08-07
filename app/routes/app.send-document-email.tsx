import type {
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdminAuth } from "../shopify-context.server";
import type { EmailDocumentKind } from "../email-templates";
import { sendDocumentEmail } from "../send-email.server";

function asDocumentKind(value: string): EmailDocumentKind {
  if (
    value === "invoice" ||
    value === "credit-note" ||
    value === "packing-slip" ||
    value === "sales-order"
  ) {
    return value;
  }
  return "sales-order";
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const formData = await request.formData();

  const orderId = String(formData.get("orderId") || "").trim();
  if (!orderId) {
    return Response.json(
      { ok: false, error: "Order is required" },
      { status: 400 },
    );
  }

  const pdfFile = formData.get("pdf");
  let pdfAttachment: { filename: string; content: Buffer } | null = null;
  if (
    pdfFile &&
    typeof pdfFile === "object" &&
    "arrayBuffer" in pdfFile &&
    typeof (pdfFile as Blob).arrayBuffer === "function" &&
    (pdfFile as Blob).size > 0
  ) {
    const blob = pdfFile as Blob & { name?: string };
    const maxBytes = 15 * 1024 * 1024;
    if (blob.size > maxBytes) {
      return Response.json(
        { ok: false, error: "PDF attachment is too large" },
        { status: 400 },
      );
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    const filename =
      (typeof blob.name === "string" ? blob.name : "").trim() ||
      String(formData.get("pdfFileName") || "").trim() ||
      "document.pdf";
    pdfAttachment = { filename, content: bytes };
  }

  const result = await sendDocumentEmail({
    admin,
    shop: session.shop,
    orderId,
    documentKind: asDocumentKind(String(formData.get("documentKind") || "")),
    toEmail: String(formData.get("toEmail") || ""),
    documentNumber: String(formData.get("documentNumber") || ""),
    orderName: String(formData.get("orderName") || ""),
    customerName: String(formData.get("customerName") || ""),
    total: String(formData.get("total") || ""),
    currency: String(formData.get("currency") || "USD"),
    referenceNumber: String(formData.get("referenceNumber") || "") || null,
    templateId: String(formData.get("templateId") || "") || null,
    pdfAttachment,
  });

  if (!result.ok) {
    return Response.json(result, { status: 400 });
  }
  return Response.json(result);
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
