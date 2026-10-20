import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isApiError } from "@/api/client";
import { usePreviewStack } from "@/api/queries/editor";
import type { PreviewStack } from "@/api/types";
import { Button, Callout, Dialog, Input, Loading, Select } from "@/components/ui";
import { PageUpload } from "@/features/services/components/PageUpload";
import { errorText } from "@/features/themes/lib/errors";
import { type I18n, useI18n } from "@/lib/i18n";
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
import { formatBytes } from "../lib/format";
import { demoBodyHtml } from "./demo-page";
import { demoTexts } from "./demo-texts";
import { PreviewError, previewErrorText } from "./errors";
import { buildSnapshotDocument, type SnapshotStack } from "./snapshot-document";
import { DEMO_SOURCE, type PreviewSourceTheme, type SnapshotOption } from "./source";
import { buildPreviewDocument } from "./srcdoc";
import { templateFromDocument } from "../template/render";
import { useBridge } from "./use-bridge";
import { type PreviewSource, usePreviewSource } from "./use-preview-source";

const PRESETS: readonly ViewportPreset[] = ["desktop", "tablet", "mobile", "custom"];

export interface PreviewPaneProps {
  session: DraftSession | undefined;
  /** Tokens van het palet van het thema (`--ct-*` in de preview), of `null`. */
  paletteTokens: Readonly<Record<string, string>> | null | undefined;
  /** Ctrl/⌘+S of Ctrl+\ terwijl de preview de focus heeft (de iframe stuurt ze door). */
  onShortcut?: (action: EditorShortcut) => void;
  /**
   * Het thema: bepaalt de bron (demo-pagina of een snapshot van de app, zie `source.ts`) en
   * waar de keuze onthouden wordt. Zonder thema alleen de demo-pagina, zonder keuzelijst.
   */
  theme?: PreviewSourceTheme | null;
  /**
   * "CSS-template maken": de CSS die uit de pagina in de preview gemaakt is, vervangt de inhoud
   * van de editor of komt eronder. Zonder deze functie geen knop.
   */
  onTemplate?: (css: string, mode: "replace" | "append") => void;
  className?: string;
}

type TemplateState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "choose"; css: string }
  | { status: "error"; message: string };

/** Tekst van een snapshot in de keuzelijst (de dienst staat in de `optgroup`). */
function snapshotLabel(snapshot: SnapshotOption): string {
  return snapshot.title && snapshot.title !== snapshot.page
    ? `${snapshot.page} · ${snapshot.title}`
    : snapshot.page;
}

/** De stapel zoals de srcdoc hem nodig heeft (onderdelen die niet gevonden zijn, vallen weg). */
function snapshotStack(stack: PreviewStack): SnapshotStack {
  const found = (parts: PreviewStack["before"]) =>
    parts.flatMap((part) => (part.css === null ? [] : [{ name: part.name, css: part.css }]));
  return { before: found(stack.before), after: found(stack.after) };
}

/** Foutmelding bij het laden van een snapshot-document. */
function snapshotErrorText(error: unknown, i18n: I18n): string {
  if (isApiError(error) && error.status === 404) return i18n.t("editor.snapshotNotFound");
  return errorText(error, i18n);
}

/**
 * Live preview (F-ED-06/07a/08): de demo-pagina of een vastgelegde pagina van de app (snapshot)
 * in een sandboxed iframe met het palet als `:root`-variabelen en de CSS uit de editor,
 * bijgewerkt per animatieframe. De viewport is instelbaar (desktop/tablet/mobiel/eigen maat) en
 * wordt geschaald tot hij in het paneel past.
 */
