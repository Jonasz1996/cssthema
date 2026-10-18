import { vi } from "vitest";

/**
 * Hulpmiddelen voor tests in jsdom: een bestuurbare `matchMedia` (reduced motion), een nep
 * 2D-canvascontext en een handmatige `requestAnimationFrame`-wachtrij.
 */

let reducedMotion = false;
const mediaListeners = new Set<() => void>();

/** Zet `prefers-reduced-motion: reduce` aan/uit en verwittig luisteraars. */
export function setReducedMotion(value: boolean): void {
  reducedMotion = value;
  for (const listener of mediaListeners) listener();
}

export function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        media: query,
        get matches() {
          return query.includes("prefers-reduced-motion") ? reducedMotion : false;
        },
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          mediaListeners.delete(listener),
        addListener: (listener: () => void) => mediaListeners.add(listener),
        removeListener: (listener: () => void) => mediaListeners.delete(listener),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

export interface FakeContext {
  ctx: CanvasRenderingContext2D;
  /** Namen van alle aangeroepen methodes, in volgorde. */
  calls: string[];
}

/** Nep-`CanvasRenderingContext2D`: elke methode wordt gelogd, eigenschappen zijn schrijfbaar. */
export function fakeContext(): FakeContext {
  const calls: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "createRadialGradient" || prop === "createLinearGradient") {
        return () => {
          calls.push(String(prop));
          return { addColorStop: () => {} };
        };
      }
      return () => {
        calls.push(String(prop));
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** Laat `getContext("2d")` een nepcontext teruggeven (tot `vi.restoreAllMocks()`). */
export function mockCanvasContext(): FakeContext {
  const fake = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => fake.ctx as unknown as RenderingContext,
  );
  return fake;
}

export interface FrameQueue {
  /** Aantal wachtende frames. */
  pending: () => number;
  /** Voert de wachtende callbacks uit (één "frame"); geeft het aantal uitgevoerde terug. */
  flush: () => number;
  /** Frames afspelen tot er niets meer wacht (met een veiligheidsgrens). */
  flushAll: (limit?: number) => number;
}

/** Vervangt `requestAnimationFrame`/`cancelAnimationFrame` door een handmatige wachtrij. */
export function mockAnimationFrames(): FrameQueue {
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue.delete(id);
  });
  const flush = () => {
    const batch = [...queue.entries()];
    queue.clear();
    for (const [, cb] of batch) cb(performance.now());
    return batch.length;
  };
  return {
    pending: () => queue.size,
    flush,
    flushAll: (limit = 500) => {
      let frames = 0;
      while (queue.size && frames < limit) {
        flush();
        frames++;
      }
      return frames;
    },
  };
}

/** Zet `document.hidden` en stuurt `visibilitychange`. */
export function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}
