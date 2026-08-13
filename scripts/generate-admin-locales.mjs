/**
 * Generate admin-locales/*.json for every ADMIN_UI_LANGUAGE via Google gtx.
 * Preserves {placeholders}. Existing JSON keys win (not overwritten).
 *
 * Usage: node scripts/generate-admin-locales.mjs [--lang=fr,de] [--force-missing] [--prefix=detail.,common.edit]
 */
import fs from "fs";
import path from "path";

const LOCALES_DIR = path.join("app", "admin-locales");
const ADMIN_I18N = fs.readFileSync(path.join("app", "admin-i18n.ts"), "utf8");

const LANGS = [
  ...ADMIN_I18N.matchAll(/\{\s*value:\s*"([^"]+)"/g),
].map((m) => m[1]);

/** Map admin locale → Google Translate target (closest supported if needed). */
const GOOGLE_CODE = {
  af: "af",
  ak: "tw",
  am: "am",
  ar: "ar",
  as: "bn",
  az: "az",
  be: "be",
  bg: "bg",
  bm: "fr",
  bn: "bn",
  bo: "zh-CN",
  br: "fr",
  bs: "bs",
  ca: "ca",
  ce: "ru",
  ckb: "ku",
  cs: "cs",
  cy: "cy",
  da: "da",
  de: "de",
  dz: "en",
  ee: "ee",
  el: "el",
  en: "en",
  eo: "eo",
  es: "es",
  et: "et",
  eu: "eu",
  fa: "fa",
  ff: "fr",
  fi: "fi",
  fil: "tl",
  fo: "da",
  fr: "fr",
  fy: "fy",
  ga: "ga",
  gd: "gd",
  gl: "gl",
  gu: "gu",
  gv: "ga",
  ha: "ha",
  he: "iw",
  hi: "hi",
  hr: "hr",
  hu: "hu",
  hy: "hy",
  ia: "en",
  id: "id",
  ig: "ig",
  ii: "zh-CN",
  is: "is",
  it: "it",
  ja: "ja",
  jv: "jw",
  ka: "ka",
  ki: "sw",
  kk: "kk",
  kl: "da",
  km: "km",
  kn: "kn",
  ko: "ko",
  ks: "ur",
  ku: "ku",
  kw: "cy",
  ky: "ky",
  lb: "lb",
  lg: "sw",
  ln: "fr",
  lo: "lo",
  lt: "lt",
  lu: "fr",
  lv: "lv",
  mg: "mg",
  mi: "mi",
  mk: "mk",
  ml: "ml",
  mn: "mn",
  mr: "mr",
  ms: "ms",
  mt: "mt",
  my: "my",
  nb: "no",
  nd: "zu",
  ne: "ne",
  nl: "nl",
  nn: "no",
  no: "no",
  om: "om",
  or: "or",
  os: "ru",
  pa: "pa",
  pl: "pl",
  ps: "ps",
  "pt-BR": "pt",
  "pt-PT": "pt",
  qu: "es",
  rm: "de",
  rn: "rw",
  ro: "ro",
  ru: "ru",
  rw: "rw",
  sa: "hi",
  sc: "it",
  sd: "sd",
  se: "no",
  sg: "fr",
  si: "si",
  sk: "sk",
  sl: "sl",
  sn: "sn",
  so: "so",
  sq: "sq",
  sr: "sr",
  su: "su",
  sv: "sv",
  sw: "sw",
  ta: "ta",
  te: "te",
  tg: "tg",
  th: "th",
  ti: "am",
  tk: "tr",
  to: "en",
  tr: "tr",
  tt: "ru",
  ug: "ug",
  uk: "uk",
  ur: "ur",
  uz: "uz",
  vi: "vi",
  wo: "fr",
  xh: "xh",
  yi: "yi",
  yo: "yo",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  zu: "zu",
};

const SEP = "\n###@@###\n";
const BATCH = 15;
const CONCURRENCY = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function protectPlaceholders(text) {
  const slots = [];
  const protectedText = text.replace(/\{[a-zA-Z0-9_]+\}/g, (m) => {
    const i = slots.length;
    slots.push(m);
    return `⦃${i}⦄`;
  });
  return { protectedText, slots };
}

function restorePlaceholders(text, slots) {
  return text.replace(/⦃\s*(\d+)\s*⦄/g, (_, n) => slots[Number(n)] ?? _).replace(
    /\{\s*([a-zA-Z0-9_]+)\s*\}/g,
    "{$1}",
  );
}

