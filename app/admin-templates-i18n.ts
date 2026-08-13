/**
 * Templates gallery copy (admin UI language).
 */
import {
  normalizeAdminUiLanguage,
  type AdminUiLanguage,
} from "./admin-i18n";
import { adminLocaleMessage } from "./admin-locale-store";

export type TemplatesMessageKey =
  | "tpl.documentType"
  | "tpl.active"
  | "tpl.preview"
  | "tpl.edit"
  | "tpl.use"
  | "tpl.available"
  | "tpl.useConfirmTitle"
  | "tpl.useConfirmYes"
  | "tpl.useConfirmCancel"
  | "tpl.useConfirmBody"
  | "tpl.previewSubtitle"
  | "tpl.close"
  | "tpl.type.sales-order"
  | "tpl.type.invoice"
  | "tpl.type.draft"
  | "tpl.type.credit-note"
  | "tpl.type.packing-slip"
  | "tpl.type.return"
  | "tpl.desc.sales-order"
  | "tpl.desc.invoice"
  | "tpl.desc.draft"
  | "tpl.desc.credit-note"
  | "tpl.desc.packing-slip"
  | "tpl.desc.return"
  | "tpl.heading.sales-order"
  | "tpl.heading.invoice"
  | "tpl.heading.draft"
  | "tpl.heading.credit-note"
  | "tpl.heading.packing-slip"
  | "tpl.heading.return"
  | "tpl.name.Standard"
  | "tpl.name.Modern"
  | "tpl.name.Classic"
  | "tpl.name.Compact"
  | "tpl.name.Minimal"
  | "tpl.name.European"
  | "tpl.name.Japanese"
  | "tpl.name.Bold"
  | "tpl.name.Professional"
  | "tpl.name.Studio"
  | "tpl.name.Horizon"
  | "tpl.name.Ledger"
  | "tpl.name.Folio"
  | "tpl.name.Spectrum"
  | "tpl.name.Apex"
  | "tpl.name.Simple"
  | "tpl.name.Detailed"
  | "tpl.name.Branded"
  | "tpl.name.Warehouse"
  | "tpl.name.Express"
  | "tpl.name.Fulfillment";

/** English description → translated string per language (FR full; others fall back). */
const DESC_FR: Record<string, string> = {
  "Original sales order layout — your saved settings stay as set.":
    "Mise en page d’origine — vos réglages enregistrés restent inchangés.",
  "Accent bar header, product images, and paid/due amounts.":
    "En-tête à barre d’accent, images produits et montants payé/dû.",
  "Editorial serif with full tax summary and balances.":
    "Serif éditorial avec récapitulatif fiscal et soldes.",
  "Dense premium layout with thumbs and payment status.":
    "Mise en page premium dense avec vignettes et statut de paiement.",
  "Soft ocean accents, airy spacing, and a calm totals block.":
    "Accents océan doux, espacement aéré et bloc totaux calme.",
  "Logo right / title left — tax summary + balance banner.":
    "Logo à droite / titre à gauche — récap fiscal + bannière solde.",
  "Centered premium layout with boxed payment status.":
    "Mise en page premium centrée avec statut de paiement encadré.",
  "Color title band with inverted details and balances.":
    "Bandeau titre coloré avec détails et soldes inversés.",
  "Navy B2B with tax summary, paid & balance due.":
    "B2B marine avec récap fiscal, payé et solde dû.",
  "Violet title with logo top-right and payment panels.":
    "Titre violet, logo en haut à droite et panneaux de paiement.",
  "Full-width banner title with payment totals.":
    "Titre bannière pleine largeur avec totaux de paiement.",
  "Formal ledger with under-total dues.":
    "Grand livre formel avec dus sous le total.",
  "Display serif title with split payment panels.":
    "Titre serif display avec panneaux de paiement séparés.",
  "Sky dual-tone accents, large images, and balance banner.":
    "Accents bicolores ciel, grandes images et bannière solde.",
  "Indigo accents with inverted payment dues.":
    "Accents indigo avec dus de paiement inversés.",
  "Navy B2B invoice with card meta and under-total dues.":
    "Facture B2B marine avec méta en cartes et dus sous le total.",
  "Clean blue accent bar with product images and boxed dues.":
    "Barre bleue claire, images produits et dus encadrés.",
  "EU-style layout — logo right, tax summary, balance banner.":
    "Style UE — logo à droite, récap fiscal, bannière solde.",
  "Editorial European serif with formal tax summary.":
    "Serif européen éditorial avec récap fiscal formel.",
  "Dense amber layout for multi-line invoices.":
    "Mise en page ambre dense pour factures multi-lignes.",
  "Soft Nordic accents and airy spacing.":
    "Accents nordiques doux et espacement aéré.",
  "Simple everyday invoice — clear and familiar.":
    "Facture simple du quotidien — claire et familière.",
  "Strong red title band with inverted meta details.":
    "Bandeau titre rouge fort avec méta inversée.",
  "Creative violet strip meta and boxed payments.":
    "Méta en bande violette créative et paiements encadrés.",
  "Full-width warm banner title for retail invoices.":
    "Bannière titre chaude pleine largeur pour le retail.",
  "Formal European ledger with under-total balances.":
    "Grand livre européen formel avec soldes sous le total.",
  "Sky dual-tone modern invoice with large images.":
    "Facture moderne bicolore ciel avec grandes images.",
  "Indigo modern invoice with inverted meta and banner dues.":
    "Facture moderne indigo, méta inversée et dus en bannière.",
  "Centered modern layout with boxed payment status.":
    "Mise en page moderne centrée avec statut de paiement encadré.",
  "Navy B2B credit note with card meta and clear totals.":
    "Avoir B2B marine avec méta en cartes et totaux clairs.",
  "Clean blue accent for refunds and adjustments.":
    "Accent bleu clair pour remboursements et ajustements.",
  "EU-style credit note with tax summary space.":
    "Avoir style UE avec espace récap fiscal.",
  "Formal serif layout for accounting-led refunds.":
    "Mise en page serif formelle pour remboursements comptables.",
  "A concise layout for quick adjustments.":
    "Mise en page concise pour ajustements rapides.",
  "Airy Nordic layout for clean credit notes.":
    "Mise en page nordique aérée pour avoirs clairs.",
  "A clear layout for refunds and adjustments.":
    "Mise en page claire pour remboursements et ajustements.",
  "Strong rose title band for high-visibility credits.":
    "Bandeau titre rose fort pour avoirs très visibles.",
  "Soft violet studio look for branded credit notes.":
    "Look studio violet doux pour avoirs de marque.",
  "Wide cyan header for marketplace refunds.":
    "En-tête cyan large pour remboursements marketplace.",
  "Accounting-forward layout with outline meta.":
    "Mise en page comptable avec méta en contour.",
  "Editorial folio style for premium brand credits.":
    "Style folio éditorial pour avoirs premium.",
  "Indigo spectrum accents for multi-line credits.":
    "Accents spectre indigo pour avoirs multi-lignes.",
  "A lightweight credit note layout.":
    "Mise en page d’avoir légère.",
  "Includes extra space for adjustment notes.":
    "Espace supplémentaire pour notes d’ajustement.",
  "Clear packing slip for everyday shipments.":
    "Bon de livraison clair pour expéditions quotidiennes.",
  "Highlights your brand and delivery details.":
    "Met en avant votre marque et les détails de livraison.",
  "Dense left-aligned layout for high-volume packing.":
    "Mise en page dense alignée à gauche pour gros volumes.",
  "Extra room for shipment and item details.":
    "Plus d’espace pour expédition et détails articles.",
  "Warehouse-ready navy layout for B2B packs.":
    "Mise en page marine prête entrepôt pour packs B2B.",
  "Clean blue accent for fulfillment desks.":
    "Accent bleu clair pour postes d’expédition.",
  "EU-style slip with clear ship-to hierarchy.":
    "Bon style UE avec hiérarchie destinataire claire.",
  "Formal packing list for retail handoffs.":
    "Liste d’emballage formelle pour remises retail.",
  "Sparse layout focused on SKU and quantity.":
    "Mise en page épurée centrée sur SKU et quantité.",
  "High-contrast slip for busy packing stations.":
    "Bon contrasté pour postes d’emballage chargés.",
  "Industrial slate look for pick-and-pack flows.":
    "Look ardoise industriel pour pick-and-pack.",
  "Fast-ship accent with clear quantity focus.":
    "Accent expédition rapide, focus quantité.",
  "Indigo spectrum accents for multi-line packs.":
    "Accents spectre indigo pour packs multi-lignes.",
  "Lightweight slip for quick outbound labels.":
    "Bon léger pour étiquettes sortantes rapides.",
  "Detailed pick list style with centered brand mark.":
    "Style liste de picking détaillée avec marque centrée.",
};


