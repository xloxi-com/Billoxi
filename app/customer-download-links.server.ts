import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { extensionPublicOrigin } from "./extension-public-origin.server";
import {
  CUSTOMER_DOWNLOAD_DOCUMENT_TYPES,
  isCustomerDownloadDocumentType,
  type CustomerDownloadDocumentType,
} from "./customer-download-links";

export {
  CUSTOMER_DOWNLOAD_DOCUMENT_TYPES,
  isCustomerDownloadDocumentType,
  type CustomerDownloadDocumentType,
};

const HASH_SALT = "bx1";

function apiSecret(): string {
  return (
    process.env.SHOPIFY_API_SECRET?.trim() ||
    process.env.SHOPIFY_API_KEY?.trim() ||
    "billoxi-download"
  );
}

/** Always normalize so snippet token and download verify use the same shop key. */
export function normalizeCustomerDownloadShop(shop: string): string {
  const raw = String(shop || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  if (!raw) return "";
  return raw.includes(".") ? raw : `${raw}.myshopify.com`;
}

/** Per-shop token embedded in notification Liquid (same idea as peer apps). */
export function customerDownloadShopToken(shop: string): string {
  const normalized = normalizeCustomerDownloadShop(shop);
  return createHmac("sha256", apiSecret())
    .update(`billoxi-customer-download:${normalized}`)
    .digest("base64url")
    .slice(0, 28);
}

function expectedHash(orderId: string, shop: string): string {
  const md5 = createHash("md5")
    .update(`${orderId}${HASH_SALT}${orderId}`)
    .digest("hex");
  return `${md5}_${customerDownloadShopToken(shop)}_${orderId}`;
}

export function verifyCustomerDownloadHash(args: {
  hash: string;
  shop: string;
  orderId?: string | null;
}): { ok: true; orderId: string } | { ok: false } {
  const hash = String(args.hash || "").trim();
  const shop = normalizeCustomerDownloadShop(args.shop);
  if (!hash || !shop) return { ok: false };

  const orderId = String(args.orderId || hash.split("_").pop() || "")
    .replace(/^gid:\/\/shopify\/(?:Order|DraftOrder)\//i, "")
    .trim();
  if (!/^\d+$/.test(orderId)) return { ok: false };

  const expected = expectedHash(orderId, shop);
  const a = Buffer.from(hash);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false };
  if (!timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, orderId };
}

function liquidOrderIdAssign(type: CustomerDownloadDocumentType): string {
  if (type === "draft") {
    return `{% assign oid = draft_order.id | default: order.id | default: id %}`;
  }
  return `{% assign oid = order.id | default: id %}`;
}

function downloadHref(args: {
  origin: string;
  shop: string;
  type: CustomerDownloadDocumentType;
}): string {
  return `${args.origin}/public/document-download?hash={{ hash }}&shop=${args.shop}&order_id={{ oid }}&type=${args.type}`;
}

export function buildCustomerDownloadLiquidSnippet(args: {
  shop: string;
  appOrigin: string;
  type: CustomerDownloadDocumentType;
  linkLabel?: string;
}): string {
  const meta =
    CUSTOMER_DOWNLOAD_DOCUMENT_TYPES.find((item) => item.id === args.type) ||
    CUSTOMER_DOWNLOAD_DOCUMENT_TYPES[0];
  const shop = normalizeCustomerDownloadShop(args.shop);
  const token = customerDownloadShopToken(shop);
  const origin = args.appOrigin.replace(/\/$/, "");
  const label = args.linkLabel || meta.linkLabel;
  const href = downloadHref({ origin, shop, type: args.type });

  // Paid → invoice link; COD / custom / unpaid → sales order link.
  if (args.type === "invoice") {
    return `${liquidOrderIdAssign("invoice")}
{% assign hash = oid | append: "${HASH_SALT}" | append: oid | md5 | append: "_${token}_" | append: oid %}
{% if order.financial_status == 'paid' %}
<a target="_blank" href="${href}">${label}</a>
{% endif %}`;
  }

  if (args.type === "sales-order") {
    return `${liquidOrderIdAssign("sales-order")}
{% assign hash = oid | append: "${HASH_SALT}" | append: oid | md5 | append: "_${token}_" | append: oid %}
{% unless order.financial_status == 'paid' %}
<a target="_blank" href="${href}">${label}</a>
{% endunless %}`;
  }

  return `${liquidOrderIdAssign(args.type)}
{% assign hash = oid | append: "${HASH_SALT}" | append: oid | md5 | append: "_${token}_" | append: oid %}
<a target="_blank" href="${href}">${label}</a>`;
}

/** Combined snippet: paid → invoice, otherwise sales order (COD / custom). */
export function buildSmartOrderDownloadLiquidSnippet(args: {
  shop: string;
  appOrigin: string;
}): string {
  const shop = normalizeCustomerDownloadShop(args.shop);
  const token = customerDownloadShopToken(shop);
  const origin = args.appOrigin.replace(/\/$/, "");
  const invoiceHref = downloadHref({ origin, shop, type: "invoice" });
  const salesHref = downloadHref({ origin, shop, type: "sales-order" });

  return `{% assign oid = order.id | default: id %}
{% assign hash = oid | append: "${HASH_SALT}" | append: oid | md5 | append: "_${token}_" | append: oid %}
{% if order.financial_status == 'paid' %}
<a target="_blank" href="${invoiceHref}">Download your invoice</a>
{% else %}
<a target="_blank" href="${salesHref}">Download your sales order</a>
{% endif %}`;
}

export function customerDownloadSnippetsForShop(
  shop: string,
  request: Request,
): Record<CustomerDownloadDocumentType, string> & { smart: string } {
  const appOrigin = extensionPublicOrigin(request);
  const out = { smart: "" } as Record<CustomerDownloadDocumentType, string> & {
    smart: string;
  };
  for (const item of CUSTOMER_DOWNLOAD_DOCUMENT_TYPES) {
    out[item.id] = buildCustomerDownloadLiquidSnippet({
      shop,
      appOrigin,
      type: item.id,
    });
  }
  out.smart = buildSmartOrderDownloadLiquidSnippet({ shop, appOrigin });
  return out;
}
