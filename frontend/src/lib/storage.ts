/**
 * Veilige toegang tot localStorage: in private vensters, met geblokkeerde site-data of buiten
 * de browser kan elke aanroep een exception gooien. Voorkeuren zijn "nice to have", dus een
 * fout betekent gewoon: geen opgeslagen waarde.
 */

/** Alle sleutels van de app krijgen dit voorvoegsel. */
export const STORAGE_PREFIX = "cssthema.";

export function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(STORAGE_PREFIX + key);
    else globalThis.localStorage?.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // Opslag niet beschikbaar of vol: de voorkeur geldt dan alleen voor deze sessie.
  }
}

/** JSON lezen; bij ontbrekende of ongeldige inhoud de fallback. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readStorage(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeStorage(key, JSON.stringify(value));
}
