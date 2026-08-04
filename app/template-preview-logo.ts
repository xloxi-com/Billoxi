import logoSvg from "./assets/Logo.svg?raw";

const BRAND_REDS = [/#b70228/gi, /#bb0028/gi] as const;

function normalizeHex(value: string, fallback = "#B90128") {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const [, a, b, c] = raw;
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase();
  }
  return fallback;
}

/**
 * Recolor Logo.svg brand marks to the template accent and return a data URL
 * for template gallery / editor previews.
 */
export function templatePreviewLogoDataUrl(accent: string): string {
  const brand = normalizeHex(accent);
  let svg = String(logoSvg || "");
  for (const pattern of BRAND_REDS) {
    svg = svg.replace(pattern, brand);
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
