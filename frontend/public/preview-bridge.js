/**
 * cssthema preview bridge — the ONLY script allowed inside the preview iframe (docs/02 §4.2).
 *
 * The editor's preview component builds the iframe document itself (`srcdoc`) and runs it in a
 * sandbox (`sandbox="allow-scripts"`, no `allow-same-origin`: opaque origin, no cookies, no
 * API). It fetches this file once from `/preview-bridge.js` and INLINES its text; the srcdoc
 * then starts with:
 *   <meta http-equiv="Content-Security-Policy"
 *         content="default-src 'none'; style-src 'unsafe-inline'; ...;
 *                  script-src 'sha256-<hash of this file>'">
 *   style element #ct-palette   palette tokens as :root { --ct-*: … }
 *   style element #ct-live      the theme CSS being edited
 *   an inline script element with the contents of this file
 * (This file must never contain a closing script or style tag: it is inlined verbatim.)
 * Not a `src` attribute: inside srcdoc a relative URL resolves against the editor route (and hits
 * the SPA fallback), and a CSP response header never reaches a srcdoc document, so the policy
 * has to travel inside it as a meta tag.
 *
 * Protocol, parent -> iframe (postMessage, target "*": the iframe origin is opaque):
 *   { type: "css", css: "<stylesheet text>", seq?: number }   -> style #ct-live
 *   { type: "palette", css: "<stylesheet text>" }             -> style #ct-palette
 * iframe -> parent:
 *   { type: "cssthema:ready" }               once the bridge listens (send the CSS now)
 *   { type: "cssthema:applied", seq }        after a "css" message was applied
 *   { type: "cssthema:shortcut", action }    Ctrl/Cmd+S ("publish") or Ctrl+\ ("togglePreview")
 *                                            pressed while the preview has focus; the browser
 *                                            default ("Save page as") is prevented here, the
 *                                            editor decides what to do
 * Both stylesheets are mirrored into every open shadow root via adoptedStyleSheets,
 * approximating what a userscript injection would do.
 *
 * Inspector mode ({type:"click", selectorPath}) follows in a later phase.
 * Safety: only messages from the direct parent with the exact expected shape are accepted;
 * CSS is only ever assigned as text (never parsed as HTML), and a size cap is enforced.
 */
(function () {
  "use strict";

  var MAX_CSS_LENGTH = 2 * 1024 * 1024; // 2 MiB
  var TARGETS = { css: "ct-live", palette: "ct-palette" };
  var shadowSheets = { css: null, palette: null };

  function getStyleElement(id) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }

  function collectOpenShadowRoots(root, out) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    var node = walker.currentNode;
    while (node) {
      if (node.shadowRoot) {
        out.push(node.shadowRoot);
        collectOpenShadowRoots(node.shadowRoot, out);
      }
      node = walker.nextNode();
    }
    return out;
  }

  function applyToShadowRoots(kind, css) {
    if (typeof CSSStyleSheet !== "function" || !("replaceSync" in CSSStyleSheet.prototype)) return;
    if (!shadowSheets[kind]) shadowSheets[kind] = new CSSStyleSheet();
    var sheet = shadowSheets[kind];
    try {
      sheet.replaceSync(css);
    } catch {
      return; // invalid CSS for constructable sheets: keep previous state
    }
    collectOpenShadowRoots(document, []).forEach(function (sr) {
      var sheets = sr.adoptedStyleSheets || [];
      if (sheets.indexOf(sheet) === -1) {
        sr.adoptedStyleSheets = sheets.concat([sheet]);
      }
    });
  }

  function isStyleMessage(data) {
    return (
      data !== null &&
      typeof data === "object" &&
      (data.type === "css" || data.type === "palette") &&
      typeof data.css === "string" &&
      data.css.length <= MAX_CSS_LENGTH
    );
  }

  function reply(message) {
    if (window.parent && window.parent !== window) window.parent.postMessage(message, "*");
  }

  // Same rules as editorShortcut() in src/features/editor/lib/shortcuts.ts.
  function shortcutOf(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
    var key = typeof event.key === "string" ? event.key : "";
    if (key === "s" || key === "S") return "publish";
    if (event.code === "KeyS" && !/^[a-z]$/i.test(key)) return "publish";
    if (key === "\\" || event.code === "Backslash") return "togglePreview";
    return null;
  }

  window.addEventListener(
    "keydown",
    function (event) {
      var action = shortcutOf(event);
      if (!action) return;
      event.preventDefault();
      reply({ type: "cssthema:shortcut", action: action });
    },
    true,
  );

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!isStyleMessage(data)) return;
    getStyleElement(TARGETS[data.type]).textContent = data.css;
    applyToShadowRoots(data.type, data.css);
    if (data.type === "css") {
      reply({ type: "cssthema:applied", seq: typeof data.seq === "number" ? data.seq : null });
    }
  });

  reply({ type: "cssthema:ready" });
})();
