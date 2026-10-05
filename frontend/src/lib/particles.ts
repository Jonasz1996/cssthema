/**
 * Deeltjesnetwerk op de achtergrond (zoals aiverslag): stippen en `0`/`1`-tekens die langzaam
 * bewegen, lijnen tussen buren, lijnen naar de muis, en de muis duwt deeltjes weg.
 *
 * De rekenfuncties zijn puur (testbaar zonder canvas); `ParticleNetwork` koppelt ze aan een
 * canvas en regelt de lus: draait alleen in modus `running` en zolang het tabblad zichtbaar
 * is, tekent één stilstaand beeld in `paused` (editor: Monaco krijgt de CPU) en is leeg in `off`.
 */

export interface NetworkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Teken in plaats van een stip, of `null` voor een stip. */
  ch: "0" | "1" | null;
  /** Frameteller voor het wisselen van het teken. */
  t: number;
}

export interface Pointer {
  x: number;
  y: number;
}

export type NetworkMode = "running" | "paused" | "off";

export const NETWORK = {
  maxParticles: 110,
  areaPerParticle: 14_000,
  linkDistance: 120,
  pointerLinkDistance: 170,
  repelDistance: 130,
  repelStep: 1.2,
  glyphEvery: 4,
  glyphSwapFrames: 120,
} as const;

/** Muis buiten beeld: geen lijnen, geen afstoting. */
export const NO_POINTER: Pointer = { x: -999, y: -999 };

type Random = () => number;

/** Aantal deeltjes voor een viewport: één per 14.000 px², maximaal 110. */
export function particleCount(width: number, height: number): number {
  const n = Math.floor((Math.max(0, width) * Math.max(0, height)) / NETWORK.areaPerParticle);
  return Math.min(NETWORK.maxParticles, n);
}

export function createParticles(
  width: number,
  height: number,
  random: Random = Math.random,
): NetworkParticle[] {
  return Array.from({ length: particleCount(width, height) }, (_, i) => ({
    x: random() * width,
    y: random() * height,
    vx: (random() - 0.5) * 0.35,
    vy: (random() - 0.5) * 0.35,
    r: random() * 1.4 + 0.6,
    ch: i % NETWORK.glyphEvery === 0 ? (random() < 0.5 ? "0" : "1") : null,
    t: random() * 200,
  }));
}

/** Eén animatiestap: bewegen, terugkaatsen aan de randen, wegduwen door de muis. */
export function stepParticles(
  particles: NetworkParticle[],
  width: number,
  height: number,
  pointer: Pointer,
  random: Random = Math.random,
): void {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > width) p.vx *= -1;
    if (p.y < 0 || p.y > height) p.vy *= -1;
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < NETWORK.repelDistance) {
      p.x += (dx / d) * NETWORK.repelStep;
      p.y += (dy / d) * NETWORK.repelStep;
    }
    if (p.ch && ++p.t > NETWORK.glyphSwapFrames) {
      p.t = 0;
      p.ch = random() < 0.5 ? "0" : "1";
    }
  }
}

/** Tekent het netwerk; met `pointer = null` zonder muislijnen (stilstaand beeld). */
export function drawNetwork(
  ctx: CanvasRenderingContext2D,
  particles: readonly NetworkParticle[],
  width: number,
  height: number,
  pointer: Pointer | null,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.font = "11px monospace";
  for (const p of particles) {
    if (p.ch) {
      ctx.fillStyle = "rgba(200,200,200,.35)";
      ctx.fillText(p.ch, p.x, p.y);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(220,220,220,.55)";
      ctx.fill();
    }
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i]!;
    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < NETWORK.linkDistance) {
        ctx.strokeStyle = `rgba(200,200,200,${(1 - d / NETWORK.linkDistance) * 0.22})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    if (pointer) {
      const d = Math.hypot(a.x - pointer.x, a.y - pointer.y);
      if (d < NETWORK.pointerLinkDistance) {
        ctx.strokeStyle = `rgba(255,255,255,${(1 - d / NETWORK.pointerLinkDistance) * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(pointer.x, pointer.y);
        ctx.stroke();
      }
    }
  }
}

export interface ParticleNetworkOptions {
  random?: Random;
}

/** Koppelt het netwerk aan een canvas; `destroy()` ruimt alle listeners en de lus op. */
export class ParticleNetwork {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly random: Random;
  private particles: NetworkParticle[] = [];
  private pointer: Pointer = { ...NO_POINTER };
  private width = 0;
  private height = 0;
  private mode: NetworkMode = "off";
  private frame = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: ParticleNetworkOptions = {},
  ) {
    this.ctx = canvas.getContext("2d");
    this.random = options.random ?? Math.random;
    this.resize();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  get currentMode(): NetworkMode {
    return this.mode;
  }

  /** Of de animatielus nu loopt (alleen in `running` en met zichtbaar tabblad). */
  get isAnimating(): boolean {
    return this.frame !== 0;
  }

  get particleCount(): number {
    return this.particles.length;
  }

  setMode(mode: NetworkMode): void {
    this.mode = mode;
    this.stop();
    if (!this.ctx) return;
    if (mode === "off") {
      this.ctx.clearRect(0, 0, this.width, this.height);
    } else if (mode === "paused") {
      drawNetwork(this.ctx, this.particles, this.width, this.height, null);
    } else if (!document.hidden) {
      this.frame = requestAnimationFrame(this.loop);
    }
  }

  destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointerMove);
    document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.particles = createParticles(this.width, this.height, this.random);
  }

  private loop = (): void => {
    if (!this.ctx) return;
    stepParticles(this.particles, this.width, this.height, this.pointer, this.random);
    drawNetwork(this.ctx, this.particles, this.width, this.height, this.pointer);
    this.frame = requestAnimationFrame(this.loop);
  };

  private onResize = (): void => {
    this.resize();
    this.setMode(this.mode);
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  private onPointerLeave = (): void => {
    this.pointer = { ...NO_POINTER };
  };

  private onVisibility = (): void => {
    if (document.hidden) this.stop();
    else if (this.mode === "running" && !this.frame) this.setMode("running");
  };
}
