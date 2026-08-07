import type { TemplateLanguage } from "./template-labels";
import {
  CREDIT_NOTE_LABELS,
  PACKING_SLIP_LABELS,
  type DocumentTypeLabelOverrides,
} from "./template-document-type-labels.data";

export type { DocumentTypeLabelOverrides };

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

export function isBuiltInCreditOrPackingBody(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  for (const pack of Object.values(CREDIT_NOTE_LABELS)) {
    if (pack.notes === trimmed || pack.terms === trimmed) return true;
  }
  for (const pack of Object.values(PACKING_SLIP_LABELS)) {
    if (pack.notes === trimmed || pack.terms === trimmed) return true;
  }
  return false;
}
