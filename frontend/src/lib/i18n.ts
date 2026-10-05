import en from "@/locales/en.json";
import nl from "@/locales/nl.json";

/**
 * Minimal i18n: flat key → string dictionaries. `en.json` is the source of truth for keys;
 * other locales fall back to English for missing keys. Supports `{name}` interpolation.
 */
export type MessageKey = keyof typeof en;
export type Locale = "en" | "nl";

const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = { en, nl };

let currentLocale: Locale = "en";

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dictionaries[currentLocale][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
