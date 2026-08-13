/**
 * Fill missing template language packs + document-type labels via Google gtx.
 * Existing translations are kept. Writes:
 *   app/template-label-packs-extra.json
 *   app/template-document-type-labels-extra.json
 */
import fs from "fs";
import path from "path";

const ADMIN_I18N = fs.readFileSync(path.join("app", "admin-i18n.ts"), "utf8");
const LANGS = [...ADMIN_I18N.matchAll(/\{\s*value:\s*"([^"]+)"/g)].map(
  (m) => m[1],
);

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
const BATCH = 12;
const CONCURRENCY = 3;

const EN_PACK = {
  transaction: {
    customer: "Bill To",
    shipping: "Ship To",
    customerDetails: "Customer Details",
    documentTitle: "SALES ORDER",
    orderNumber: "Sales Order#",
    date: "Order Date",
    reference: "Ref#",
    expectedShipmentDate: "Expected Shipment Date",
    paymentMethod: "Payment Method",
  },
  columns: {
    number: "#",
    item: "Item",
    custom: "Custom",
    sku: "SKU",
    barcode: "Barcode",
    quantity: "Qty",
    rate: "Rate",
    discount: "Discount",
    discountPercentage: "Discount %",
    taxPercentage: "Tax %",
    taxAmount: "Tax",
    amount: "Amount",
  },
  customerFields: {
    company: "Company",
    companyId: "Company ID",
    name: "Name",
    nameFallback: "First name and last name",
    address: "Address",
    taxId: "Tax ID",
    vatNumber: "VAT number",
    phone: "Phone",
    email: "Email",
  },
  totals: {
    subtotalLabel: "Sub Total",
    discountAmountLabel: "Discount",
    shippingPriceLabel: "Shipping Charge",
    vatAmountLabel: "Total Tax",
    paidAmountLabel: "Paid Amount",
    balanceDueLabel: "Balance Due",
    totalLabel: "Total",
    itemsInTotalLabel: "Items in Total",
    refundedAmountLabel: "Refunded Amount",
  },
  taxSummary: {
    title: "Tax Summary",
    detailsLabel: "Tax Details",
    taxableAmountLabel: "Taxable Amount ({currency})",
    taxAmountLabel: "Tax Amount ({currency})",
    totalAmountLabel: "Total Amount ({currency})",
    totalLabel: "Total",
  },
  notesLabel: "Notes",
  notes: "Thanks for your business.",
  termsLabel: "Terms & Conditions",
  terms: "Payment is due on receipt.",
};

const DOC_EN = {
  credit: {
    documentTitle: "CREDIT NOTE",
    orderNumber: "Credit Note#",
    date: "Credit Note Date",
    reference: "Invoice Ref#",
    totalLabel: "Credit Total",
    itemsInTotalLabel: "Items in Total",
    refundedAmountLabel: "Credit Amount",
    notes: "Credit issued against the referenced invoice.",
    terms:
      "This credit note may be applied to future purchases or refunded as agreed.",
  },
  packing: {
    documentTitle: "PACKING SLIP",
    orderNumber: "Packing Slip#",
    date: "Packing Date",
    reference: "Order Ref#",
    totalLabel: "Packed Total",
    itemsInTotalLabel: "Items packed",
    notes: "Please check contents against this packing slip.",
    terms: "Report missing or damaged items within 48 hours of delivery.",
  },
  draft: {
    documentTitle: "DRAFT",
    orderNumber: "Draft#",
    date: "Draft Date",
    reference: "Ref#",
    totalLabel: "Total",
    itemsInTotalLabel: "Items in Total",
    notes: "This is a draft document for review.",
    terms:
      "This draft is not a final invoice and may change before confirmation.",
  },
  return: {
    documentTitle: "RETURN",
    orderNumber: "Return#",
    date: "Return Date",
    reference: "Order Ref#",
    totalLabel: "Return Total",
    itemsInTotalLabel: "Items returned",
    notes: "Please check returned items against this document.",
    terms: "Report discrepancies within 48 hours of the return being received.",
  },
  invoice: {
    documentTitle: "INVOICE",
    orderNumber: "Invoice#",
    date: "Invoice Date",
  },
};

const CORE_PACK_LANGS = new Set([
  "sq",
  "ar",
  "eu",
  "be",
  "bs",
  "bg",
  "ca",
  "zh-CN",
  "zh-TW",
  "hr",
  "cs",
  "da",
  "nl",
  "en",
  "et",
  "fi",
  "fr",
  "gl",
  "de",
  "el",
  "he",
  "hi",
  "hu",
  "is",
  "id",
  "ga",
  "it",
  "ja",
  "ko",
  "lv",
  "lt",
  "lb",
  "mk",
  "ms",
  "mt",
  "no",
  "pl",
  "pt",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sr",
  "sk",
  "sl",
  "es",
  "sv",
  "ta",
  "th",
  "tr",
  "uk",
  "vi",
  "cy",
]);

