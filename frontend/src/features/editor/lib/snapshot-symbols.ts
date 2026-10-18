/**
 * Classes, id's en CSS-variabelen van een vastgelegde pagina (snapshot) voor de autocomplete in
 * de editor (stappenplan D2, docs/07 taak 2.10). Puur, zonder Monaco: `monaco/providers.ts`
 * maakt er suggesties van.
 *
 * - Classes en id's: van de elementen op de pagina (ook in shadow roots), met hun aantal, en
 *   daarna die uit de selectors van de app-CSS (aantal 0: niet op deze pagina, wel in de app).
 * - Variabelen: `--naam` uit de app-CSS en uit `style`-attributen, met de eerste waarde.
 */

/** Hoogstens zoveel classes, id's en variabelen (elk). */
export const SNAPSHOT_SYMBOL_LIMIT = 5000;

/** Langere waarden van variabelen worden ingekort (alleen voor de detailregel). */
const MAX_VALUE_LENGTH = 100;

export interface SnapshotName {
  /** Naam zonder escapes, bv. `sm:flex`. */
  name: string;
  /** Aantal elementen op de pagina; 0 = alleen in de CSS van de app. */
  count: number;
}

export interface SnapshotVariable {
  /** `--accent`. */
  name: string;
  /** Eerste waarde die gevonden werd (ingekort). */
  value: string;
}

export interface SnapshotSymbols {
  classes: SnapshotName[];
  ids: SnapshotName[];
  variables: SnapshotVariable[];
}

const ESCAPE = String.raw`\\[0-9a-fA-F]{1,6}[ \t\n\r\f]?|\\[^\n\r\f0-9a-fA-F]`;
const NAME_START = String.raw`[_a-zA-Z\u0080-￿]|${ESCAPE}`;
const NAME_CHAR = String.raw`[\w\u0080-￿-]|${ESCAPE}`;
const IDENT = String.raw`(?:--|-?(?:${NAME_START}))(?:${NAME_CHAR})*`;
const CLASS_IN_SELECTOR = new RegExp(String.raw`\.(${IDENT})`, "g");
const ID_IN_SELECTOR = new RegExp(String.raw`#(${IDENT})`, "g");
/** `--naam: waarde` aan het begin van een declaratie. */
const VARIABLE_DECLARATION = /(?:^|[{;\s])(--[\w\u0080-￿-]+)\s*:\s*([^;{}]*)/g;
const COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
const STRING = /"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'/g;

/** `sm\:flex` → `sm:flex` (CSS-escapes uit een selector). */
export function unescapeCss(ident: string): string {
  return ident.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/g, (_, hex, char) => {
    if (char !== undefined) return char as string;
    const code = Number.parseInt(hex as string, 16);
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return String.fromCodePoint(valid ? code : 0xfffd);
  });
}

/** Naam als CSS-identifier (zoals `CSS.escape`): `sm:flex` → `sm\:flex`, `1col` → `\31 col`. */
export function cssEscapeIdent(value: string): string {
  let out = "";
  const first = value.charCodeAt(0);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const char = value.charAt(index);
    const digit = code >= 0x30 && code <= 0x39;
    if (code === 0) out += "�";
    else if (
      (code >= 0x01 && code <= 0x1f) ||
      code === 0x7f ||
      (index === 0 && digit) ||
      (index === 1 && digit && first === 0x2d)
    ) {
      out += `\\${code.toString(16)} `;
    } else if (index === 0 && value.length === 1 && code === 0x2d) out += `\\${char}`;
    else if (code >= 0x80 || code === 0x2d || code === 0x5f || digit || /[a-zA-Z]/.test(char)) {
      out += char;
    } else out += `\\${char}`;
  }
  return out;
}

function bump(map: Map<string, number>, name: string): void {
  map.set(name, (map.get(name) ?? 0) + 1);
}

function collectVariables(css: string, into: Map<string, string>): void {
  for (const match of css.matchAll(VARIABLE_DECLARATION)) {
    const name = match[1]!;
    if (into.has(name)) continue;
    let value = match[2]!.replace(/\s+/g, " ").trim();
    if (value.length > MAX_VALUE_LENGTH) value = `${value.slice(0, MAX_VALUE_LENGTH - 1)}…`;
    into.set(name, value);
  }
}

/** Classes en id's uit de selectors van een stylesheet (niet uit at-rules of waarden). */
function collectSelectorNames(css: string, classes: Set<string>, ids: Set<string>): void {
  const bare = css.replace(COMMENT, "").replace(STRING, '""');
  // Zelf splitsen op `{`, `}` en `;` (lineair; een regex als `[^{};]+\{` kan op lange waarden,
  // bv. data-URI's, kwadratisch worden).
  let start = 0;
  for (let index = 0; index < bare.length; index++) {
    const char = bare[index];
    if (char === "}" || char === ";") start = index + 1;
    else if (char === "{") {
      const prelude = bare.slice(start, index).trim();
      start = index + 1;
      if (!prelude || prelude.startsWith("@")) continue;
      for (const found of prelude.matchAll(CLASS_IN_SELECTOR)) classes.add(unescapeCss(found[1]!));
      for (const found of prelude.matchAll(ID_IN_SELECTOR)) ids.add(unescapeCss(found[1]!));
    }
  }
}

