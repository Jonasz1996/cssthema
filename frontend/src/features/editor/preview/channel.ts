/**
 * Berichten van de editor naar de preview-iframe (en terug). De iframe draait in een opaque
 * origin (`sandbox="allow-scripts"` zonder `allow-same-origin`), dus `postMessage` met
 * doel `"*"`; binnenkomende berichten tellen alleen als ze van díe iframe komen.
 *
 * Updates zijn `requestAnimationFrame`-gedreven: hoe snel er ook getypt wordt, per frame gaat
 * hoogstens één bericht met de nieuwste CSS (< 100 ms tot zichtbaar, meestal één frame).
 * Grote stylesheets (> `LARGE_CSS_LENGTH` tekens) gaan pas `LARGE_CSS_DEBOUNCE_MS` na de laatste
 * wijziging (trailing debounce), en bij lang doortypen toch om de `LARGE_CSS_MAX_WAIT_MS`: elke
 * update kopieert en herparseert de hele tekst in de iframe, op dezelfde thread als de editor
 * (review PERF-5).
 */

import type { EditorShortcut } from "../lib/shortcuts";

export const LARGE_CSS_LENGTH = 200 * 1024;
export const LARGE_CSS_DEBOUNCE_MS = 400;
export const LARGE_CSS_MAX_WAIT_MS = 2000;

export type BridgeInbound =
  | { type: "cssthema:ready" }
  | { type: "cssthema:applied"; seq: number | null }
  /** Sneltoets terwijl de preview de focus had (de bridge hield de browseractie tegen). */
  | { type: "cssthema:shortcut"; action: EditorShortcut }
  /** De bridge weigerde een stylesheet boven haar limiet (`max` tekens). */
  | { type: "cssthema:too-large"; kind: "css" | "palette"; max: number | null };

export type BridgeOutbound =
  { type: "css"; css: string; seq: number } | { type: "palette"; css: string };

/** Herkent een bericht van de bridge (`public/preview-bridge.js`). */
export function parseBridgeMessage(data: unknown): BridgeInbound | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.type === "cssthema:ready") return { type: "cssthema:ready" };
  if (message.type === "cssthema:applied") {
    return { type: "cssthema:applied", seq: typeof message.seq === "number" ? message.seq : null };
  }
  if (
    message.type === "cssthema:shortcut" &&
    (message.action === "publish" || message.action === "togglePreview")
  ) {
    return { type: "cssthema:shortcut", action: message.action };
  }
  if (
    message.type === "cssthema:too-large" &&
    (message.kind === "css" || message.kind === "palette")
  ) {
    return {
      type: "cssthema:too-large",
      kind: message.kind,
      max: typeof message.max === "number" ? message.max : null,
    };
  }
  return null;
}

export interface PreviewChannelOptions {
  /** Het `contentWindow` van de iframe (of `null` zolang die er niet is). */
  getTarget: () => Window | null;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Klok en timer voor het uitstellen van grote stylesheets (tests). */
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Na elke toegepaste CSS-update (voor de "klaar"-toestand en metingen). */
  onApplied?: (seq: number | null) => void;
  onReady?: () => void;
  /** Ctrl/⌘+S of Ctrl+\ in de preview. */
  onShortcut?: (action: EditorShortcut) => void;
  /** De bridge weigerde de stylesheet (te groot). */
  onTooLarge?: (kind: "css" | "palette", max: number | null) => void;
}

export class PreviewChannel {
  private css = "";
  private palette = "";
  private sentCss: string | null = null;
  private sentPalette: string | null = null;
  private ready = false;
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Sinds wanneer een grote stylesheet op een pauze in het typen wacht (`null` = niet). */
  private waitingSince: number | null = null;
  private seq = 0;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<PreviewChannelOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<PreviewChannelOptions["clearTimer"]>;

  constructor(private readonly options: PreviewChannelOptions) {
    this.requestFrame =
      options.requestFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => globalThis.cancelAnimationFrame(handle));
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Volgnummer van de laatst verstuurde CSS. */
  get lastSeq(): number {
    return this.seq;
  }

  setCss(css: string): void {
    // De sessie meldt ook "opgeslagen" e.d.: dat mag een wachtende grote update niet uitstellen.
    if (css === this.css) return;
    this.css = css;
    this.schedule();
  }

  setPalette(css: string): void {
    this.palette = css;
    // Wacht er een grote stylesheet op een pauze: het palet gaat met die update mee.
    if (this.timer === null) this.schedule();
  }

  /** `message`-event van `window`: verwerkt alleen berichten van de eigen iframe. */
  handleMessage(event: MessageEvent): BridgeInbound | null {
    const target = this.options.getTarget();
    if (!target || event.source !== target) return null;
    const message = parseBridgeMessage(event.data);
    if (!message) return null;
    if (message.type === "cssthema:ready") {
      // Nieuw document (eerste keer of herladen): alles opnieuw sturen.
      this.ready = true;
      this.sentCss = null;
      this.sentPalette = null;
      this.cancel();
      this.flush();
      this.options.onReady?.();
    } else if (message.type === "cssthema:shortcut") {
      this.options.onShortcut?.(message.action);
    } else if (message.type === "cssthema:too-large") {
      this.options.onTooLarge?.(message.kind, message.max);
    } else {
      this.options.onApplied?.(message.seq);
    }
    return message;
  }

  /** De iframe wordt opnieuw opgebouwd: wachten op een nieuw `ready`. */
  reset(): void {
    this.ready = false;
    this.sentCss = null;
    this.sentPalette = null;
    this.cancel();
  }

  /** Stuurt wat veranderd is meteen (normaal via `requestAnimationFrame`). */
  flush(): void {
    this.frame = null;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.waitingSince = null;
    const target = this.options.getTarget();
    if (!this.ready || !target) return;
    if (this.palette !== this.sentPalette) {
      this.post(target, { type: "palette", css: this.palette });
      this.sentPalette = this.palette;
    }
    if (this.css !== this.sentCss) {
      this.seq += 1;
      this.post(target, { type: "css", css: this.css, seq: this.seq });
      this.sentCss = this.css;
    }
  }

  dispose(): void {
    this.cancel();
    this.ready = false;
  }

  private post(target: Window, message: BridgeOutbound): void {
    target.postMessage(message, "*");
  }

  private schedule(): void {
    if (!this.ready) return;
    if (this.css.length > LARGE_CSS_LENGTH && this.css !== this.sentCss) {
      // Groot: opnieuw wachten op een pauze, maar niet langer dan de maximale wachttijd.
      const now = this.now();
      this.waitingSince ??= now;
      const wait = Math.min(LARGE_CSS_DEBOUNCE_MS, this.waitingSince + LARGE_CSS_MAX_WAIT_MS - now);
      this.cancel(false);
      this.timer = this.setTimer(
        () => {
          this.timer = null;
          this.frame = this.requestFrame(() => this.flush());
        },
        Math.max(0, wait),
      );
      return;
    }
    // Klein (of alleen het palet): het volgende frame, ook als er nog een grote update wachtte.
    if (this.timer !== null) this.cancel();
    if (this.frame === null) this.frame = this.requestFrame(() => this.flush());
  }

  private cancel(stopWaiting = true): void {
    if (this.frame !== null) this.cancelFrame(this.frame);
    if (this.timer !== null) this.clearTimer(this.timer);
    this.frame = null;
    this.timer = null;
    if (stopWaiting) this.waitingSince = null;
  }
}
