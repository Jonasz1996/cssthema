import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchDraft } from "@/api/queries/editor";
import { type DraftBuffer, draftBuffer } from "./buffer";
import {
  DraftSession,
  type DraftSessionOptions,
  type SaveDraftFn,
  type SessionSnapshot,
} from "./draft-session";

/**
 * Eén `DraftSession` per open thema, buiten React bewaard: wisselen van tab of even naar een
 * andere pagina verliest geen wachtende save, conflict of offline-toestand. Sluiten van de tab
 * (`closeSession`) slaat eerst op en ruimt dan op; tot dat klaar is blijft de sessie in de map,
 * zodat een render die het thema nog toont geen tweede sessie (met een verouderde lock) maakt.
 *
 * Globaal: bij `online` en bij een zichtbaar tabblad probeert elke offline sessie het opnieuw;
 * `beforeunload` waarschuwt zolang er iets niet op de server staat.
 */

const sessions = new Map<string, DraftSession>();
const restored = new WeakSet<DraftSession>();
/** Sessies die gesloten worden (flush loopt nog); `ensureSession` haalt ze terug. */
const closing = new WeakSet<DraftSession>();
let globalsInstalled = false;

type SessionInit = Pick<DraftSessionOptions, "draft" | "save"> &
  Partial<Pick<DraftSessionOptions, "delayMs" | "bufferDelayMs" | "retryDelaysMs" | "load">> & {
    buffer?: DraftBuffer;
  };

/** Bestaande sessie, of `undefined`. */
export function peekSession(themeId: string): DraftSession | undefined {
  return sessions.get(themeId);
}

/** Bestaande sessie of een nieuwe op basis van de draft van de server (idempotent). */
export function ensureSession(themeId: string, init: SessionInit): DraftSession {
  let session = sessions.get(themeId);
  if (session) {
    // Opnieuw geopend terwijl het sluiten nog opsloeg: de sessie blijft gewoon bestaan.
    closing.delete(session);
    return session;
  }
  session = new DraftSession({
    themeId,
    buffer: init.buffer ?? draftBuffer(),
    load: (id) => fetchDraft(id),
    ...init,
  });
  sessions.set(themeId, session);
  installGlobals();
  return session;
}

/**
 * Slaat op wat nog openstaat en ruimt de sessie daarna op (tab gesloten). Tijdens het opslaan
 * blijft de sessie in de map: `hasUnsavedChanges()` telt hem nog mee, en een render die het
 * thema nog toont krijgt deze sessie terug in plaats van een nieuwe met een verouderde lock.
 */
export async function closeSession(themeId: string): Promise<void> {
  const session = sessions.get(themeId);
  if (!session || closing.has(session)) return;
  closing.add(session);
  try {
    await session.flush();
  } finally {
    if (closing.has(session)) {
      closing.delete(session);
      if (sessions.get(themeId) === session) sessions.delete(themeId);
      session.dispose();
    }
  }
}

/** Of er ergens nog wijzigingen zijn die niet op de server staan. */
export function hasUnsavedChanges(): boolean {
  for (const session of sessions.values()) {
    if (session.getSnapshot().dirty) return true;
  }
  return false;
}

/** Alle offline sessies opnieuw laten proberen. */
export function retryOfflineSessions(): void {
  for (const session of sessions.values()) session.retryNow();
}

/** Alleen voor tests: alle sessies weg. */
export function resetSessions(): void {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
}

function installGlobals(): void {
  if (globalsInstalled || typeof window === "undefined") return;
  globalsInstalled = true;
  window.addEventListener("online", retryOfflineSessions);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retryOfflineSessions();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges()) return;
    // De tekst staat ook in de offline-buffer, maar waarschuwen is vriendelijker.
    for (const session of sessions.values()) void session.flush();
    event.preventDefault();
    event.returnValue = "";
  });
}

/**
 * React: sessie voor een thema zodra de draft geladen is. Werkt de opslagfunctie bij, haalt
 * één keer de offline-buffer terug en neemt een nieuwere serverdraft over (rollback e.d.).
 */
export function useDraftSession(
  themeId: string,
  draft: DraftSessionOptions["draft"] | undefined,
  save: SaveDraftFn,
): DraftSession | undefined {
  const session = draft ? ensureSession(themeId, { draft, save }) : peekSession(themeId);

  useEffect(() => {
    if (!session) return;
    session.setSave(save);
    if (!restored.has(session)) {
      restored.add(session);
      void session.restoreFromBuffer();
    }
  }, [session, save]);

  useEffect(() => {
    if (session && draft) session.adoptServerDraft(draft);
  }, [session, draft]);

  return session;
}

const EMPTY = () => () => {};

/** Momentopname van een sessie (rendert opnieuw bij elke wijziging). */
export function useSessionSnapshot(session: DraftSession | undefined): SessionSnapshot | undefined {
  return useSyncExternalStore(
    session?.subscribe ?? EMPTY,
    () => session?.getSnapshot(),
    () => session?.getSnapshot(),
  );
}

/** Eén waarde uit de sessie; rendert alleen opnieuw als die waarde verandert. */
export function useSessionValue<T>(
  session: DraftSession | undefined,
  select: (snapshot: SessionSnapshot) => T,
  fallback: T,
): T {
  return useSyncExternalStore(
    session?.subscribe ?? EMPTY,
    () => (session ? select(session.getSnapshot()) : fallback),
    () => (session ? select(session.getSnapshot()) : fallback),
  );
}

/**
 * De CSS van een sessie, pas na `delay` ms zonder wijzigingen (voor de lint, 400 ms). De
 * component rendert alleen opnieuw als de vertraagde waarde verandert, niet bij elke toets.
 */
export function useDebouncedSessionCss(
  session: DraftSession | undefined,
  delay: number,
): string | undefined {
  const [latest, setLatest] = useState<{ session: DraftSession; css: string } | null>(null);

  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = session.getSnapshot().css;
    const unsubscribe = session.subscribe(() => {
      const css = session.getSnapshot().css;
      if (css === last) return;
      last = css;
      clearTimeout(timer);
      timer = setTimeout(() => setLatest({ session, css }), delay);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [session, delay]);

  if (!session) return undefined;
  return latest?.session === session ? latest.css : session.getSnapshot().css;
}
