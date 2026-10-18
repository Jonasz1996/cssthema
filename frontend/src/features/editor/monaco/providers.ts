import type * as Monaco from "monaco-editor/editor/editor.api";
import {
  cssEscapeIdent,
  selectorCompletionContext,
  type SnapshotSymbols,
} from "../lib/snapshot-symbols";
import {
  PALETTE_PREFIX,
  type PaletteToken,
  paletteCompletionContext,
  paletteInsertText,
  paletteTokens,
  paletteVariableAt,
} from "../palette";

/**
 * Autocomplete en hover voor de `--ct-*`-tokens van het palet dat aan een thema hangt, en
 * autocomplete voor de classes, id's en variabelen van de snapshot waartegen de preview loopt.
 * Monaco-providers gelden per taal (alle CSS-modellen); welk palet of welke snapshot bij welk
 * model hoort, houden `setModelPalette` en `setModelSnapshot` bij (sleutel: de model-URI).
 */

interface ModelPalette {
  name: string;
  tokens: PaletteToken[];
}

const palettes = new Map<string, ModelPalette>();

/** Koppel een palet aan een model (`null` = geen palet → geen token-suggesties). */
export function setModelPalette(
  uri: string,
  palette: { name: string; tokens: Readonly<Record<string, string>> } | null,
): void {
  if (!palette) palettes.delete(uri);
  else palettes.set(uri, { name: palette.name, tokens: paletteTokens(palette.tokens) });
}

export interface ProviderLabels {
  /** Detailregel van een suggestie, bv. "palet Nord". */
  detail: (paletteName: string) => string;
  /** Kop van de hover, bv. "Palet Nord". */
  hoverTitle: (paletteName: string) => string;
}

let registered = false;

/** Registreert de providers één keer per Monaco-instantie. */
export function registerPaletteProviders(monaco: typeof Monaco, labels: ProviderLabels): void {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider("css", {
    triggerCharacters: ["-", "("],
    provideCompletionItems(model, position) {
      const palette = palettes.get(model.uri.toString());
      if (!palette?.tokens.length) return { suggestions: [] };
      const line = model.getLineContent(position.lineNumber);
      const context = paletteCompletionContext(line.slice(0, position.column - 1));
      if (!context) return { suggestions: [] };
      const range = new monaco.Range(
        position.lineNumber,
        context.start + 1,
        position.lineNumber,
        position.column,
      );
      return {
        suggestions: palette.tokens.map((token, index) => ({
          label: token.variable,
          kind: token.isColor
            ? monaco.languages.CompletionItemKind.Color
            : monaco.languages.CompletionItemKind.Variable,
          // Bij kind=Color toont Monaco een kleurvoorbeeld als de documentatie een kleur is.
          documentation: token.value,
          detail: `${token.value} · ${labels.detail(palette.name)}`,
          insertText: paletteInsertText(token, context),
          filterText: token.variable,
          sortText: `0${String(index).padStart(3, "0")}`,
          range,
        })),
      };
    },
  });

  monaco.languages.registerHoverProvider("css", {
    provideHover(model, position) {
      const palette = palettes.get(model.uri.toString());
      if (!palette) return null;
      const line = model.getLineContent(position.lineNumber);
      const found = paletteVariableAt(line, position.column - 1);
      if (!found) return null;
      const token = palette.tokens.find((item) => item.name === found.name);
      if (!token) return null;
      return {
        range: new monaco.Range(
          position.lineNumber,
          found.start + 1,
          position.lineNumber,
          found.start + 1 + token.variable.length,
        ),
        contents: [
          { value: `**${labels.hoverTitle(palette.name)}**` },
          { value: `\`${token.variable}: ${token.value}\`` },
        ],
      };
    },
  });
}

// --- snapshot van de app (classes, id's, variabelen) ----------------------------------------------