const NAME_KEYS: Record<string, TemplatesMessageKey> = {
  Standard: "tpl.name.Standard",
  Modern: "tpl.name.Modern",
  Classic: "tpl.name.Classic",
  Compact: "tpl.name.Compact",
  Minimal: "tpl.name.Minimal",
  European: "tpl.name.European",
  Japanese: "tpl.name.Japanese",
  Bold: "tpl.name.Bold",
  Professional: "tpl.name.Professional",
  Studio: "tpl.name.Studio",
  Horizon: "tpl.name.Horizon",
  Ledger: "tpl.name.Ledger",
  Folio: "tpl.name.Folio",
  Spectrum: "tpl.name.Spectrum",
  Apex: "tpl.name.Apex",
  Simple: "tpl.name.Simple",
  Detailed: "tpl.name.Detailed",
  Branded: "tpl.name.Branded",
  Warehouse: "tpl.name.Warehouse",
  Express: "tpl.name.Express",
  Fulfillment: "tpl.name.Fulfillment",
};

export function templatesT(
  language: AdminUiLanguage | string | null | undefined,
  key: TemplatesMessageKey,
): string {
  const lang = normalizeAdminUiLanguage(language);
  return adminLocaleMessage(lang, key);
}

export function templatesTf(
  language: AdminUiLanguage | string | null | undefined,
  key: TemplatesMessageKey,
  vars: Record<string, string>,
): string {
  let text = templatesT(language, key);
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

export function templatesDocTypeLabel(
  language: AdminUiLanguage | string | null | undefined,
  id: string,
): string {
  const key = `tpl.type.${id}` as TemplatesMessageKey;
  return templatesT(language, key);
}

export function templatesDocTypeDesc(
  language: AdminUiLanguage | string | null | undefined,
  id: string,
): string {
  const key = `tpl.desc.${id}` as TemplatesMessageKey;
  return templatesT(language, key);
}

export function templatesHeading(
  language: AdminUiLanguage | string | null | undefined,
  id: string,
): string {
  const key = `tpl.heading.${id}` as TemplatesMessageKey;
  return templatesT(language, key);
}

export function templatesPresetName(
  language: AdminUiLanguage | string | null | undefined,
  name: string,
): string {
  const key = NAME_KEYS[name];
  return key ? templatesT(language, key) : name;
}

export function templatesPresetDescription(
  language: AdminUiLanguage | string | null | undefined,
  description: string,
): string {
  const lang = normalizeAdminUiLanguage(language);
  if (lang === "fr") return DESC_FR[description] ?? description;
  return description;
}
