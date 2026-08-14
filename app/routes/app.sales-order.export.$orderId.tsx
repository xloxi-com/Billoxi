import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { requireAdminAuth } from "../shopify-context.server";
import {
  fetchSalesOrderDocument,
  loadDocumentTemplateSettings,
  loadSalesOrderTemplateSettings,
} from "../sales-order-document.server";
import { fetchDraftOrderDocument } from "../shopify-draft-orders.server";
import {
  getSalesOrderDocumentDetails,
  getSalesOrderDocumentNumbersByOrderGids,
} from "../sales-order-number.server";
import {
  DEFAULT_CREDIT_NOTE_TEMPLATE_ID,
  DEFAULT_DRAFT_TEMPLATE_ID,
  DEFAULT_INVOICE_TEMPLATE_ID,
  DEFAULT_PACKING_SLIP_TEMPLATE_ID,
  DEFAULT_RETURN_TEMPLATE_ID,
  findTemplatePreset,
  resolveDocumentNotes,
  resolveSalesOrderTemplateId,
  toOrderGid,
  type TemplateEditorSettings,
} from "../sales-order-document";
import { toDraftOrderGid } from "../sales-order-ids";
import { loadSelectedTemplateForShop } from "../shop-settings.server";
import {
  ensureInvoiceDocumentNumbers,
  getInvoicedMetaByOrderGids,
} from "../order-invoice-status.server";
import { getCreditNoteMetaByOrderGids, ensureCreditNoteDocumentNumbers } from "../order-credit-note-status.server";
import { ensurePackingSlipDocumentNumbers, getPackingSlipMetaByOrderGids } from "../order-packing-slip-status.server";
import {
  ensureReturnDocumentNumbers,
  getReturnMetaByOrderGids,
} from "../order-return-status.server";
import { getDraftMetaByOrderGids, markOrderDraft } from "../order-invoice-draft-status.server";
import type { StoreDetails } from "../store-details";

function resolveInvoiceTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("invoice-")) {
    return value;
  }
  return DEFAULT_INVOICE_TEMPLATE_ID;
}

function resolveDraftTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("draft-")) {
    return value;
  }
  return DEFAULT_DRAFT_TEMPLATE_ID;
}

function resolveCreditNoteTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("credit-")) {
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

function resolveReturnTemplateId(value: string | null | undefined) {
  if (value && findTemplatePreset(value)?.id.startsWith("return-")) {
    return value;
  }
  return DEFAULT_RETURN_TEMPLATE_ID;
}

function stripLogoFromStoreDetails(storeDetails: StoreDetails): StoreDetails {
  const { logoDataUrl: _logo, logoFileName: _name, ...rest } = storeDetails;
  return rest;
}

/** Client already has the shop logo cached — omit large base64 from JSON. */
function withOptionalLogoOmit<T extends {
  storeDetails: StoreDetails;
  settings: TemplateEditorSettings;
}>(payload: T, omitLogo: boolean): T {
  if (!omitLogo) return payload;
  const { logoDataUrl: _sLogo, logoFileName: _sName, ...settingsRest } =
    payload.settings;
  return {
    ...payload,
    storeDetails: stripLogoFromStoreDetails(payload.storeDetails),
    settings: settingsRest as TemplateEditorSettings,
  };
}

function exportPayloadResponse(
  payload: {
    ok: true;
    order: unknown;
    templateId: string;
    settings: TemplateEditorSettings;
    storeDetails: StoreDetails;
  },
  omitLogo: boolean,
) {
  return Response.json(withOptionalLogoOmit(payload, omitLogo));
}

/**
 * JSON payload for client-side DOM vector PDF (same pipeline as document Download).
 * GET /app/sales-order/export/:orderId?template=...&document=sales-order|invoice|draft|credit-note|packing-slip|return
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const orderId = params.orderId;
  if (!orderId) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const omitLogo = url.searchParams.get("omitLogo") === "1";
  const documentKind = url.searchParams.get("document") || "sales-order";
  const isInvoice = documentKind === "invoice";
  const isDraft = documentKind === "draft";
  const isCreditNote = documentKind === "credit-note";
  const isPackingSlip = documentKind === "packing-slip";
  const isReturn = documentKind === "return";
  const orderGid = isDraft
    ? toDraftOrderGid(decodeURIComponent(orderId))
    : toOrderGid(decodeURIComponent(orderId));

  if (isDraft) {
    const shopSelectedDraftTemplateId = await loadSelectedTemplateForShop(
      session.shop,
      "draft",
    );
    const templateId = resolveDraftTemplateId(
      shopSelectedDraftTemplateId || url.searchParams.get("template"),
    );

    const [order, template] = await Promise.all([
      fetchDraftOrderDocument(admin, orderGid, { shop: session.shop }),
      loadDocumentTemplateSettings(session.shop, "draft", templateId, admin),
    ]);

    if (!order) {
      return Response.json(
        { ok: false, error: "Draft order not found" },
        { status: 404 },
      );
    }

    const draftMeta = await getDraftMetaByOrderGids(session.shop, [order.id]);
    let currentMeta = draftMeta.get(order.id);
    let documentNumber = currentMeta?.documentNumber?.trim() || "";
    if (!documentNumber) {
      documentNumber =
        (await markOrderDraft(session.shop, order.id))?.trim() || "";
      const refreshed = await getDraftMetaByOrderGids(session.shop, [order.id]);
      currentMeta = refreshed.get(order.id);
    }

    return exportPayloadResponse({
      ok: true,
      order: {
        ...order,
        documentNumber: documentNumber || order.name,
        documentDate:
          currentMeta?.draftedAt?.toISOString() || order.createdAt,
      },
      templateId: template.templateId,
      settings: {
        ...template.settings,
        notes: resolveDocumentNotes({
          savedNote: currentMeta?.customerNote ?? null,
          orderNote: order.orderNote,
          defaultNotes: template.settings.notes ?? "",
          preferShopifyOrderNote: template.settings.preferShopifyOrderNote,
        }),
        terms: currentMeta?.terms ?? template.settings.terms,
      },
      storeDetails: template.storeDetails,
    }, omitLogo);
  }

  if (isCreditNote) {
    const [shopSelectedCreditNoteTemplateId, shopSelectedSo] =
      await Promise.all([
        loadSelectedTemplateForShop(session.shop, "credit-note"),
        loadSelectedTemplateForShop(session.shop, "sales-order"),
      ]);
    const templateId = resolveCreditNoteTemplateId(
      shopSelectedCreditNoteTemplateId || url.searchParams.get("template"),
    );
    const salesOrderTemplateId = resolveSalesOrderTemplateId(shopSelectedSo);

    const [order, template] = await Promise.all([
      fetchSalesOrderDocument(admin, orderGid, {
        asCreditNote: true,
        shop: session.shop,
      }),
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

    const [creditMeta, invoiceMeta, soNumbers] = await Promise.all([
      getCreditNoteMetaByOrderGids(session.shop, [order.id]),
      getInvoicedMetaByOrderGids(session.shop, [order.id]),
      getSalesOrderDocumentNumbersByOrderGids(
        session.shop,
        salesOrderTemplateId,
        [order.id],
      ),
    ]);
    const currentCredit = creditMeta.get(order.id);
    if (!currentCredit) {
      return Response.json(
        { ok: false, error: "Credit note not found for this order" },
        { status: 404 },
      );
    }

    const currentInvoice = invoiceMeta.get(order.id);

    const documentNumber =
      currentCredit.documentNumber ||
      (
        await ensureCreditNoteDocumentNumbers(session.shop, [order.id])
      ).get(order.id) ||
      order.name;
    const documentDate =
      currentCredit.convertedAt?.toISOString() || order.createdAt;
    const creditNoteNote = currentCredit.customerNote || null;

    return exportPayloadResponse({
      ok: true,
      order: {
        ...order,
        documentNumber,
        referenceNumber: soNumbers.get(order.id) || undefined,
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
    }, omitLogo);
  }

  if (isPackingSlip) {
    const [shopSelectedPacking, shopSelectedSo] = await Promise.all([
      loadSelectedTemplateForShop(session.shop, "packing-slip"),
      loadSelectedTemplateForShop(session.shop, "sales-order"),
    ]);
    const templateId = resolvePackingSlipTemplateId(
      shopSelectedPacking || url.searchParams.get("template"),
    );
    const salesOrderTemplateId = resolveSalesOrderTemplateId(shopSelectedSo);

    const [order, template, packingMeta, soNumbers] = await Promise.all([
      fetchSalesOrderDocument(admin, orderGid, { shop: session.shop }),
      loadDocumentTemplateSettings(
        session.shop,
        "packing-slip",
        templateId,
        admin,
      ),
      getPackingSlipMetaByOrderGids(session.shop, [orderGid]),
      getSalesOrderDocumentNumbersByOrderGids(
        session.shop,
        salesOrderTemplateId,
        [orderGid],
      ),
    ]);

    if (!order) {
      return Response.json(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }
    const currentMeta = packingMeta.get(order.id);
    if (!currentMeta) {
      return Response.json(
        { ok: false, error: "Packing slip not found for this order" },
        { status: 404 },
      );
    }

    const ensured =
      !currentMeta.documentNumber
        ? await ensurePackingSlipDocumentNumbers(session.shop, [order.id])
        : new Map<string, string>();
    const documentNumber =
      currentMeta.documentNumber ||
      ensured.get(order.id) ||
      soNumbers.get(order.id) ||
      order.name;

    return exportPayloadResponse({
      ok: true,
      order: {
        ...order,
        documentNumber,
        referenceNumber: soNumbers.get(order.id) || undefined,
        documentDate:
          currentMeta.convertedAt?.toISOString() || order.createdAt,
      },
      templateId: template.templateId,
      settings: template.settings,
      storeDetails: template.storeDetails,
    }, omitLogo);
  }

  if (isReturn) {
    const [shopSelectedReturn, shopSelectedSo] = await Promise.all([
      loadSelectedTemplateForShop(session.shop, "return"),
      loadSelectedTemplateForShop(session.shop, "sales-order"),
    ]);
    const templateId = resolveReturnTemplateId(
      shopSelectedReturn || url.searchParams.get("template"),
    );
    const salesOrderTemplateId = resolveSalesOrderTemplateId(shopSelectedSo);

    const [order, template, returnMeta, soNumbers] = await Promise.all([
      fetchSalesOrderDocument(admin, orderGid, {
        shop: session.shop,
        asReturn: true,
      }),
      loadDocumentTemplateSettings(session.shop, "return", templateId, admin),
      getReturnMetaByOrderGids(session.shop, [orderGid]),
      getSalesOrderDocumentNumbersByOrderGids(
        session.shop,
        salesOrderTemplateId,
        [orderGid],
      ),
    ]);

    if (!order) {
      return Response.json(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }
    const currentMeta = returnMeta.get(order.id);
    if (!currentMeta) {
      return Response.json(
        { ok: false, error: "Return not found for this order" },
        { status: 404 },
      );
    }

    const ensured = !currentMeta.documentNumber
      ? await ensureReturnDocumentNumbers(session.shop, [order.id])
      : new Map<string, string>();
    const documentNumber =
      currentMeta.documentNumber ||
      ensured.get(order.id) ||
      soNumbers.get(order.id) ||
      order.name;

    return exportPayloadResponse({
      ok: true,
      order: {
        ...order,
        documentNumber,
        referenceNumber: soNumbers.get(order.id) || undefined,
        documentDate:
          currentMeta.convertedAt?.toISOString() || order.createdAt,
      },
      templateId: template.templateId,
      settings: template.settings,
      storeDetails: template.storeDetails,
    }, omitLogo);
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

    const [order, template, invoiceMeta] = await Promise.all([
      fetchSalesOrderDocument(admin, orderGid, { shop: session.shop }),
      loadDocumentTemplateSettings(session.shop, "invoice", templateId, admin),
      getInvoicedMetaByOrderGids(session.shop, [orderGid]),
    ]);

    if (!order) {
      return Response.json(
        { ok: false, error: "Order not found" },
        { status: 404 },
      );
    }

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

    return exportPayloadResponse({
      ok: true,
      order: {
        ...order,
        documentNumber,
        referenceNumber: soNumbers.get(order.id) || undefined,
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
    }, omitLogo);
  }

  const shopSelectedTemplateId = await loadSelectedTemplateForShop(
    session.shop,
    "sales-order",
  );
  const templateId = resolveSalesOrderTemplateId(
    shopSelectedTemplateId || url.searchParams.get("template"),
  );

  const [order, template, documentNumbers, soDetails] = await Promise.all([
    fetchSalesOrderDocument(admin, orderGid, { shop: session.shop }),
    loadSalesOrderTemplateSettings(session.shop, templateId, admin),
    getSalesOrderDocumentNumbersByOrderGids(session.shop, templateId, [
      orderGid,
    ]),
    getSalesOrderDocumentDetails(session.shop, templateId, orderGid),
  ]);

  if (!order) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const documentNumber = documentNumbers.get(order.id) ?? order.name;

  return exportPayloadResponse({
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
  }, omitLogo);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
