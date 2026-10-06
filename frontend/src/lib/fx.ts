import { prefersReducedMotion } from "./motion";

/**
 * Effecten "vuur + bliksem", overgenomen uit aiverslag: bliksem, vonken, explosies, een
 * schermflits, een schok van de app en het "wegzappen" van een element.
 *
 * Alles tekent op één vaste canvas `#fx-top` (boven de app) plus een
 * flits-laag `#fx-flash`; beide worden bij het eerste gebruik aan `<body>` toegevoegd. De
 * animatielus draait alleen zolang er iets te tekenen is. Bij `prefers-reduced-motion` is
 * elke functie een no-op (en `zap`/`remove` resolven meteen).
 *
 * Gebruik: verwijderen = `fx.remove(el)` (bliksem + flits + shake + zap), publiceren =
 * `fx.publish(el)` (vonken + kleine explosie), rollback = `fx.rollback(el)` (blauwe vonken).
 */

export interface Point {
  x: number;
  y: number;
}

/** Een element (het midden ervan) of een punt in viewport-coördinaten. */
export type FxTarget = Element | Point;

export const FX_CANVAS_ID = "fx-top";
export const FX_FLASH_ID = "fx-flash";
/** Id van het element dat `shake()` standaard laat schudden (de app-wrapper). */
export const SHAKE_TARGET_ID = "app-wrap";

const SHAKE_CLASS = "ui-shake";
const ZAP_CLASS = "ui-zap";
const SHAKE_MS = 450;
const ZAP_MS = 300;
const REMOVE_DELAY_MS = 170;

interface FireParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  dec: number;
  sz: number;
  h: number;
  l?: number;
  g: number;
  spark?: boolean;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  k: number;
  slow?: boolean;
  blue?: boolean;
}

type Segment = [number, number, number, number];

interface BoltShape {
  main: Segment[];
  branches: Segment[][];
}

interface Bolt {
  x0: number;
  x: number;
  y: number;
  shape: BoltShape;
  life: number;
  t: number;
}

const TAU = Math.PI * 2;

