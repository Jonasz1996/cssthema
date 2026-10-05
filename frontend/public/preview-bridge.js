/**
 * cssthema preview bridge — the ONLY script allowed inside the preview iframe (docs/02 §4.2).
 *
 * The editor's preview component loads a sanitised snapshot into a sandboxed iframe
 * (`sandbox="allow-scripts"`, no `allow-same-origin`) together with:
 *   <style id="ct-live"></style>
 *   <script src="preview-bridge.js"></script>
 *
 * Protocol (parent -> iframe):
 *   postMessage({ type: "css", css: "<stylesheet text>" }, "*")
 * The bridge writes the CSS into <style id="ct-live"> and mirrors it into every open
 * shadow root via adoptedStyleSheets, approximating what a userscript injection would do.
 *
 * Phase 0 placeholder: inspector mode ({type:"click", selectorPath}) follows later.
 * Safety: only messages from the direct parent with the exact expected shape are accepted;
 * CSS is only ever assigned as text (never parsed as HTML), and a size cap is enforced.
 */
(function () {
  "use strict";

  var MAX_CSS_LENGTH = 2 * 1024 * 1024; // 2 MiB
  var STYLE_ID = "ct-live";
  var shadowSheet = null;

  function getStyleElement() {
    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
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

  function applyToShadowRoots(css) {
    if (typeof CSSStyleSheet !== "function" || !("replaceSync" in CSSStyleSheet.prototype)) return;
    if (!shadowSheet) shadowSheet = new CSSStyleSheet();
    try {
      shadowSheet.replaceSync(css);
    } catch {
      return; // invalid CSS for constructable sheets: keep previous state
    }
    collectOpenShadowRoots(document, []).forEach(function (sr) {
      var sheets = sr.adoptedStyleSheets || [];
      if (sheets.indexOf(shadowSheet) === -1) {
        sr.adoptedStyleSheets = sheets.concat([shadowSheet]);
      }
    });
  }

  function isCssMessage(data) {
    return (
      data !== null &&
      typeof data === "object" &&
      data.type === "css" &&
      typeof data.css === "string" &&
      data.css.length <= MAX_CSS_LENGTH
    );
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (!isCssMessage(event.data)) return;
    getStyleElement().textContent = event.data.css;
    applyToShadowRoots(event.data.css);
  });
})();
