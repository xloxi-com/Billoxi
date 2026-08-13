/**
 * Admin UI locale cache (menus/settings/templates chrome).
 * PDF/preview language is separate.
 *
 * Client receives the active pack via the app loader (hydrate).
 * Do not glob locale JSON here — that registers 137 modules in every
 * route chunk and breaks embedded navigation ("No result found for routeId").
 */
import en from "./admin-locales/en.json";

export type AdminLocalePack = Record<string, string>;

const enPack = en as AdminLocalePack;
const packCache = new Map<string, AdminLocalePack>([["en", enPack]]);

export function hydrateAdminLocale(
  lang: string | null | undefined,
  pack: AdminLocalePack | null | undefined,
) {
  const code = (lang && String(lang).trim()) || "en";
  if (pack && typeof pack === "object") {
    packCache.set(code, pack);
  }
}

export function adminLocaleMessage(
  language: string | null | undefined,
  key: string,
): string {
  const lang = (language && String(language).trim()) || "en";
  const pack = packCache.get(lang);
  if (pack?.[key]) return pack[key];
  const base = lang.split("-")[0] || lang;
  if (base !== lang) {
    const basePack = packCache.get(base);
    if (basePack?.[key]) return basePack[key];
  }
  return enPack[key] ?? key;
}

export function adminLocaleMessageFormat(
  language: string | null | undefined,
  key: string,
  vars: Record<string, string>,
): string {
  let text = adminLocaleMessage(language, key);
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}
