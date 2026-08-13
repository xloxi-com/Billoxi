/**
 * Template Language dropdown — same catalog as admin UI,
 * plus English / Portuguese regional variants.
 */
import { ADMIN_UI_LANGUAGES } from "./admin-i18n";

const EXTRA_TEMPLATE_LANGUAGES = [
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "pt", label: "Português (Portuguese)" },
] as const;

function templateLanguageSortKey(label: string): string {
  if (/^English(\s|$)/i.test(label)) return label.toLowerCase();
  const paren = label.match(/\(([^)]+)\)\s*$/);
  return (paren?.[1] || label).toLowerCase();
}

export const TEMPLATE_LANGUAGES = [
  ...ADMIN_UI_LANGUAGES,
  ...EXTRA_TEMPLATE_LANGUAGES,
]
  .slice()
  .sort((a, b) =>
    templateLanguageSortKey(a.label).localeCompare(
      templateLanguageSortKey(b.label),
      "en",
      { sensitivity: "base" },
    ),
  );

export type TemplateLanguage = string;

export const DEFAULT_TEMPLATE_LANGUAGE: TemplateLanguage = "en";

export function isTemplateLanguage(value: unknown): value is TemplateLanguage {
  return (
    typeof value === "string" &&
    TEMPLATE_LANGUAGES.some((entry) => entry.value === value)
  );
}

export function normalizeTemplateLanguage(
  value: unknown,
  fallback: TemplateLanguage = DEFAULT_TEMPLATE_LANGUAGE,
): TemplateLanguage {
  if (isTemplateLanguage(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const raw = value.trim();
    const lower = raw.toLowerCase();
    const base = lower.split("-")[0] || lower;
    const exact = TEMPLATE_LANGUAGES.find(
      (entry) =>
        entry.value === raw || entry.value.toLowerCase() === lower,
    );
    if (exact) return exact.value;
    if (base === "pt") {
      if (lower.includes("br")) return "pt-BR";
      if (lower.includes("pt")) return "pt-PT";
      return "pt";
    }
    if (base === "zh") {
      if (
        lower.includes("tw") ||
        lower.includes("hk") ||
        lower.includes("hant")
      ) {
        return "zh-TW";
      }
      return "zh-CN";
    }
    if (base === "en") {
      if (lower.includes("au")) return "en-AU";
      if (lower.includes("ca")) return "en-CA";
      if (lower.includes("gb") || lower.includes("uk")) return "en-GB";
      return "en";
    }
    const match = TEMPLATE_LANGUAGES.find(
      (entry) => entry.value.split("-")[0]?.toLowerCase() === base,
    );
    if (match) return match.value;
  }
  return fallback;
}
