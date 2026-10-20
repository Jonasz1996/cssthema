import { cssEscapeIdent } from "../lib/snapshot-symbols";

/**
 * CSS-template uit een pagina (de snapshot of de demo-pagina in de preview): bovenaan een
 * `:root` met kleurvariabelen (startwaarde = de kleur op de pagina), daaronder regels voor de
 * elementen, classes en id's die echt op de pagina staan en alleen naar die variabelen wijzen.
 * Zo volstaat het om de kleuren in `:root` te veranderen.
 *
 * Puur: de kleuren komen van `getStyle` (in de editor `getComputedStyle` van een verborgen
 * iframe zonder scripts, zie `render.ts`), zodat ook de CSS van de app zelf meetelt.
 */

/** Hoogstens zoveel regels voor classes/id's (de meest voorkomende eerst). */
export const MAX_CLASS_RULES = 40;
/** Hoogstens zoveel extra kleuren (`--tpl-kleur-N`) naast de vaste rollen. */
export const MAX_EXTRA_COLORS = 24;
/** Zoveel elementen bekijken we hoogstens (grote pagina's). */
const MAX_ELEMENTS = 20_000;
/** Kleuren die minder verschillen (RGB-afstand) delen één variabele. */
const SAME_COLOR_DISTANCE = 14;

export type StyleGetter = (
  element: Element,
) => Pick<
  CSSStyleDeclaration,
  "backgroundColor" | "color" | "borderTopColor" | "borderTopWidth" | "borderTopStyle"
>;

export interface TemplateInput {
  document: Document;
  getStyle: StyleGetter;
  /** Naam van de pagina voor de kop, bv. `portainer.jbogaert.be · Login`. */
  source: string;
  /** Datum in de kop (ISO, standaard vandaag). */
  date?: string;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)` / `rgb(1 2 3 / 50%)` → kanalen; anders `null`. */
export function parseColor(value: string | null | undefined): Rgba | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const match = /^rgba?\(([^)]*)\)$/.exec(text);
  if (!match) return null;
  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (part: string) =>
    part.endsWith("%") ? (Number.parseFloat(part) * 255) / 100 : Number.parseFloat(part);
  const alpha =
    parts[3] === undefined
      ? 1
      : parts[3].endsWith("%")
        ? Number.parseFloat(parts[3]) / 100
        : Number.parseFloat(parts[3]);
  const [r, g, b] = parts.slice(0, 3).map(channel) as [number, number, number];
  if (![r, g, b, alpha].every(Number.isFinite)) return null;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: alpha };
}

const hex2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");

/** Kanalen → `#rrggbb` of (doorschijnend) `rgba(…)`. */
export function formatColor({ r, g, b, a }: Rgba): string {
  if (a >= 0.999) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

function distance(x: Rgba, y: Rgba): number {
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b, (x.a - y.a) * 255);
}

/** Een zichtbare kleur (niet volledig doorzichtig) als tekst, of `null`. */
function visible(value: string | null | undefined): string | null {
  const color = parseColor(value);
  return color && color.a > 0.01 ? formatColor(color) : null;
}

/** Telt waarden en geeft de meest voorkomende. */
class Tally {
  private counts = new Map<string, number>();
  add(value: string | null, weight = 1) {
    if (value) this.counts.set(value, (this.counts.get(value) ?? 0) + weight);
  }
  top(): string | null {
    let best: string | null = null;
    let most = 0;
    for (const [value, count] of this.counts) {
      if (count > most) [best, most] = [value, count];
    }
    return best;
  }
}

type Property = "background-color" | "color" | "border-color";

interface Role {
  /** Variabele zonder `--tpl-`. */
  name: string;
  label: string;
  /** Selectors van de regel; alleen de delen die op de pagina staan blijven. */
  selectors?: readonly string[];
  property: Property;
  /** Kleur als niets op de pagina die rol heeft (verwijst naar een andere rol). */
  fallback: string;
}

