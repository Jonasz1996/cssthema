import { describe, expect, it, vi } from "vitest";
import { centerOf, FX_CANVAS_ID, FX_FLASH_ID, FxEngine, SHAKE_TARGET_ID } from "@/lib/fx";
import { mockAnimationFrames, mockCanvasContext, setReducedMotion } from "../helpers";

function element(rect = { x: 100, y: 200, width: 40, height: 20 }): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect(rect));
  return el;
}

function shakeTarget(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.id = SHAKE_TARGET_ID;
  document.body.append(wrap);
  return wrap;
}

describe("fx bij prefers-reduced-motion", () => {
  it("doet niets: geen canvas, geen flits, geen frames, geen klassen", async () => {
    setReducedMotion(true);
    const frames = mockAnimationFrames();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    const engine = new FxEngine();
    const wrap = shakeTarget();
    const el = element();

    engine.bolt(10, 10);
    engine.sparkle(10, 10);
    engine.explode(10, 10, 2);
    engine.flash("red");
    engine.shake();
    engine.publish(el);
    engine.rollback({ x: 1, y: 2 });
    await engine.zap(el);
    await engine.remove(el);

    expect(document.getElementById(FX_CANVAS_ID)).toBeNull();
    expect(document.getElementById(FX_FLASH_ID)).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(0);
    expect(engine.activeCount).toBe(0);
    expect(wrap.className).toBe("");
    expect(el.className).toBe("");
    wrap.remove();
    el.remove();
  });
});

describe("fx met animaties", () => {
  it("maakt bij het eerste effect één canvas #fx-top en speelt af tot alles weg is", () => {
    const frames = mockAnimationFrames();
    const { calls } = mockCanvasContext();
    const engine = new FxEngine();

    engine.bolt(300, 400);
    engine.sparkle(300, 400);
    engine.explode(300, 400, 1);
    const canvas = document.getElementById(FX_CANVAS_ID) as HTMLCanvasElement;
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas.style.pointerEvents).toBe("none");
    expect(document.querySelectorAll(`#${FX_CANVAS_ID}`)).toHaveLength(1);
    expect(engine.activeCount).toBeGreaterThan(0);
    expect(engine.isRunning).toBe(true);
    // Eén lus, ook bij meerdere effecten.
    expect(frames.pending()).toBe(1);

    const played = frames.flushAll();
    expect(played).toBeGreaterThan(5);
    expect(played).toBeLessThan(500);
    expect(engine.activeCount).toBe(0);
    expect(engine.isRunning).toBe(false);
    expect(calls).toContain("stroke");
    expect(calls).toContain("createRadialGradient");
    expect(calls.at(-1)).toBe("clearRect");
  });

  it("doet niets als de browser geen 2D-canvas heeft", () => {
    const frames = mockAnimationFrames();
    const engine = new FxEngine();
    engine.bolt(1, 1);
    expect(engine.activeCount).toBe(0);
    expect(frames.pending()).toBe(0);
  });

  it("flash zet een laag #fx-flash en laat die uitfaden", () => {
    const frames = mockAnimationFrames();
    const engine = new FxEngine();
    engine.flash("rgba(190,220,255,.8)");
    const layer = document.getElementById(FX_FLASH_ID) as HTMLElement;
    expect(layer.style.opacity).toBe("1");
    expect(layer.style.background).toContain("rgba(190, 220, 255");
    frames.flush();
    frames.flush();
    expect(layer.style.opacity).toBe("0");
    expect(layer.style.transition).toContain("opacity");
  });

  it("shake laat de app-wrapper (of een gegeven element) even schudden", () => {
    vi.useFakeTimers();
    const engine = new FxEngine();
    const wrap = shakeTarget();
    engine.shake();
    expect(wrap).toHaveClass("ui-shake");
    vi.advanceTimersByTime(450);
    expect(wrap).not.toHaveClass("ui-shake");
    const other = element();
    engine.shake(other);
    expect(other).toHaveClass("ui-shake");
    wrap.remove();
    other.remove();
  });

  it("zap resolvet na de animatie en unzap maakt het ongedaan", async () => {
    vi.useFakeTimers();
    const engine = new FxEngine();
    const el = element();
    const done = vi.fn();
    void engine.zap(el).then(done);
    expect(el).toHaveClass("ui-zap");
    await vi.advanceTimersByTimeAsync(299);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledOnce();
    engine.unzap(el);
    expect(el).not.toHaveClass("ui-zap");
    el.remove();
  });

  it("remove = bliksem + flits, dan shake + vonken + zap", async () => {
    vi.useFakeTimers();
    mockAnimationFrames();
    mockCanvasContext();
    const engine = new FxEngine();
    const wrap = shakeTarget();
    const el = element();
    const bolt = vi.spyOn(engine, "bolt");
    const sparkle = vi.spyOn(engine, "sparkle");
    const done = vi.fn();

    void engine.remove(el).then(done);
    expect(bolt).toHaveBeenCalledWith(120, 210);
    expect(document.getElementById(FX_FLASH_ID)).not.toBeNull();
    expect(wrap).not.toHaveClass("ui-shake");

    await vi.advanceTimersByTimeAsync(170);
    expect(wrap).toHaveClass("ui-shake");
    expect(sparkle).toHaveBeenCalledWith(120, 210);
    expect(el).toHaveClass("ui-zap");
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toHaveBeenCalledOnce();
    wrap.remove();
    el.remove();
  });

  it("publish = vonken + kleine explosie, rollback = blauwe vonken", () => {
    mockAnimationFrames();
    mockCanvasContext();
    const engine = new FxEngine();
    const sparkle = vi.spyOn(engine, "sparkle");
    const explode = vi.spyOn(engine, "explode");
    engine.publish(element());
    expect(sparkle).toHaveBeenCalledWith(120, 210);
    expect(explode).toHaveBeenCalledWith(120, 210, 0.6);
    sparkle.mockClear();
    explode.mockClear();
    engine.rollback({ x: 5, y: 6 });
    expect(sparkle).toHaveBeenCalledWith(5, 6);
    expect(explode).not.toHaveBeenCalled();
  });

  it("clear stopt de lus en wist alles", () => {
    const frames = mockAnimationFrames();
    mockCanvasContext();
    const engine = new FxEngine();
    engine.explode(1, 1);
    engine.clear();
    expect(engine.activeCount).toBe(0);
    expect(engine.isRunning).toBe(false);
    expect(frames.pending()).toBe(0);
  });
});

describe("centerOf()", () => {
  it("geeft het midden van een element of het punt zelf", () => {
    const el = element({ x: 10, y: 20, width: 100, height: 50 });
    expect(centerOf(el)).toEqual({ x: 60, y: 45 });
    expect(centerOf({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    el.remove();
  });
});
