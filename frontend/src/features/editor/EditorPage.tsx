import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { saveBlob } from "@/api/client";
import { useDraft, useLint, useSaveDraft } from "@/api/queries/editor";
import { usePalette } from "@/api/queries/palettes";
import { useExportTheme, useTheme } from "@/api/queries/themes";
import type { LintIssue } from "@/api/types";
import { useShellCommand } from "@/app/shell-command";
import { Button, ButtonLink, Callout, CardTitle, Loading, Tag, toast } from "@/components/ui";
import { t as translate, useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";
import { copyText } from "@/features/themes/lib/clipboard";
import { errorText } from "@/features/themes/lib/errors";
import type { SaveState, SessionSnapshot } from "./autosave/draft-session";
import {
  closeSession,
  peekSession,
  useDebouncedSessionCss,
  useDraftSession,
  useSessionValue,
} from "./autosave/sessions";
import { CodeEditor, type CodeEditorHandle, type CursorPosition } from "./components/CodeEditor";
import { ConflictDialog } from "./components/ConflictDialog";
import { EditorTabs } from "./components/EditorTabs";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Explorer } from "./components/Explorer";
import { MenuButton } from "./components/MenuButton";
import { ProblemsPanel } from "./components/ProblemsPanel";
import { PublishDialog } from "./components/PublishDialog";
import { Splitter } from "./components/Splitter";
import { StatusBar } from "./components/StatusBar";
import { useFillHeight, useMediaQuery } from "./lib/layout-hooks";
import { type EditorShortcut, editorShortcut, LINT_DEBOUNCE_MS } from "./lib/shortcuts";
import { themeStatusTags } from "./lib/theme-status";
import { disposeThemeModel } from "./monaco/load";
import { PreviewPane } from "./preview/PreviewPane";
import { EXPLORER_WIDTH, PREVIEW_SIZE, useEditorStore } from "./store";

const selectConflict = (snapshot: SessionSnapshot): SaveState | null =>
  snapshot.state.kind === "conflict" ? snapshot.state : null;

/** Gesloten tab opruimen: Monaco-model weg, wachtende wijzigingen opslaan, sessie weg. */
function releaseTab(themeId: string): void {
  disposeThemeModel(themeId);
  // Opslaan mislukt: de tekst staat in de offline-buffer en komt terug bij heropenen.
  closeSession(themeId).catch(() => undefined);
}

/**
 * Editor voor één thema (`/editor/:themeId`, F-ED-01/03/04/06/08/10/11): tabs, verkenner,
 * Monaco met autosave en lint-markers, live preview, statusbalk, probleempaneel, publiceren
 * en conflictafhandeling. Monaco zit in een eigen chunk en laadt alleen hier.
 */
