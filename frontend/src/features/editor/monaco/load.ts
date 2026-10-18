/**
 * Monaco één keer laden (aparte chunk). Componenten gebruiken `use(monacoModule())` binnen een
 * `Suspense`; zo blijft de rest van de editorpagina bruikbaar terwijl Monaco nog laadt.
 */

type SetupModule = typeof import("./setup");

let pending: Promise<SetupModule> | null = null;

export function monacoModule(): Promise<SetupModule> {
  pending ??= import("./setup").catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** URI-pad van het Monaco-model van een thema (één model per open thema). */
export function themeModelPath(themeId: string): string {
  return `inmemory://cssthema/themes/${themeId}.css`;
}

/** Model van een gesloten tab opruimen (alleen als Monaco al geladen is). */
export function disposeThemeModel(themeId: string): void {
  if (!pending) return;
  void pending.then(({ monaco }) => {
    monaco.editor.getModel(monaco.Uri.parse(themeModelPath(themeId)))?.dispose();
  });
}
