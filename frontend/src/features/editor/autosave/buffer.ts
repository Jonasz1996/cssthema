import { createStore, del, get, set, type UseStore } from "idb-keyval";

/**
 * Offline-buffer voor drafts: wat nog niet op de server staat, wordt in IndexedDB bewaard
 * (`idb-keyval`), zodat een wegvallende verbinding, een gesloten tabblad of een crash geen
 * werk kost. Bij het openen van het thema en bij online-komen synchroniseert de editor.
 *
 * Werkt IndexedDB niet (privévenster, geblokkeerde site-data, oude browser), dan valt de
 * buffer terug op het geheugen: dan overleeft hij alleen geen herladen van de pagina.
 */

export interface BufferedDraft {
  themeId: string;
  css: string;
  /** `lock_version` van de serverversie waarop deze wijzigingen gebaseerd zijn. */
  baseLockVersion: number;
  /** Wanneer lokaal bewaard (ISO 8601). */
  savedAt: string;
}

export interface DraftBuffer {
  get(themeId: string): Promise<BufferedDraft | undefined>;
  set(entry: BufferedDraft): Promise<void>;
  delete(themeId: string): Promise<void>;
}

function isBufferedDraft(value: unknown, themeId: string): value is BufferedDraft {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.themeId === themeId &&
    typeof entry.css === "string" &&
    typeof entry.baseLockVersion === "number" &&
    Number.isFinite(entry.baseLockVersion) &&
    typeof entry.savedAt === "string"
  );
}

/** Buffer in het geheugen (tests, of als IndexedDB niet beschikbaar is). */
export function createMemoryBuffer(): DraftBuffer & { entries: Map<string, BufferedDraft> } {
  const entries = new Map<string, BufferedDraft>();
  return {
    entries,
    get: async (themeId) => entries.get(themeId),
    set: async (entry) => {
      entries.set(entry.themeId, { ...entry });
    },
    delete: async (themeId) => {
      entries.delete(themeId);
    },
  };
}

export const IDB_DATABASE = "cssthema";
export const IDB_STORE = "draft-buffer";

/** Buffer in IndexedDB, met terugval op het geheugen bij elke fout. */
export function createIdbBuffer(): DraftBuffer {
  const memory = createMemoryBuffer();
  let store: UseStore | null = null;
  let broken = typeof indexedDB === "undefined";

  const openStore = (): UseStore | null => {
    if (broken) return null;
    try {
      store ??= createStore(IDB_DATABASE, IDB_STORE);
      return store;
    } catch {
      broken = true;
      return null;
    }
  };

  const fail = (error: unknown) => {
    if (!broken)
      console.warn("cssthema: offline-buffer niet beschikbaar, alleen in geheugen", error);
    broken = true;
  };

  return {
    async get(themeId) {
      const idb = openStore();
      if (idb) {
        try {
          const value: unknown = await get(themeId, idb);
          if (isBufferedDraft(value, themeId)) return value;
          return memory.get(themeId);
        } catch (error) {
          fail(error);
        }
      }
      return memory.get(themeId);
    },
    async set(entry) {
      await memory.set(entry);
      const idb = openStore();
      if (!idb) return;
      try {
        await set(entry.themeId, entry, idb);
      } catch (error) {
        fail(error);
      }
    },
    async delete(themeId) {
      await memory.delete(themeId);
      const idb = openStore();
      if (!idb) return;
      try {
        await del(themeId, idb);
      } catch (error) {
        fail(error);
      }
    },
  };
}

let shared: DraftBuffer | null = null;

/** De buffer van de app (IndexedDB), één keer aangemaakt. */
export function draftBuffer(): DraftBuffer {
  shared ??= createIdbBuffer();
  return shared;
}
