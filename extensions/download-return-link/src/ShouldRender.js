/**
 * Show Download return / Print return only when the order has a Shopify return
 * (or was already converted to a Billoxi return document).
 */
export default async () => {
  const orderGid = shopify?.data?.selected?.[0]?.id;
  if (!orderGid) return { display: false };

  try {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query OrderHasReturn($id: ID!) {
          order(id: $id) {
            returnStatus
            returns(first: 1) {
              nodes { id }
            }
          }
        }`,
        variables: { id: orderGid },
      }),
    });

    if (response.ok) {
      const payload = await response.json();
      const order = payload?.data?.order;
      const status = String(order?.returnStatus || "NO_RETURN");
      const hasReturnNodes = (order?.returns?.nodes?.length || 0) > 0;
      if (hasReturnNodes || (status && status !== "NO_RETURN")) {
        return { display: true };
      }
    }
  } catch (err) {
    console.error("[billoxi] return should-render graphql failed", err);
  }

  // Fallback: already converted in Billoxi (manual return).
  try {
    const orderId = String(orderGid).split("/").pop();
    if (!orderId) return { display: false };
    const idToken = await shopify.auth.idToken();
    if (!idToken) return { display: false };

    const qs = new URLSearchParams({
      orderId,
      document: "return",
      statusOnly: "1",
    });
    const res = await fetch(`/extension-document-pdf?${qs}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return { display: false };
    const payload = await res.json();
    return { display: Boolean(payload?.ok && payload?.isConverted) };
  } catch (err) {
    console.error("[billoxi] return should-render status failed", err);
    return { display: false };
  }
};
