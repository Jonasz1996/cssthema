import { escapeHtml } from "./demo-page";
import { PreviewError } from "./errors";
import { assertInlineableBridge, previewHeadEnd, previewHeadStart } from "./srcdoc";

/**
 * De srcdoc voor een vastgelegde pagina van een echte app (snapshot, stappenplan D2), naast de
 * demo-pagina van `srcdoc.ts`:
 *
 * ```html
 * <html class="…" data-…>                                     ← alleen veilige attributen
 * <head>
 *   <meta http-equiv="Content-Security-Policy" content="…">   ← dezelfde CSP, eerste element
 *   <style data-ct-app="1">…</style> …                         ← CSS van de app, paginavolgorde
 *   <style id="ct-palette"></style>                            ← daarna: het thema wint
 *   <style id="ct-live"></style>
 *   <script>…preview-bridge.js…</script>
 * </head>
 * <body class="…">…de pagina, zonder scripts…</body>
 * ```
 *
 * De HTML komt van de server al zonder scripts, maar wordt hier toch opgeschoond (verdediging
 * in de diepte; de CSP blokkeert ze ook): geen `<script>`, `<noscript>`, frames, plugins,
 * `<base>`, `<meta http-equiv>` of `<link>`, geen `on*`-, `srcdoc`- of `autofocus`-attributen
 * en geen `javascript:`-URL's. Declaratieve shadow roots (`<template shadowrootmode>`) blijven
 * staan (hun inhoud wordt ook opgeschoond), zodat de iframe ze opnieuw opbouwt.
 */

/** Grootste snapshot (HTML + CSS, in tekens) waarvoor de preview nog een document bouwt. */
export const MAX_SNAPSHOT_CHARS = 24 * 1024 * 1024;

const MB = 1024 * 1024;

/** Elementen die nooit in de preview komen (met inhoud). */
const REMOVED_ELEMENTS = new Set([
  "script",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "base",
  "link",
  "noembed",
  "noframes",
]);

/** Attributen van `<html>` en `<body>` die meegaan; de rest valt weg. */
const COPIED_ROOT_ATTRIBUTE = /^(?:class|id|lang|dir|style|data-[a-z0-9_.:-]+)$/;