export function EditorPage() {
  const { themeId = "" } = useParams<{ themeId: string }>();
  const navigate = useNavigate();
  const i18n = useI18n();
  const { t } = i18n;
  const problemsId = useId();
  const explorerId = useId();
  const editorPanelId = useId();
  const previewId = useId();

  const themeQuery = useTheme(themeId);
  const draftQuery = useDraft(themeId);
  const theme = themeQuery.data;
  const paletteQuery = usePalette(theme?.palette_id);
  const palette = paletteQuery.data
    ? { name: paletteQuery.data.name, tokens: paletteQuery.data.tokens }
    : null;
  const { mutateAsync: save } = useSaveDraft();
  const session = useDraftSession(themeId, draftQuery.data, save);
  const lintCss = useDebouncedSessionCss(session, LINT_DEBOUNCE_MS);
  const lint = useLint(themeId, session ? lintCss : undefined);
  const exportTheme = useExportTheme();

  const tabs = useEditorStore((state) => state.tabs);
  const openTab = useEditorStore((state) => state.openTab);
  const closeTab = useEditorStore((state) => state.closeTab);
  const layout = useEditorStore((state) => state.layout);
  const setLayout = useEditorStore((state) => state.setLayout);

  const narrow = useMediaQuery("(max-width: 899px)");
  const previewPosition = narrow ? "bottom" : layout.previewPosition;
  const workRef = useRef<HTMLDivElement>(null);
  // Op een telefoon lopen kop en knoppen over meerdere regels; met minstens 1000 px blijft er
  // voor editor en preview elk ~300 px over (de pagina scrolt dan, zoals de versiepagina).
  const [attachFill, fillHeight] = useFillHeight({ bottom: 64, min: narrow ? 1000 : 480 });
  const editorHandle = useRef<CodeEditorHandle | null>(null);
  const [cursor, setCursor] = useState<CursorPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  // De conflictdialoog staat open zolang de sessie in conflict is, tot je hem voor díé
  // conflictmelding sluit; een nieuw conflict (of een klik op de statusbalk) opent hem weer.
  const conflict = useSessionValue(session, selectConflict, null);
  const [dismissedConflict, setDismissedConflict] = useState<SaveState | null>(null);
  const [overlayExplorerFor, setOverlayExplorerFor] = useState<string | null>(null);
  const conflictOpen = conflict !== null && conflict !== dismissedConflict;

  useShellCommand(theme?.slug ? `cssthema edit ${theme.slug}` : null);
  useDocumentTitle(theme?.name ? `${theme.name} · ${t("editor.title")}` : t("editor.title"));

  // Tab openen of bijwerken (naam/slug) zodra het thema geladen is.
  const tabName = theme?.name;
  const tabSlug = theme?.slug;
  useEffect(() => {
    if (tabName && tabSlug) openTab({ id: themeId, name: tabName, slug: tabSlug });
  }, [openTab, themeId, tabName, tabSlug]);

  // Wisselen van thema of de pagina verlaten: wachtende wijzigingen meteen opslaan.
  useEffect(() => () => void peekSession(themeId)?.flush(), [themeId]);

  // Meldingen van de sessie: hersteld uit de buffer, terug online, conflict.
  useEffect(() => {
    if (!session) return;
    return session.onEvent((event) => {
      if (event.type === "restored") toast.mid(translate("editor.restoredFromBuffer"));
      else if (event.type === "synced" && event.afterOffline)
        toast.ok(translate("editor.syncedAfterOffline"));
    });
  }, [session]);

  const openPublish = useCallback(() => {
    if (!session || !theme || theme.deleted_at) return;
    setPublishOpen(true);
    void session.flush();
  }, [session, theme]);

  const togglePreview = useCallback(
    () => setLayout({ previewOpen: !useEditorStore.getState().layout.previewOpen }),
    [setLayout],
  );

  const runShortcut = useCallback(
    (action: EditorShortcut) => {
      // Niet als er al een dialoog openstaat: de browseractie ("Pagina opslaan als") blijft
      // wel tegengehouden, maar een tweede Ctrl+S opent niets nieuws.
      if (document.querySelector("[role=dialog][aria-modal=true]")) return;
      if (action === "publish") openPublish();
      else togglePreview();
    },
    [openPublish, togglePreview],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = editorShortcut(event);
      if (!action) return;
      event.preventDefault();
      runShortcut(action);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [runShortcut]);

  // Een tab die gesloten wordt terwijl hij actief is, ruimen we pas op als de route gewisseld
  // is: de navigatie is een transition, dus de pagina rendert het thema eerst nog een keer.
  // Zou de sessie dan al weg zijn, dan maakte die render er een nieuwe met een oude lock.
  const closingRef = useRef(new Set<string>());
  useEffect(() => {
    const pending = closingRef.current;
    for (const id of pending) {
      if (id === themeId) continue;
      pending.delete(id);
      releaseTab(id);
    }
  }, [themeId]);
  useEffect(() => {
    const pending = closingRef.current;
    return () => {
      for (const id of pending) releaseTab(id);
      pending.clear();
    };
  }, []);

  const handleCloseTab = (id: string) => {
    const next = closeTab(id);
    if (id === themeId) {
      closingRef.current.add(id);
      navigate(next ? `/editor/${next}` : "/themes");
    } else {
      releaseTab(id);
    }
  };

  const onStatusAction = (state: SaveState) => {
    if (state.kind === "conflict") setDismissedConflict(null);
    else if (state.kind === "offline") session?.retryNow();
    else if (state.kind === "error") void session?.flush();
  };

  // De server telt kolommen in codepunten; de editor rekent zelf om naar UTF-16 (emoji e.d.).
  const selectIssue = (issue: LintIssue) =>
    editorHandle.current?.revealCodePoint(issue.line, issue.column);

  const download = (format: "css" | "bundle") => {
    if (!theme) return;
    exportTheme.mutate(
      {
        themeId: theme.id,
        format,
        fallbackName: format === "css" ? `${theme.slug}.css` : `${theme.slug}.cssthema.zip`,
      },
      { onError: (error) => toast.err(errorText(error, i18n)) },
    );
  };

  const downloadDraft = () => {
    if (!theme || !session) return;
    const blob = new Blob([session.getSnapshot().css], { type: "text/css;charset=utf-8" });
    saveBlob(blob, `${theme.slug}.draft.css`);
  };

  const copyUrl = async () => {
    if (!theme) return;
    // copyText valt over http op een LAN-adres terug op execCommand (geen navigator.clipboard).
    if (await copyText(theme.public_url)) toast.ok(t("editor.urlCopied"));
    else toast.err(t("editor.urlCopyFailed"));
  };

  // --- weergave ---------------------------------------------------------------------------------

  if (themeQuery.isError || draftQuery.isError) {
    const error = themeQuery.error ?? draftQuery.error;
    const notFound = error?.status === 404;
    return (
      <div className="py-2">
        <EditorTabs tabs={tabs} activeId={themeId} onClose={handleCloseTab} />
        <Callout
          tone="err"
          title={notFound ? t("editor.notFoundTitle") : t("editor.loadFailedTitle")}
          actions={
            <>
              <ButtonLink to="/themes" size="sm">
                {t("editor.backToThemes")}
              </ButtonLink>
              {notFound ? (
                <Button variant="alt" size="sm" onClick={() => handleCloseTab(themeId)}>
                  {t("editor.closeTab")}
                </Button>
              ) : (
                <Button
                  variant="alt"
                  size="sm"
                  onClick={() => {
                    void themeQuery.refetch();
                    void draftQuery.refetch();
                  }}
                >
                  {t("editor.retry")}
                </Button>
              )}
            </>
          }
        >
          {notFound ? t("editor.notFoundText") : errorText(error, i18n)}
        </Callout>
      </div>
    );
  }

  if (!theme) return <Loading />;

  const readOnly = Boolean(theme.deleted_at);
  const tags = themeStatusTags(theme);
  // Smal scherm: de verkenner is een overlay, standaard dicht en per thema (sluit bij navigeren).
  const explorerVisible = narrow ? overlayExplorerFor === themeId : layout.explorerOpen;
  const setExplorerVisible = (open: boolean) => {
    if (narrow) setOverlayExplorerFor(open ? themeId : null);
    else setLayout({ explorerOpen: open });
  };
  const previewVisible = layout.previewOpen;

  const workSize = () => {
    const el = workRef.current;
    if (!el) return 1;
    return Math.max(1, previewPosition === "right" ? el.clientWidth : el.clientHeight);
  };

  return (
    <div ref={attachFill} className="flex min-w-0 flex-col" style={{ height: fillHeight }}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <Link to="/themes" className="text-[13px] text-muted no-underline hover:text-white">
            {t("editor.breadcrumbThemes")}
          </Link>
          <span aria-hidden className="text-dim">
            ▸
          </span>
          <CardTitle className="text-[19px]">{theme.name}</CardTitle>
          <span className="text-[12.5px] text-dim">{theme.slug}.css</span>
        </div>
        <ul
          className="m-0 flex list-none flex-wrap gap-1.5 p-0"
          aria-label={t("editor.statusTags")}
        >
          {tags.map((tag) => (
            <li key={tag.key}>
              <Tag tone={tag.tone}>{t(tag.key, tag.params)}</Tag>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant="mini"
            aria-pressed={explorerVisible}
            aria-controls={explorerId}
            onClick={() => setExplorerVisible(!explorerVisible)}
            title={t("editor.toggleExplorer")}
          >
            <span aria-hidden>☰</span> {t("editor.explorerTitleShort")}
          </Button>
          <Button
            variant="mini"
            aria-pressed={previewVisible}
            aria-controls={previewId}
            onClick={togglePreview}
            title={`${t("editor.togglePreview")} (Ctrl+\\)`}
          >
            <span aria-hidden>◨</span> {t("editor.previewTitleShort")}
          </Button>
          <ButtonLink
            to={`/editor/${theme.id}/versions?from=live&to=draft`}
            variant="alt"
            size="sm"
            title={t("editor.diffHint")}
          >
            {t("editor.diff")}
          </ButtonLink>
          <ButtonLink to={`/editor/${theme.id}/versions`} variant="alt" size="sm">
            {t("editor.versions")}
          </ButtonLink>
          <MenuButton
            label={<span aria-hidden>⤓</span>}
            ariaLabel={t("editor.downloadMenu")}
            title={t("editor.downloadMenu")}
            items={[
              {
                id: "live",
                label: t("editor.downloadLive"),
                hint: theme.published_version
                  ? t("editor.downloadLiveHint", { n: theme.published_version.version_number })
                  : t("editor.downloadLiveNone"),
                disabled: !theme.published_version,
                onSelect: () => download("css"),
              },
              {
                id: "draft",
                label: t("editor.downloadDraft"),
                hint: t("editor.downloadDraftHint"),
                disabled: !session,
                onSelect: downloadDraft,
              },
              {
                id: "bundle",
                label: t("editor.downloadBundle"),
                hint: t("editor.downloadBundleHint"),
                onSelect: () => download("bundle"),
              },
              {
                id: "url",
                label: t("editor.copyUrl"),
                hint: theme.public_url,
                onSelect: () => void copyUrl(),
              },
            ]}
          />
          <Button
            size="sm"
            onClick={openPublish}
            disabled={!session || readOnly}
            title={`${t("editor.publish")} (Ctrl+S)`}
            aria-keyshortcuts="Control+S Meta+S"
          >
            {t("editor.publish")}
          </Button>
        </div>
      </div>

      {readOnly && (
        <Callout tone="err" className="mb-2">
          {t("editor.deletedReadOnly")}
        </Callout>
      )}
      {theme.shadowed_by_file && (
        <Callout tone="mid" className="mb-2">
          {t("editor.shadowedText", { slug: theme.slug })}
        </Callout>
      )}

      <EditorTabs tabs={tabs} activeId={themeId} onClose={handleCloseTab} />

      <div
        data-dragging={dragging}
        className={cn(
          "relative flex min-h-0 flex-1 overflow-hidden rounded-b-[10px] rounded-tr-[10px] border border-line-strong bg-black/25",
          "data-[dragging=true]:select-none [&[data-dragging=true]_iframe]:pointer-events-none",
        )}
      >
        {explorerVisible && (
          <>
            <div
              className={cn(
                "min-h-0 flex-none",
                narrow &&
                  "absolute inset-y-0 left-0 z-20 w-[min(86%,300px)] border-r border-line-strong bg-[#121212] shadow-card",
              )}
              style={narrow ? undefined : { width: layout.explorerWidth }}
              onKeyDown={
                narrow
                  ? (event) => {
                      if (event.key === "Escape") setExplorerVisible(false);
                    }
                  : undefined
              }
            >
              <Explorer
                id={explorerId}
                currentTheme={theme}
                palette={palette}
                onInsert={(text) => editorHandle.current?.insert(text)}
                onClose={() => setExplorerVisible(false)}
              />
            </div>
            {!narrow && (
              <Splitter
                orientation="vertical"
                value={layout.explorerWidth}
                min={EXPLORER_WIDTH.min}
                max={EXPLORER_WIDTH.max}
                step={16}
                fromDelta={(start, delta) => start + delta}
                onChange={(explorerWidth) => setLayout({ explorerWidth })}
                onReset={() => setLayout({ explorerWidth: EXPLORER_WIDTH.default })}
                onDraggingChange={setDragging}
                label={t("editor.resizeExplorer")}
                controls={explorerId}
                valueText={`${layout.explorerWidth} px`}
              />
            )}
          </>
        )}

        <div
          ref={workRef}
          className={cn("flex min-h-0 min-w-0 flex-1", previewPosition === "bottom" && "flex-col")}
        >
          <div
            id={editorPanelId}
            className="flex min-h-0 min-w-0 flex-col"
            style={{ flex: previewVisible ? `${1 - layout.previewSize} 1 0` : "1 1 0" }}
          >
            <div className="relative min-h-0 flex-1">
              {!session ? (
                <Loading />
              ) : (
                <ErrorBoundary
                  fallback={(error, reset) => (
                    <Callout
                      tone="err"
                      className="m-3"
                      title={t("editor.monacoFailed")}
                      actions={
                        <Button variant="alt" size="sm" onClick={reset}>
                          {t("editor.retry")}
                        </Button>
                      }
                    >
                      {error.message}
                    </Callout>
                  )}
                >
                  <Suspense fallback={<Loading label={t("editor.monacoLoading")} />}>
                    <CodeEditor
                      themeId={themeId}
                      session={session}
                      palette={palette}
                      lint={lint.data}
                      readOnly={readOnly}
                      compact={narrow}
                      ariaLabel={t("editor.editorLabel", { slug: theme.slug })}
                      onCursorChange={setCursor}
                      onReady={(handle) => {
                        editorHandle.current = handle;
                      }}
                    />
                  </Suspense>
                </ErrorBoundary>
              )}
            </div>
            {layout.problemsOpen && (
              <ProblemsPanel
                id={problemsId}
                lint={lint.data}
                onSelect={selectIssue}
                onClose={() => setLayout({ problemsOpen: false })}
              />
            )}
          </div>

          {previewVisible && (
            <>
              <Splitter
                orientation={previewPosition === "right" ? "vertical" : "horizontal"}
                value={layout.previewSize}
                min={PREVIEW_SIZE.min}
                max={PREVIEW_SIZE.max}
                step={0.02}
                fromDelta={(start, delta) => start - delta / workSize()}
                reversed
                onChange={(previewSize) => setLayout({ previewSize })}
                onReset={() => setLayout({ previewSize: PREVIEW_SIZE.default })}
                onDraggingChange={setDragging}
                label={t("editor.resizePreview")}
                controls={previewId}
                valueText={`${Math.round(layout.previewSize * 100)} %`}
              />
              <div
                id={previewId}
                className="min-h-0 min-w-0"
                style={{ flex: `${layout.previewSize} 1 0` }}
              >
                <PreviewPane
                  session={session}
                  paletteTokens={palette?.tokens}
                  onShortcut={runShortcut}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar
        session={session}
        lint={lint.data}
        lintPending={lint.isFetching}
        cursor={cursor}
        paletteName={palette?.name ?? null}
        problemsOpen={layout.problemsOpen}
        problemsId={problemsId}
        onToggleProblems={() => setLayout({ problemsOpen: !layout.problemsOpen })}
        onStatusAction={onStatusAction}
      />

      {session && (
        <>
          <PublishDialog
            open={publishOpen}
            onClose={() => setPublishOpen(false)}
            theme={theme}
            session={session}
          />
          <ConflictDialog
            open={conflictOpen}
            onClose={() => setDismissedConflict(conflict)}
            session={session}
            slug={theme.slug}
          />
        </>
      )}
    </div>
  );
}
