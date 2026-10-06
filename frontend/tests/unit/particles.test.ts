import { describe, expect, it } from "vitest";
import {
  createParticles,
  drawNetwork,
  NETWORK,
  type NetworkParticle,
  NO_POINTER,
  ParticleNetwork,
  particleCount,
  stepParticles,
} from "@/lib/particles";
import { fakeContext, mockAnimationFrames, mockCanvasContext, setDocumentHidden } from "../helpers";

/** Voorspelbare "random" voor tests. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

function particle(overrides: Partial<NetworkParticle> = {}): NetworkParticle {
  return { x: 50, y: 50, vx: 0, vy: 0, r: 1, ch: null, t: 0, ...overrides };
}

describe("particleCount()", () => {
  it("is één per 14.000 px² met een maximum van 110", () => {
    expect(particleCount(390, 844)).toBe(Math.floor((390 * 844) / 14_000));
    expect(particleCount(1280, 900)).toBe(82);
    expect(particleCount(1920, 1080)).toBe(NETWORK.maxParticles);
    expect(particleCount(0, 900)).toBe(0);
    expect(particleCount(-5, 900)).toBe(0);
  });
});

describe("createParticles()", () => {
  it("maakt het juiste aantal binnen het scherm met elk vierde een 0/1-teken", () => {
    const list = createParticles(1280, 900, sequence(0.1, 0.9, 0.3, 0.7, 0.5));
    expect(list).toHaveLength(82);
    for (const p of list) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1280);
      expect(Math.abs(p.vx)).toBeLessThanOrEqual(0.175);
    }
    list.forEach((p, i) => {
      if (i % 4 === 0) expect(["0", "1"]).toContain(p.ch);
      else expect(p.ch).toBeNull();
    });
  });
});

describe("stepParticles()", () => {
  it("beweegt en kaatst terug aan de randen", () => {
    const p = particle({ x: 99.9, y: 10, vx: 0.3, vy: -0.1 });
    stepParticles([p], 100, 100, NO_POINTER);
    expect(p.x).toBeCloseTo(100.2);
    expect(p.vx).toBe(-0.3);
    expect(p.vy).toBe(-0.1);
  });

  it("duwt deeltjes binnen 130 px van de muis weg", () => {
    const near = particle({ x: 60, y: 50 });
    const far = particle({ x: 300, y: 50 });
    stepParticles([near, far], 1000, 1000, { x: 50, y: 50 });
    expect(near.x).toBeCloseTo(60 + NETWORK.repelStep);
    expect(near.y).toBe(50);
    expect(far.x).toBe(300);
  });

  it("deelt niet door nul als de muis precies op een deeltje staat", () => {
    const p = particle({ x: 50, y: 50 });
    stepParticles([p], 100, 100, { x: 50, y: 50 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it("wisselt het teken na 120 frames", () => {
    const p = particle({ ch: "0", t: NETWORK.glyphSwapFrames });
    stepParticles([p], 100, 100, NO_POINTER, () => 0.9);
    expect(p.ch).toBe("1");
    expect(p.t).toBe(0);
  });
});

describe("drawNetwork()", () => {
  it("tekent lijnen tussen buren (< 120 px) en naar de muis (< 170 px)", () => {
    const { ctx, calls } = fakeContext();
    const a = particle({ x: 0, y: 0 });
    const b = particle({ x: 100, y: 0 });
    const c = particle({ x: 500, y: 500, ch: "1" });
    drawNetwork(ctx, [a, b, c], 1000, 1000, null);
    expect(calls.filter((n) => n === "stroke")).toHaveLength(1);
    expect(calls).toContain("fillText");

    const withPointer = fakeContext();
    drawNetwork(withPointer.ctx, [a, b, c], 1000, 1000, { x: 50, y: 10 });
    // a–b plus a→muis en b→muis
    expect(withPointer.calls.filter((n) => n === "stroke")).toHaveLength(3);
  });
});

describe("ParticleNetwork", () => {
  function setup() {
    const frames = mockAnimationFrames();
    const fake = mockCanvasContext();
    const canvas = document.createElement("canvas");
    const network = new ParticleNetwork(canvas, { random: sequence(0.2, 0.6, 0.4, 0.8) });
    return { frames, fake, canvas, network };
  }

  it("animeert alleen in running", () => {
    const { frames, network } = setup();
    expect(network.particleCount).toBe(particleCount(window.innerWidth, window.innerHeight));
    network.setMode("running");
    expect(network.isAnimating).toBe(true);
    frames.flush();
    expect(frames.pending()).toBe(1);
    network.destroy();
  });

  it("tekent in paused één stilstaand beeld zonder lus", () => {
    const { frames, fake, network } = setup();
    network.setMode("paused");
    expect(network.isAnimating).toBe(false);
    expect(frames.pending()).toBe(0);
    expect(fake.calls).toContain("arc");
    network.destroy();
  });

  it("wist alles in off", () => {
    const { frames, fake, network } = setup();
    network.setMode("running");
    fake.calls.length = 0;
    network.setMode("off");
    expect(network.isAnimating).toBe(false);
    expect(frames.pending()).toBe(0);
    expect(fake.calls).toEqual(["clearRect"]);
    network.destroy();
  });

  it("pauzeert als het tabblad verborgen is en hervat daarna", () => {
    const { frames, network } = setup();
    network.setMode("running");
    setDocumentHidden(true);
    expect(network.isAnimating).toBe(false);
    expect(frames.pending()).toBe(0);
    setDocumentHidden(false);
    expect(network.isAnimating).toBe(true);
    network.destroy();
  });

  it("start niet in running zolang het tabblad verborgen is", () => {
    const { network } = setup();
    setDocumentHidden(true);
    network.setMode("running");
    expect(network.isAnimating).toBe(false);
    network.destroy();
  });

  it("hervat een gepauzeerd netwerk niet bij zichtbaar worden", () => {
    const { network } = setup();
    network.setMode("paused");
    setDocumentHidden(true);
    setDocumentHidden(false);
    expect(network.isAnimating).toBe(false);
    network.destroy();
  });

  it("stopt en luistert niet meer na destroy", () => {
    const { frames, network } = setup();
    network.setMode("running");
    network.destroy();
    expect(frames.pending()).toBe(0);
    setDocumentHidden(true);
    setDocumentHidden(false);
    expect(frames.pending()).toBe(0);
  });

  it("maakt de deeltjes opnieuw bij resize", () => {
    const { canvas, network } = setup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    window.dispatchEvent(new Event("resize"));
    expect(network.particleCount).toBe(particleCount(390, 844));
    expect(canvas.width).toBe(390 * Math.min(window.devicePixelRatio || 1, 2));
    network.destroy();
  });

  it("werkt zonder canvascontext (geen fouten, geen lus)", () => {
    const frames = mockAnimationFrames();
    const network = new ParticleNetwork(document.createElement("canvas"));
    network.setMode("running");
    expect(frames.pending()).toBe(0);
    network.destroy();
  });
});
