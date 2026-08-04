import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { adminAuthenticationContext } from "../shopify-context.server";
import {
  fetchSalesOrderDocument,
  loadDocumentTemplateSettings,
  loadSalesOrderTemplateSettings,
} from "../sales-order-document.server";
import { allocateSalesOrderDocumentNumber } from "../sales-order-number.server";
import {
  DEFAULT_INVOICE_TEMPLATE_ID,
  findTemplatePreset,
  resolveSalesOrderTemplateId,
  toOrderGid,
} from "../sales-order-document";
import { loadSelectedTemplateForShop } from "../shop-settings.server";
import {
  ensureInvoiceDocumentNumbers,
  getInvoicedMetaByOrderGids,
} from "../order-invoice-status.server";

function resolveInvoiceTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("invoice-")) {
    return value;
  }
  return DEFAULT_INVOICE_TEMPLATE_ID;
}

/**
 * JSON payload for client-side DOM vector PDF (same pipeline as document Download).
 * GET /app/sales-order/export/:orderId?template=...&document=sales-order|invoice
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { session, admin } = context.get(adminAuthenticationContext);
  const orderId = params.orderId;
  if (!orderId) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const isInvoice = url.searchParams.get("document") === "invoice";
  const orderGid = toOrderGid(decodeURIComponent(orderId));

  if (isInvoice) {
    const shopSelectedInvoiceTemplateId = await loadSelectedTemplateForShop(
      session.shop,
      "invoice",
    );
    const templateId = resolveInvoiceTemplateId(
      shopSelectedInvoiceTemplateId || url.searchParams.get("template"),
    );
    const salesOrderTemplateId = resolveSalesOrderTemplateId(
      await loadSelectedTemplateForShop(session.shop, "sales-order"),
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

    const [invoiceMeta, ensured, salesOrderSettings] = await Promise.all([
      getInvoicedMetaByOrderGids(session.shop, [order.id]),
      ensureInvoiceDocumentNumbers(session.shop, [order.id]),
      loadSalesOrderTemplateSettings(
        session.shop,
        salesOrderTemplateId,
        admin,
      ),
    ]);

    const currentMeta = invoiceMeta.get(order.id);
    if (!currentMeta) {
      return Response.json(
        { ok: false, error: "Invoice not found for this order" },
        { status: 404 },
      );
    }

    const documentNumber =
      currentMeta.documentNumber ||
      ensured.get(order.id) ||
      order.name;
    const documentDate =
      currentMeta.invoicedAt?.toISOString() || order.createdAt;
    const referenceNumber = await allocateSalesOrderDocumentNumber(
      session.shop,
      salesOrderTemplateId,
      order.id,
      salesOrderSettings.settings.numbering,
    );

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
        notes: currentMeta.customerNote ?? template.settings.notes,
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

  const documentNumber = await allocateSalesOrderDocumentNumber(
    session.shop,
    template.templateId,
    order.id,
    template.settings.numbering,
  );

  return Response.json({
    ok: true,
    order: {
      ...order,
      documentNumber,
    },
    templateId: template.templateId,
    settings: template.settings,
    storeDetails: template.storeDetails,
  });
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