async function translateBatch(texts, tl) {
  const per = texts.map((t) => protectPlaceholders(t));
  const encoded = per.map((p) => p.protectedText).join(SEP);

  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" +
    encodeURIComponent(tl) +
    "&dt=t&q=" +
    encodeURIComponent(encoded);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${tl}`);
  const json = await res.json();
  const translated = (json[0] || []).map((row) => row[0]).join("");
  const pieces = translated.split(/\n?###@@###\n?/);
  const exact = translated.split(SEP);
  const use = exact.length === texts.length ? exact : pieces;
  if (use.length !== texts.length) {
    const out = [];
    for (let i = 0; i < texts.length; i++) {
      out.push(await translateOne(texts[i], tl));
      await sleep(80);
    }
    return out;
  }
  return use.map((piece, i) => restorePlaceholders(piece.trim(), per[i].slots));
}

async function translateOne(text, tl) {
  const { protectedText, slots } = protectPlaceholders(text);
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" +
    encodeURIComponent(tl) +
    "&dt=t&q=" +
    encodeURIComponent(protectedText);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const translated = (json[0] || []).map((row) => row[0]).join("");
  return restorePlaceholders(translated, slots);
}

function loadJson(lang) {
  const p = path.join(LOCALES_DIR, `${lang}.json`);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveJson(lang, data) {
  const p = path.join(LOCALES_DIR, `${lang}.json`);
  const sorted = {};
  for (const k of Object.keys(data).sort()) sorted[k] = data[k];
  fs.writeFileSync(p, JSON.stringify(sorted, null, 2) + "\n");
}

const args = process.argv.slice(2);
const only = args
  .find((a) => a.startsWith("--lang="))
  ?.slice(7)
  ?.split(",")
  .filter(Boolean);
const forceMissing = args.includes("--force-missing");
const prefixes = args
  .find((a) => a.startsWith("--prefix="))
  ?.slice(9)
  ?.split(",")
  .filter(Boolean);

const en = loadJson("en");
const enKeys = Object.keys(en);
if (enKeys.length === 0) {
  console.error("Missing app/admin-locales/en.json — run extract first");
  process.exit(1);
}

function keyInScope(key) {
  if (!prefixes?.length) return true;
  return prefixes.some((prefix) =>
    prefix.endsWith(".") ? key.startsWith(prefix) : key === prefix,
  );
}

const targets = (only?.length ? only : LANGS).filter((l) => l !== "en");

async function fillLanguage(lang) {
  let tl = GOOGLE_CODE[lang] || lang;
  const existing = loadJson(lang);
  const missingKeys = enKeys.filter((k) => {
    if (!keyInScope(k)) return false;
    if (!existing[k]) return true;
    if (forceMissing && existing[k] === en[k] && tl !== "en") return true;
    return false;
  });
  if (missingKeys.length === 0) {
    console.log(`[${lang}] complete (${enKeys.length})`);
    return;
  }
  if (tl === "en") {
    const next = { ...en, ...existing };
    saveJson(lang, next);
    console.log(`[${lang}] copied English (${enKeys.length})`);
    return;
  }
  console.log(`[${lang}] translating ${missingKeys.length} missing via ${tl}…`);
  const next = { ...existing };
  for (let i = 0; i < missingKeys.length; i += BATCH) {
    const chunkKeys = missingKeys.slice(i, i + BATCH);
    const chunkTexts = chunkKeys.map((k) => en[k]);
    let tries = 0;
    for (;;) {
      try {
        const translated = await translateBatch(chunkTexts, tl);
        chunkKeys.forEach((k, idx) => {
          next[k] = translated[idx] || en[k];
        });
        break;
      } catch (err) {
        const msg = String(err.message || err);
        console.warn(`[${lang}] batch fail try ${tries + 1}:`, msg);
        if (msg.includes("HTTP 400")) {
          chunkKeys.forEach((k) => {
            next[k] = en[k];
          });
          for (const k of missingKeys.slice(i + BATCH)) next[k] = en[k];
          saveJson(lang, next);
          console.log(`[${lang}] unsupported ${tl}, filled rest from English`);
          return;
        }
        tries++;
        if (tries >= 3) {
          chunkKeys.forEach((k) => {
            next[k] = en[k];
          });
          break;
        }
        await sleep(400 * tries);
      }
    }
    saveJson(lang, next);
    await sleep(80);
  }
  console.log(`[${lang}] done ${Object.keys(next).length}`);
}

async function pool(items, size, worker) {
  let idx = 0;
  const runners = Array.from({ length: size }, async () => {
    while (idx < items.length) {
      const cur = items[idx++];
      await worker(cur);
    }
  });
  await Promise.all(runners);
}

console.log(`EN keys: ${enKeys.length}; languages: ${targets.length}`);
await pool(targets, CONCURRENCY, fillLanguage);
console.log("All done.");
