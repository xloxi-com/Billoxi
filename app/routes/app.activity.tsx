import type { ActionFunctionArgs, HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  incrementShopMonthlyUsage,
  type ShopMonthlyUsageMetric,
} from "../shop-monthly-usage.server";
import {
  isDocumentEventProcessType,
  type DocumentEventProcessType,
} from "../document-event-log";
import { normalizeOrderIdentity } from "../document-event-log.server";
import { requireAdminAuth } from "../shopify-context.server";

const METRICS = new Set<ShopMonthlyUsageMetric>([
  "printed",
  "downloaded",
  "sent",
  "uploaded",
]);

function parseMetric(value: FormDataEntryValue | null): ShopMonthlyUsageMetric | null {
  const raw = String(value || "").trim();
  return METRICS.has(raw as ShopMonthlyUsageMetric)
    ? (raw as ShopMonthlyUsageMetric)
    : null;
}

function parseProcessType(
  value: FormDataEntryValue | null,
): DocumentEventProcessType {
  const raw = String(value || "").trim();
  return isDocumentEventProcessType(raw) ? raw : "manual";
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireAdminAuth(request);
  const formData = await request.formData();
  const metric = parseMetric(formData.get("metric"));
  if (!metric) {
    return Response.json({ ok: false, error: "Invalid metric" }, { status: 400 });
  }

  const rawCount = Number.parseInt(String(formData.get("count") || "1"), 10);
  const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.min(rawCount, 500) : 1;

  const identity = normalizeOrderIdentity({
    orderGid:
      String(formData.get("orderGid") || formData.get("orderId") || "").trim() ||
      null,
    orderName: String(formData.get("orderName") || "").trim() || null,
  });

  await incrementShopMonthlyUsage(session.shop, metric, count, {
    documentKind: String(formData.get("documentKind") || "").trim() || null,
    documentNumber: String(formData.get("documentNumber") || "").trim() || null,
    orderGid: identity.orderGid,
    orderName: identity.orderName,
    processType: parseProcessType(formData.get("processType")),
  });
  return Response.json({ ok: true });
}

/** Resource route — POST only; no UI. */
export default function AppActivityRoute() {
  return null;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