// Volgorde = voorrang: een rol met dezelfde kleur als een eerdere wordt `var(--eerdere)`.
const HEADER = ["header", '[role="banner"]', ".navbar", ".header", ".topbar", ".app-header"];
const SIDEBAR = ["nav", "aside", '[role="navigation"]', ".sidebar", ".side-nav", ".sidenav"];
const PANEL = [
  ".card",
  ".panel",
  ".box",
  ".tile",
  ".widget",
  ".modal-content",
  "dialog",
  '[role="dialog"]',
  "fieldset",
];
const BUTTON = [
  "button",
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="reset"]',
  ".btn",
  ".button",
  '[role="button"]',
];
const INPUT = [
  'input:not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
  "select",
  "textarea",
];
const TABLE_HEAD = ["th", "thead"];
const TABLE_CELL = ["table", "td", "tr"];
const FOOTER = ["footer", '[role="contentinfo"]', ".footer"];
const HEADINGS = ["h1", "h2", "h3", "h4"];

const ROLES: readonly Role[] = [
  {
    name: "achtergrond",
    label: "achtergrond van de pagina",
    property: "background-color",
    fallback: "#ffffff",
  },
  { name: "tekst", label: "tekst", property: "color", fallback: "#000000" },
  {
    name: "accent",
    label: "accent (hoofdknop, actieve link)",
    property: "background-color",
    fallback: "#2563eb",
  },
  {
    name: "link",
    label: "links",
    selectors: ["a"],
    property: "color",
    fallback: "var(--tpl-accent)",
  },
  {
    name: "kop-achtergrond",
    label: "kopbalk",
    selectors: HEADER,
    property: "background-color",
    fallback: "var(--tpl-achtergrond)",
  },
  {
    name: "kop-tekst",
    label: "tekst in de kopbalk",
    selectors: HEADER,
    property: "color",
    fallback: "var(--tpl-tekst)",
  },
  {
    name: "zijbalk-achtergrond",
    label: "navigatie / zijbalk",
    selectors: SIDEBAR,
    property: "background-color",
    fallback: "var(--tpl-kop-achtergrond)",
  },
  {
    name: "zijbalk-tekst",
    label: "tekst in navigatie / zijbalk",
    selectors: SIDEBAR,
    property: "color",
    fallback: "var(--tpl-kop-tekst)",
  },
  {
    name: "paneel-achtergrond",
    label: "kaarten / panelen",
    selectors: PANEL,
    property: "background-color",
    fallback: "var(--tpl-achtergrond)",
  },
  {
    name: "paneel-tekst",
    label: "tekst in kaarten / panelen",
    selectors: PANEL,
    property: "color",
    fallback: "var(--tpl-tekst)",
  },
  {
    name: "titel",
    label: "titels (h1–h4)",
    selectors: HEADINGS,
    property: "color",
    fallback: "var(--tpl-tekst)",
  },
  {
    name: "rand",
    label: "randen en lijnen",
    property: "border-color",
    fallback: "rgba(127, 127, 127, 0.35)",
  },
  {
    name: "knop-achtergrond",
    label: "knoppen",
    selectors: BUTTON,
    property: "background-color",
    fallback: "var(--tpl-accent)",
  },
  {
    name: "knop-tekst",
    label: "tekst op knoppen",
    selectors: BUTTON,
    property: "color",
    fallback: "var(--tpl-achtergrond)",
  },
  {
    name: "knop-rand",
    label: "rand van knoppen",
    selectors: BUTTON,
    property: "border-color",
    fallback: "var(--tpl-knop-achtergrond)",
  },
  {
    name: "invoer-achtergrond",
    label: "invoervelden",
    selectors: INPUT,
    property: "background-color",
    fallback: "var(--tpl-achtergrond)",
  },
  {
    name: "invoer-tekst",
    label: "tekst in invoervelden",
    selectors: INPUT,
    property: "color",
    fallback: "var(--tpl-tekst)",
  },
  {
    name: "invoer-rand",
    label: "rand van invoervelden",
    selectors: INPUT,
    property: "border-color",
    fallback: "var(--tpl-rand)",
  },
  {
    name: "tabel-kop-achtergrond",
    label: "tabelkoppen",
    selectors: TABLE_HEAD,
    property: "background-color",
    fallback: "var(--tpl-paneel-achtergrond)",
  },
  {
    name: "tabel-kop-tekst",
    label: "tekst in tabelkoppen",
    selectors: TABLE_HEAD,
    property: "color",
    fallback: "var(--tpl-tekst)",
  },
  {
    name: "tabel-achtergrond",
    label: "tabelcellen",
    selectors: TABLE_CELL,
    property: "background-color",
    fallback: "var(--tpl-achtergrond)",
  },
  {
    name: "tabel-rand",
    label: "rand van tabellen",
    selectors: TABLE_CELL,
    property: "border-color",
    fallback: "var(--tpl-rand)",
  },
  {
    name: "voet-achtergrond",
    label: "voettekst",
    selectors: FOOTER,
    property: "background-color",
    fallback: "var(--tpl-achtergrond)",
  },
  {
    name: "voet-tekst",
    label: "tekst in de voettekst",
    selectors: FOOTER,
    property: "color",
    fallback: "var(--tpl-tekst)",
  },
];

