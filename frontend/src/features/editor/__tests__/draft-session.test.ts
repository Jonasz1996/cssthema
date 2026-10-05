import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NETWORK_ERROR } from "@/api/client";
import { makeDraft } from "@/api/testing/fixtures";
import type { Draft, Locked } from "@/api/types";
import { createMemoryBuffer } from "../autosave/buffer";
import {
  DraftSession,
  isUnreachable,
  type LoadDraftFn,
  type SaveDraftFn,
  type SessionEvent,
} from "../autosave/draft-session";
import { closeSession, ensureSession, peekSession, resetSessions } from "../autosave/sessions";

const SERVER_TIME = "2026-10-05T10:00:00Z";

function locked(
  css: string,
  lockVersion: number,
  updatedAt = "2026-10-05T10:05:00Z",
): Locked<Draft> {
  return {
    data: makeDraft({ css, lock_version: lockVersion, updated_at: updatedAt }),
    etag: `"lv-${lockVersion}"`,
    lockVersion,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const conflictError = () =>
  new ApiError({
    status: 412,
    code: "precondition_failed",
    title: "Gewijzigd",
    current: { etag: '"lv-9"', lock_version: 9, updated_by: null, updated_at: SERVER_TIME },
  });
const networkError = () =>
  new ApiError({ status: 0, code: NETWORK_ERROR, title: "Geen verbinding" });
const tooLarge = () =>
  new ApiError({
    status: 413,
    code: "payload_too_large",
    title: "Te groot",
    detail: "CSS is te groot",
  });

function setup({
  css = "a{}",
  lockVersion = 3,
  load,
}: { css?: string; lockVersion?: number; load?: LoadDraftFn } = {}) {
  const buffer = createMemoryBuffer();
  const save = vi.fn<SaveDraftFn>();
  const session = new DraftSession({
    themeId: "t1",
    draft: { css, lock_version: lockVersion, updated_at: SERVER_TIME },
    save,
    load,
    buffer,
    retryDelaysMs: [1000, 5000],
    now: () => new Date("2026-10-05T12:00:00Z"),
  });
  const kinds: string[] = [];
  session.subscribe(() => {
    const kind = session.getSnapshot().state.kind;
    if (kinds.at(-1) !== kind) kinds.push(kind);
  });
  const events: SessionEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { session, save, buffer, kinds, events };
}

describe("DraftSession (autosave)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts as saved with the server time", () => {
    const { session } = setup();
    expect(session.getSnapshot()).toMatchObject({
      css: "a{}",
      savedCss: "a{}",
      lockVersion: 3,
      dirty: false,
      state: { kind: "saved", at: SERVER_TIME },
    });
  });

  it("debounces: saves once, 1 s after the last key, with the lock version", async () => {
    const { session, save, kinds } = setup();
    save.mockResolvedValue(locked("a{color:red}", 4));
    session.edit("a{c");
    await vi.advanceTimersByTimeAsync(600);
    session.edit("a{color:red}");
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    expect(session.getSnapshot().state.kind).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ themeId: "t1", css: "a{color:red}", lockVersion: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({
      dirty: false,
      lockVersion: 4,
      savedCss: "a{color:red}",
      state: { kind: "saved", at: "2026-10-05T10:05:00Z" },
    });
    expect(kinds).toEqual(["pending", "saving", "saved"]);
  });

  it("typing back to the saved text cancels the pending save", async () => {
    const { session, save } = setup();
    session.edit("a{x}");
    session.edit("a{}");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(session.getSnapshot().state.kind).toBe("saved");
  });

  it("keeps typing during a save: saves the rest afterwards with the new lock", async () => {
    const { session, save } = setup();
    const first = deferred<Locked<Draft>>();
    save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(locked("a{2}", 5));
    session.edit("a{1}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().state.kind).toBe("saving");
    session.edit("a{2}");
    first.resolve(locked("a{1}", 4));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ dirty: true, lockVersion: 4, savedCss: "a{1}" });
    expect(session.getSnapshot().state.kind).toBe("pending");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenLastCalledWith({ themeId: "t1", css: "a{2}", lockVersion: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ dirty: false, lockVersion: 5 });
  });

  it("flush() saves immediately (before publishing)", async () => {
    const { session, save } = setup();
    save.mockResolvedValue(locked("a{1}", 4));
    session.edit("a{1}");
    const snapshot = await session.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(snapshot.state.kind).toBe("saved");
  });

  it("412 → conflict: stops saving, keeps the text, buffers it and emits an event", async () => {
    const { session, save, buffer, events } = setup();
    save.mockRejectedValue(conflictError());
    session.edit("a{mine}");
    await vi.advanceTimersByTimeAsync(1000);
    const state = session.getSnapshot().state;
    expect(state).toMatchObject({ kind: "conflict", origin: "save" });
    expect(state.kind === "conflict" && state.current?.lock_version).toBe(9);
    expect(events).toContainEqual({ type: "conflict", origin: "save" });
    expect(buffer.entries.get("t1")).toMatchObject({ css: "a{mine}", baseLockVersion: 3 });
    // Verder typen in conflict: geen nieuwe saves, wel de buffer bijwerken.
    session.edit("a{mine2}");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().state.kind).toBe("conflict");
    expect(buffer.entries.get("t1")?.css).toBe("a{mine2}");
  });

  it("conflict → overwrite: saves my text with the server's lock", async () => {
    const { session, save, buffer } = setup();
    save.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(locked("a{mine}", 10));
    session.edit("a{mine}");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await session.overwrite(9);
    expect(save).toHaveBeenLastCalledWith({ themeId: "t1", css: "a{mine}", lockVersion: 9 });
    expect(result).toMatchObject({ dirty: false, lockVersion: 10, state: { kind: "saved" } });
    expect(buffer.entries.has("t1")).toBe(false);
  });

  it("conflict → reload: the server version wins and the buffer is dropped", async () => {
    const { session, save, buffer } = setup();
    save.mockRejectedValue(conflictError());
    session.edit("a{mine}");
    await vi.advanceTimersByTimeAsync(1000);
    const before = session.getSnapshot().revision;
    session.replaceWithServer({ css: "a{theirs}", lock_version: 9, updated_at: SERVER_TIME });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({
      css: "a{theirs}",
      savedCss: "a{theirs}",
      lockVersion: 9,
      dirty: false,
      state: { kind: "saved" },
    });
    expect(session.getSnapshot().revision).toBe(before + 1);
    expect(buffer.entries.has("t1")).toBe(false);
  });

  it("offline: buffers, retries with backoff and reports 'synced after offline'", async () => {
    const { session, save, buffer, events } = setup();
    save
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(locked("a{off}", 4));
    session.edit("a{off}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().state).toEqual({
      kind: "offline",
      since: "2026-10-05T12:00:00.000Z",
    });
    expect(buffer.entries.get("t1")).toMatchObject({ css: "a{off}", baseLockVersion: 3 });
    // Verder typen terwijl offline: blijft offline, geen extra save buiten de retry om.
    session.edit("a{off}2");
    session.edit("a{off}");
    await vi.advanceTimersByTimeAsync(999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // retry na 1 s
    expect(save).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().state.kind).toBe("offline");
    await vi.advanceTimersByTimeAsync(4999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // retry na 5 s
    expect(save).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().state.kind).toBe("saved");
    expect(buffer.entries.has("t1")).toBe(false);
    expect(events).toContainEqual({ type: "synced", afterOffline: true });
  });

  it("retryNow() (online event) retries at once, only when offline", async () => {
    const { session, save } = setup();
    save.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(locked("a{x}", 4));
    session.retryNow();
    expect(save).not.toHaveBeenCalled();
    session.edit("a{x}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().state.kind).toBe("offline");
    session.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().state.kind).toBe("saved");
  });

  it("other server errors → error state; the next edit tries again", async () => {
    const { session, save } = setup();
    save.mockRejectedValueOnce(tooLarge()).mockResolvedValueOnce(locked("a{small}", 4));
    session.edit("a{huge}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().state).toEqual({
      kind: "error",
      code: "payload_too_large",
      status: 413,
      message: "CSS is te groot",
      fromServer: false,
    });
    session.edit("a{small}");
    expect(session.getSnapshot().state.kind).toBe("pending");
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().state.kind).toBe("saved");
  });

  it("restoreFromBuffer: same base lock → restore and save", async () => {
    const { session, save, buffer, events } = setup();
    save.mockResolvedValue(locked("a{local}", 4));
    await buffer.set({ themeId: "t1", css: "a{local}", baseLockVersion: 3, savedAt: SERVER_TIME });
    await expect(session.restoreFromBuffer()).resolves.toBe("restored");
    expect(session.getSnapshot()).toMatchObject({ css: "a{local}", dirty: true, revision: 1 });
    expect(events).toContainEqual({ type: "restored" });
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledWith({ themeId: "t1", css: "a{local}", lockVersion: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().state.kind).toBe("saved");
    expect(buffer.entries.has("t1")).toBe(false);
  });

  it("restoreFromBuffer: older base lock → conflict (origin restore), nothing saved", async () => {
    const { session, save, buffer } = setup({ lockVersion: 5 });
    await buffer.set({
      themeId: "t1",
      css: "a{old-local}",
      baseLockVersion: 3,
      savedAt: SERVER_TIME,
    });
    await expect(session.restoreFromBuffer()).resolves.toBe("conflict");
    expect(session.getSnapshot().state).toMatchObject({ kind: "conflict", origin: "restore" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });

  it("restoreFromBuffer: identical to the server → buffer discarded; empty → none", async () => {
    const { session, buffer } = setup();
    await expect(session.restoreFromBuffer()).resolves.toBe("none");
    await buffer.set({ themeId: "t1", css: "a{}", baseLockVersion: 2, savedAt: SERVER_TIME });
    await expect(session.restoreFromBuffer()).resolves.toBe("discarded");
    expect(buffer.entries.has("t1")).toBe(false);
  });

  it("adoptServerDraft: takes a newer server draft only when clean", async () => {
    const { session } = setup();
    expect(
      session.adoptServerDraft({ css: "a{old}", lock_version: 3, updated_at: SERVER_TIME }),
    ).toBe(false);
    expect(
      session.adoptServerDraft({ css: "a{rolled-back}", lock_version: 6, updated_at: SERVER_TIME }),
    ).toBe(true);
    expect(session.getSnapshot()).toMatchObject({
      css: "a{rolled-back}",
      lockVersion: 6,
      revision: 1,
    });
    session.edit("a{dirty}");
    expect(
      session.adoptServerDraft({ css: "a{newer}", lock_version: 7, updated_at: SERVER_TIME }),
    ).toBe(false);
    expect(session.getSnapshot().css).toBe("a{dirty}");
  });

  it("markConflict (publish 412) and setLockVersion (after publish)", () => {
    const { session, events } = setup();
    session.setLockVersion(2);
    expect(session.getSnapshot().lockVersion).toBe(3);
    session.setLockVersion(4);
    expect(session.getSnapshot().lockVersion).toBe(4);
    session.markConflict(null, "publish");
    expect(session.getSnapshot().state).toEqual({
      kind: "conflict",
      current: null,
      origin: "publish",
    });
    expect(events).toContainEqual({ type: "conflict", origin: "publish" });
  });

  it("dispose() stops timers and listeners", async () => {
    const { session, save } = setup();
    const listener = vi.fn();
    session.subscribe(listener);
    session.edit("a{1}");
    listener.mockClear();
    session.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    session.edit("a{2}");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("isUnreachable", () => {
  it("treats network errors, gateway errors and body-less 5xx as offline", () => {
    expect(isUnreachable(networkError())).toBe(true);
    expect(isUnreachable(new ApiError({ status: 502, code: "http_502", title: "x" }))).toBe(true);
    expect(isUnreachable(new ApiError({ status: 503, code: "x", title: "x", problem: null }))).toBe(
      true,
    );
    expect(isUnreachable(new ApiError({ status: 500, code: "http_500", title: "x" }))).toBe(true);
  });

  it("does not treat real refusals as offline", () => {
    const problem = { type: "about:blank", title: "boom", status: 500, code: "internal_error" };
    expect(
      isUnreachable(new ApiError({ status: 500, code: "internal_error", title: "boom", problem })),
    ).toBe(false);
    expect(isUnreachable(conflictError())).toBe(false);
    expect(isUnreachable(tooLarge())).toBe(false);
    expect(isUnreachable(new Error("x"))).toBe(false);
  });
});

describe("DraftSession: a 412 that only bumped the lock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("412 with an unchanged server draft (lock bumped by delete + restore): silent retry", async () => {
    const load = vi.fn<LoadDraftFn>(async () => ({
      css: "a{}",
      lock_version: 9,
      updated_at: SERVER_TIME,
    }));
    const { session, save, kinds, events } = setup({ load });
    save.mockRejectedValueOnce(conflictError()).mockResolvedValueOnce(locked("a{mine}", 10));
    session.edit("a{mine}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledWith("t1");
    expect(save.mock.calls.map(([input]) => input.lockVersion)).toEqual([3, 9]);
    expect(session.getSnapshot()).toMatchObject({ lockVersion: 10, dirty: false });
    expect(session.getSnapshot().state.kind).toBe("saved");
    expect(kinds).not.toContain("conflict");
    expect(events.filter((event) => event.type === "conflict")).toEqual([]);
  });

  it("412 with a changed server draft stays a real conflict", async () => {
    const load = vi.fn<LoadDraftFn>(async () => ({
      css: "a{theirs}",
      lock_version: 9,
      updated_at: SERVER_TIME,
    }));
    const { session, save } = setup({ load });
    save.mockRejectedValueOnce(conflictError());
    session.edit("a{mine}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().state.kind).toBe("conflict");
    expect(session.getSnapshot().lockVersion).toBe(3);
  });

  it("stops recovering after a few 412s in a row (no endless loop)", async () => {
    let lock = 3;
    const load = vi.fn<LoadDraftFn>(async () => ({
      css: "a{}",
      lock_version: (lock += 1),
      updated_at: SERVER_TIME,
    }));
    const { session, save } = setup({ load });
    save.mockRejectedValue(conflictError());
    session.edit("a{mine}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(4);
    expect(session.getSnapshot().state.kind).toBe("conflict");
  });

  it("refreshLock() (publish 412) adopts a higher lock only for an unchanged draft", async () => {
    let server = { css: "a{}", lock_version: 7, updated_at: SERVER_TIME };
    const { session } = setup({ load: async () => server });
    await expect(session.refreshLock()).resolves.toBe(true);
    expect(session.getSnapshot().lockVersion).toBe(7);
    server = { css: "a{other}", lock_version: 8, updated_at: SERVER_TIME };
    await expect(session.refreshLock()).resolves.toBe(false);
    expect(session.getSnapshot().lockVersion).toBe(7);
    // Zonder `load` kan het niet.
    await expect(setup().session.refreshLock()).resolves.toBe(false);
  });
});

describe("sessions (open tabs)", () => {
  afterEach(() => resetSessions());

  it("closeSession keeps the session while it saves; a render meanwhile gets the same one back", async () => {
    const pending = deferred<Locked<Draft>>();
    const save = vi.fn<SaveDraftFn>(() => pending.promise);
    const draft = { css: "a{}", lock_version: 1, updated_at: SERVER_TIME };
    const buffer = createMemoryBuffer();
    const session = ensureSession("b", { draft, save, buffer });
    session.edit("a{typed}");
    const closing = closeSession("b");
    // Zoals een render die het thema nog toont: dezelfde sessie, geen nieuwe met lock 1.
    expect(peekSession("b")).toBe(session);
    expect(ensureSession("b", { draft, save, buffer })).toBe(session);
    pending.resolve(locked("a{typed}", 2));
    await closing;
    // Opnieuw opgevraagd tijdens het sluiten = heropend: de sessie blijft.
    expect(peekSession("b")).toBe(session);
    expect(session.getSnapshot()).toMatchObject({ lockVersion: 2, dirty: false });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("closeSession removes the session once it is saved", async () => {
    const save = vi.fn<SaveDraftFn>(async () => locked("a{typed}", 2));
    const draft = { css: "a{}", lock_version: 1, updated_at: SERVER_TIME };
    const session = ensureSession("c", { draft, save, buffer: createMemoryBuffer() });
    session.edit("a{typed}");
    await closeSession("c");
    expect(save).toHaveBeenCalledTimes(1);
    expect(peekSession("c")).toBeUndefined();
  });
});
