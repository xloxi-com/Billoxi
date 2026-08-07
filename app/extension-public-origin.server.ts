/**
 * Public HTTPS origin for Admin UI extension links (open/fetch).
 * Dev Vite often sees http://localhost; extensions require https.
 */
export function extensionPublicOrigin(request: Request): string {
  const envUrl =
    process.env.SHOPIFY_APP_URL?.trim() || process.env.HOST?.trim() || "";
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (parsed.protocol === "https:") return parsed.origin;
      if (parsed.host && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(parsed.host)) {
        return `https://${parsed.host}`;
      }
    } catch {
      // ignore invalid env URL
    }
  }

  const forwardedHost = (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    ""
  )
    .split(",")[0]
    ?.trim();
  const forwardedProto = (
    request.headers.get("x-forwarded-proto") || ""
  )
    .split(",")[0]
    ?.trim()
    .toLowerCase();

  if (forwardedHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(forwardedHost)) {
    const proto = forwardedProto === "http" ? "https" : forwardedProto || "https";
    return `${proto}://${forwardedHost}`;
  }

  const url = new URL(request.url);
  if (url.protocol === "https:") return url.origin;
  if (url.host && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url.host)) {
    return `https://${url.host}`;
  }

  // Last resort: still return something usable for local debugging.
  return url.origin;
}
