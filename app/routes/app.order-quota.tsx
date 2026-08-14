import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  assertOrderQuotaAllows,
  loadOrderQuotaStatus,
  OrderQuotaExceededError,
} from "../order-quota.server";
import { getShopPlanIdForGating } from "../plan-access";
import { requireAdminAuth } from "../shopify-context.server";

/**
 * GET /app/order-quota
 * Optional ?orderGid= (repeat or comma-separated) — whether those orders may be processed now.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await requireAdminAuth(request);
  const planId = await getShopPlanIdForGating(billing);
  const url = new URL(request.url);
  const orderGids = [
    ...url.searchParams.getAll("orderGid"),
    ...String(url.searchParams.get("orderGids") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  const quota = await loadOrderQuotaStatus(session.shop, planId);

  let allowed = !quota.exhausted;
  let error: string | null = null;
  if (orderGids.length > 0) {
    try {
      await assertOrderQuotaAllows(session.shop, planId, orderGids);
      allowed = true;
    } catch (err) {
      if (err instanceof OrderQuotaExceededError) {
        allowed = false;
        error = err.message;
      } else {
        throw err;
      }
    }
  } else if (quota.exhausted) {
    error = `Monthly order limit reached (${quota.used}/${quota.limit}). Upgrade your plan or wait until next month.`;
  }

  return Response.json({
    ok: true,
    quota,
    allowed,
    error,
  });
}

export default function AppOrderQuotaRoute() {
  return null;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
