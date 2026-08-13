/**
 * Retry leftover English template labels using easier-to-translate phrasing.
 */
import fs from "fs";
import path from "path";

const GOOGLE_CODE = {
  ak: "tw",
  as: "bn",
  bm: "fr",
  ckb: "ku",
  ee: "ee",
  eo: "eo",
  ff: "fr",
  fil: "tl",
  fy: "fy",
  gd: "gd",
  ha: "ha",
  hy: "hy",
  ig: "ig",
  jv: "jw",
  kl: "da",
  ku: "ku",
  lg: "sw",
  ln: "fr",
  lo: "lo",
  lu: "fr",
  mg: "mg",
  my: "my",
  nb: "no",
  nn: "no",
  om: "om",
  qu: "es",
  sa: "hi",
  se: "no",
  sn: "sn",
  so: "so",
  ug: "ug",
  uz: "uz",
  yo: "yo",
};

const ALTS = {
  "Bill To": ["Billed to", "Billing address"],
  "Ship To": ["Ship to", "Shipping address"],
  "SALES ORDER": ["Sales Order"],
  "Order Date": ["Date of order"],
  "Ref#": ["Reference"],
  "Customer Details": ["Customer details"],
  Item: ["Product item"],
  Custom: ["Custom field"],
  Qty: ["Quantity"],
  Rate: ["Unit price"],
  Discount: ["Discount amount"],
  Amount: ["Line amount"],
  Company: ["Company name"],
  Name: ["Full name"],
  Email: ["Email address"],
  Total: ["Grand total"],
  "Sub Total": ["Subtotal"],
  "Balance Due": ["Amount due"],
};

const file = path.join("app", "template-label-packs-extra.json");
const packs = JSON.parse(fs.readFileSync(file, "utf8"));

async function translateOne(text, tl) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" +
    encodeURIComponent(tl) +
    "&dt=t&q=" +
    encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json[0] || []).map((row) => row[0]).join("");
}

function walk(obj, fn) {
  if (!obj || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object") walk(value, fn);
    else if (typeof value === "string") fn(obj, key, value);
  }
}

let changed = 0;
for (const [lang, pack] of Object.entries(packs)) {
  const tl = GOOGLE_CODE[lang] || lang;
  if (tl === "en") continue;
  const jobs = [];
  walk(pack, (parent, key, value) => {
    const alts = ALTS[value];
    if (!alts) return;
    jobs.push({ parent, key, original: value, alts });
  });
  if (!jobs.length) continue;
  console.log(`[${lang}] retry ${jobs.length} English labels via ${tl}`);
  for (const job of jobs) {
    let next = job.original;
    for (const alt of [job.original, ...job.alts]) {
      try {
        const translated = (await translateOne(alt, tl)).trim();
        if (
          translated &&
          translated.toLowerCase() !== job.original.toLowerCase() &&
          translated.toLowerCase() !== alt.toLowerCase()
        ) {
          next =
            job.original === job.original.toUpperCase()
              ? translated.toUpperCase()
              : translated;
          break;
        }
      } catch {
        /* keep trying */
      }
    }
    if (next !== job.original) {
      job.parent[job.key] = next;
      changed++;
    }
  }
}

fs.writeFileSync(file, JSON.stringify(packs, null, 2) + "\n");
console.log(`Updated ${changed} labels.`);