const CORE_DOC_LANGS = new Set([
  ...CORE_PACK_LANGS,
  "en-AU",
  "en-CA",
  "en-GB",
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function protectPlaceholders(text) {
  const slots = [];
  const protectedText = String(text).replace(/\{[a-zA-Z0-9_]+\}/g, (m) => {
    const i = slots.length;
    slots.push(m);
    return `⦃${i}⦄`;
  });
  return { protectedText, slots };
}

function restorePlaceholders(text, slots) {
  return String(text)
    .replace(/⦃\s*(\d+)\s*⦄/g, (_, n) => slots[Number(n)] ?? _)
    .replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, "{$1}");
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
    for (const text of texts) {
      out.push(await translateOne(text, tl));
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

function flatten(obj, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flatten(value, pathKey));
    } else {
      out.push([pathKey, String(value)]);
    }
  }
  return out;
}

function unflatten(entries) {
  const root = {};
  for (const [pathKey, value] of entries) {
    const parts = pathKey.split(".");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] ??= {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return root;
}

async function translateObject(enObj, tl) {
  const entries = flatten(enObj);
  const next = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    let tries = 0;
    for (;;) {
      try {
        const translated = await translateBatch(
          chunk.map(([, text]) => text),
          tl,
        );
        chunk.forEach(([key], idx) => {
          next.push([key, translated[idx] || chunk[idx][1]]);
        });
        break;
      } catch (err) {
        tries++;
        if (tries >= 3) {
          chunk.forEach((entry) => next.push(entry));
          break;
        }
        await sleep(400 * tries);
      }
    }
    await sleep(60);
  }
  return unflatten(next);
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

const EXTENDED_SRC = fs.readFileSync(
  path.join("app", "template-label-packs-extended.ts"),
  "utf8",
);
const EXTENDED_LANGS = new Set(
  [...EXTENDED_SRC.matchAll(/\n    ([a-z]{2}(?:-[A-Z]{2})?): \{/g)].map(
    (m) => m[1],
  ),
);

const PACK_EXTRA_FILE = path.join("app", "template-label-packs-extra.json");
const DOC_EXTRA_FILE = path.join(
  "app",
  "template-document-type-labels-extra.json",
);

const packExtra = loadJson(PACK_EXTRA_FILE, {});
const docExtra = loadJson(DOC_EXTRA_FILE, {
  credit: {},
  packing: {},
  draft: {},
  return: {},
  invoice: {},
});

const forceEnglish = process.argv.includes("--force-english");

function packHasEnglishLeaves(pack) {
  if (!pack || typeof pack !== "object") return false;
  const enLeaves = new Map(flatten(EN_PACK));
  return flatten(pack).some(([key, value]) => enLeaves.get(key) === value);
}

const extendedBodies = {};
{
  const parts = EXTENDED_SRC.split(/\n    ([a-z]{2,3}(?:-[A-Z]{2})?): \{/);
  for (let i = 1; i < parts.length; i += 2) {
    extendedBodies[parts[i]] = parts[i + 1] || "";
  }
}

const missingPacks = LANGS.filter((lang) => {
  if (lang === "en" || CORE_PACK_LANGS.has(lang)) return false;
  if (!EXTENDED_LANGS.has(lang) && !packExtra[lang]) return true;
  if (!forceEnglish) return false;
  const tl = GOOGLE_CODE[lang] || lang;
  if (tl === "en") return false;
  if (packExtra[lang]) return packHasEnglishLeaves(packExtra[lang]);
  const body = extendedBodies[lang] || "";
  return (
    body.includes('customer: "Bill To"') ||
    body.includes('documentTitle: "SALES ORDER"') ||
    body.includes('shipping: "Ship To"')
  );
});

const missingDoc = LANGS.filter((lang) => {
  if (lang === "en" || CORE_DOC_LANGS.has(lang)) return false;
  if (!docExtra.credit?.[lang]) return true;
  if (!forceEnglish) return false;
  const tl = GOOGLE_CODE[lang] || lang;
  if (tl === "en") return false;
  return packHasEnglishLeaves(docExtra.credit[lang]);
});

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

console.log(
  `Missing sales-order packs: ${missingPacks.length}; missing doc-type langs: ${missingDoc.length}`,
);

await pool(missingPacks, CONCURRENCY, async (lang) => {
  const tl = GOOGLE_CODE[lang] || lang;
  if (tl === "en") {
    packExtra[lang] = EN_PACK;
    saveJson(PACK_EXTRA_FILE, packExtra);
    console.log(`[pack ${lang}] copied English`);
    return;
  }
  console.log(`[pack ${lang}] translating via ${tl}…`);
  packExtra[lang] = await translateObject(EN_PACK, tl);
  saveJson(PACK_EXTRA_FILE, packExtra);
  console.log(`[pack ${lang}] done`);
});

await pool(missingDoc, CONCURRENCY, async (lang) => {
  const tl = GOOGLE_CODE[lang] || lang;
  if (tl === "en") {
    for (const kind of Object.keys(DOC_EN)) {
      docExtra[kind][lang] = DOC_EN[kind];
    }
    saveJson(DOC_EXTRA_FILE, docExtra);
    console.log(`[doc ${lang}] copied English`);
    return;
  }
  console.log(`[doc ${lang}] translating via ${tl}…`);
  for (const kind of Object.keys(DOC_EN)) {
    docExtra[kind][lang] = await translateObject(DOC_EN[kind], tl);
  }
  saveJson(DOC_EXTRA_FILE, docExtra);
  console.log(`[doc ${lang}] done`);
});

console.log("Template locale generate done.");
