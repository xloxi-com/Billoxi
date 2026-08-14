/**
 * Hide Billoxi order actions on FREE (no paid Shopify subscription).
 * Cache display briefly so More actions opens without waiting on every extension.
 */
const CACHE_KEY = "billoxi.plan.adminExtensions.v1";
const CACHE_TTL_MS = 60_000;

function readCachedDisplay() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.display !== "boolean" || typeof parsed?.at !== "number") {
      return null;
    }
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.display;
  } catch {
    return null;
  }
}

function writeCachedDisplay(display) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ display, at: Date.now() }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export default async () => {
  const cached = readCachedDisplay();
  if (cached != null) return { display: cached };

  try {
    const idToken = await shopify.auth.idToken();
    if (!idToken) return { display: false };

    const res = await fetch("/extension-plan-access", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return { display: false };
    const payload = await res.json();
    const display = Boolean(payload?.ok && payload?.adminExtensions);
    writeCachedDisplay(display);
    return { display };
  } catch (err) {
    console.error("[billoxi] plan should-render failed", err);
    return { display: false };
  }
};