/** `<link href="../../_css/<sha16>.css">` zoals de import ze leest (backend: `_CSS_LINK_RE`). */
const CSS_LINK = /href=["'](?:\.\.\/)*_css\/([0-9a-f]{16}\.css)["']/g;
const CSS_HREF = /(?:^|\/)_css\/([0-9a-f]{16}\.css)$/;

/** Zou `</style` het `<style>`-blok sluiten? Dan `<\/style` (in CSS een gewone `/`). */
export function neutraliseStyleText(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

/**
 * `javascript:`/`vbscript:` aan het begin van de waarde, van een lijstitem (SVG `values`) of in
 * `url(…)` (een `style`-attribuut).
 */
export function isScriptUrl(value: string): boolean {
  // De URL-parser negeert tabs, regeleinden en andere stuurtekens: `java\tscript:` telt mee.
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "");
  return /(?:^|[\s;,('"])(?:javascript|vbscript):/i.test(cleaned);
}

function isUnsafeAttribute(name: string, value: string): boolean {
  return name.startsWith("on") || name === "srcdoc" || name === "autofocus" || isScriptUrl(value);
}

/** Koppeling `<sha16>.css` → CSS-tekst, als de lijst van de server met de links in de HTML strookt. */
function linkedStylesheets(html: string, stylesheets: readonly string[]): Map<string, string> {
  const names = [...new Set(Array.from(html.matchAll(CSS_LINK), (match) => match[1]!))];
  // De server laat ontbrekende bestanden weg: dan klopt de volgorde niet meer.
  if (names.length !== stylesheets.length) return new Map();
  return new Map(names.map((name, index) => [name, stylesheets[index]!]));
}

/**
 * Schoont een boom op (een element of de inhoud van een `<template>`), ook binnen templates.
 * Een stylesheet-link binnen een shadow root wordt een `<style>` met dezelfde CSS (de CSS van
 * het document bereikt een shadow root niet); elders valt hij weg (die CSS staat in `<head>`).
 */
function sanitizeTree(root: ParentNode, linked: ReadonlyMap<string, string>, inTemplate: boolean) {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tag = element.localName.toLowerCase();
    if (tag === "link" && inTemplate) {
      const css = linked.get(CSS_HREF.exec(element.getAttribute("href") ?? "")?.[1] ?? "");
      if (css !== undefined && /\bstylesheet\b/i.test(element.getAttribute("rel") ?? "")) {
        const style = element.ownerDocument.createElement("style");
        style.textContent = neutraliseStyleText(css);
        element.replaceWith(style);
        continue;
      }
    }
    if (REMOVED_ELEMENTS.has(tag) || (tag === "meta" && element.hasAttribute("http-equiv"))) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (isUnsafeAttribute(attribute.name.toLowerCase(), attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (tag === "style" && /<\/style/i.test(element.textContent ?? "")) {
      element.textContent = neutraliseStyleText(element.textContent ?? "");
    }
    if (tag === "template" && "content" in element) {
      sanitizeTree((element as HTMLTemplateElement).content, linked, true);
    }
  }
}

/** ` class="…" data-x="…"` van `<html>` of `<body>`: alleen de toegestane attributen. */
function copiedAttributes(element: Element | null): string {
  if (!element) return "";
  let out = "";
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (!COPIED_ROOT_ATTRIBUTE.test(name) || isScriptUrl(attribute.value)) continue;
    out += ` ${name}="${escapeHtml(attribute.value)}"`;
  }
  return out;
}

export interface SnapshotDocumentInput {
  bridgeSource: string;
  bridgeHash: string;
  /** Titel van het iframe-document. */
  title: string;
  /** De vastgelegde pagina (volledig HTML-document, zonder scripts). */
  html: string;
  /** De CSS van de app, in de volgorde van de pagina. */
  stylesheets: readonly string[];
}

/**
 * Bouwt de srcdoc voor een snapshot. Gooit een `PreviewError` als het bridge-script niet inline
 * kan of als de snapshot te groot is voor de preview (`MAX_SNAPSHOT_CHARS`).
 */
export function buildSnapshotDocument({
  bridgeSource,
  bridgeHash,
  title,
  html,
  stylesheets,
}: SnapshotDocumentInput): string {
  assertInlineableBridge(bridgeSource);
  const size = stylesheets.reduce((total, css) => total + css.length, html.length);
  if (size > MAX_SNAPSHOT_CHARS) {
    throw new PreviewError("snapshotTooLarge", `snapshot te groot (${size} tekens)`, {
      size: Math.ceil(size / MB),
      max: MAX_SNAPSHOT_CHARS / MB,
    });
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  // Inline `<style>` in de kop van de pagina: na de gelinkte CSS (de volgorde ertussen is niet
  // bekend; zulke blokken zijn meestal klein en staan meestal achteraan).
  const headStyles = Array.from(parsed.head?.querySelectorAll("style") ?? [], (style) => ({
    css: style.textContent ?? "",
    media: style.getAttribute("media"),
  }));
  const body = parsed.body;
  if (body) sanitizeTree(body, linkedStylesheets(html, stylesheets), false);

  const appStyles = [
    ...stylesheets.map((css) => ({ css, media: null as string | null })),
    ...headStyles,
  ].map(
    ({ css, media }, index) =>
      `<style data-ct-app="${index + 1}"${media ? ` media="${escapeHtml(media)}"` : ""}>` +
      `${neutraliseStyleText(css)}</style>`,
  );

  return [
    "<!doctype html>",
    `<html${copiedAttributes(parsed.documentElement)}>`,
    "<head>",
    ...previewHeadStart(bridgeHash, title),
    ...appStyles,
    ...previewHeadEnd(bridgeSource),
    "</head>",
    `<body${copiedAttributes(body)}>${body?.innerHTML ?? ""}</body>`,
    "</html>",
  ].join("\n");
}
