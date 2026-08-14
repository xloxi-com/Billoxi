/**
 * Show return actions only when the order has a Shopify return,
 * and the shop has a paid plan with admin extensions.
 */
const PLAN_CACHE_KEY = "billoxi.plan.adminExtensions.v1";
const PLAN_CACHE_TTL_MS = 60_000;

function readCachedPlanDisplay() {
  try {
    const raw = sessionStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.display !== "boolean" || typeof parsed?.at !== "number") {
      return null;
    }
    if (Date.now() - parsed.at > PLAN_CACHE_TTL_MS) return null;
    return parsed.display;
  } catch {
    return null;
  }
}

function writeCachedPlanDisplay(display) {
  try {
    sessionStorage.setItem(
      PLAN_CACHE_KEY,
      JSON.stringify({ display, at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

async function orderHasShopifyReturn(orderGid) {
  const response = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query BilloxiOrderReturnStatus($id: ID!) {
        order(id: $id) {
          returnStatus
        }
      }`,
      variables: { id: orderGid },
    }),
  });
  const json = await response.json();
  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message || "Return status query failed");
  }
  const status = json?.data?.order?.returnStatus;
  return Boolean(status && status !== "NO_RETURN");
}

async function hasAdminExtensionsPlan() {
  const cached = readCachedPlanDisplay();
  if (cached != null) return cached;

  const idToken = await shopify.auth.idToken();
  if (!idToken) return false;

  const res = await fetch("/extension-plan-access", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return false;
  const payload = await res.json();
  const display = Boolean(payload?.ok && payload?.adminExtensions);
  writeCachedPlanDisplay(display);
  return display;
}

export default async () => {
  try {
    const orderGid = shopify.data?.selected?.[0]?.id;
    if (!orderGid) return { display: false };

    // Most orders have no return — fail fast before plan network call.
    const hasReturn = await orderHasShopifyReturn(orderGid);
    if (!hasReturn) return { display: false };

    const planOk = await hasAdminExtensionsPlan();
    return { display: planOk };
  } catch (err) {
    console.error("[billoxi] return should-render failed", err);
    return { display: false };
  }
};
