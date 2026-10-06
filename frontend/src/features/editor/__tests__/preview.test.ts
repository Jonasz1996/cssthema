import { describe, expect, it, vi } from "vitest";
import { messageKeys } from "@/lib/i18n";
import { fetchBridge } from "../preview/bridge";
import { parseBridgeMessage, PreviewChannel } from "../preview/channel";
import { demoBodyHtml, escapeHtml } from "../preview/demo-page";
import { DEMO_TEXT_FIELDS, demoTextKey, demoTexts } from "../preview/demo-texts";
import { previewFrameHeight, previewScale } from "../preview/scale";
import { sha256Base64, sha256Bytes } from "../preview/sha256";
import { buildPreviewDocument, previewCsp } from "../preview/srcdoc";

import BRIDGE_SOURCE from "../../../../public/preview-bridge.js?raw";

/** SHA-256 via WebCrypto (zoals de browser de CSP-hash berekent). */
async function webcrypto(text: string, encoding: "base64" | "hex"): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  if (encoding === "hex")
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return btoa(String.fromCharCode(...bytes));
}

// --- preview-bridge.js (draait in de iframe) --------------------------------------------------

interface BridgeEnv {
  doc: Document;
  parent: { postMessage: ReturnType<typeof vi.fn> };
  /** Stuurt een `message`-event naar de bridge. */
  send: (data: unknown, source?: unknown) => void;
  /** Een toets in de iframe; geeft het event terug (zie `defaultPrevented`). */
  press: (init: KeyboardEventInit) => KeyboardEvent;
}

class FakeSheet {
  css = "";
  replaceSync(css: string) {
    this.css = css;
  }
}

/** Voert het echte bridge-script uit met een nep-`window` en een los document. */
function runBridge({ standalone = false } = {}): BridgeEnv {
  const doc = document.implementation.createHTMLDocument("preview");
  const listeners: ((event: { source: unknown; data: unknown }) => void)[] = [];
  const keyListeners: ((event: KeyboardEvent) => void)[] = [];
  const parent = { postMessage: vi.fn() };
  const fakeWindow: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: never) => void) => {
      if (type === "message") listeners.push(listener as (typeof listeners)[number]);
      if (type === "keydown") keyListeners.push(listener as (typeof keyListeners)[number]);
    },
  };
  fakeWindow.parent = standalone ? fakeWindow : parent;
  const run = new Function("window", "document", "NodeFilter", "CSSStyleSheet", BRIDGE_SOURCE) as (
    ...args: unknown[]
  ) => void;
  run(fakeWindow, doc, NodeFilter, FakeSheet);
  return {
    doc,
    parent,
    send: (data, source = parent) => listeners.forEach((listener) => listener({ source, data })),
    press: (init) => {
      const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
      keyListeners.forEach((listener) => listener(event));
      return event;
    },
  };
}

