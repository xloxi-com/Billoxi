import type { LoaderFunctionArgs } from "react-router";

import { loadShopBillingState } from "../billing-plans";
import { authenticate } from "../shopify.server";

/**
 * Admin UI extension should-render probe.
 * FREE (no paid subscription) → hide order Print/Apps Billoxi actions.
 */
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: extensionCorsHeaders(request),
    });
  }

  try {
    const { admin, billing } = await authenticate.admin(request);
    const { hasActivePlan, currentPlanId } = await loadShopBillingState(
      billing,
      admin,
    );
    return corsJson(request, {
      ok: true,
      hasActivePlan,
      currentPlanId,
    });
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
