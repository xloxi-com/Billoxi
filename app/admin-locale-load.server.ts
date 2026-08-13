/**
 * Server-only locale loader. Reads JSON from disk so the client bundle
 * never imports all admin-locales/*.json files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdminLocalePack } from "./admin-locale-store";
import { hydrateAdminLocale } from "./admin-locale-store";
import en from "./admin-locales/en.json";

const enPack = en as AdminLocalePack;
const fileCache = new Map<string, AdminLocalePack>();

function readLocaleFile(code: string): AdminLocalePack | null {
  try {
    const file = join(process.cwd(), "app", "admin-locales", `${code}.json`);
    return JSON.parse(readFileSync(file, "utf8")) as AdminLocalePack;
  } catch {
    return null;
  }
}

function mergeWithEnglish(pack: AdminLocalePack): AdminLocalePack {
  // English fills gaps so newly added keys never render as raw ids.
  return { ...enPack, ...pack };
}

export function loadAdminLocalePack(lang: string): AdminLocalePack {
  const code = (lang && String(lang).trim()) || "en";
  const isDev = process.env.NODE_ENV !== "production";

  let pack = !isDev ? fileCache.get(code) : undefined;
  if (!pack) {
    // Dev: re-read so new keys appear without restart. Prod: cache once.
    pack = readLocaleFile(code) ?? (code === "en" ? enPack : null) ?? enPack;
    fileCache.set(code, pack);
  }

  const merged = mergeWithEnglish(pack);
  hydrateAdminLocale(code, merged);
  return merged;
}