describe("preview-bridge.js", () => {
  it("is inlineable: no closing script/style tag, no HTML comment opener", () => {
    expect(BRIDGE_SOURCE).toContain("cssthema preview bridge");
    expect(BRIDGE_SOURCE).not.toMatch(/<\/script|<\/style|<!--/i);
  });

  it("announces itself to the parent once it listens", () => {
    const { parent } = runBridge();
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "cssthema:ready" }, "*");
  });

  it("applies CSS from the parent into #ct-live and confirms with the sequence number", () => {
    const { doc, parent, send } = runBridge();
    send({ type: "css", css: "body{color:red}", seq: 7 });
    expect(doc.getElementById("ct-live")?.textContent).toBe("body{color:red}");
    expect(parent.postMessage).toHaveBeenLastCalledWith({ type: "cssthema:applied", seq: 7 }, "*");
  });

  it("applies the palette into #ct-palette without a confirmation", () => {
    const { doc, parent, send } = runBridge();
    parent.postMessage.mockClear();
    send({ type: "palette", css: ":root{--ct-bg:#000}" });
    expect(doc.getElementById("ct-palette")?.textContent).toBe(":root{--ct-bg:#000}");
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("ignores messages from anyone but the parent, and malformed messages", () => {
    const { doc, parent, send } = runBridge();
    parent.postMessage.mockClear();
    send({ type: "css", css: "a{}" }, { postMessage: vi.fn() });
    send({ type: "css", css: 42 });
    send({ type: "script", css: "alert(1)" });
    send("css");
    send(null);
    send({ type: "css", css: "x".repeat(2 * 1024 * 1024 + 1) });
    expect(doc.getElementById("ct-live")).toBeNull();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("treats CSS strictly as text (no HTML injection)", () => {
    const { doc, send } = runBridge();
    send({ type: "css", css: "</style><script>alert(1)</script><img src=x onerror=alert(1)>" });
    expect(doc.querySelectorAll("script, img")).toHaveLength(0);
    expect(doc.getElementById("ct-live")?.textContent).toContain("<script>");
  });

  it("mirrors the CSS into open shadow roots", () => {
    const { doc, send } = runBridge();
    const host = doc.createElement("div");
    doc.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    send({ type: "css", css: "p{margin:0}", seq: 1 });
    const adopted = (shadow as unknown as { adoptedStyleSheets: FakeSheet[] }).adoptedStyleSheets;
    expect(adopted).toHaveLength(1);
    expect(adopted[0]!.css).toBe("p{margin:0}");
    send({ type: "css", css: "p{margin:1px}", seq: 2 });
    expect(adopted).toHaveLength(1);
    expect(
      (shadow as unknown as { adoptedStyleSheets: FakeSheet[] }).adoptedStyleSheets[0]!.css,
    ).toBe("p{margin:1px}");
  });

  it("forwards Ctrl/⌘+S and Ctrl+\\ to the editor and blocks the browser's save dialog", () => {
    const { parent, press } = runBridge();
    parent.postMessage.mockClear();
    const save = press({ key: "s", code: "KeyS", ctrlKey: true });
    expect(save.defaultPrevented).toBe(true);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: "cssthema:shortcut", action: "publish" },
      "*",
    );
    expect(press({ key: "s", metaKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: "\\", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: "cssthema:shortcut", action: "togglePreview" },
      "*",
    );
    parent.postMessage.mockClear();
    // Gewone toetsen en andere sneltoetsen blijven van de pagina zelf.
    expect(press({ key: "s" }).defaultPrevented).toBe(false);
    expect(press({ key: "c", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("does not post anything when opened on its own (no parent)", () => {
    const { parent } = runBridge({ standalone: true });
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});

// --- editor-kant: kanaal naar de iframe --------------------------------------------------------

function channelSetup() {
  const target = { postMessage: vi.fn() } as unknown as Window & {
    postMessage: ReturnType<typeof vi.fn>;
  };
  const frames: (() => void)[] = [];
  const onApplied = vi.fn();
  const channel = new PreviewChannel({
    getTarget: () => target,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: (handle) => {
      frames[handle - 1] = () => {};
    },
    onApplied,
  });
  const runFrames = () => frames.splice(0).forEach((frame) => frame());
  const fromFrame = (data: unknown, source: unknown = target) =>
    channel.handleMessage({ source, data } as MessageEvent);
  return { channel, target, runFrames, fromFrame, onApplied, frames };
}

describe("PreviewChannel", () => {
  it("waits for the bridge to be ready, then sends palette and CSS", () => {
    const { channel, target, runFrames, fromFrame } = channelSetup();
    channel.setPalette(":root{--ct-bg:#000}");
    channel.setCss("a{}");
    runFrames();
    expect(target.postMessage).not.toHaveBeenCalled();
    fromFrame({ type: "cssthema:ready" });
    expect(target.postMessage.mock.calls).toEqual([
      [{ type: "palette", css: ":root{--ct-bg:#000}" }, "*"],
      [{ type: "css", css: "a{}", seq: 1 }, "*"],
    ]);
  });

  it("throttles to one message per animation frame with the latest CSS", () => {
    const { channel, target, runFrames, fromFrame, frames } = channelSetup();
    fromFrame({ type: "cssthema:ready" });
    target.postMessage.mockClear();
    channel.setCss("a{1}");
    channel.setCss("a{12}");
    channel.setCss("a{123}");
    expect(frames).toHaveLength(1);
    expect(target.postMessage).not.toHaveBeenCalled();
    runFrames();
    expect(target.postMessage.mock.calls).toEqual([[{ type: "css", css: "a{123}", seq: 2 }, "*"]]);
    runFrames();
    expect(target.postMessage).toHaveBeenCalledTimes(1);
  });

  it("only listens to its own iframe and reports applied updates", () => {
    const { fromFrame, onApplied } = channelSetup();
    expect(fromFrame({ type: "cssthema:applied", seq: 3 }, {})).toBeNull();
    expect(onApplied).not.toHaveBeenCalled();
    expect(fromFrame({ type: "cssthema:applied", seq: 3 })).toEqual({
      type: "cssthema:applied",
      seq: 3,
    });
    expect(onApplied).toHaveBeenCalledWith(3);
  });

  it("resends everything after a reload (reset + ready)", () => {
    const { channel, target, fromFrame, runFrames } = channelSetup();
    fromFrame({ type: "cssthema:ready" });
    channel.setCss("a{}");
    runFrames();
    channel.reset();
    expect(channel.isReady).toBe(false);
    target.postMessage.mockClear();
    fromFrame({ type: "cssthema:ready" });
    expect(target.postMessage).toHaveBeenCalledWith({ type: "palette", css: "" }, "*");
    expect(target.postMessage).toHaveBeenCalledWith({ type: "css", css: "a{}", seq: 3 }, "*");
  });

  it("parses only known bridge messages", () => {
    expect(parseBridgeMessage({ type: "cssthema:ready" })).toEqual({ type: "cssthema:ready" });
    expect(parseBridgeMessage({ type: "cssthema:applied", seq: "x" })).toEqual({
      type: "cssthema:applied",
      seq: null,
    });
    expect(parseBridgeMessage({ type: "cssthema:shortcut", action: "publish" })).toEqual({
      type: "cssthema:shortcut",
      action: "publish",
    });
    expect(parseBridgeMessage({ type: "cssthema:shortcut", action: "delete" })).toBeNull();
    expect(parseBridgeMessage({ type: "other" })).toBeNull();
    expect(parseBridgeMessage("cssthema:ready")).toBeNull();
  });

  it("passes shortcuts from its own frame to the editor, not from other windows", () => {
    const onShortcut = vi.fn();
    const target = { postMessage: vi.fn() } as unknown as Window;
    const channel = new PreviewChannel({ getTarget: () => target, onShortcut });
    const data = { type: "cssthema:shortcut", action: "publish" };
    channel.handleMessage({ source: {}, data } as MessageEvent);
    expect(onShortcut).not.toHaveBeenCalled();
    channel.handleMessage({ source: target, data } as MessageEvent);
    expect(onShortcut).toHaveBeenCalledWith("publish");
  });
});

// --- srcdoc, CSP en hash ------------------------------------------------------------------------

describe("preview document (srcdoc + CSP)", () => {
  it("has a CSP that blocks all network access and only allows the bridge by hash", () => {
    const csp = previewCsp("abc=");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'sha256-abc='");
    expect(csp).toContain("img-src data:");
    expect(csp).not.toMatch(/https?:|'unsafe-eval'|\*/);
  });

  it("puts the CSP first, then the style slots, then the inline bridge", () => {
    const html = buildPreviewDocument({
      bridgeSource: "/* cssthema preview bridge */",
      bridgeHash: "h",
      lang: "nl",
      title: 'Preview "x"',
      bodyHtml: "<main>demo</main>",
      baseCss: "p{}",
    });
    const head = html.slice(html.indexOf("<head>"));
    expect(head.indexOf("Content-Security-Policy")).toBeLessThan(head.indexOf("<meta charset"));
    expect(head.indexOf('id="ct-palette"')).toBeLessThan(head.indexOf('id="ct-live"'));
    expect(head.indexOf('id="ct-live"')).toBeLessThan(head.indexOf("<script>"));
    expect(html).toContain("<title>Preview &quot;x&quot;</title>");
    expect(html).toContain("<body><main>demo</main></body>");
  });

  it("refuses a bridge that could break out of its script block", () => {
    const input = { bridgeHash: "h", lang: "nl", title: "t", bodyHtml: "" };
    expect(() => buildPreviewDocument({ ...input, bridgeSource: "x</script>" })).toThrow();
    expect(() => buildPreviewDocument({ ...input, bridgeSource: "<!-- x" })).toThrow();
    expect(() =>
      buildPreviewDocument({ ...input, bridgeSource: "ok", baseCss: "</style>" }),
    ).toThrow();
  });

  it("hashes like the browser does (CSP hash of the real bridge)", async () => {
    const expected = await webcrypto(BRIDGE_SOURCE, "base64");
    await expect(sha256Base64(BRIDGE_SOURCE)).resolves.toBe(expected);
    // Terugval zonder crypto.subtle (http op het LAN).
    vi.stubGlobal("isSecureContext", false);
    await expect(sha256Base64(BRIDGE_SOURCE)).resolves.toBe(expected);
  });

  it("pure-JS SHA-256 matches known test vectors", async () => {
    const hex = (text: string) =>
      Array.from(sha256Bytes(new TextEncoder().encode(text)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    expect(hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const long = "a".repeat(1000) + "€😀";
    expect(hex(long)).toBe(await webcrypto(long, "hex"));
  });

  it("fetches the bridge and rejects the SPA fallback", async () => {
    const ok = vi.fn(async () => new Response(BRIDGE_SOURCE, { status: 200 }));
    const bridge = await fetchBridge(ok as unknown as typeof fetch);
    expect(bridge.source).toBe(BRIDGE_SOURCE);
    expect(String((ok.mock.calls[0] as unknown[])[0])).toMatch(/\/preview-bridge\.js$/);
    const html = vi.fn(async () => new Response("<!doctype html><div id=root>", { status: 200 }));
    await expect(fetchBridge(html as unknown as typeof fetch)).rejects.toThrow(
      /onverwachte inhoud/,
    );
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(fetchBridge(missing as unknown as typeof fetch)).rejects.toThrow(/404/);
  });
});

describe("demo page", () => {
  it("has an nl and en text for every field", () => {
    const en = new Set(messageKeys("en"));
    const nl = new Set(messageKeys("nl"));
    for (const field of DEMO_TEXT_FIELDS) {
      expect(en.has(demoTextKey(field)), demoTextKey(field)).toBe(true);
      expect(nl.has(demoTextKey(field)), demoTextKey(field)).toBe(true);
    }
  });

  it("escapes texts and uses palette variables, without scripts or event handlers", () => {
    const texts = demoTexts(() => "<b>x</b>");
    const html = demoBodyHtml(texts);
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("var(--ct-accent");
    expect(html).not.toMatch(/<script|\son[a-z]+=/i);
    expect(escapeHtml(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });

  it("scales the viewport down to fit, never up", () => {
    expect(previewScale(640, 1280)).toBe(0.5);
    expect(previewScale(2000, 1280)).toBe(1);
    expect(previewScale(0, 1280)).toBe(1);
  });

  it("lets a preset fill the panel height, but keeps a custom size exact", () => {
    // 1280×800 at 50 % in a 600 px tall panel: 1200 px of page fit.
    expect(previewFrameHeight(800, 600, 0.5, true)).toBe(1200);
    // Never below the nominal height (the panel then scrolls).
    expect(previewFrameHeight(800, 300, 0.5, true)).toBe(800);
    expect(previewFrameHeight(800, 600, 0.5, false)).toBe(800);
    expect(previewFrameHeight(800, 0, 0.5, true)).toBe(800);
  });
});