/** De snapshot waartegen een model gepreviewd wordt (`null` = demo-pagina, geen suggesties). */
export interface ModelSnapshot {
  hostname: string;
  page: string;
  symbols: SnapshotSymbols;
}

const snapshots = new Map<string, ModelSnapshot>();

/**
 * Koppel de classes, id's en variabelen van een snapshot aan een model (`null` = weg, bv. bij
 * wisselen naar de demo of het sluiten van de editor). Eén provider voor alle modellen, zoals bij
 * de paletten: er hoeft per snapshot niets geregistreerd of opgeruimd te worden.
 */
export function setModelSnapshot(uri: string, snapshot: ModelSnapshot | null): void {
  if (!snapshot) snapshots.delete(uri);
  else snapshots.set(uri, snapshot);
}

export interface SnapshotProviderLabels {
  /** Detail van een class/id op de pagina, bv. "3× op start". */
  onPage: (count: number, page: string) => string;
  /** Detail van een class/id die alleen in de CSS van de app staat. */
  inCss: (hostname: string) => string;
  /** Detail van een variabele van de app. */
  variable: (value: string, hostname: string) => string;
}

let snapshotRegistered = false;

/** Registreert de snapshot-autocomplete één keer per Monaco-instantie. */
export function registerSnapshotProviders(
  monaco: typeof Monaco,
  labels: SnapshotProviderLabels,
): void {
  if (snapshotRegistered) return;
  snapshotRegistered = true;

  monaco.languages.registerCompletionItemProvider("css", {
    triggerCharacters: [".", "#", "-", "("],
    provideCompletionItems(model, position) {
      const uri = model.uri.toString();
      const snapshot = snapshots.get(uri);
      if (!snapshot) return { suggestions: [] };
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      const { symbols, hostname, page } = snapshot;

      const variableContext = paletteCompletionContext(before);
      // Net na `#` of `.` (een kleur of getal in een waarde, of een selector): geen variabelen.
      if (variableContext && !/[.#]$/.test(before.slice(0, variableContext.start))) {
        // `--ct-*` komt van het palet (eigen provider), niet nog eens van de app.
        const skipPalette = palettes.has(uri);
        const range = new monaco.Range(
          position.lineNumber,
          variableContext.start + 1,
          position.lineNumber,
          position.column,
        );
        return {
          suggestions: symbols.variables
            .filter((variable) => !(skipPalette && variable.name.startsWith(PALETTE_PREFIX)))
            .map((variable, index) => ({
              label: variable.name,
              kind: monaco.languages.CompletionItemKind.Variable,
              documentation: variable.value,
              detail: labels.variable(variable.value, hostname),
              insertText: variableContext.wrapInVar ? `var(${variable.name})` : variable.name,
              filterText: variable.name,
              sortText: `1${String(index).padStart(5, "0")}`,
              range,
            })),
        };
      }

      // Goedkope controle op de regel; pas dan de tekst tot de cursor bekijken.
      if (!/[.#][\w-]*$/.test(before)) return { suggestions: [] };
      const context = selectorCompletionContext(
        model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column)),
      );
      if (!context) return { suggestions: [] };
      const marker = context.kind === "class" ? "." : "#";
      const names = context.kind === "class" ? symbols.classes : symbols.ids;
      const range = new monaco.Range(
        position.lineNumber,
        position.column - context.prefix.length,
        position.lineNumber,
        position.column,
      );
      return {
        suggestions: names.map((item, index) => {
          const text = `${marker}${cssEscapeIdent(item.name)}`;
          return {
            label: text,
            kind:
              context.kind === "class"
                ? monaco.languages.CompletionItemKind.Class
                : monaco.languages.CompletionItemKind.Reference,
            detail: item.count > 0 ? labels.onPage(item.count, page) : labels.inCss(hostname),
            insertText: text,
            filterText: text,
            sortText: `2${String(index).padStart(5, "0")}`,
            range,
          };
        }),
      };
    },
  });
}