/** De delen van een selectorlijst die op de pagina iets vinden (ongeldige vallen weg). */
function present(document: Document, selectors: readonly string[]): string[] {
  return selectors.filter((selector) => {
    try {
      return document.querySelector(selector) !== null;
    } catch {
      return false;
    }
  });
}

function matches(element: Element, selectors: readonly string[]): boolean {
  return selectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
}

function hasBorder(style: ReturnType<StyleGetter>): boolean {
  return (
    Number.parseFloat(style.borderTopWidth) > 0 &&
    style.borderTopStyle !== "none" &&
    style.borderTopStyle !== "hidden"
  );
}

function read(style: ReturnType<StyleGetter>, property: Property): string | null {
  if (property === "background-color") return visible(style.backgroundColor);
  if (property === "color") return visible(style.color);
  return hasBorder(style) ? visible(style.borderTopColor) : null;
}

/**
 * Classes die per build of per toestand wisselen (CSS-in-JS-hashes, Angular/Vue-interne,
 * `is-active`): geen goede selector voor een thema.
 */
function unstableClass(name: string): boolean {
  return (
    /^(?:css|sc|jsx|svelte|emotion|ng|v|is|has|mat-mdc|cdk)-/.test(name) ||
    /^_/.test(name) ||
    (name.match(/\d/g)?.length ?? 0) >= 3 ||
    name.length > 40
  );
}

/** `#id` of `.a.b` (hoogstens drie stabiele classes), of `null`. */
function keySelector(element: Element): string | null {
  const id = element.getAttribute("id");
  if (id && !unstableClass(id) && /^[A-Za-z]/.test(id)) return `#${cssEscapeIdent(id)}`;
  const classes = Array.from(element.classList).filter((name) => !unstableClass(name));
  if (!classes.length) return null;
  return classes
    .slice(0, 3)
    .map((name) => `.${cssEscapeIdent(name)}`)
    .join("");
}

interface Variable {
  name: string;
  value: string;
  color: Rgba | null;
  label: string;
}

/** Beheert de variabelen: dezelfde kleur → dezelfde (of een verwijzende) variabele. */
class Palette {
  readonly vars: Variable[] = [];
  private extra = 0;

  /** Rolvariabele; is de kleur al bekend, dan `var(--die)`. */
  role(name: string, label: string, value: string) {
    const color = parseColor(value);
    const same = color && this.nearest(color);
    this.vars.push({
      name,
      value: same ? `var(--tpl-${same.name})` : value,
      color,
      label,
    });
  }

  private nearest(color: Rgba): Variable | null {
    let best: Variable | null = null;
    let bestDistance = Infinity;
    for (const variable of this.vars) {
      if (!variable.color || variable.value.startsWith("var(")) continue;
      const d = distance(variable.color, color);
      if (d < bestDistance) [best, bestDistance] = [variable, d];
    }
    return bestDistance <= SAME_COLOR_DISTANCE ? best : null;
  }

  /** Variabele voor een kleur van een class/id: een bestaande of een nieuwe `kleur-N`. */
  forColor(value: string, usedBy: string): string {
    const color = parseColor(value)!;
    const same = this.nearest(color);
    if (same) return same.name;
    if (this.extra >= MAX_EXTRA_COLORS) {
      // Geen nieuwe meer: de dichtstbijzijnde, hoe ver ook.
      let best = this.vars[0]!;
      for (const variable of this.vars) {
        if (
          variable.color &&
          best.color &&
          distance(variable.color, color) < distance(best.color, color)
        ) {
          best = variable;
        }
      }
      return best.name;
    }
    this.extra += 1;
    const name = `kleur-${this.extra}`;
    this.vars.push({ name, value, color, label: `o.a. ${usedBy}` });
    return name;
  }
}

