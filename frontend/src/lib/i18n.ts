import { useSyncExternalStore } from "react";
import { en, type NamespaceName, type Namespaces, nl } from "@/locales";

/**
 * Kleine i18n-laag: de namespace-bestanden uit `src/locales/<taal>/` worden samengevoegd tot
 * één platte map `<namespace>.<sleutel>` → tekst. Nederlands is de standaardtaal, Engels de
 * tweede; ontbreekt een Nederlandse tekst, dan valt `t()` terug op het Engels.
 * Ondersteunt `{naam}`-interpolatie en meervoud via sleutels `<basis>_one` / `<basis>_other`.
 *
 * Componenten vertalen met `const { t } = useI18n()`: bij een taalwissel renderen ze dan
 * opnieuw zonder te remounten (focus, formulieren en editorstatus blijven behouden). De losse
 * `t()` / `tc()` zijn voor code buiten het renderen (event-handlers, toasts, tests).
 */
export type MessageKey = {
  [N in NamespaceName]: `${N}.${keyof Namespaces[N] & string}`;
}[NamespaceName];

type PluralBase<K extends string> = K extends `${infer Base}_one`
  ? `${Base}_other` extends MessageKey
    ? Base
    : never
  : never;

/** Basissleutels waarvoor zowel `_one` als `_other` bestaat (voor `tc()`). */
export type PluralKey = PluralBase<MessageKey>;

export type Locale = "nl" | "en";
export const LOCALES: readonly Locale[] = ["nl", "en"];
export const DEFAULT_LOCALE: Locale = "nl";

type Params = Record<string, string | number>;

/**
 * Voegt `{ namespace: { sleutel: tekst } }` samen tot `{ "namespace.sleutel": tekst }`.
 * Gooit bij een waarde die geen string is: geneste objecten of getallen in een
 * vertaalbestand zijn een fout die meteen moet opvallen (tests, dev-server).
 */
export function flattenNamespaces(
  namespaces: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [namespace, messages] of Object.entries(namespaces)) {
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value !== "string") {
        throw new TypeError(`i18n: ${namespace}.${key} is geen tekst`);
      }
      flat[`${namespace}.${key}`] = value;
    }
  }
  return flat;
}

const dictionaries: Record<Locale, Readonly<Record<string, string>>> = {
  en: flattenNamespaces(en),
  nl: flattenNamespaces(nl),
};

/** Alle sleutels (uit het Engels); handig voor tests en tooling. */
export function messageKeys(locale: Locale = "en"): string[] {
  return Object.keys(dictionaries[locale]);
}

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Wisselt de taal voor volgende `t()`-aanroepen, zet `<html lang>` en verwittigt de
 * componenten die `useI18n()` / `useLocale()` gebruiken.
 */
export function setLocale(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  if (locale === currentLocale) return;
  currentLocale = locale;
  for (const listener of [...listeners]) listener();
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Luistert naar taalwissels; geeft een functie terug die het luisteren stopt. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** BCP 47-tag voor Intl-formattering (datums, getallen) in de huidige taal. */
export function intlLocale(locale: Locale = currentLocale): string {
  return locale === "nl" ? "nl-BE" : "en-GB";
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  return interpolate(template, params);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

function translatePlural(locale: Locale, key: PluralKey, count: number, params?: Params): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(intlLocale(locale));
    pluralRules.set(locale, rules);
  }
  const form = rules.select(count) === "one" ? "one" : "other";
  return translate(locale, `${key}_${form}` as MessageKey, {
    count: count.toLocaleString(intlLocale(locale)),
    ...params,
  });
}

/** Vertaalt in de huidige taal. In componenten: `useI18n().t` (rendert mee bij een taalwissel). */
export function t(key: MessageKey, params?: Params): string {
  return translate(currentLocale, key, params);
}

/** Meervoud: kiest `<key>_one` of `<key>_other` op basis van `count` en vult `{count}` in. */
export function tc(key: PluralKey, count: number, params?: Params): string {
  return translatePlural(currentLocale, key, count, params);
}

export interface I18n {
  locale: Locale;
  t: (key: MessageKey, params?: Params) => string;
  tc: (key: PluralKey, count: number, params?: Params) => string;
}

/** Eén object per taal, zodat `t`/`tc` stabiel blijven tussen renders (veilig in deps-lijsten). */
const translators = new Map<Locale, I18n>();

function translatorFor(locale: Locale): I18n {
  let translator = translators.get(locale);
  if (!translator) {
    translator = {
      locale,
      t: (key, params) => translate(locale, key, params),
      tc: (key, count, params) => translatePlural(locale, key, count, params),
    };
    translators.set(locale, translator);
  }
  return translator;
}

/** De huidige taal; de component rendert opnieuw bij een wissel. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** `t`, `tc` en `locale` voor componenten; rendert opnieuw (zonder remount) bij een taalwissel. */
export function useI18n(): I18n {
  return translatorFor(useLocale());
}