interface PageNames {
  classes: Map<string, number>;
  ids: Map<string, number>;
  variables: Map<string, string>;
  /** Tekst van de `<style>`-blokken in de pagina (kop, body en shadow roots). */
  styles: string[];
}

function visitElements(root: ParentNode, into: PageNames): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const name of Array.from(element.classList)) bump(into.classes, name);
    const id = element.getAttribute("id");
    if (id && !/\s/.test(id)) bump(into.ids, id);
    const style = element.getAttribute("style");
    if (style?.includes("--")) collectVariables(style, into.variables);
    if (element.localName === "style") into.styles.push(element.textContent ?? "");
    if (element.localName === "template" && "content" in element) {
      visitElements((element as HTMLTemplateElement).content, into);
    }
  }
}

/** Pagina-namen (meest gebruikt eerst), dan de namen die alleen in de CSS staan (alfabetisch). */
function rank(onPage: Map<string, number>, inCss: Set<string>, limit: number): SnapshotName[] {
  const page = Array.from(onPage, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
  const cssOnly = Array.from(inCss)
    .filter((name) => !onPage.has(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, count: 0 }));
  return [...page, ...cssOnly].slice(0, limit);
}

/** Verzamelt classes, id's en variabelen van een snapshot (HTML + de CSS van de app). */
export function collectSnapshotSymbols(
  snapshot: { html: string; stylesheets: readonly string[] },
  limit: number = SNAPSHOT_SYMBOL_LIMIT,
): SnapshotSymbols {
  const page: PageNames = { classes: new Map(), ids: new Map(), variables: new Map(), styles: [] };
  const cssClasses = new Set<string>();
  const cssIds = new Set<string>();

  visitElements(new DOMParser().parseFromString(snapshot.html, "text/html"), page);
  // De CSS van de app, daarna de `<style>`-blokken van de pagina zelf.
  for (const css of [...snapshot.stylesheets, ...page.styles]) {
    collectVariables(css.replace(COMMENT, ""), page.variables);
    collectSelectorNames(css, cssClasses, cssIds);
  }

  return {
    classes: rank(page.classes, cssClasses, limit),
    ids: rank(page.ids, cssIds, limit),
    variables: Array.from(page.variables, ([name, value]) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit),
  };
}

// --- waar de cursor staat ------------------------------------------------------------------------

export interface SelectorCompletionContext {
  kind: "class" | "id";
  /** Wat er al getypt is, met de `.` of `#` (bv. `.btn-`). */
  prefix: string;
}

/** At-rules waarvan het blok gewone regels bevat (en dus selectors). */
const GROUPING_AT_RULE = /^@(?:media|supports|layer|container|scope|document|starting-style)\b/i;

/**
 * De tekst vóór de cursor doorlopen (commentaar en strings overslaan): de open blokken (hun
 * prelude) en het begin van de huidige declaratie of selector. `null` binnen commentaar of een
 * string.
 */
function scanCss(text: string): { blocks: string[]; statement: string } | null {
  const blocks: string[] = [];
  let statementStart = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) return null;
      index = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < text.length && text[end] !== char && text[end] !== "\n") {
        end += text[end] === "\\" ? 2 : 1;
      }
      if (end >= text.length) return null;
      index = end + 1;
      continue;
    }
    if (char === "{") {
      blocks.push(text.slice(statementStart, index));
      statementStart = index + 1;
    } else if (char === "}") {
      blocks.pop();
      statementStart = index + 1;
    } else if (char === ";") {
      statementStart = index + 1;
    }
    index += 1;
  }
  return { blocks, statement: text.slice(statementStart) };
}

/**
 * Of de autocomplete classes (na `.`) of id's (na `#`) moet tonen voor de tekst vóór de cursor
 * (het hele document tot de cursor): alleen waar een selector staat, dus niet in een waarde
 * (`color: #fff`, `0.5`), commentaar, string of de prelude van een at-rule. Binnen een regel
 * (CSS nesting) telt alles wat niet als `property:` begint als geneste selector.
 */
export function selectorCompletionContext(
  textBeforeCursor: string,
): SelectorCompletionContext | null {
  const match = /([.#])([\w-]*)$/.exec(textBeforeCursor);
  if (!match) return null;
  const scan = scanCss(textBeforeCursor.slice(0, match.index));
  if (!scan) return null;
  const strip = (value: string) => value.replace(COMMENT, "").trim();
  const statement = strip(scan.statement);
  if (statement.startsWith("@")) return null;
  const block = scan.blocks.length ? strip(scan.blocks.at(-1)!) : null;
  if (block !== null) {
    if (block.startsWith("@") && !GROUPING_AT_RULE.test(block)) return null;
    if (!block.startsWith("@") && /^[\w-]+\s*:(?!:)/.test(statement)) return null;
  }
  return { kind: match[1] === "." ? "class" : "id", prefix: match[0] };
}
