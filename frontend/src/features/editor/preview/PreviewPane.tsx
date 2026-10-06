import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Input, Loading } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DraftSession } from "../autosave/draft-session";
import type { EditorShortcut } from "../lib/shortcuts";
import { paletteCss } from "../palette";
import {
  clamp,
  useEditorStore,
  VIEWPORT_LIMITS,
  VIEWPORTS,
  type ViewportPreset,
  viewportSize,
} from "../store";
import { PreviewChannel } from "./channel";
import { previewFrameHeight, previewScale } from "./scale";
import { demoBodyHtml } from "./demo-page";
import { demoTexts } from "./demo-texts";
import { buildPreviewDocument } from "./srcdoc";
import { useBridge } from "./use-bridge";

const PRESETS: readonly ViewportPreset[] = ["desktop", "tablet", "mobile", "custom"];

export interface PreviewPaneProps {
  session: DraftSession | undefined;
  /** Tokens van het palet van het thema (`--ct-*` in de preview), of `null`. */
  paletteTokens: Readonly<Record<string, string>> | null | undefined;
  /** Ctrl/⌘+S of Ctrl+\ terwijl de preview de focus heeft (de iframe stuurt ze door). */
  onShortcut?: (action: EditorShortcut) => void;
  className?: string;
}

/**
 * Live preview (F-ED-06/08): de demo-pagina in een sandboxed iframe met het palet als
 * `:root`-variabelen en de CSS uit de editor, bijgewerkt per animatieframe. De viewport is
 * instelbaar (desktop/tablet/mobiel/eigen maat) en wordt geschaald tot hij in het paneel past.
 */