/** Kleur van de pagina zelf: `body`, anders `html`, anders wit (canvas). */
function pageBackground(document: Document, getStyle: StyleGetter): string {
  for (const element of [document.body, document.documentElement]) {
    const color = element && visible(getStyle(element).backgroundColor);
    if (color) return color;
  }
  return "#ffffff";
}

/** Meest voorkomende accentkleur: achtergrond van de knoppen die het meest opvallen. */
function accentColor(
  elements: readonly Element[],
  getStyle: StyleGetter,
  background: string,
  text: string,
): string | null {
  const tally = new Tally();
  const neutral = [parseColor(background)!, parseColor(text)!];
  for (const element of elements) {
    if (!matches(element, [...BUTTON, ".active", '[aria-current="page"]', ".selected"])) continue;
    const value = visible(getStyle(element).backgroundColor);
    const color = parseColor(value);
    if (!value || !color) continue;
    // Grijze of bijna-achtergrond knoppen zijn geen accent.
    const saturation = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
    if (saturation < 30 || neutral.some((n) => distance(n, color) <= SAME_COLOR_DISTANCE)) continue;
    const primary = /primary|accent|main|submit|success/i.test(element.className.toString());
    tally.add(value, primary ? 3 : 1);
  }
  return tally.top();
}

function block(selectors: readonly string[], declarations: readonly string[]): string {
  return `${selectors.join(",\n")} {\n${declarations.map((d) => `  ${d}`).join("\n")}\n}`;
}

const important = (property: string, variable: string) =>
  `${property}: var(--tpl-${variable}) !important;`;

