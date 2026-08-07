import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_CREDIT_NOTE_TEMPLATE_ID,
  DEFAULT_INVOICE_TEMPLATE_ID,
  DEFAULT_PACKING_SLIP_TEMPLATE_ID,
  findTemplatePreset,
  resolveDocumentNotes,
  resolveSalesOrderTemplateId,
  toOrderGid,
  type SalesOrderDocumentData,
  type TemplateEditorSettings,
} from "./sales-order-document";
import {
  fetchSalesOrderDocument,
  loadDocumentTemplateSettings,
} from "./sales-order-document.server";
import { getSalesOrderDocumentNumbersByOrderGids } from "./sales-order-number.server";
import {
  ensureInvoiceDocumentNumbers,
  getInvoicedMetaByOrderGids,
} from "./order-invoice-status.server";
import {
  ensureCreditNoteDocumentNumbers,
  getCreditNoteMetaByOrderGids,
} from "./order-credit-note-status.server";
import { ensurePackingSlipDocumentNumbers, getPackingSlipMetaByOrderGids } from "./order-packing-slip-status.server";
import { loadSelectedTemplateForShop } from "./shop-settings.server";
import {
  buildSalesOrderPdfBytes,
  primePdfFontsFromBase64,
  salesOrderPdfFileName,
} from "./sales-order-pdf";

export type BulkDocumentKind =
  | "sales-order"
  | "invoice"
  | "credit-note"
  | "packing-slip";

const MAX_BULK_PDFS = 50;
const BULK_PDF_CONCURRENCY = 4;
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

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function resolveInvoiceTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("invoice-")) {
    return value;
  }
  return DEFAULT_INVOICE_TEMPLATE_ID;
}

function resolveCreditNoteTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("credit-")) {
    return value;
  }
  if (value && findTemplatePreset(value)?.id.startsWith("invoice-")) {
    return value;
  }
  return DEFAULT_CREDIT_NOTE_TEMPLATE_ID;
}

function resolvePackingSlipTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("packing-")) {
    return value;
  }
  return DEFAULT_PACKING_SLIP_TEMPLATE_ID;
}

function resolveDocumentKind(
  value: string | null | undefined,
): BulkDocumentKind {
  if (
    value === "invoice" ||
    value === "credit-note" ||
    value === "packing-slip"
  ) {
    return value;
  }
  return "sales-order";
}

type BuiltPdfEntry = {
  pdf: Uint8Array;
  fileName: string;
};

