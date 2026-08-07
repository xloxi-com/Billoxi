import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdminAuth } from "../shopify-context.server";
import {
  fetchSalesOrderDocument,
  loadDocumentTemplateSettings,
  loadSalesOrderTemplateSettings,
} from "../sales-order-document.server";
import {
  getSalesOrderDocumentDetails,
  getSalesOrderDocumentNumbersByOrderGids,
} from "../sales-order-number.server";
import {
  DEFAULT_CREDIT_NOTE_TEMPLATE_ID,
  DEFAULT_INVOICE_TEMPLATE_ID,
  findTemplatePreset,
  resolveDocumentNotes,
  resolveSalesOrderTemplateId,
  toOrderGid,
} from "../sales-order-document";
import { loadSelectedTemplateForShop } from "../shop-settings.server";
import {
  ensureInvoiceDocumentNumbers,
  getInvoicedMetaByOrderGids,
} from "../order-invoice-status.server";
import { getCreditNoteMetaByOrderGids, ensureCreditNoteDocumentNumbers } from "../order-credit-note-status.server";

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
  return DEFAULT_CREDIT_NOTE_TEMPLATE_ID;
}

/**
 * JSON payload for client-side DOM vector PDF (same pipeline as document Download).
 * GET /app/sales-order/export/:orderId?template=...&document=sales-order|invoice|credit-note
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const orderId = params.orderId;
  if (!orderId) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const documentKind = url.searchParams.get("document") || "sales-order";
  const isInvoice = documentKind === "invoice";
  const isCreditNote = documentKind === "credit-note";
  const orderGid = toOrderGid(decodeURIComponent(orderId));

  if (isCreditNote) {
    const shopSelectedCreditNoteTemplateId = await loadSelectedTemplateForShop(
      session.shop,
      "credit-note",
    );
    const templateId = resolveCreditNoteTemplateId(
      shopSelectedCreditNoteTemplateId || url.searchParams.get("template"),
    );

    const [order, template] = await Promise.all([
      fetchSalesOrderDocument(admin, orderGid),
      loadDocumentTemplateSettings(
        session.shop,
        "credit-note",
        templateId,
        admin,
      ),
    ]);

    if (!order) {
      return Response.json(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }

    const [creditMeta, invoiceMeta] = await Promise.all([
      getCreditNoteMetaByOrderGids(session.shop, [order.id]),
      getInvoicedMetaByOrderGids(session.shop, [order.id]),
    ]);
    const currentCredit = creditMeta.get(order.id);
    if (!currentCredit) {
      return Response.json(
        { ok: false, error: "Credit note not found for this order" },
        { status: 404 },
      );
    }

    const currentInvoice = invoiceMeta.get(order.id);
    let invoiceRef = currentInvoice?.documentNumber?.trim() || "";
    if (!invoiceRef && currentInvoice) {
      const ensured = await ensureInvoiceDocumentNumbers(session.shop, [
        order.id,
      ]);
      invoiceRef = ensured.get(order.id)?.trim() || "";
    }

    const documentNumber =
      currentCredit.documentNumber ||
      (
        await ensureCreditNoteDocumentNumbers(session.shop, [order.id])
      ).get(order.id) ||
      order.name;
    const documentDate =
      currentCredit.convertedAt?.toISOString() || order.createdAt;
    const creditNoteNote = currentCredit.customerNote || null;

    return Response.json({
      ok: true,
      order: {
        ...order,
        documentNumber,
        referenceNumber: invoiceRef || undefined,
        documentDate,
      },
      templateId: template.templateId,
      settings: {
        ...template.settings,
        notes: resolveDocumentNotes({
          savedNote:
            creditNoteNote || currentCredit.reason || null,
          orderNote: order.orderNote,
          defaultNotes: template.settings.notes ?? "",
          preferShopifyOrderNote: template.settings.preferShopifyOrderNote,
        }),
        terms: currentCredit.terms ?? currentInvoice?.terms ?? template.settings.terms,
      },
      storeDetails: template.storeDetails,
    });
  }

  if (isInvoice) {
    const [shopSelectedInvoiceTemplateId, shopSelectedSalesOrderTemplateId] =
      await Promise.all([
        loadSelectedTemplateForShop(session.shop, "invoice"),
        loadSelectedTemplateForShop(session.shop, "sales-order"),
      ]);
    const templateId = resolveInvoiceTemplateId(
      shopSelectedInvoiceTemplateId || url.searchParams.get("template"),
    );
    const salesOrderTemplateId = resolveSalesOrderTemplateId(
      shopSelectedSalesOrderTemplateId,
    );

    const [order, template] = await Promise.all([
      fetchSalesOrderDocument(admin, orderGid),
      loadDocumentTemplateSettings(session.shop, "invoice", templateId, admin),
    ]);

    if (!order) {
      return Response.json(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }

    const invoiceMeta = await getInvoicedMetaByOrderGids(session.shop, [
      order.id,
    ]);
    const currentMeta = invoiceMeta.get(order.id);
    if (!currentMeta) {
      return Response.json(
        { ok: false, error: "Invoice not found for this order" },
        { status: 404 },
      );
    }

    const [ensured, soNumbers] = await Promise.all([
      currentMeta.documentNumber
        ? Promise.resolve(new Map<string, string>())
        : ensureInvoiceDocumentNumbers(session.shop, [order.id]),
      getSalesOrderDocumentNumbersByOrderGids(
        session.shop,
        salesOrderTemplateId,
        [order.id],
      ),
    ]);

    const documentNumber =
      currentMeta.documentNumber ||
      ensured.get(order.id) ||
      order.name;
    const documentDate =
      currentMeta.invoicedAt?.toISOString() || order.createdAt;
    const referenceNumber = soNumbers.get(order.id) ?? order.name;

    return Response.json({
      ok: true,
      order: {
        ...order,
        documentNumber,
        referenceNumber,
        documentDate,
      },
      templateId: template.templateId,
      settings: {
        ...template.settings,
        notes: resolveDocumentNotes({
          savedNote: currentMeta.customerNote,
          orderNote: order.orderNote,
          defaultNotes: template.settings.notes ?? "",
          preferShopifyOrderNote: template.settings.preferShopifyOrderNote,
        }),
        terms: currentMeta.terms ?? template.settings.terms,
      },
      storeDetails: template.storeDetails,
    });
  }

  const shopSelectedTemplateId = await loadSelectedTemplateForShop(
    session.shop,
    "sales-order",
  );
  const templateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId || url.searchParams.get("template"),
  );

  const [order, template] = await Promise.all([
    fetchSalesOrderDocument(admin, orderGid),
    loadSalesOrderTemplateSettings(session.shop, templateId, admin),
  ]);

  if (!order) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const documentNumbers = await getSalesOrderDocumentNumbersByOrderGids(
    session.shop,
    template.templateId,
    [order.id],
  );
  const documentNumber = documentNumbers.get(order.id) ?? order.name;
  const soDetails = await getSalesOrderDocumentDetails(
    session.shop,
    template.templateId,
    order.id,
  );

  return Response.json({
    ok: true,
    order: {
      ...order,
      documentNumber,
    },
    templateId: template.templateId,
    settings: {
      ...template.settings,
      notes: resolveDocumentNotes({
        savedNote: soDetails?.customerNote,
        orderNote: order.orderNote,
        defaultNotes: template.settings.notes ?? "",
        preferShopifyOrderNote: template.settings.preferShopifyOrderNote,
      }),
      terms: soDetails?.terms ?? template.settings.terms,
    },
    storeDetails: template.storeDetails,
  });
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
