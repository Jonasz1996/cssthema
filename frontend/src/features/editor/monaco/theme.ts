/**
 * Eigen Monaco-thema in de stijl van de cssthema-UI (aiverslag): donkergrijs vlak, witte
 * selectors, lichtblauwe properties (`--ui-code`), groene strings/kleuren, oranje getallen en
 * de statuskleuren voor fouten en waarschuwingen. Puur data, zodat het zonder Monaco te testen is.
 */

export const MONACO_THEME_NAME = "cssthema-terminal";

/** Minimale vorm van `monaco.editor.IStandaloneThemeData` (zonder Monaco te importeren). */
export interface MonacoThemeData {
  base: "vs" | "vs-dark" | "hc-black" | "hc-light";
  inherit: boolean;
  rules: { token: string; foreground?: string; background?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

const ui = {
  bg: "#101010",
  widget: "#181818",
  text: "#dddddd",
  heading: "#ffffff",
  muted: "#999999",
  dim: "#777777",
  ok: "#8fd6a4",
  err: "#e58b8b",
  mid: "#e6b56b",
  code: "#d6e6ff",
  term: "#9cffb0",
} as const;

/** Kleur zonder `#` (Monaco-tokenregels willen hex zonder hekje). */
function bare(color: string): string {
  return color.replace(/^#/, "");
}

export const monacoTheme: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: bare(ui.text) },
    { token: "comment", foreground: bare(ui.dim), fontStyle: "italic" },
    { token: "tag", foreground: bare(ui.heading), fontStyle: "bold" },
    { token: "attribute.name", foreground: bare(ui.code) },
    { token: "attribute.value", foreground: bare(ui.text) },
    { token: "attribute.value.number", foreground: bare(ui.mid) },
    { token: "attribute.value.unit", foreground: bare(ui.mid) },
    { token: "attribute.value.hex", foreground: bare(ui.ok) },
    { token: "string", foreground: bare(ui.ok) },
    { token: "keyword", foreground: bare(ui.term) },
    { token: "delimiter", foreground: bare(ui.muted) },
    { token: "delimiter.bracket", foreground: "bbbbbb" },
    { token: "delimiter.parenthesis", foreground: "bbbbbb" },
  ],
  colors: {
    focusBorder: "#ffffff80",
    foreground: ui.text,
    "editor.background": ui.bg,
    "editor.foreground": ui.text,
    "editorGutter.background": ui.bg,
    "editorLineNumber.foreground": "#555555",
    "editorLineNumber.activeForeground": "#bbbbbb",
    "editorCursor.foreground": ui.heading,
    "editor.selectionBackground": "#ffffff2e",
    "editor.inactiveSelectionBackground": "#ffffff18",
    "editor.selectionHighlightBackground": "#ffffff14",
    "editor.lineHighlightBackground": "#ffffff08",
    "editor.lineHighlightBorder": "#00000000",
    "editor.wordHighlightBackground": "#ffffff14",
    "editor.wordHighlightStrongBackground": "#ffffff1f",
    "editor.findMatchBackground": "#e6b56b55",
    "editor.findMatchHighlightBackground": "#e6b56b26",
    "editorIndentGuide.background1": "#ffffff10",
    "editorIndentGuide.activeBackground1": "#ffffff30",
    "editorWhitespace.foreground": "#ffffff1a",
    "editorBracketMatch.background": "#ffffff14",
    "editorBracketMatch.border": "#ffffff55",
    "editorLink.activeForeground": ui.code,
    "editorError.foreground": ui.err,
    "editorWarning.foreground": ui.mid,
    "editorInfo.foreground": ui.code,
    "editorOverviewRuler.border": "#00000000",
    "editorOverviewRuler.errorForeground": ui.err,
    "editorOverviewRuler.warningForeground": ui.mid,
    "editorWidget.background": ui.widget,
    "editorWidget.foreground": ui.text,
    "editorWidget.border": "#ffffff24",
    "editorSuggestWidget.background": ui.widget,
    "editorSuggestWidget.border": "#ffffff24",
    "editorSuggestWidget.foreground": ui.text,
    "editorSuggestWidget.selectedBackground": "#ffffff1f",
    "editorSuggestWidget.highlightForeground": ui.heading,
    "editorHoverWidget.background": ui.widget,
    "editorHoverWidget.border": "#ffffff24",
    "editorMarkerNavigation.background": ui.widget,
    "editorMarkerNavigationError.background": ui.err,
    "editorMarkerNavigationWarning.background": ui.mid,
    "editorStickyScroll.background": ui.bg,
    "editorStickyScrollHover.background": "#ffffff10",
    "input.background": "#000000",
    "input.border": "#ffffff24",
    "input.foreground": ui.text,
    "inputOption.activeBorder": "#ffffff80",
    "list.hoverBackground": "#ffffff10",
    "list.activeSelectionBackground": "#ffffff1f",
    "list.activeSelectionForeground": ui.heading,
    "list.focusBackground": "#ffffff1f",
    "list.highlightForeground": ui.heading,
    "minimap.background": ui.bg,
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#ffffff1a",
    "scrollbarSlider.hoverBackground": "#ffffff2e",
    "scrollbarSlider.activeBackground": "#ffffff40",
    "widget.shadow": "#00000099",
    "diffEditor.insertedTextBackground": "#8fd6a42e",
    "diffEditor.removedTextBackground": "#e58b8b2e",
    "diffEditor.insertedLineBackground": "#8fd6a414",
    "diffEditor.removedLineBackground": "#e58b8b14",
    "diffEditor.diagonalFill": "#ffffff10",
    "diffEditorGutter.insertedLineBackground": "#8fd6a41f",
    "diffEditorGutter.removedLineBackground": "#e58b8b1f",
  },
};

/** Lettertype en maat zoals de rest van de UI (alles monospace). */
export const MONACO_FONT_FAMILY =
  'ui-monospace, "Cascadia Code", "SF Mono", Consolas, "Liberation Mono", monospace';
export const MONACO_FONT_SIZE = 13.5;
export const MONACO_LINE_HEIGHT = 21;
