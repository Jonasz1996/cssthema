import { isApiError, isNetworkError } from "@/api/client";
import type { SaveDraftInput } from "@/api/queries/editor";
import type { Draft, EtagState, Locked } from "@/api/types";
import type { DraftBuffer } from "./buffer";

/**
 * Autosave van één draft als kleine toestandsmachine, los van React en Monaco (testbaar met
 * nep-timers en een nep-`save`).
 *
 * ```
 *            edit                 1 s stil            200
 *   saved ─────────► pending ─────────────► saving ─────────► saved
 *     ▲                ▲  edit (opnieuw 1 s)   │ 412 ───────► conflict  (wacht op keuze)
 *     │                └───────────────────────┤ netwerk ───► offline   (buffer + opnieuw proberen)
 *     └── terug naar de opgeslagen tekst       └ 413/422… ──► error     (volgende edit probeert opnieuw)
 * ```
 *
 * - Elke save stuurt `If-Match` met de laatst bekende `lock_version`; het antwoord geeft de
 *   nieuwe (`Locked<Draft>`).
 * - Niet-opgeslagen tekst gaat ook naar de offline-buffer (IndexedDB), en blijft daar tot de
 *   server hem heeft. Bij het (her)openen haalt `restoreFromBuffer()` hem terug.
 * - "Offline" = de server is niet bereikbaar (geen antwoord, 502/503/504, of een 5xx zonder
 *   Problem-body zoals een proxy die hem geeft). Dan probeert de sessie het opnieuw met
 *   oplopende pauzes, en meteen bij `retryNow()` (online-event, tabblad weer zichtbaar).
 * - Niet elke 412 is een echt conflict: verwijderen + herstellen of een metadatawijziging
 *   verhoogt de lock zonder de draft te veranderen. Bij een 412 haalt de sessie daarom de
 *   serverdraft op (`load`); is die gelijk aan wat wij als opgeslagen kennen, dan neemt ze de
 *   nieuwe lock over en slaat ze stil opnieuw op.
 */

export type SaveState =
  /** Alles staat op de server (`at` = laatste opslag volgens de server). */
  | { kind: "saved"; at: string | null }
  /** Lokale wijzigingen, wacht op de debounce. */
  | { kind: "pending" }
  | { kind: "saving" }
  /** Iemand anders wijzigde de draft (412), of de buffer hoort bij een oudere serverversie. */
  | { kind: "conflict"; current: EtagState | null; origin: ConflictOrigin }
  /** Server onbereikbaar; de tekst staat in de offline-buffer. */
  | { kind: "offline"; since: string }
  /**
   * Server weigerde (bv. 413 te groot); `message` is de tekst van de server. `fromServer`:
   * die tekst komt uit een Problem-body van cssthema (anders: proxy/HTML, niet tonen).
   */
  | { kind: "error"; code: string; message: string; status: number; fromServer: boolean };

export type SaveStateKind = SaveState["kind"];
export type ConflictOrigin = "save" | "restore" | "publish";

export interface SessionSnapshot {
  themeId: string;
  /** Inhoud van de editor (laatste edit). */
  css: string;
  /** Inhoud zoals de server hem heeft. */
  savedCss: string;
  lockVersion: number;
  /** `css !== savedCss`. */
  dirty: boolean;
  state: SaveState;
  /** Telt op als de inhoud van buitenaf vervangen werd (buffer, server, conflict): editor bijwerken. */
  revision: number;
}

export type SessionEvent =
  | { type: "restored" }
  | { type: "synced"; afterOffline: boolean }
  | { type: "conflict"; origin: ConflictOrigin };

export type SaveDraftFn = (input: SaveDraftInput) => Promise<Locked<Draft>>;

type ServerDraft = Pick<Draft, "css" | "lock_version" | "updated_at">;

/** De draft zoals hij nu op de server staat (bij een 412, om echte conflicten te herkennen). */
export type LoadDraftFn = (themeId: string) => Promise<ServerDraft>;

export interface DraftSessionOptions {
  themeId: string;
  /** De draft zoals de server hem gaf. */
  draft: ServerDraft;
  save: SaveDraftFn;
  /**
   * Serverdraft ophalen na een 412. Zonder `load` is elke 412 een conflict; met `load` neemt de
   * sessie een hogere lock stil over als de inhoud op de server niet veranderde.
   */
  load?: LoadDraftFn;
  buffer: DraftBuffer;
  /** Stilte na de laatste toets vóór opslaan (standaard 1 s). */
  delayMs?: number;
  /** Stilte vóór de lokale buffer bijgewerkt wordt (standaard 300 ms). */
  bufferDelayMs?: number;
  /** Pauzes tussen nieuwe pogingen als de server onbereikbaar is; de laatste herhaalt. */
  retryDelaysMs?: readonly number[];
  now?: () => Date;
}

