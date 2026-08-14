/**
 * Hide Billoxi draft actions on FREE (no paid Shopify subscription).
 */
export default async () => {
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
    return { display: Boolean(payload?.ok && payload?.adminExtensions) };
  } catch (err) {
    console.error("[billoxi] plan should-render failed", err);
    return { display: false };
  }
};
