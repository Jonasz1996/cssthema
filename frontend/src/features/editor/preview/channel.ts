/**
 * Berichten van de editor naar de preview-iframe (en terug). De iframe draait in een opaque
 * origin (`sandbox="allow-scripts"` zonder `allow-same-origin`), dus `postMessage` met
 * doel `"*"`; binnenkomende berichten tellen alleen als ze van díe iframe komen.
 *
 * Updates zijn `requestAnimationFrame`-gedreven: hoe snel er ook getypt wordt, per frame gaat
 * hoogstens één bericht met de nieuwste CSS (< 100 ms tot zichtbaar, meestal één frame).
 */

import type { EditorShortcut } from "../lib/shortcuts";

export type BridgeInbound =
  | { type: "cssthema:ready" }
  | { type: "cssthema:applied"; seq: number | null }
  /** Sneltoets terwijl de preview de focus had (de bridge hield de browseractie tegen). */
  | { type: "cssthema:shortcut"; action: EditorShortcut };

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
  return null;
}

export interface PreviewChannelOptions {
  /** Het `contentWindow` van de iframe (of `null` zolang die er niet is). */
  getTarget: () => Window | null;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Na elke toegepaste CSS-update (voor de "klaar"-toestand en metingen). */
  onApplied?: (seq: number | null) => void;
  onReady?: () => void;
  /** Ctrl/⌘+S of Ctrl+\ in de preview. */
  onShortcut?: (action: EditorShortcut) => void;
}

export class PreviewChannel {
  private css = "";
  private palette = "";
  private sentCss: string | null = null;
  private sentPalette: string | null = null;
  private ready = false;
  private frame: number | null = null;
  private seq = 0;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;

  constructor(private readonly options: PreviewChannelOptions) {
    this.requestFrame =
      options.requestFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => globalThis.cancelAnimationFrame(handle));
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Volgnummer van de laatst verstuurde CSS. */
  get lastSeq(): number {
    return this.seq;
  }

  setCss(css: string): void {
    this.css = css;
    this.schedule();
  }

  setPalette(css: string): void {
    this.palette = css;
    this.schedule();
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
    if (!this.ready || this.frame !== null) return;
    this.frame = this.requestFrame(() => this.flush());
  }

  private cancel(): void {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }
}
