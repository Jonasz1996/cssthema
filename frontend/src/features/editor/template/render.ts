import { generateTemplate } from "./generate";

/** Zo lang wachten we hoogstens tot de verborgen pagina geladen is. */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * Rendert `srcdoc` in een verborgen iframe en maakt er het CSS-template van (`generate.ts`).
 *
 * De iframe heeft `sandbox="allow-same-origin"` zonder `allow-scripts`: er draait niets (ook
 * het bridge-script van de preview niet), maar het dashboard kan `getComputedStyle` lezen, zodat
 * de kleuren uit de eigen CSS van de app komen zoals de browser ze toepast. Desktopbreedte, zodat
 * de opmaak die van de gewone pagina is.
 */
export function templateFromDocument(srcdoc: string, source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: "1280px",
      height: "800px",
      border: "0",
      pointerEvents: "none",
    });
    const timer = window.setTimeout(
      () => finish(new Error("De pagina laadde niet op tijd.")),
      LOAD_TIMEOUT_MS,
    );
    function finish(result: string | Error) {
      window.clearTimeout(timer);
      frame.remove();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }
    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument;
        const view = frame.contentWindow;
        if (!doc || !view) throw new Error("De pagina kon niet gelezen worden.");
        finish(
          generateTemplate({
            document: doc,
            getStyle: (element) => view.getComputedStyle(element),
            source,
          }),
        );
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    frame.srcdoc = srcdoc;
    document.body.append(frame);
  });
}