async function prepareOrdersForPdf(args: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  };
  shop: string;
  orderIds: string[];
  templateId?: string | null;
  documentKind?: string | null;
}): Promise<BuiltPdfEntry[]> {
  const documentKind = resolveDocumentKind(args.documentKind);
  const orderIds = [
    ...new Set(args.orderIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (orderIds.length === 0) {
    throw new Response("No orders selected", { status: 400 });
  }
  if (orderIds.length > MAX_BULK_PDFS) {
    throw new Response(`Select up to ${MAX_BULK_PDFS} orders`, { status: 400 });
  }

  await ensureServerPdfFonts();
  const orderGids = orderIds.map((orderId) => toOrderGid(orderId));

  if (documentKind === "credit-note") {
    const shopSelected = await loadSelectedTemplateForShop(
      args.shop,
      "credit-note",
    );
    // Prefer the UI template (download/email) over shop Active when provided.
    const templateId = resolveCreditNoteTemplateId(
      args.templateId || shopSelected,
    );
    const [template, creditMeta, invoiceMeta] = await Promise.all([
      loadDocumentTemplateSettings(
        args.shop,
        "credit-note",
        templateId,
        args.admin,
      ),
      getCreditNoteMetaByOrderGids(args.shop, orderGids),
      getInvoicedMetaByOrderGids(args.shop, orderGids),
    ]);

    const missingNumbers = orderGids.filter((gid) => {
      const meta = creditMeta.get(gid);
      return meta && !meta.documentNumber?.trim();
    });
    const ensuredCn =
      missingNumbers.length > 0
        ? await ensureCreditNoteDocumentNumbers(args.shop, missingNumbers)
        : new Map<string, string>();

    const missingInvoiceRefs = orderGids.filter((gid) => {
      const invoice = invoiceMeta.get(gid);
      return invoice && !invoice.documentNumber?.trim();
    });
    const ensuredInv =
      missingInvoiceRefs.length > 0
        ? await ensureInvoiceDocumentNumbers(args.shop, missingInvoiceRefs)
        : new Map<string, string>();

    const built = await mapPool(
      orderIds,
      BULK_PDF_CONCURRENCY,
      async (orderId) => {
        const orderGid = toOrderGid(orderId);
        const credit = creditMeta.get(orderGid);
        if (!credit) return null;

        const order = await fetchSalesOrderDocument(args.admin, orderGid);
        if (!order) return null;

        const invoice = invoiceMeta.get(order.id);
        const documentNumber =
          credit.documentNumber?.trim() ||
          ensuredCn.get(order.id)?.trim() ||
          order.name;
        const invoiceRef =
          invoice?.documentNumber?.trim() ||
          ensuredInv.get(order.id)?.trim() ||
          "";
        const note =
          credit.customerNote || credit.reason || invoice?.customerNote || null;

        const enrichedOrder: SalesOrderDocumentData = {
          ...order,
          documentNumber,
          referenceNumber: invoiceRef || undefined,
          documentDate: credit.convertedAt?.toISOString() || order.createdAt,
        };

        const settings: TemplateEditorSettings = {
          ...template.settings,
          notes: resolveDocumentNotes({
            savedNote: note,
            orderNote: order.orderNote,
            defaultNotes: template.settings.notes ?? "",
            preferShopifyOrderNote: template.settings.preferShopifyOrderNote,
          }),
          terms: credit.terms ?? invoice?.terms ?? template.settings.terms,
        };

        const pdf = await buildSalesOrderPdfBytes({
          order: enrichedOrder,
          settings,
          storeDetails: template.storeDetails,
          templateId: template.templateId,
        });

        return {
          pdf,
          fileName: salesOrderPdfFileName(
            documentNumber || order.name,
            "credit-note",
          ),
        };
      },
    );

    const out: BuiltPdfEntry[] = [];
    for (const entry of built) {
      if (entry) out.push(entry);
    }
    return out;
  }

  if (documentKind === "invoice") {
    const [shopSelectedInvoice, shopSelectedSo] = await Promise.all([
      loadSelectedTemplateForShop(args.shop, "invoice"),
      loadSelectedTemplateForShop(args.shop, "sales-order"),
    ]);
    const templateId = resolveInvoiceTemplateId(
      args.templateId || shopSelectedInvoice,
    );
    const salesOrderTemplateId = resolveSalesOrderTemplateId(shopSelectedSo);
    const [template, invoiceMeta, soNumbers] = await Promise.all([
      loadDocumentTemplateSettings(
        args.shop,
        "invoice",
        templateId,
        args.admin,
      ),
      getInvoicedMetaByOrderGids(args.shop, orderGids),
      getSalesOrderDocumentNumbersByOrderGids(
        args.shop,
        salesOrderTemplateId,
        orderGids,
      ),
    ]);

    const missingNumbers = orderGids.filter((gid) => {
      const meta = invoiceMeta.get(gid);
      return meta && !meta.documentNumber?.trim();
    });
    const ensured =
      missingNumbers.length > 0
        ? await ensureInvoiceDocumentNumbers(args.shop, missingNumbers)
        : new Map<string, string>();

    const built = await mapPool(
      orderIds,
      BULK_PDF_CONCURRENCY,
      async (orderId) => {
        const orderGid = toOrderGid(orderId);
        const meta = invoiceMeta.get(orderGid);
        if (!meta) return null;

        const order = await fetchSalesOrderDocument(args.admin, orderGid);
        if (!order) return null;

        const documentNumber =
          meta.documentNumber?.trim() ||
          ensured.get(order.id)?.trim() ||
          order.name;
        const referenceNumber = soNumbers.get(order.id) ?? order.name;

        const enrichedOrder: SalesOrderDocumentData = {
          ...order,
          documentNumber,
          referenceNumber,
          documentDate: meta.invoicedAt?.toISOString() || order.createdAt,
        };

        const settings: TemplateEditorSettings = {
          ...template.settings,
          notes: resolveDocumentNotes({
            savedNote: meta.customerNote,
            orderNote: order.orderNote,
            defaultNotes: template.settings.notes ?? "",
            preferShopifyOrderNote: template.settings.preferShopifyOrderNote,
          }),
          terms: meta.terms ?? template.settings.terms,
        };

        const pdf = await buildSalesOrderPdfBytes({
          order: enrichedOrder,
          settings,
          storeDetails: template.storeDetails,
          templateId: template.templateId,
        });

        return {
          pdf,
          fileName: salesOrderPdfFileName(
            documentNumber || order.name,
            "invoice",
          ),
        };
      },
    );

    const out: BuiltPdfEntry[] = [];
    for (const entry of built) {
      if (entry) out.push(entry);
    }
    return out;
  }

  if (documentKind === "packing-slip") {
    const [shopSelectedPacking, shopSelectedSo] = await Promise.all([
      loadSelectedTemplateForShop(args.shop, "packing-slip"),
      loadSelectedTemplateForShop(args.shop, "sales-order"),
    ]);
    const templateId = resolvePackingSlipTemplateId(
      args.templateId || shopSelectedPacking,
    );
    const salesOrderTemplateId = resolveSalesOrderTemplateId(shopSelectedSo);
    const [template, packingMeta, soNumbers] = await Promise.all([
      loadDocumentTemplateSettings(
        args.shop,
        "packing-slip",
        templateId,
        args.admin,
      ),
      getPackingSlipMetaByOrderGids(args.shop, orderGids),
      getSalesOrderDocumentNumbersByOrderGids(
        args.shop,
        salesOrderTemplateId,
        orderGids,
      ),
    ]);

    const missingNumbers = orderGids.filter((gid) => {
      const meta = packingMeta.get(gid);
      return meta && !meta.documentNumber?.trim();
    });
    const ensured =
      missingNumbers.length > 0
        ? await ensurePackingSlipDocumentNumbers(args.shop, missingNumbers)
        : new Map<string, string>();

    const built = await mapPool(
      orderIds,
      BULK_PDF_CONCURRENCY,
      async (orderId) => {
        const orderGid = toOrderGid(orderId);
        const meta = packingMeta.get(orderGid);
        if (!meta) return null;

        const order = await fetchSalesOrderDocument(args.admin, orderGid);
        if (!order) return null;

        const documentNumber =
          meta.documentNumber?.trim() ||
          ensured.get(order.id)?.trim() ||
          soNumbers.get(order.id) ||
          order.name;

        const enrichedOrder: SalesOrderDocumentData = {
          ...order,
          documentNumber,
          referenceNumber: soNumbers.get(order.id) ?? order.name,
          documentDate: meta.convertedAt?.toISOString() || order.createdAt,
        };

        const pdf = await buildSalesOrderPdfBytes({
          order: enrichedOrder,
          settings: template.settings,
          storeDetails: template.storeDetails,
          templateId: template.templateId,
        });

        return {
          pdf,
          fileName: salesOrderPdfFileName(
            documentNumber || order.name,
            "packing-slip",
          ),
        };
      },
    );

    const out: BuiltPdfEntry[] = [];
    for (const entry of built) {
      if (entry) out.push(entry);
    }
    return out;
  }

  const shopSelected = await loadSelectedTemplateForShop(
    args.shop,
    "sales-order",
  );
  const templateId = resolveSalesOrderTemplateId(
    args.templateId || shopSelected,
  );
  const template = await loadDocumentTemplateSettings(
    args.shop,
    "sales-order",
    templateId,
    args.admin,
  );
  const documentNumbers = await getSalesOrderDocumentNumbersByOrderGids(
    args.shop,
    template.templateId,
    orderGids,
  );

  const built = await mapPool(orderIds, BULK_PDF_CONCURRENCY, async (orderId) => {
    const orderGid = toOrderGid(orderId);
    const order = await fetchSalesOrderDocument(args.admin, orderGid);
    if (!order) return null;

    const documentNumber = documentNumbers.get(order.id) ?? order.name;
    const enrichedOrder = { ...order, documentNumber };
    const pdf = await buildSalesOrderPdfBytes({
      order: enrichedOrder,
      settings: template.settings,
      storeDetails: template.storeDetails,
      templateId: template.templateId,
    });

    return {
      pdf,
      fileName: salesOrderPdfFileName(documentNumber || order.name),
    };
  });

  const out: BuiltPdfEntry[] = [];
  for (const entry of built) {
    if (entry) out.push(entry);
  }
  return out;
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
  documentKind?: string | null;
}): Promise<{ pdf: Uint8Array; fileName: string }> {
  const prepared = await prepareOrdersForPdf({
    admin: args.admin,
    shop: args.shop,
    orderIds: [args.orderId],
    templateId: args.templateId,
    documentKind: args.documentKind,
  });
  const entry = prepared[0];
  if (!entry) {
    throw new Response("Document not found", { status: 404 });
  }
  return { pdf: entry.pdf, fileName: entry.fileName };
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
  documentKind?: string | null;
}): Promise<{ zip: Uint8Array; fileName: string; count: number }> {
  const documentKind = resolveDocumentKind(args.documentKind);
  const [prepared, JSZip] = await Promise.all([
    prepareOrdersForPdf(args),
    import("jszip").then((mod) => mod.default),
  ]);

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let count = 0;
  for (const entry of prepared) {
    zip.file(uniqueFileName(entry.fileName, usedNames), entry.pdf);
    count += 1;
  }

  if (count === 0) {
    throw new Response("No documents found for download", { status: 404 });
  }

  const zipBytes = await zip.generateAsync({
    type: "uint8array",
    streamFiles: true,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const prefix =
    documentKind === "credit-note"
      ? "credit-notes"
      : documentKind === "invoice"
        ? "invoices"
        : documentKind === "packing-slip"
          ? "packing-slips"
          : "sales-orders";

  return {
    zip: zipBytes,
    fileName: `${prefix}-${stamp}.zip`,
    count,
  };
}
