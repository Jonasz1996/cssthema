/**
 * Monaco, lokaal gebundeld (geen CDN). Alleen de editor-/versieroutes importeren dit bestand
 * (via `import()`), dus Monaco zit niet in de hoofdbundel.
 *
 * - `editor.api` + alle editorfuncties (zoeken, vouwen, suggesties, diff-editor, …) + alleen de
 *   CSS-taal (tokenizer en language service), geen andere talen.
 * - Workers via Vite (`?worker`): de algemene editor-worker en de CSS-worker.
 * - `loader.config({ monaco })`: `@monaco-editor/react` gebruikt deze instantie en laadt nooit
 *   iets van jsDelivr (vite.config.ts bewaakt dat ook in de build).
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/features/register.all";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import "monaco-editor/languages/definitions/css/register";
import { cssDefaults } from "monaco-editor/languages/features/css/register";
import { t } from "@/lib/i18n";
import { registerPaletteProviders } from "./providers";
import { MONACO_THEME_NAME, monacoTheme } from "./theme";

const CSS_LABELS = new Set(["css", "scss", "less"]);

globalThis.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return CSS_LABELS.has(label) ? new CssWorker() : new EditorWorker();
  },
};

loader.config({ monaco });

monaco.editor.defineTheme(MONACO_THEME_NAME, monacoTheme);

// De server lint (lege regels, onbekende properties) en telt dat in de statusbalk; Monaco's
// eigen CSS-validatie houden we voor wat de server niet doet (dubbele properties, syntaxis).
cssDefaults.setOptions({
  ...cssDefaults.options,
  lint: {
    ...cssDefaults.options.lint,
    emptyRules: "ignore",
    unknownProperties: "ignore",
  },
});

registerPaletteProviders(monaco, {
  detail: (name) => t("editor.paletteDetail", { name }),
  hoverTitle: (name) => t("editor.paletteHover", { name }),
});

export { monaco };
export type MonacoApi = typeof monaco;
