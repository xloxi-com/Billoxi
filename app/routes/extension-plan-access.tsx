import type { LoaderFunctionArgs } from "react-router";

import { loadShopBillingState } from "../billing-plans";
import { planHasCapability } from "../plan-access";
import { PLACEHOLDER_CURRENT_PLAN_ID, type PlanId } from "../plan-features";
import { loadOrderQuotaStatus } from "../order-quota.server";
import { authenticate } from "../shopify.server";

/**
 * Admin UI extension should-render probe.
 * FREE (no paid subscription) → hide order Print/Apps Billoxi actions.
 * Extensions are available on all paid plans; monthly order quota still applies
 * inside actions (not on should-render — that must stay fast).
 */

type PlanAccessBody = {
  ok: true;
  hasActivePlan: boolean;
  currentPlanId: PlanId | null;
  adminExtensions: boolean;
  orderQuota: Awaited<ReturnType<typeof loadOrderQuotaStatus>> | null;
};

/** Cross-request cache — More actions fires should_render for many extensions at once. */
const PLAN_ACCESS_TTL_MS = 45_000;
const planAccessCache = new Map<
  string,
  { expires: number; value: Omit<PlanAccessBody, "orderQuota"> }
>();
const planAccessInflight = new Map<
  string,
  Promise<Omit<PlanAccessBody, "orderQuota">>
>();

function extensionCorsHeaders(request: Request): HeadersInit {
  const origin =
    request.headers.get("Origin") || "https://extensions.shopifycdn.com";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function corsJson(request: Request, body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(extensionCorsHeaders(request))) {
    headers.set(key, value);
  }
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return Response.json(body, { ...init, headers });
}

async function loadPlanAccessCore(
  shop: string,
  billing: Parameters<typeof loadShopBillingState>[0],
): Promise<Omit<PlanAccessBody, "orderQuota">> {
  const key = shop.trim().toLowerCase();
  const hit = planAccessCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let pending = planAccessInflight.get(key);
  if (!pending) {
    pending = (async () => {
      const { hasActivePlan, currentPlanId } =
        await loadShopBillingState(billing, shop);
      const planId = currentPlanId ?? PLACEHOLDER_CURRENT_PLAN_ID;
      const value = {
        ok: true as const,
        hasActivePlan,
        currentPlanId,
        adminExtensions:
          hasActivePlan && planHasCapability(planId, "adminExtensions"),
      };
      planAccessCache.set(key, {
        expires: Date.now() + PLAN_ACCESS_TTL_MS,
        value,
      });
      return value;
    })().finally(() => {
      planAccessInflight.delete(key);
    });
    planAccessInflight.set(key, pending);
  }
  return pending;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: extensionCorsHeaders(request),
    });
  }

  const wantQuota = new URL(request.url).searchParams.get("quota") === "1";

  try {
    const { billing, session } = await authenticate.admin(request);
    const core = await loadPlanAccessCore(session.shop, billing);
    const planId = core.currentPlanId ?? PLACEHOLDER_CURRENT_PLAN_ID;
    const orderQuota =
      wantQuota && core.hasActivePlan
        ? await loadOrderQuotaStatus(session.shop, planId)
        : null;

    return corsJson(
      request,
      {
        ...core,
        orderQuota,
      } satisfies PlanAccessBody,
      {
        headers: {
          // should_render runs per extension — allow brief browser reuse.
          "Cache-Control": "private, max-age=30",
        },
      },
    );
  } catch (error) {
    if (error instanceof Response) {
      return corsJson(
        request,
        { ok: false, hasActivePlan: false, error: "Authentication required" },
        { status: error.status || 401 },
      );
    }
    return corsJson(
      request,
      { ok: false, hasActivePlan: false, error: "Plan check failed" },
      { status: 500 },
    );
  }
};
