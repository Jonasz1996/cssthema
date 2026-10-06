import type { Palette } from "@/api/types";

/**
 * Design tokens van een palet (docs/03 § 4.8). In de gecompileerde CSS van een thema zet
 * cssthema ze als `--ct-<naam>` op `:root`, vóór de CSS van het thema zelf.
 */

/** Vaste volgorde voor weergave; onbekende tokens komen daarna, alfabetisch. */
export const TOKEN_ORDER = [
  "bg",
  "surface",
  "fg",
  "muted",
  "accent",
  "accent-fg",
  "success",
  "warning",
  "danger",
  "border",
  "radius",
  "font-sans",
  "font-mono",
] as const;

export type KnownToken = (typeof TOKEN_ORDER)[number];

/** Tokens die in een kleine kleurstrook het palet herkenbaar maken. */
export const SWATCH_TOKENS: readonly KnownToken[] = ["bg", "surface", "fg", "accent", "danger"];

/** Waarden voor wie geen palet koppelt (= het ingebouwde palet `terminal`, de cssthema-stijl). */
export const DEFAULT_TOKENS: Readonly<Record<KnownToken, string>> = {
  bg: "#141414",
  surface: "#1e1e1e",
  fg: "#dddddd",
  muted: "#999999",
  accent: "#aaaaaa",
  "accent-fg": "#000000",
  success: "#8fd6a4",
  warning: "#e6b56b",
  danger: "#e58b8b",
  border: "#333333",
  radius: "10px",
  "font-sans": 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace',
  "font-mono": 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace',
};

/** `bg` → `--ct-bg`. */
export function tokenVar(name: string): string {
  return `--ct-${name}`;
}

/** Tokens als `[naam, waarde]` in de vaste volgorde. */
export function orderedTokens(tokens: Readonly<Record<string, string>>): [string, string][] {
  const known = TOKEN_ORDER.filter((name) => name in tokens).map(
    (name) => [name, tokens[name]!] as [string, string],
  );
  const extra = Object.keys(tokens)
    .filter((name) => !(TOKEN_ORDER as readonly string[]).includes(name))
    .sort()
    .map((name) => [name, tokens[name]!] as [string, string]);
  return [...known, ...extra];
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[^()]*\)$/i;
const NAMED = new Set(["transparent", "black", "white", "currentcolor"]);

/** Of een tokenwaarde een kleur is (voor een kleurstaal), los van de token-naam. */
export function isColorValue(value: string): boolean {
  const v = value.trim();
  return HEX_RE.test(v) || FUNCTION_RE.test(v) || NAMED.has(v.toLowerCase());
}

export type TokenKind = "color" | "length" | "font" | "other";

/** Soort waarde, voor de weergave (kleurstaal, afgeronde hoek, letterproef). */
export function tokenKind(name: string, value: string): TokenKind {
  if (isColorValue(value)) return "color";
  if (name.startsWith("font")) return "font";
  if (/^-?\d*\.?\d+(?:px|rem|em|%)$/.test(value.trim())) return "length";
  return "other";
}

/** `:root { --ct-bg: …; … }` zoals cssthema het vóór de thema-CSS zet (leesbaar opgemaakt). */
export function paletteCss(tokens: Readonly<Record<string, string>>): string {
  const lines = orderedTokens(tokens).map(([name, value]) => `  ${tokenVar(name)}: ${value};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

/** Een token, met terugval op het standaardpalet. */
export function tokenValue(palette: Pick<Palette, "tokens"> | null | undefined, name: KnownToken) {
  return palette?.tokens[name] ?? DEFAULT_TOKENS[name];
}
