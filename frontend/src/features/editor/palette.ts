/**
 * Palet-tokens van een thema als CSS-variabelen `--ct-<naam>` (zoals de compiler ze vóór de
 * gepubliceerde CSS zet), plus de pure logica achter de autocomplete in de editor. Geen Monaco
 * hier: `monaco/providers.ts` zet dit om in completion items.
 */

/** Voorvoegsel van de palet-variabelen (docs/03 § 4.8). */
export const PALETTE_PREFIX = "--ct-";

/** Volgorde van de standaardtokens; andere tokens volgen alfabetisch. */
const TOKEN_ORDER = [
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
];

export interface PaletteToken {
  /** Naam zonder voorvoegsel, bv. `bg`. */
  name: string;
  /** `--ct-bg`. */
  variable: string;
  value: string;
  /** De waarde is een kleur (dan toont de autocomplete een kleurvoorbeeld). */
  isColor: boolean;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[^()]*\)$/i;

/** Of een tokenwaarde een kleur is (hex of kleurfunctie; geen namen als `red`). */
export function isCssColor(value: string): boolean {
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) || FUNCTION_COLOR.test(trimmed);
}

/** Geldige tokennaam (ook als CSS-identifier na `--ct-`). */
function isTokenName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/i.test(name);
}

/** De tokens van een palet in een vaste volgorde. Ongeldige namen vallen weg. */
export function paletteTokens(tokens: Readonly<Record<string, string>> | null | undefined) {
  if (!tokens) return [];
  const rank = (name: string) => {
    const index = TOKEN_ORDER.indexOf(name);
    return index < 0 ? TOKEN_ORDER.length : index;
  };
  return Object.entries(tokens)
    .filter(([name, value]) => isTokenName(name) && typeof value === "string")
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map<PaletteToken>(([name, value]) => ({
      name,
      variable: `${PALETTE_PREFIX}${name}`,
      value,
      isColor: isCssColor(value),
    }));
}

/**
 * Waarde veilig in een `<style>`-blok: geen `<` (zou `</style>` kunnen sluiten), geen `{`/`}`/`;`
 * die uit de declaratie breken. Zulke tekens worden CSS-escapes.
 */
function safeValue(value: string): string {
  return value.replace(/[<>{};\\]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
}

/** `:root{--ct-bg:#2e3440;…}` (leeg als het palet geen tokens heeft). */
export function paletteCss(tokens: Readonly<Record<string, string>> | null | undefined): string {
  const items = paletteTokens(tokens);
  if (!items.length) return "";
  return `:root{${items.map((token) => `${token.variable}:${safeValue(token.value)}`).join(";")}}`;
}

export interface PaletteCompletionContext {
  /** 0-based index in de regel waar de te vervangen tekst begint. */
  start: number;
  /** Wat er al getypt is (bv. `--ct-b`), mag leeg zijn. */
  prefix: string;
  /** In een waarde zonder `var(` ervoor: invoegen als `var(--ct-…)`. */
  wrapInVar: boolean;
}

/**
 * Bepaalt of de autocomplete palet-tokens moet tonen voor de tekst vóór de cursor (één regel):
 * - na `var(` → `--ct-…`;
 * - in een waarde (`color: |` of `color: --c|`) → `var(--ct-…)`;
 * - een eigen property die met `--` begint (`--ct-|` in `:root`) → `--ct-…`.
 * Anders `null` (gewone CSS-autocomplete van Monaco).
 */
export function paletteCompletionContext(
  lineBeforeCursor: string,
): PaletteCompletionContext | null {
  const prefix = /[\w-]*$/.exec(lineBeforeCursor)?.[0] ?? "";
  const start = lineBeforeCursor.length - prefix.length;
  const before = lineBeforeCursor.slice(0, start);
  if (prefix && !prefix.startsWith("-")) return null;

  if (/var\(\s*$/i.test(before)) return { start, prefix, wrapInVar: false };

  const statementStart = Math.max(before.lastIndexOf("{"), before.lastIndexOf(";")) + 1;
  const statement = before.slice(statementStart);
  if (statement.includes(":")) {
    // In een waarde. Niet midden in een selector als `a:hover` (daar staat geen spatie of
    // functie na de dubbele punt) en niet binnen een string.
    if (/^\s*[\w-]*\s*:(?!:)/.test(statement) && !/["']/.test(statement)) {
      return { start, prefix, wrapInVar: true };
    }
    return null;
  }
  if (prefix.startsWith("--") && /^\s*$/.test(statement)) {
    return { start, prefix, wrapInVar: false };
  }
  return null;
}

/** Tekst die de autocomplete invoegt voor een token. */
export function paletteInsertText(token: PaletteToken, context: PaletteCompletionContext): string {
  return context.wrapInVar ? `var(${token.variable})` : token.variable;
}

/** Het `--ct-…`-woord rond een kolom (0-based) in een regel, voor de hover. */
export function paletteVariableAt(
  line: string,
  index: number,
): { start: number; name: string } | null {
  const pattern = /--ct-[a-z0-9][a-z0-9-]*/gi;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (index >= start && index <= start + match[0].length) {
      return { start, name: match[0].slice(PALETTE_PREFIX.length) };
    }
  }
  return null;
}