export function PreviewPane({
  session,
  paletteTokens,
  onShortcut,
  theme,
  onTemplate,
  className,
}: PreviewPaneProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const source = usePreviewSource(theme);
  const layout = useEditorStore((state) => state.layout);
  const setLayout = useEditorStore((state) => state.setLayout);
  const { state: bridgeState, retry } = useBridge();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<PreviewChannel | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [template, setTemplate] = useState<TemplateState>({ status: "idle" });
  const [available, setAvailable] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(0);

  // Het document van de gekozen snapshot (alleen als het bij die snapshot hoort).
  const snapshotDocument =
    source.snapshotId && source.document.data?.id === source.snapshotId
      ? source.document.data
      : null;
  // De rest van wat de host krijgt (bv. alg-kern en de modules), vóór en na de live draft. Laadt
  // samen met het document; lukt het niet, dan de snapshot zonder stapel (met een melding).
  const stackHost = source.snapshotId
    ? (source.selected?.group.hostname ?? snapshotDocument?.hostname ?? null)
    : null;
  const stackQuery = usePreviewStack(stackHost, theme?.slug);
  const stack = stackHost && stackQuery.data ? stackQuery.data : null;
  const stackPending = stackHost !== null && Boolean(theme) && stackQuery.isPending;
  const docStack = useMemo(() => (stack ? snapshotStack(stack) : null), [stack]);
  const frameTitle = snapshotDocument
    ? t("editor.previewFrameTitleSnapshot", {
        name: source.selected
          ? `${snapshotDocument.hostname} · ${source.selected.snapshot.page}`
          : snapshotDocument.hostname,
      })
    : t("editor.previewFrameTitle");

  const built = useMemo((): { doc: string } | { error: unknown } | null => {
    if (bridgeState.status !== "ready" || source.value === null) return null;
    try {
      if (source.snapshotId) {
        if (!snapshotDocument || stackPending) return null;
        return {
          doc: buildSnapshotDocument({
            bridgeSource: bridgeState.bridge.source,
            bridgeHash: bridgeState.bridge.hash,
            // Vast per document: de dienstenlijst die later binnenkomt, herlaadt de iframe niet.
            title: snapshotDocument.title ?? snapshotDocument.hostname,
            html: snapshotDocument.html,
            stylesheets: snapshotDocument.stylesheets,
            stack: docStack,
          }),
        };
      }
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
      return { error };
    }
  }, [
    bridgeState,
    locale,
    t,
    source.value,
    source.snapshotId,
    snapshotDocument,
    stackPending,
    docStack,
  ]);
  const srcdoc = built && "doc" in built ? built.doc : null;

  // Het template komt uit de pagina zelf: een snapshot zonder de stapel van de host (die zou de
  // kleuren van het huidige thema geven), de demo-pagina zoals hij is.
  const makeTemplate = async () => {
    if (bridgeState.status !== "ready" || !srcdoc) return;
    setTemplate({ status: "busy" });
    try {
      const doc = snapshotDocument
        ? buildSnapshotDocument({
            bridgeSource: bridgeState.bridge.source,
            bridgeHash: bridgeState.bridge.hash,
            title: snapshotDocument.title ?? snapshotDocument.hostname,
            html: snapshotDocument.html,
            stylesheets: snapshotDocument.stylesheets,
            stack: null,
          })
        : srcdoc;
      const name = snapshotDocument
        ? source.selected
          ? `${snapshotDocument.hostname} · ${snapshotLabel(source.selected.snapshot)}`
          : snapshotDocument.hostname
        : t("editor.previewSourceDemo");
      const css = await templateFromDocument(doc, name);
      const current = session?.getSnapshot().css ?? "";
      if (current.trim()) setTemplate({ status: "choose", css });
      else {
        onTemplate?.(css, "replace");
        setTemplate({ status: "idle" });
      }
    } catch (error) {
      setTemplate({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const buildError = built && "error" in built ? built.error : null;
  const failure =
    bridgeState.status === "error"
      ? previewErrorText(bridgeState.error, t)
      : buildError !== null
        ? previewErrorText(buildError, t)
        : null;
  // Een snapshot die niet lukt (te groot): terug naar de demo helpt, opnieuw proberen niet.
  const snapshotFailed =
    source.snapshotId !== null &&
    buildError instanceof PreviewError &&
    buildError.code === "snapshotTooLarge";
  const documentError = source.snapshotId && source.document.isError ? source.document.error : null;
  const sourceLoading =
    bridgeState.status !== "loading" &&
    (source.value === null ||
      (source.snapshotId !== null && (source.document.isPending || stackPending)));
  const stackError = source.snapshotId && stackHost && stackQuery.isError ? stackQuery.error : null;

  // Welk document de iframe toont; "klaar" geldt per document (verbergt de ongestijlde flits).
  const documentKey = `${frameKey}:${locale}:${bridgeState.status}:${source.value ?? ""}`;
  const documentKeyRef = useRef(documentKey);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  // De bridge weigerde de CSS (te groot): melding tonen en de iframe toch zichtbaar maken.
  const [tooLarge, setTooLarge] = useState<{ key: string; max: number | null } | null>(null);
  const tooLargeMax = tooLarge?.key === documentKey ? tooLarge : null;
  const ready = appliedKey === documentKey || tooLargeMax !== null;

  const onShortcutRef = useRef(onShortcut);
  useLayoutEffect(() => {
    onShortcutRef.current = onShortcut;
  });

  useEffect(() => {
    const channel = new PreviewChannel({
      getTarget: () => iframeRef.current?.contentWindow ?? null,
      onApplied: () => {
        setAppliedKey(documentKeyRef.current);
        setTooLarge(null);
      },
      onTooLarge: (_kind, max) => setTooLarge({ key: documentKeyRef.current, max }),
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
        {theme && <SourcePicker source={source} />}
        {theme && (
          <Button
            variant="mini"
            onClick={() => setUploadOpen(true)}
            title={t("editor.previewUploadHint")}
            data-testid="preview-upload"
          >
            📄 {t("editor.previewUpload")}
          </Button>
        )}
        {theme && onTemplate && (
          <Button
            variant="mini"
            onClick={() => void makeTemplate()}
            disabled={!srcdoc || !session || template.status === "busy"}
            title={t("editor.templateHint")}
            data-testid="preview-template"
          >
            🎨 {template.status === "busy" ? t("editor.templateBusy") : t("editor.template")}
          </Button>
        )}
        {source.snapshotId && stack && <StackInfo stack={stack} />}
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
        {sourceLoading && (
          <Loading label={source.snapshotId ? t("editor.snapshotLoading") : undefined} />
        )}
        {failure !== null && (
          <Callout
            tone="err"
            title={t("editor.previewUnavailable")}
            actions={
              snapshotFailed ? (
                <Button variant="alt" size="sm" onClick={() => source.select(DEMO_SOURCE)}>
                  {t("editor.snapshotShowDemo")}
                </Button>
              ) : (
                <Button variant="alt" size="sm" onClick={retry}>
                  {t("editor.retry")}
                </Button>
              )
            }
          >
            {failure}
          </Callout>
        )}
        {documentError !== null && (
          <Callout
            tone="err"
            title={t("editor.snapshotUnavailable")}
            actions={
              <>
                <Button variant="alt" size="sm" onClick={() => void source.document.refetch()}>
                  {t("editor.retry")}
                </Button>
                <Button variant="alt" size="sm" onClick={() => source.select(DEMO_SOURCE)}>
                  {t("editor.snapshotShowDemo")}
                </Button>
              </>
            }
          >
            {snapshotErrorText(documentError, i18n)}
          </Callout>
        )}
        {stackError !== null && srcdoc && (
          <Callout
            tone="mid"
            className="mb-2"
            title={t("editor.previewStackFailed")}
            actions={
              <Button variant="alt" size="sm" onClick={() => void stackQuery.refetch()}>
                {t("editor.retry")}
              </Button>
            }
          >
            {errorText(stackError, i18n)}
          </Callout>
        )}
        {srcdoc && tooLargeMax && (
          <Callout tone="mid" role="status" title={t("editor.previewTooLarge")}>
            {t("editor.previewTooLargeBody", {
              // De bridge telt tekens; voor de melding volstaat dat als grootte.
              max: tooLargeMax.max ? formatBytes(tooLargeMax.max, locale) : "?",
            })}
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
              title={frameTitle}
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
      <Dialog
        open={template.status === "choose" || template.status === "error"}
        onClose={() => setTemplate({ status: "idle" })}
        size="sm"
        title={t("editor.templateTitle")}
        footer={
          template.status === "choose" ? (
            <>
              <Button variant="alt" onClick={() => setTemplate({ status: "idle" })}>
                {t("editor.templateCancel")}
              </Button>
              <Button
                variant="alt"
                data-testid="template-append"
                onClick={() => {
                  onTemplate?.(template.css, "append");
                  setTemplate({ status: "idle" });
                }}
              >
                {t("editor.templateAppend")}
              </Button>
              <Button
                data-testid="template-replace"
                onClick={() => {
                  onTemplate?.(template.css, "replace");
                  setTemplate({ status: "idle" });
                }}
              >
                {t("editor.templateReplace")}
              </Button>
            </>
          ) : undefined
        }
      >
        {template.status === "error" ? (
          <Callout tone="err" title={t("editor.templateFailed")}>
            {template.message}
          </Callout>
        ) : (
          <p className="text-[13px] text-muted">{t("editor.templateChoose")}</p>
        )}
      </Dialog>
      <Dialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        size="md"
        title={t("editor.previewUploadTitle")}
        command="cssthema pages upload"
      >
        <PageUpload
          onUploaded={(result) => {
            source.select(result.snapshot_id);
            setUploadOpen(false);
          }}
        />
      </Dialog>
    </section>
  );
}

/**
 * Keuze van de bron: de demo-pagina of een snapshot, gegroepeerd per dienst (hostnaam). Een
 * gewone `<select>`: typen springt naar de eerste passende optie.
 */
function SourcePicker({ source }: { source: PreviewSource }) {
  const { t } = useI18n();
  const known = source.snapshotId === null || source.selected !== null;
  return (
    <Select
      aria-label={t("editor.previewSource")}
      title={t("editor.previewSource")}
      value={source.value ?? ""}
      disabled={source.value === null}
      onChange={(event) => source.select(event.target.value)}
      className="w-auto max-w-[min(260px,60vw)] py-1 pr-7 pl-2 text-[12px]"
    >
      {source.value === null && <option value="">{t("common.loading")}</option>}
      <option value={DEMO_SOURCE}>{t("editor.previewSourceDemo")}</option>
      {!known && source.snapshotId && (
        // Bewaarde keuze terwijl de lijst (nog) niet geladen is.
        <option value={source.snapshotId}>
          {source.document.data?.hostname ?? t("editor.previewSourceSnapshot")}
        </option>
      )}
      {source.groups.map((group) => (
        <optgroup key={group.serviceId} label={group.hostname}>
          {group.snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>
              {snapshotLabel(snapshot)}
            </option>
          ))}
        </optgroup>
      ))}
      {source.servicesLoaded && source.groups.length === 0 && (
        <option value="" disabled>
          {t("editor.previewSourceNone")}
        </option>
      )}
    </Select>
  );
}

/**
 * Welke stapel de snapshot krijgt: "+ 4 onderdelen van de host", met de volgorde in de tooltip
 * (het bewerkte thema op zijn plek). Ook als de koppeling uit staat of het thema er niet in zit.
 */
function StackInfo({ stack }: { stack: PreviewStack }) {
  const { t, tc } = useI18n();
  const parts = [...stack.before, ...stack.after];
  const names = [
    ...stack.before.map((part) => part.name),
    `▸ ${t("editor.previewStackThis")}`,
    ...stack.after.map((part) => part.name),
  ];
  const binding = stack.binding ?? t("editor.previewStackNoBinding");
  const title = stack.excluded
    ? t("editor.previewStackExcluded")
    : !stack.enabled
      ? t("editor.previewStackOff", { binding })
      : [
          t("editor.previewStackBinding", { binding }),
          names.join(" → "),
          stack.contains_theme ? null : t("editor.previewStackNotIn"),
        ]
          .filter(Boolean)
          .join("\n");
  return (
    <span
      data-preview-stack=""
      className={cn("text-[11.5px] text-dim", !stack.contains_theme && "text-mid")}
      title={title}
    >
      {stack.excluded
        ? t("editor.previewStackExcludedShort")
        : !stack.enabled
          ? t("editor.previewStackOffShort")
          : parts.length
            ? tc("editor.previewStackParts", parts.length)
            : t("editor.previewStackEmpty")}
    </span>
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
