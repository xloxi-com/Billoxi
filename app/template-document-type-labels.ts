import type { TemplateLanguage } from "./template-labels";
import extraDocumentTypeLabels from "./template-document-type-labels-extra.json";
import {
  CREDIT_NOTE_LABELS as BASE_CREDIT_NOTE_LABELS,
  DRAFT_LABELS as BASE_DRAFT_LABELS,
  PACKING_SLIP_LABELS as BASE_PACKING_SLIP_LABELS,
  RETURN_LABELS as BASE_RETURN_LABELS,
  type DocumentTypeLabelOverrides,
} from "./template-document-type-labels.data";

export type { DocumentTypeLabelOverrides };

const extra = extraDocumentTypeLabels as {
  credit?: Record<string, DocumentTypeLabelOverrides>;
  packing?: Record<string, DocumentTypeLabelOverrides>;
  draft?: Record<string, DocumentTypeLabelOverrides>;
  return?: Record<string, DocumentTypeLabelOverrides>;
  invoice?: Record<string, Pick<DocumentTypeLabelOverrides, "documentTitle" | "orderNumber" | "date">>;
};

export const CREDIT_NOTE_LABELS: Record<string, DocumentTypeLabelOverrides> = {
  ...BASE_CREDIT_NOTE_LABELS,
  ...extra.credit,
};
export const DRAFT_LABELS: Record<string, DocumentTypeLabelOverrides> = {
  ...BASE_DRAFT_LABELS,
  ...extra.draft,
};
export const PACKING_SLIP_LABELS: Record<string, DocumentTypeLabelOverrides> = {
  ...BASE_PACKING_SLIP_LABELS,
  ...extra.packing,
};
export const RETURN_LABELS: Record<string, DocumentTypeLabelOverrides> = {
  ...BASE_RETURN_LABELS,
  ...extra.return,
};
export const INVOICE_LABELS = extra.invoice ?? {};

export function lookupDocumentTypeLabels(
  table: Record<string, DocumentTypeLabelOverrides>,
  language: TemplateLanguage,
): DocumentTypeLabelOverrides {
  const base = language.split("-")[0];
  return table[language] ?? table[base] ?? table.en;
}

export function getCreditNoteLabels(
  language: TemplateLanguage,
): DocumentTypeLabelOverrides {
  return lookupDocumentTypeLabels(CREDIT_NOTE_LABELS, language);
}

export function getPackingSlipLabels(
  language: TemplateLanguage,
): DocumentTypeLabelOverrides {
  return lookupDocumentTypeLabels(PACKING_SLIP_LABELS, language);
}

export function getDraftLabels(
  language: TemplateLanguage,
): DocumentTypeLabelOverrides {
  return lookupDocumentTypeLabels(DRAFT_LABELS, language);
}

export function getReturnLabels(
  language: TemplateLanguage,
): DocumentTypeLabelOverrides {
  return lookupDocumentTypeLabels(RETURN_LABELS, language);
}

export function isBuiltInCreditOrPackingBody(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  for (const pack of Object.values(CREDIT_NOTE_LABELS)) {
    if (pack.notes === trimmed || pack.terms === trimmed) return true;
  }
  for (const pack of Object.values(PACKING_SLIP_LABELS)) {
    if (pack.notes === trimmed || pack.terms === trimmed) return true;
  }
  for (const pack of Object.values(DRAFT_LABELS)) {
    if (pack.notes === trimmed || pack.terms === trimmed) return true;
  }
  for (const pack of Object.values(RETURN_LABELS)) {
    if (pack.notes === trimmed || pack.terms === trimmed) return true;
  }
  return false;
}
