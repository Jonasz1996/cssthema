/**
 * Syntaxcontrole van een script vóór het uploaden (review THM-4). De bundel `/host/<host>.js`
 * zet alle scripts van een host in één bestand: één syntaxfout houdt dan ook de andere tegen
 * (bv. de netwerkachtergrond van algemeen.js), zonder melding in het dashboard.
 *
 * We parseren zoals de bundel het script krijgt: los (geen functiebody, dus geen `return`
 * bovenaan) en in een eigen `try`, net als build_js. Een `eval` in een niet-strict functie
 * parseert de tekst als zo'n script; de eerste regel gooit meteen, er draait niets van.
 */

export type ScriptSyntax =
  | { ok: true }
  | { ok: false; message: string }
  /** Niet te controleren (bv. een CSP zonder `unsafe-eval`): de server neemt het aan. */
  | { ok: null };

const PARSED = 0;
const PARSE_AS_BUNDLE = `eval("throw ${PARSED};\\ntry {\\n" + source + "\\n} catch (e) {}\\n");`;

export function checkScriptSyntax(source: string): ScriptSyntax {
  try {
    const parse = new Function("source", PARSE_AS_BUNDLE) as (source: string) => void;
    parse(source);
    return { ok: true };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, message: error.message };
    // De eerste regel gooide: alles is geparseerd, niets uitgevoerd.
    if (error === PARSED) return { ok: true };
    return { ok: null };
  }
}