export const AUTOSAVE_DELAY_MS = 1_000;
export const BUFFER_DELAY_MS = 300;
/** Opnieuw proberen na offline: snel na een korte onderbreking, daarna rustiger (max. 30 s). */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;
/** Zoveel keer na elkaar mag een 412 stil opgelost worden (daarna: conflict, geen lus). */
const MAX_LOCK_RECOVERIES = 3;

/** Server niet bereikbaar (in plaats van een inhoudelijke weigering). */
export function isUnreachable(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  if (!isApiError(error)) return false;
  if ([502, 503, 504].includes(error.status)) return true;
  // Een proxy (Vite, nginx) zonder backend geeft 500/502 zonder Problem-body.
  return error.status >= 500 && error.problem === null;
}

type Timer = ReturnType<typeof setTimeout>;

export class DraftSession {
  private snap: SessionSnapshot;
  private savedAt: string | null;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: SessionEvent) => void>();
  private saveTimer: Timer | null = null;
  private bufferTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private retryAttempt = 0;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private wasOffline = false;
  private buffered = false;
  private disposed = false;
  private lockRecoveries = 0;
  private readonly options: Required<Omit<DraftSessionOptions, "draft" | "load">> &
    Pick<DraftSessionOptions, "load">;

  constructor({ draft, ...options }: DraftSessionOptions) {
    this.options = {
      delayMs: AUTOSAVE_DELAY_MS,
      bufferDelayMs: BUFFER_DELAY_MS,
      retryDelaysMs: RETRY_DELAYS_MS,
      now: () => new Date(),
      ...options,
    };
    this.savedAt = draft.updated_at;
    this.snap = {
      themeId: options.themeId,
      css: draft.css,
      savedCss: draft.css,
      lockVersion: draft.lock_version,
      dirty: false,
      state: { kind: "saved", at: draft.updated_at },
      revision: 0,
    };
  }

  // --- lezen / luisteren ------------------------------------------------------------------------

  get themeId(): string {
    return this.options.themeId;
  }

  getSnapshot = (): SessionSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Gebeurtenissen voor meldingen (hersteld uit buffer, weer gesynchroniseerd, conflict). */
  onEvent(listener: (event: SessionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // --- acties -----------------------------------------------------------------------------------

  /** Andere opslagfunctie (de editor geeft die van zijn eigen mutatie-hook mee). */
  setSave(save: SaveDraftFn): void {
    this.options.save = save;
  }

  /** Nieuwe inhoud uit de editor. */
  edit(css: string): void {
    if (this.disposed || css === this.snap.css) return;
    const dirty = css !== this.snap.savedCss;
    const kind = this.snap.state.kind;
    let state = this.snap.state;
    if (kind === "conflict" || kind === "offline") {
      // Blijft zo: de tekst gaat naar de buffer, opslaan wacht op een keuze of de server.
    } else if (!dirty) {
      state = this.inFlight ? { kind: "saving" } : { kind: "saved", at: this.savedAt };
    } else if (!this.inFlight) {
      state = { kind: "pending" };
    }
    this.update({ css, dirty, state });

    if (!dirty) {
      this.clearSaveTimer();
      if (kind !== "conflict" && kind !== "offline") this.dropBuffer();
      return;
    }
    this.scheduleBuffer();
    if (kind !== "conflict" && kind !== "offline") this.scheduleSave(this.options.delayMs);
  }

  /** Nu opslaan (vóór publiceren, bij wisselen of sluiten van een tab). */
  async flush(): Promise<SessionSnapshot> {
    this.clearSaveTimer();
    if (this.inFlight) await this.inFlight;
    const kind = this.snap.state.kind;
    if (this.snap.dirty && kind !== "conflict") await this.runSave();
    return this.snap;
  }

  /** Server weer proberen (online-event, tabblad zichtbaar). Alleen in de toestand offline. */
  retryNow(): void {
    if (this.disposed || this.snap.state.kind !== "offline") return;
    this.clearRetryTimer();
    void this.runSave();
  }

  /**
   * Lokale buffer na het openen: dezelfde basisversie → terugzetten en opslaan; een oudere
   * basisversie → conflict (de gebruiker kiest); gelijk aan de server → buffer weg.
   */
  async restoreFromBuffer(): Promise<"none" | "restored" | "conflict" | "discarded"> {
    const entry = await this.options.buffer.get(this.themeId);
    if (!entry || this.disposed) return "none";
    if (entry.css === this.snap.savedCss) {
      await this.options.buffer.delete(this.themeId);
      return "discarded";
    }
    // De sessie heeft al nieuwere eigen edits (bv. tab opnieuw geopend): die gaan voor.
    if (this.snap.dirty) return "none";
    this.buffered = true;
    if (entry.baseLockVersion === this.snap.lockVersion) {
      this.update({
        css: entry.css,
        dirty: true,
        state: { kind: "pending" },
        revision: this.snap.revision + 1,
      });
      this.emit({ type: "restored" });
      this.scheduleSave(0);
      return "restored";
    }
    this.update({
      css: entry.css,
      dirty: true,
      state: { kind: "conflict", current: null, origin: "restore" },
      revision: this.snap.revision + 1,
    });
    this.emit({ type: "conflict", origin: "restore" });
    return "conflict";
  }

  /**
   * Een nieuwere draft van de server (rollback, draft-reset, andere tab) overnemen, maar alleen
   * als er geen eigen niet-opgeslagen wijzigingen zijn. Geeft `true` als de inhoud overgenomen is.
   */
  adoptServerDraft(draft: Pick<Draft, "css" | "lock_version" | "updated_at">): boolean {
    if (this.disposed || draft.lock_version <= this.snap.lockVersion) return false;
    if (this.snap.dirty || this.inFlight || this.snap.state.kind === "conflict") return false;
    this.savedAt = draft.updated_at;
    this.update({
      css: draft.css,
      savedCss: draft.css,
      lockVersion: draft.lock_version,
      dirty: false,
      state: { kind: "saved", at: draft.updated_at },
      revision: draft.css === this.snap.css ? this.snap.revision : this.snap.revision + 1,
    });
    return true;
  }

  /** Conflict oplossen met "herladen": de serverversie wint, lokale wijzigingen vervallen. */
  replaceWithServer(draft: Pick<Draft, "css" | "lock_version" | "updated_at">): void {
    if (this.disposed) return;
    this.clearTimers();
    this.savedAt = draft.updated_at;
    this.update({
      css: draft.css,
      savedCss: draft.css,
      lockVersion: draft.lock_version,
      dirty: false,
      state: { kind: "saved", at: draft.updated_at },
      revision: this.snap.revision + 1,
    });
    this.dropBuffer();
  }

  /** Conflict oplossen met "mijn versie overschrijven": opslaan met de huidige serverlock. */
  async overwrite(serverLockVersion: number): Promise<SessionSnapshot> {
    if (this.disposed) return this.snap;
    this.clearTimers();
    if (this.inFlight) await this.inFlight;
    this.update({
      lockVersion: serverLockVersion,
      dirty: this.snap.css !== this.snap.savedCss || serverLockVersion !== this.snap.lockVersion,
      state: { kind: "pending" },
    });
    // Ook als de tekst gelijk lijkt: de server heeft iets anders, dus altijd versturen.
    await this.runSave(true);
    return this.snap;
  }

  /** Conflict van buitenaf (bv. publiceren gaf 412). */
  markConflict(current: EtagState | null, origin: ConflictOrigin): void {
    if (this.disposed) return;
    this.clearSaveTimer();
    this.update({ state: { kind: "conflict", current, origin } });
    if (this.snap.dirty) void this.writeBuffer();
    this.emit({ type: "conflict", origin });
  }

  /** Nieuwe lock na een actie die de inhoud niet wijzigt (publiceren). */
  setLockVersion(lockVersion: number): void {
    if (this.disposed || lockVersion <= this.snap.lockVersion) return;
    this.lockRecoveries = 0;
    this.update({ lockVersion });
  }

  /**
   * Na een 412 van buitenaf (bv. publiceren): haalt de serverdraft op en neemt de hogere lock
   * over als de inhoud gelijk is aan wat wij als opgeslagen kennen (alleen de lock schoof op,
   * bv. na verwijderen + herstellen). Geeft `true` als de actie met de nieuwe lock opnieuw kan.
   */
  async refreshLock(): Promise<boolean> {
    if (this.disposed || this.inFlight || this.snap.state.kind === "conflict") return false;
    return this.adoptUnchangedLock(this.snap.lockVersion);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.listeners.clear();
    this.eventListeners.clear();
  }

  // --- intern -----------------------------------------------------------------------------------

  private update(patch: Partial<SessionSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private emit(event: SessionEvent): void {
    for (const listener of [...this.eventListeners]) listener(event);
  }

  private scheduleSave(delay: number): void {
    this.clearSaveTimer();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.runSave();
    }, delay);
  }

  private scheduleBuffer(): void {
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = setTimeout(() => {
      this.bufferTimer = null;
      if (this.snap.dirty) void this.writeBuffer();
    }, this.options.bufferDelayMs);
  }

  private async writeBuffer(): Promise<void> {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
    this.buffered = true;
    try {
      await this.options.buffer.set({
        themeId: this.themeId,
        css: this.snap.css,
        baseLockVersion: this.snap.lockVersion,
        savedAt: this.options.now().toISOString(),
      });
    } catch {
      // De buffer vangt zelf fouten op; dit is een laatste vangnet.
    }
  }

  private dropBuffer(): void {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
    if (!this.buffered) return;
    this.buffered = false;
    void this.options.buffer.delete(this.themeId).catch(() => undefined);
  }

  private async runSave(force = false): Promise<void> {
    this.clearSaveTimer();
    if (this.disposed) return;
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const { css, savedCss, lockVersion, state } = this.snap;
    if (state.kind === "conflict") return;
    if (css === savedCss && !force) {
      if (state.kind !== "saved") this.update({ state: { kind: "saved", at: this.savedAt } });
      this.dropBuffer();
      return;
    }
    this.update({ state: { kind: "saving" } });
    void this.writeBuffer();
    const request = this.options
      .save({ themeId: this.themeId, css, lockVersion })
      .then(
        (result) => this.onSaved(css, result),
        (error: unknown) => this.onSaveError(error, lockVersion),
      )
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = request;
    await request;
    if (this.again && !this.disposed) {
      this.again = false;
      const kind = this.snap.state.kind;
      if (this.snap.dirty && (kind === "pending" || kind === "saving")) await this.runSave();
    }
  }

  private onSaved(sentCss: string, result: Locked<Draft>): void {
    if (this.disposed) return;
    this.clearRetryTimer();
    this.retryAttempt = 0;
    this.lockRecoveries = 0;
    this.savedAt = result.data.updated_at;
    const dirty = this.snap.css !== sentCss;
    this.update({
      savedCss: sentCss,
      lockVersion: Math.max(result.lockVersion, this.snap.lockVersion),
      dirty,
      state: dirty ? { kind: "pending" } : { kind: "saved", at: result.data.updated_at },
    });
    const afterOffline = this.wasOffline;
    this.wasOffline = false;
    if (dirty) {
      // Tijdens het opslaan verder getypt: die wijzigingen volgen na de gewone pauze.
      if (!this.saveTimer) this.scheduleSave(this.options.delayMs);
    } else {
      this.dropBuffer();
    }
    this.emit({ type: "synced", afterOffline });
  }

  private async onSaveError(error: unknown, sentLock: number): Promise<void> {
    if (this.disposed) return;
    if (isApiError(error) && error.status === 412) {
      if (await this.adoptUnchangedLock(sentLock)) {
        // Alleen de lock schoof op: meteen opnieuw opslaan (runSave pikt `again` op).
        this.again = true;
        return;
      }
      if (this.disposed) return;
      this.clearSaveTimer();
      this.update({ state: { kind: "conflict", current: error.current, origin: "save" } });
      void this.writeBuffer();
      this.emit({ type: "conflict", origin: "save" });
      return;
    }
    if (isUnreachable(error)) {
      this.clearSaveTimer();
      this.wasOffline = true;
      const since =
        this.snap.state.kind === "offline"
          ? this.snap.state.since
          : this.options.now().toISOString();
      this.update({ state: { kind: "offline", since } });
      void this.writeBuffer();
      this.scheduleRetry();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.update({
      state: {
        kind: "error",
        code: isApiError(error) ? error.code : "unknown",
        status: isApiError(error) ? error.status : 0,
        message,
        fromServer: isApiError(error) && error.problem !== null,
      },
    });
    void this.writeBuffer();
  }

  /**
   * Serverdraft ophalen; staat daar nog de inhoud die wij als opgeslagen kennen (alleen de lock
   * is hoger dan `sentLock`), dan die lock overnemen. Begrensd, zodat een server die de lock
   * blijft verhogen geen eindeloze lus geeft.
   */
  private async adoptUnchangedLock(sentLock: number): Promise<boolean> {
    const load = this.options.load;
    if (!load || this.lockRecoveries >= MAX_LOCK_RECOVERIES) return false;
    this.lockRecoveries += 1;
    let server: ServerDraft;
    try {
      server = await load(this.themeId);
    } catch {
      return false;
    }
    if (this.disposed || server.css !== this.snap.savedCss || server.lock_version <= sentLock) {
      return false;
    }
    if (server.lock_version > this.snap.lockVersion)
      this.update({ lockVersion: server.lock_version });
    return true;
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    const delays = this.options.retryDelaysMs;
    const delay = delays[Math.min(this.retryAttempt, delays.length - 1)] ?? 30_000;
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.runSave();
    }, delay);
  }

  private clearSaveTimer(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearTimers(): void {
    this.clearSaveTimer();
    this.clearRetryTimer();
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = null;
  }
}
