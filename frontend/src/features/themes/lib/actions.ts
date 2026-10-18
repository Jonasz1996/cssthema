/** Acties op een thema vanuit een kaart of lijst. */
export type ThemeAction =
  "duplicate" | "export-css" | "export-bundle" | "copy-url" | "delete" | "restore" | "purge";

/** De editor van een thema (route van de editor-feature). */
export function editorPath(themeId: string): string {
  return `/editor/${encodeURIComponent(themeId)}`;
}

/** Bestandsnaam als de server geen `Content-Disposition` stuurt. */
export function exportFilename(slug: string, format: "css" | "bundle"): string {
  return format === "bundle" ? `${slug}.cssthema.zip` : `${slug}.css`;
}
