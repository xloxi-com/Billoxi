/**
 * Extract English + existing human packs from admin *i18n.ts into JSON.
 */
import fs from "fs";
import path from "path";

function extractObjectLiteral(src, constName) {
  const re = new RegExp(`const ${constName}(?:: [^=]+)? = \\{`);
  const m = src.match(re);
  if (!m || m.index == null) return null;
  let i = m.index + m[0].length - 1;
  let depth = 0;
  let inStr = false;
  let strQuote = "";
  let escape = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === strQuote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = true;
      strQuote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(m.index + m[0].length - 1, i + 1);
    }
  }
  return null;
}

/** Parse TS object with string keys/values; joins adjacent string literals. */
function parseMessages(objSrc) {
  const out = {};
  // Match "key": <value expression until next key or }>
  const entryRe =
    /"((?:\\.|[^"\\])*)"\s*:\s*((?:(?:"(?:\\.|[^"\\])*")\s*\+\s*)*(?:"(?:\\.|[^"\\])*"))/g;
  let m;
  while ((m = entryRe.exec(objSrc))) {
    const key = JSON.parse(`"${m[1]}"`);
    const parts = [...m[2].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((p) =>
      JSON.parse(`"${p[1]}"`),
    );
    out[key] = parts.join("");
  }
  return out;
}

const modules = [
  { file: "admin-i18n.ts", packs: ["en", "ta", "es", "fr", "de", "hi"] },
  { file: "admin-settings-i18n.ts", packs: ["en", "fr", "es", "de", "ta", "hi"] },
  { file: "admin-pricing-i18n.ts", packs: ["en", "fr", "es", "de", "ta", "hi"] },
  { file: "admin-templates-i18n.ts", packs: ["en", "fr", "es", "de", "ta", "hi"] },
  {
    file: "admin-template-editor-i18n.ts",
    packs: ["en", "fr", "es", "de", "ta", "hi"],
  },
];

const byLang = {};

for (const mod of modules) {
  const src = fs.readFileSync(path.join("app", mod.file), "utf8");
  for (const pack of mod.packs) {
    const lit = extractObjectLiteral(src, pack);
    if (!lit) {
      console.warn("missing", mod.file, pack);
      continue;
    }
    const msgs = parseMessages(lit);
    byLang[pack] = { ...(byLang[pack] || {}), ...msgs };
    console.log(mod.file, pack, Object.keys(msgs).length);
  }
}

const outDir = "app/admin-locales";
fs.mkdirSync(outDir, { recursive: true });
for (const [lang, msgs] of Object.entries(byLang)) {
  fs.writeFileSync(
    path.join(outDir, `${lang}.json`),
    JSON.stringify(msgs, null, 2) + "\n",
  );
  console.log("wrote", lang, Object.keys(msgs).length);
}

const enKeys = Object.keys(byLang.en || {});
console.log("EN keys", enKeys.length);
