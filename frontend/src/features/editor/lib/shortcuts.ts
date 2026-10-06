/** Wachttijd na de laatste toets vóór de lint (F-ED-04). */
export const LINT_DEBOUNCE_MS = 400;

export type EditorShortcut = "publish" | "togglePreview";

/** Toetsen-info die de sneltoetsen nodig hebben (ook uit de preview-iframe, via postMessage). */
export type ShortcutKey = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">;

/**
 * Toetsen die de editor overal op de pagina afvangt (ook als Monaco of de preview de focus
 * heeft). `Ctrl/⌘+S` volgt de letter op de toets; bij een indeling zonder Latijnse letters
 * (bv. Cyrillisch) telt de fysieke S-toets (`code === "KeyS"`), zoals de browser zelf doet.
 * `public/preview-bridge.js` past dezelfde regels toe in de iframe.
 */
export function editorShortcut(event: ShortcutKey): EditorShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key ?? "";
  if (key === "s" || key === "S") return "publish";
  if (event.code === "KeyS" && !/^[a-z]$/i.test(key)) return "publish";
  if (key === "\\" || event.code === "Backslash") return "togglePreview";
  return null;
}
