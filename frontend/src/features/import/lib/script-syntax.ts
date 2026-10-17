/**
 * Syntaxcontrole van een script vóór het uploaden (review THM-4). De bundel `/host/<host>.js`
 * zet alle scripts van een host in één bestand: één syntaxfout houdt dan ook de andere tegen
 * (bv. de netwerkachtergrond van algemeen.js), zonder melding in het dashboard. `new Function`
 * parseert de tekst zonder hem uit te voeren.
 */

export type ScriptSyntax =
  | { ok: true }
  | { ok: false; message: string }
  /** Niet te controleren (bv. een CSP zonder `unsafe-eval`): de server neemt het aan. */
  | { ok: null };

export function checkScriptSyntax(source: string): ScriptSyntax {
  try {
    // Een functie maken parseert de code; aanroepen doen we niet.
    new Function(source);
    return { ok: true };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, message: error.message };
    return { ok: null };
  }
}
