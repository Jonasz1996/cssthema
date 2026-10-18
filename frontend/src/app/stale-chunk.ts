/**
 * Na een update (install.sh, nieuwe image) bestaan de chunks van de vorige build niet meer. Een
 * tab die nog open stond, vraagt bij de eerste lazy route (editor, versies) een oude
 * `EditorPage-<hash>.js` op en krijgt 404. Dan herladen we de pagina één keer (de nieuwe
 * index.html kent de nieuwe hashes); lukt het daarna nog steeds niet, dan toont de route een
 * eigen melding met een knop "Herladen" in plaats van in een lus te blijven herladen.
 */

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk .* failed/i;

/** Of een fout van een lazy import komt die zijn bestand niet kon laden (oude build). */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || CHUNK_ERROR.test(error.message);
}

const RELOAD_KEY = "cssthema.chunk-reload";
/** Binnen deze tijd na een automatische herlaadbeurt niet nog eens (geen herlaadlus). */
export const RELOAD_GUARD_MS = 15_000;

export interface ReloadDeps {
  now?: number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  reload?: () => void;
}

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Herlaadt de pagina voor een nieuwe versie, maar niet als dat net al gebeurde. Geeft `true`
 * als er herladen wordt. Zonder sessionStorage (privévenster, geblokkeerd) herladen we niet
 * automatisch: dan kunnen we een lus niet uitsluiten en toont de route de melding.
 */
export function reloadForNewVersion({
  now = Date.now(),
  storage = sessionStore(),
  reload = () => globalThis.location.reload(),
}: ReloadDeps = {}): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY)) || 0;
    if (now - last < RELOAD_GUARD_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * Vite meldt een mislukte lazy import met het event `vite:preloadError`. We herladen dan één
 * keer; de fout zelf gaat gewoon door naar de route (die toont kort de melding tot de pagina
 * herlaadt, of blijvend als herladen niet hielp).
 */
export function installStaleChunkReload(
  target: Window = window,
  deps: Omit<ReloadDeps, "now"> = {},
): void {
  target.addEventListener("vite:preloadError", () => {
    reloadForNewVersion(deps);
  });
}
