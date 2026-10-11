import type { I18n } from "@/lib/i18n";

export type PreviewErrorCode = "unexpected" | "http" | "notInlineable";

/**
 * Fout bij het opbouwen van de preview, met een code voor een vertaalde tekst in het
 * foutvak; `message` blijft een technische omschrijving (console, tests).
 */
export class PreviewError extends Error {
  constructor(
    readonly code: PreviewErrorCode,
    message: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "PreviewError";
  }
}

/** Tekst voor het foutvak van de preview: vertaald als de code bekend is, anders de melding. */
export function previewErrorText(error: unknown, t: I18n["t"]): string {
  if (error instanceof PreviewError) return t(`editor.previewError_${error.code}`, error.params);
  return error instanceof Error ? error.message : String(error);
}