/** Midden van een element of het punt zelf. */
export function centerOf(target: FxTarget): Point {
  if ("getBoundingClientRect" in target) {
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return target;
}

/** Recursieve zigzag tussen twee punten (middelpunt-verplaatsing). */
function jag(x1: number, y1: number, x2: number, y2: number, d: number, out: Segment[]): void {
  if (d < 3) {
    out.push([x1, y1, x2, y2]);
    return;
  }
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * d;
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * d;
  jag(x1, y1, mx, my, d / 2, out);
  jag(mx, my, x2, y2, d / 2, out);
}

function makeBolt(x0: number, y0: number, x: number, y: number): BoltShape {
  const main: Segment[] = [];
  jag(x0, y0, x, y, Math.hypot(x - x0, y - y0) * 0.35, main);
  const branches: Segment[][] = [];
  for (let i = 0; i < 7 && main.length; i++) {
    const start = main[Math.floor(Math.random() * main.length)]!;
    const angle = Math.random() * 3.1 + 0.02;
    const len = 60 + Math.random() * 140;
    const seg: Segment[] = [];
    jag(
      start[2],
      start[3],
      start[2] + Math.cos(angle) * len * (Math.random() < 0.5 ? -1 : 1),
      start[3] + Math.sin(angle) * len,
      len * 0.4,
      seg,
    );
    branches.push(seg);
  }
  return { main, branches };
}

export class FxEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  private fire: FireParticle[] = [];
  private rings: Ring[] = [];
  private bolts: Bolt[] = [];
  private frame = 0;
  private running = false;
  private resizeBound = false;

  /** Aantal actieve deeltjes, ringen en bliksems (voor tests en debug). */
  get activeCount(): number {
    return this.fire.length + this.rings.length + this.bolts.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Bliksem van boven het scherm naar (x, y). */
  bolt = (x: number, y: number): void => {
    if (prefersReducedMotion() || !this.layer()) return;
    const x0 = x + (Math.random() - 0.5) * 400;
    this.bolts.push({ x0, x, y, shape: makeBolt(x0, -10, x, y), life: 1, t: 0 });
    this.start();
  };

  /** Blauwe vonken met een ring. */
  sparkle = (x: number, y: number): void => {
    if (prefersReducedMotion() || !this.layer()) return;
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * TAU;
      const s = Math.random() * 11 + 3;
      this.fire.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
        dec: 0.03 + Math.random() * 0.03,
        sz: 1.8,
        h: 210,
        l: 85,
        g: 0.2,
        spark: true,
      });
    }
    this.rings.push({ x, y, r: 4, life: 1, k: 0.8, blue: true });
    this.start();
  };

  /** Vuurexplosie; `k` schaalt grootte en aantal (1 = normaal). */
  explode = (x: number, y: number, k = 1): void => {
    if (prefersReducedMotion() || !this.layer()) return;
    for (let i = 0; i < 130 * k; i++) {
      const a = Math.random() * TAU;
      const s = Math.random() ** 0.5 * 9 * k;
      this.fire.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1.5,
        life: 1,
        dec: 0.014 + Math.random() * 0.02,
        sz: Math.random() * 7 * k + 2,
        h: Math.random() * 45 + 5,
        g: -0.05,
      });
    }
    for (let i = 0; i < 40 * k; i++) {
      const a = Math.random() * TAU;
      const s = Math.random() * 14 * k + 4;
      this.fire.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
        dec: 0.02 + Math.random() * 0.02,
        sz: 1.6,
        h: 45,
        g: 0.28,
        spark: true,
      });
    }
    this.rings.push({ x, y, r: 6, life: 1, k }, { x, y, r: 2, life: 1, k: k * 0.6, slow: true });
    this.start();
  };

  /** Korte schermflits in een kleur (of gradient), daarna uitfaden. */
  flash = (color = "rgba(190,220,255,.8)"): void => {
    if (prefersReducedMotion()) return;
    const el = this.flashLayer();
    el.style.transition = "none";
    el.style.background = color;
    el.style.opacity = "1";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.style.transition = "opacity .45s ease-out";
        el.style.opacity = "0";
      }),
    );
  };

  /** Laat de app (of een ander element) even schudden. */
  shake = (target?: Element | null): void => {
    if (prefersReducedMotion()) return;
    const el = target ?? document.getElementById(SHAKE_TARGET_ID);
    if (!(el instanceof HTMLElement)) return;
    el.classList.remove(SHAKE_CLASS);
    void el.offsetWidth; // reflow: animatie opnieuw starten
    el.classList.add(SHAKE_CLASS);
    window.setTimeout(() => el.classList.remove(SHAKE_CLASS), SHAKE_MS);
  };

  /** Element wit/blauw laten flitsen en vervagen; resolvet als de animatie klaar is. */
  zap = (element: Element): Promise<void> => {
    if (prefersReducedMotion()) return Promise.resolve();
    element.classList.add(ZAP_CLASS);
    return new Promise((resolve) => window.setTimeout(resolve, ZAP_MS));
  };

  /** Zap ongedaan maken (bv. als verwijderen toch mislukte). */
  unzap = (element: Element): void => {
    element.classList.remove(ZAP_CLASS);
  };

  /** Verwijderen: bliksem + flits, dan shake + vonken + zap. Resolvet na de zap. */
  remove = (element: Element): Promise<void> => {
    if (prefersReducedMotion()) return Promise.resolve();
    const { x, y } = centerOf(element);
    this.bolt(x, y);
    this.flash("rgba(190,220,255,.8)");
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.shake();
        this.sparkle(x, y);
        void this.zap(element).then(resolve);
      }, REMOVE_DELAY_MS);
    });
  };

  /** Publiceren: vonken + kleine explosie. */
  publish = (target: FxTarget): void => {
    const { x, y } = centerOf(target);
    this.sparkle(x, y);
    this.explode(x, y, 0.6);
  };

  /** Rollback: blauwe vonken. */
  rollback = (target: FxTarget): void => {
    const { x, y } = centerOf(target);
    this.sparkle(x, y);
  };

  /** Alles stoppen en wissen (bv. bij unmount in tests). */
  clear = (): void => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.running = false;
    this.fire = [];
    this.rings = [];
    this.bolts = [];
    this.ctx?.clearRect(0, 0, this.width, this.height);
  };

  private layer(): CanvasRenderingContext2D | null {
    if (this.ctx && this.canvas?.isConnected) return this.ctx;
    if (typeof document === "undefined") return null;
    let canvas = document.getElementById(FX_CANVAS_ID);
    if (!(canvas instanceof HTMLCanvasElement)) {
      canvas = document.createElement("canvas");
      canvas.id = FX_CANVAS_ID;
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70";
      document.body.append(canvas);
    }
    const ctx = (canvas as HTMLCanvasElement).getContext("2d");
    if (!ctx) return null;
    this.canvas = canvas as HTMLCanvasElement;
    this.ctx = ctx;
    this.resize();
    if (!this.resizeBound) {
      window.addEventListener("resize", () => this.resize());
      this.resizeBound = true;
    }
    return ctx;
  }

  private flashLayer(): HTMLElement {
    let el = document.getElementById(FX_FLASH_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = FX_FLASH_ID;
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:75;opacity:0";
      document.body.append(el);
    }
    return el;
  }

  private resize(): void {
    if (!this.canvas || !this.ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.frame = requestAnimationFrame(this.tick);
  }

  private segments(ctx: CanvasRenderingContext2D, segs: Segment[], width: number): void {
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const s of segs) {
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(s[2], s[3]);
    }
    ctx.stroke();
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx) {
      this.running = false;
      return;
    }
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "lighter";

    this.rings = this.rings.filter((r) => r.life > 0);
    for (const r of this.rings) {
      r.r += (r.slow ? 7 : 16) * r.k;
      r.life -= 0.035;
      ctx.lineWidth = Math.max(0, (r.slow ? 10 : 5) * r.life * r.k);
      ctx.strokeStyle = r.blue
        ? `rgba(160,200,255,${r.life})`
        : `rgba(255,${(140 + r.life * 80) | 0},40,${r.life * 0.8})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }

    this.fire = this.fire.filter((p) => p.life > 0);
    for (const p of this.fire) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      p.vx *= 0.97;
      p.life -= p.dec;
      if (p.life <= 0) continue;
      if (p.spark) {
        ctx.fillStyle = `hsla(${p.h},100%,${p.l ?? 70}%,${p.life})`;
        ctx.fillRect(p.x, p.y, p.sz * 1.6, p.sz * 1.6);
      } else {
        const s = p.sz * (0.4 + p.life);
        const h = p.h * p.life + (1 - p.life) * 5;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 2);
        g.addColorStop(0, `hsla(${h + 15},100%,${55 + p.life * 35}%,${p.life * 0.85})`);
        g.addColorStop(1, `hsla(${h},100%,45%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * 2, 0, TAU);
        ctx.fill();
      }
    }

    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const b of this.bolts) {
      b.t++;
      b.life -= 0.045;
      if (b.t % 4 === 0) b.shape = makeBolt(b.x0, -10, b.x, b.y);
      const a = Math.random() < 0.25 ? b.life * 0.3 : Math.min(1, b.life * 1.6);
      ctx.shadowColor = "#7db7ff";
      ctx.shadowBlur = 28;
      ctx.strokeStyle = `rgba(120,175,255,${a * 0.7})`;
      this.segments(ctx, b.shape.main, 7);
      for (const s of b.shape.branches) {
        ctx.strokeStyle = `rgba(120,175,255,${a * 0.5})`;
        this.segments(ctx, s, 3);
      }
      ctx.shadowBlur = 10;
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      this.segments(ctx, b.shape.main, 2.2);
      for (const s of b.shape.branches) {
        ctx.strokeStyle = `rgba(230,240,255,${a * 0.8})`;
        this.segments(ctx, s, 1);
      }
      ctx.shadowBlur = 0;
    }

    ctx.globalCompositeOperation = "source-over";
    if (this.activeCount) {
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.running = false;
      this.frame = 0;
      ctx.clearRect(0, 0, this.width, this.height);
    }
  };
}

/** Gedeelde instantie voor de hele app. */
export const fx = new FxEngine();
