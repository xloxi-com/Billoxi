import { readFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";

import {
  resolveSalesOrderTemplateId,
  toOrderGid,
} from "./sales-order-document";
import {
  fetchSalesOrderDocument,
  loadSalesOrderTemplateSettings,
} from "./sales-order-document.server";
import { allocateSalesOrderDocumentNumber } from "./sales-order-number.server";
import {
  buildSalesOrderPdfBytes,
  primePdfFontsFromBase64,
  salesOrderPdfFileName,
} from "./sales-order-pdf";

const MAX_BULK_PDFS = 50;
let serverFontsPrimed = false;

async function ensureServerPdfFonts() {
  if (serverFontsPrimed) return;
  const fontsDir = join(process.cwd(), "public", "fonts");
  const [regular, bold] = await Promise.all([
    readFile(join(fontsDir, "NotoSans-Regular.ttf")),
    readFile(join(fontsDir, "NotoSans-Bold.ttf")),
  ]);
  primePdfFontsFromBase64({
    regular: Buffer.from(regular).toString("base64"),
    bold: Buffer.from(bold).toString("base64"),
  });
  serverFontsPrimed = true;
}

function uniqueFileName(base: string, used: Set<string>) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot) : "";
  let i = 2;
  let candidate = `${stem}-${i}${ext}`;
  while (used.has(candidate)) {
    i += 1;
    candidate = `${stem}-${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

export async function buildSalesOrderPdfFile(args: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  };
  shop: string;
  orderId: string;
  templateId?: string | null;
}): Promise<{ pdf: Uint8Array; fileName: string }> {
  const orderId = args.orderId.trim();
  if (!orderId) {
    throw new Response("No order selected", { status: 400 });
  }

  const templateId = resolveSalesOrderTemplateId(args.templateId ?? null);
  const template = await loadSalesOrderTemplateSettings(
    args.shop,
    templateId,
    args.admin,
  );

  await ensureServerPdfFonts();

  const orderGid = toOrderGid(orderId);
  const order = await fetchSalesOrderDocument(args.admin, orderGid);
  if (!order) {
    throw new Response("Sales order not found", { status: 404 });
  }

  const documentNumber = await allocateSalesOrderDocumentNumber(
    args.shop,
    template.templateId,
    order.id,
    template.settings.numbering,
  );

  const pdf = await buildSalesOrderPdfBytes({
    order: { ...order, documentNumber },
    settings: template.settings,
    storeDetails: template.storeDetails,
    templateId: template.templateId,
  });

  return {
    pdf,
    fileName: salesOrderPdfFileName(documentNumber || order.name),
  };
}

export async function buildSalesOrdersPdfZip(args: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  };
  shop: string;
  orderIds: string[];
  templateId?: string | null;
}): Promise<{ zip: Uint8Array; fileName: string; count: number }> {
  const orderIds = [...new Set(args.orderIds.map((id) => id.trim()).filter(Boolean))];
  if (orderIds.length === 0) {
    throw new Response("No orders selected", { status: 400 });
  }
  if (orderIds.length > MAX_BULK_PDFS) {
    throw new Response(`Select up to ${MAX_BULK_PDFS} orders`, { status: 400 });
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let count = 0;

  for (const orderId of orderIds) {
    const { pdf, fileName } = await buildSalesOrderPdfFile({
      admin: args.admin,
      shop: args.shop,
      orderId,
      templateId: args.templateId,
    });
    zip.file(uniqueFileName(fileName, usedNames), pdf);
    count += 1;
  }

  if (count === 0) {
    throw new Response("No sales orders found for download", { status: 404 });
  }

  const zipBytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    zip: zipBytes,
    fileName: `sales-orders-${stamp}.zip`,
    count,
  };
}
