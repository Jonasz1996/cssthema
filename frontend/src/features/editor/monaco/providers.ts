import type * as Monaco from "monaco-editor/editor/editor.api";
import {
  type PaletteToken,
  paletteCompletionContext,
  paletteInsertText,
  paletteTokens,
  paletteVariableAt,
} from "../palette";

/**
 * Autocomplete en hover voor de `--ct-*`-tokens van het palet dat aan een thema hangt.
 * Monaco-providers gelden per taal (alle CSS-modellen); welk palet bij welk model hoort,
 * houdt `setModelPalette` bij (sleutel: de model-URI).
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