export function PreviewPane({ session, paletteTokens, onShortcut, className }: PreviewPaneProps) {
  const { t, locale } = useI18n();
  const layout = useEditorStore((state) => state.layout);
  const setLayout = useEditorStore((state) => state.setLayout);
  const { state: bridgeState, retry } = useBridge();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<PreviewChannel | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [available, setAvailable] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(0);

  const built = useMemo((): { doc: string } | { error: string } | null => {
    if (bridgeState.status !== "ready") return null;
    try {
      return {
        doc: buildPreviewDocument({
          bridgeSource: bridgeState.bridge.source,
          bridgeHash: bridgeState.bridge.hash,
          lang: locale,
          title: t("editor.previewFrameTitle"),
          bodyHtml: demoBodyHtml(demoTexts(t)),
        }),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [bridgeState, locale, t]);
  const srcdoc = built && "doc" in built ? built.doc : null;
  const failure =
    bridgeState.status === "error"
      ? bridgeState.message
      : built && "error" in built
        ? built.error
        : null;

  // Welk document de iframe toont; "klaar" geldt per document (verbergt de ongestijlde flits).
  const documentKey = `${frameKey}:${locale}:${bridgeState.status}`;
  const documentKeyRef = useRef(documentKey);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const ready = appliedKey === documentKey;

  const onShortcutRef = useRef(onShortcut);
  useLayoutEffect(() => {
    onShortcutRef.current = onShortcut;
  });

  useEffect(() => {
    const channel = new PreviewChannel({
      getTarget: () => iframeRef.current?.contentWindow ?? null,
      onApplied: () => setAppliedKey(documentKeyRef.current),
      onShortcut: (action) => onShortcutRef.current?.(action),
    });
    channelRef.current = channel;
    const onMessage = (event: MessageEvent) => channel.handleMessage(event);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      channel.dispose();
      channelRef.current = null;
    };
  }, []);

  // Nieuw document (andere taal, herladen): wachten op `ready` van de bridge.
  useLayoutEffect(() => {
    documentKeyRef.current = documentKey;
    channelRef.current?.reset();
  }, [documentKey, srcdoc]);

  // CSS rechtstreeks uit de sessie, zonder de component bij elke toets te renderen.
  useEffect(() => {
    const channel = channelRef.current;
    if (!session || !channel) return;
    channel.setCss(session.getSnapshot().css);
    return session.subscribe(() => channel.setCss(session.getSnapshot().css));
  }, [session]);

  const palette = useMemo(() => paletteCss(paletteTokens), [paletteTokens]);
  useEffect(() => channelRef.current?.setPalette(palette), [palette]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // p-2: 8 px binnenmarge aan elke kant.
    const measure = () => {
      setAvailable(stage.clientWidth - 16);
      setAvailableHeight(stage.clientHeight - 16);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const size = viewportSize(layout);
  const scale = previewScale(available, size.width);
  const percent = Math.round(scale * 100);
  const frameHeight = previewFrameHeight(
    size.height,
    availableHeight,
    scale,
    layout.viewport !== "custom",
  );

  const setCustom = (dimension: "width" | "height", value: number) =>
    setLayout({ customViewport: { ...layout.customViewport, [dimension]: value } });

  return (
    <section
      aria-label={t("editor.previewLabel")}
      className={cn("flex h-full min-h-0 min-w-0 flex-col bg-black/30", className)}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <span className="mr-1 text-[11px] tracking-[.08em] text-muted uppercase">
          {t("editor.previewTitle")}
        </span>
        <div role="group" aria-label={t("editor.viewportLabel")} className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              variant="mini"
              aria-pressed={layout.viewport === preset}
              onClick={() => setLayout({ viewport: preset })}
              title={
                preset === "custom"
                  ? t("editor.viewport_custom")
                  : `${t(`editor.viewport_${preset}`)} · ${VIEWPORTS[preset].width}×${VIEWPORTS[preset].height}`
              }
            >
              {t(`editor.viewport_${preset}`)}
            </Button>
          ))}
        </div>
        {layout.viewport === "custom" && (
          <div className="flex items-center gap-1 text-[12px] text-muted">
            <ViewportInput
              label={t("editor.viewportWidth")}
              value={layout.customViewport.width}
              onCommit={(value) => setCustom("width", value)}
            />
            ×
            <ViewportInput
              label={t("editor.viewportHeight")}
              value={layout.customViewport.height}
              onCommit={(value) => setCustom("height", value)}
            />
          </div>
        )}
        <span className="ml-auto text-[11.5px] text-dim" title={t("editor.previewScale")}>
          {size.width}×{frameHeight} · {percent} %
        </span>
        <Button
          variant="mini"
          size="icon"
          aria-label={t("editor.previewReload")}
          title={t("editor.previewReload")}
          onClick={() => setFrameKey((key) => key + 1)}
        >
          ⟳
        </Button>
        <Button
          variant="mini"
          size="icon"
          aria-label={
            layout.previewPosition === "right"
              ? t("editor.previewMoveBottom")
              : t("editor.previewMoveRight")
          }
          title={
            layout.previewPosition === "right"
              ? t("editor.previewMoveBottom")
              : t("editor.previewMoveRight")
          }
          onClick={() =>
            setLayout({ previewPosition: layout.previewPosition === "right" ? "bottom" : "right" })
          }
        >
          {layout.previewPosition === "right" ? "⬓" : "◨"}
        </Button>
        <Button
          variant="mini"
          size="icon"
          tone="danger"
          aria-label={t("editor.previewHide")}
          title={`${t("editor.previewHide")} (Ctrl+\\)`}
          onClick={() => setLayout({ previewOpen: false })}
        >
          ✕
        </Button>
      </div>

      <div ref={stageRef} className="min-h-0 flex-1 overflow-auto p-2">
        {bridgeState.status === "loading" && <Loading />}
        {failure !== null && (
          <Callout
            tone="err"
            title={t("editor.previewUnavailable")}
            actions={
              <Button variant="alt" size="sm" onClick={retry}>
                {t("editor.retry")}
              </Button>
            }
          >
            {failure}
          </Callout>
        )}
        {srcdoc && (
          <div
            className="relative mx-auto overflow-hidden rounded-md border border-line-strong bg-white shadow-card"
            style={{ width: size.width * scale, height: frameHeight * scale }}
          >
            <iframe
              key={frameKey}
              ref={iframeRef}
              title={t("editor.previewFrameTitle")}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={srcdoc}
              data-ready={ready}
              className="absolute top-0 left-0 origin-top-left border-0 bg-white transition-opacity duration-150 data-[ready=false]:opacity-0"
              style={{
                width: size.width,
                height: frameHeight,
                transform: scale === 1 ? undefined : `scale(${scale})`,
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Breedte of hoogte van de eigen viewport. Het veld toont wat je typt; bij Enter of verlaten
 * wordt de waarde binnen de grenzen gehouden en toont het veld wat de preview echt gebruikt
 * (bv. 100 → 240), zodat veld en preview nooit verschillende maten tonen.
 */
function ViewportInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const parsed = Number.parseInt(text, 10);
    const next = Number.isFinite(parsed)
      ? clamp(parsed, VIEWPORT_LIMITS.min, VIEWPORT_LIMITS.max)
      : value;
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={VIEWPORT_LIMITS.min}
      max={VIEWPORT_LIMITS.max}
      aria-label={label}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className="w-[74px] px-2 py-1 text-[12px]"
    />
  );
}