/** Bouwt het template; zie de uitleg bovenaan. */
export function generateTemplate({ document, getStyle, source, date }: TemplateInput): string {
  const elements = Array.from(document.body?.querySelectorAll("*") ?? []).slice(0, MAX_ELEMENTS);
  const background = pageBackground(document, getStyle);
  const text = (document.body && visible(getStyle(document.body).color)) ?? "#000000";

  // Waarden per rol: de meest voorkomende kleur bij de elementen van die rol.
  const tallies = new Map(ROLES.map((role) => [role.name, new Tally()]));
  const borders = tallies.get("rand")!;
  for (const element of elements) {
    const style = getStyle(element);
    for (const role of ROLES) {
      if (role.selectors && matches(element, role.selectors)) {
        tallies.get(role.name)!.add(read(style, role.property));
      }
    }
    borders.add(read(style, "border-color"));
  }
  tallies.get("achtergrond")!.add(background);
  tallies.get("tekst")!.add(text);
  tallies
    .get("accent")!
    .add(accentColor(elements, getStyle, background, text) ?? tallies.get("link")!.top());

  const palette = new Palette();
  const found = new Set<string>();
  for (const role of ROLES) {
    const value = tallies.get(role.name)!.top();
    if (value) found.add(role.name);
    palette.role(role.name, role.label, value ?? role.fallback);
  }

  // Regels voor de vaste rollen: alleen selectors die op de pagina staan.
  const rules: string[] = [];
  rules.push(
    block(
      ["html", "body"],
      [important("background-color", "achtergrond"), important("color", "tekst")],
    ),
  );
  const groups: { selectors: readonly string[]; roles: [Property, string][] }[] = [
    {
      selectors: HEADER,
      roles: [
        ["background-color", "kop-achtergrond"],
        ["color", "kop-tekst"],
      ],
    },
    {
      selectors: SIDEBAR,
      roles: [
        ["background-color", "zijbalk-achtergrond"],
        ["color", "zijbalk-tekst"],
      ],
    },
    {
      selectors: PANEL,
      roles: [
        ["background-color", "paneel-achtergrond"],
        ["color", "paneel-tekst"],
        ["border-color", "rand"],
      ],
    },
    { selectors: HEADINGS, roles: [["color", "titel"]] },
    { selectors: ["a"], roles: [["color", "link"]] },
    {
      selectors: BUTTON,
      roles: [
        ["background-color", "knop-achtergrond"],
        ["color", "knop-tekst"],
        ["border-color", "knop-rand"],
      ],
    },
    {
      selectors: INPUT,
      roles: [
        ["background-color", "invoer-achtergrond"],
        ["color", "invoer-tekst"],
        ["border-color", "invoer-rand"],
      ],
    },
    {
      selectors: TABLE_CELL,
      roles: [
        ["background-color", "tabel-achtergrond"],
        ["border-color", "tabel-rand"],
      ],
    },
    {
      selectors: TABLE_HEAD,
      roles: [
        ["background-color", "tabel-kop-achtergrond"],
        ["color", "tabel-kop-tekst"],
        ["border-color", "tabel-rand"],
      ],
    },
    {
      selectors: FOOTER,
      roles: [
        ["background-color", "voet-achtergrond"],
        ["color", "voet-tekst"],
      ],
    },
    { selectors: ["hr"], roles: [["border-color", "rand"]] },
  ];
  for (const group of groups) {
    const selectors = present(document, group.selectors);
    if (!selectors.length) continue;
    // Een achtergrond die op de pagina niet bestond (doorzichtig) niet ineens opleggen.
    const roles = group.roles.filter(
      ([property, name]) => property !== "background-color" || found.has(name),
    );
    if (roles.length)
      rules.push(
        block(
          selectors,
          roles.map(([p, name]) => important(p, name)),
        ),
      );
  }
  const buttons = present(document, BUTTON);
  if (buttons.length) {
    rules.push(
      block(
        buttons.map((s) => `${s}:hover`),
        ["filter: brightness(1.12);"],
      ),
    );
  }
  const inputs = present(document, INPUT);
  if (inputs.length) {
    rules.push(
      block(
        inputs.map((s) => `${s}::placeholder`),
        ["color: var(--tpl-gedempt) !important;"],
      ),
      block(
        inputs.map((s) => `${s}:focus`),
        [
          "outline-color: var(--tpl-accent) !important;",
          "border-color: var(--tpl-accent) !important;",
        ],
      ),
    );
  }
  if (document.querySelector("a")) {
    rules.push(block(["a:hover"], ["color: var(--tpl-accent) !important;"]));
  }

  // Classes en id's met een eigen kleur, de meest voorkomende eerst.
  const parentColor = (element: Element) =>
    element.parentElement ? visible(getStyle(element.parentElement).color) : text;
  const byKey = new Map<
    string,
    { count: number; background: Tally; color: Tally; border: Tally }
  >();
  for (const element of elements) {
    const key = keySelector(element);
    if (!key) continue;
    const style = getStyle(element);
    const bg = visible(style.backgroundColor);
    const color = visible(style.color);
    const border = read(style, "border-color");
    const ownColor = color !== parentColor(element) ? color : null;
    if (!bg && !ownColor && !border) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { count: 0, background: new Tally(), color: new Tally(), border: new Tally() };
      byKey.set(key, entry);
    }
    entry.count += 1;
    entry.background.add(bg);
    entry.color.add(ownColor);
    entry.border.add(border);
  }
  const classRules = [...byKey.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, MAX_CLASS_RULES)
    .map(([key, entry]) => {
      const declarations: string[] = [];
      const add = (property: Property, value: string | null) => {
        if (value) declarations.push(important(property, palette.forColor(value, key)));
      };
      add("background-color", entry.background.top());
      add("color", entry.color.top());
      add("border-color", entry.border.top());
      return block([key], declarations);
    });

  const longest = Math.max(...palette.vars.map((v) => v.name.length));
  const vars = palette.vars.map(
    (v) =>
      `  --tpl-${v.name}:${" ".repeat(longest - v.name.length + 1)}${v.value}; /* ${v.label} */`,
  );
  vars.push(
    `  --tpl-gedempt:${" ".repeat(Math.max(1, longest - 7 + 1))}color-mix(in srgb, var(--tpl-tekst) 60%, transparent); /* placeholders, minder belangrijke tekst */`,
  );

  const today = date ?? new Date().toISOString().slice(0, 10);
  return [
    `/* CSS-template uit ${source.replace(/\*\//g, "* /")} (${today})`,
    " *",
    " * Pas alleen de kleuren in :root aan: alle regels hieronder verwijzen ernaar.",
    " * Een waarde var(--tpl-…) betekent: had op de pagina dezelfde kleur. Vervang ze door een",
    " * eigen kleur om dat onderdeel los te kleuren.",
    " */",
    "",
    `:root {\n${vars.join("\n")}\n}`,
    "",
    "/* Basis: de elementen van de pagina */",
    "",
    rules.join("\n\n"),
    ...(classRules.length
      ? [
          "",
          "/* Classes en id's van deze pagina (meest voorkomend eerst) */",
          "",
          classRules.join("\n\n"),
        ]
      : []),
    "",
  ].join("\n");
}
