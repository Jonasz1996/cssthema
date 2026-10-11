import { DEMO_BASE_CSS, escapeHtml } from "./demo-page";
import { PreviewError } from "./errors";

/**
 * Het document van de preview-iframe (`srcdoc`), docs/02 § 4.2:
 *
 * ```html
 * <head>
 *   <meta http-equiv="Content-Security-Policy" content="…">   ← altijd het eerste element
 *   <style id="ct-demo-base">…</style>                         ← neutrale demo-stijl (:where)
 *   <style id="ct-palette"></style>                            ← :root { --ct-*: … }
 *   <style id="ct-live"></style>                               ← de CSS uit de editor
 *   <script>…preview-bridge.js…</script>                       ← enige script (hash in de CSP)
 * </head>
 * ```
 *
 * Palet en CSS komen via `postMessage` (zie `channel.ts`), niet in de srcdoc zelf: dan hoeft
 * de iframe bij elke toets niet opnieuw te laden. Een vastgelegde pagina van een echte app
 * (snapshot) bouwt `snapshot-document.ts` met dezelfde kop, zonder de demo-stijl.
 *
 * De CSP laat niets van buiten toe: geen netwerk (ook geen fonts of afbeeldingen van een
 * server), alleen inline stijl, `data:`-afbeeldingen/-fonts en het bridge-script.
 */

export function previewCsp(bridgeHash: string): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    `script-src 'sha256-${bridgeHash}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export interface PreviewDocumentInput {
  bridgeSource: string;
  bridgeHash: string;
  lang: string;
  title: string;
  bodyHtml: string;
  /** Basisstijl van de demo (standaard `DEMO_BASE_CSS`). */
  baseCss?: string;
}

/** Gooit als het bridge-script zijn `<script>`-blok zou kunnen sluiten (of een commentaar openen). */
export function assertInlineableBridge(bridgeSource: string): void {
  if (/<\/script|<!--/i.test(bridgeSource)) {
    throw new PreviewError(
      "notInlineable",
      "preview-bridge.js bevat </script of <!-- en kan niet inline",
    );
  }
}

/** Begin van `<head>`: de CSP (altijd het eerste element), tekenset, viewport en titel. */
export function previewHeadStart(bridgeHash: string, title: string): string[] {
  return [
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(previewCsp(bridgeHash))}">`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
  ];
}

/** Einde van `<head>`: palet en live CSS (na alle andere stijl, zodat het thema wint) en de bridge. */
export function previewHeadEnd(bridgeSource: string): string[] {
  return [
    '<style id="ct-palette"></style>',
    '<style id="ct-live"></style>',
    `<script>${bridgeSource}</script>`,
  ];
}

/** Bouwt de srcdoc. Gooit als het bridge-script het `<script>`-blok zou kunnen sluiten. */
export function buildPreviewDocument({
  bridgeSource,
  bridgeHash,
  lang,
  title,
  bodyHtml,
  baseCss = DEMO_BASE_CSS,
}: PreviewDocumentInput): string {
  assertInlineableBridge(bridgeSource);
  if (/<\/style/i.test(baseCss)) throw new Error("demo-stijl bevat </style");
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(lang)}">`,
    "<head>",
    ...previewHeadStart(bridgeHash, title),
    `<style id="ct-demo-base">${baseCss}</style>`,
    ...previewHeadEnd(bridgeSource),
    "</head>",
    `<body>${bodyHtml}</body>`,
    "</html>",
  ].join("\n");
}
