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
const fileCache = new Map<string, AdminLocalePack>([["en", enPack]]);

export function loadAdminLocalePack(lang: string): AdminLocalePack {
  const code = (lang && String(lang).trim()) || "en";
  const cached = fileCache.get(code);
  if (cached) {
    hydrateAdminLocale(code, cached);
    return cached;
  }

  try {
    const file = join(process.cwd(), "app", "admin-locales", `${code}.json`);
    const pack = JSON.parse(readFileSync(file, "utf8")) as AdminLocalePack;
    fileCache.set(code, pack);
    hydrateAdminLocale(code, pack);
    return pack;
  } catch {
    hydrateAdminLocale(code, enPack);
    return enPack;
  }
}
