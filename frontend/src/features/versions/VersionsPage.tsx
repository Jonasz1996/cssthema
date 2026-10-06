import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { isApiError } from "@/api/client";
import {
  fetchDraft,
  useDiff,
  useDraft,
  useResetDraft,
  useRollback,
  useVersion,
  useVersionsInfinite,
} from "@/api/queries/editor";
import { flattenPages } from "@/api/queries/options";
import { useExportTheme, useTheme } from "@/api/queries/themes";
import { themeKeys } from "@/api/queries/keys";
import type { Draft, Theme, VersionSummary } from "@/api/types";
import { useShellCommand } from "@/app/shell-command";
import {
  Button,
  ButtonLink,
  Callout,
  CardTitle,
  ConfirmDialog,
  Field,
  Loading,
  Select,
  Tag,
  Textarea,
  toast,
} from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { fx } from "@/lib/fx";
import { type I18n, useI18n } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";
import type { SessionSnapshot } from "@/features/editor/autosave/draft-session";
import { peekSession, useSessionValue } from "@/features/editor/autosave/sessions";
import { DiffView } from "@/features/editor/components/DiffView";
import { ErrorBoundary } from "@/features/editor/components/ErrorBoundary";
import { formatBytes, formatDateTime, formatRelative } from "@/features/editor/lib/format";
import { useFillHeight, useMediaQuery } from "@/features/editor/lib/layout-hooks";
import { themeStatusTags } from "@/features/editor/lib/theme-status";
import {
  type CompareRef,
  type Comparison,
  comparisonSearch,
  defaultFrom,
  refLabel,
  resolveComparison,
} from "./compare";

/** CSS-bron van één kant van de vergelijking (versie, draft of leeg). */
function useSideSource(themeId: string, ref: CompareRef | null, i18n: I18n) {
  const version = useVersion(themeId, typeof ref === "number" ? ref : null);
  const draft = useDraft(themeId, { enabled: ref === "draft" });
  if (ref === null) return { css: "", pending: false, error: null as string | null };
  if (ref === "draft") {
    return {
      css: draft.data?.css ?? "",
      pending: draft.isPending,
      error: draft.error ? errorText(draft.error, i18n) : null,
    };
  }
  return {
    css: version.data?.css_source ?? "",
    pending: version.isPending,
    error: version.error ? errorText(version.error, i18n) : null,
  };
}

interface VersionRowProps {
  version: VersionSummary;
  selected: boolean;
  onSelect: () => void;
}

function VersionRow({ version, selected, onSelect }: VersionRowProps) {
  const { t, locale } = useI18n();
  const source =
    version.source === "rollback" && version.source_version_number
      ? t("versions.sourceRollbackOf", { n: version.source_version_number })
      : t(`versions.source_${version.source}`);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "w-full rounded-lg border-l-[3px] px-3 py-2 text-left text-[12.5px] outline-none",
          "focus-visible:outline-2 focus-visible:outline-white",
          version.is_live ? "border-ok" : "border-white/15",
          selected ? "bg-white/14 text-white" : "text-fg hover:bg-white/6",
        )}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden className={version.is_live ? "text-ok" : "text-dim"}>
            {version.is_live ? "●" : "○"}
          </span>
          {/* Spaties tussen de stukken: zonder lopen ze in de toegankelijke naam aan elkaar. */}
          <b className="text-heading">v{version.version_number}</b>{" "}
          {version.is_live && <Tag tone="ok">{t("versions.live")}</Tag>} <Tag>{source}</Tag>{" "}
          <span
            className="ml-auto text-[11.5px] text-dim"
            title={formatDateTime(version.created_at, locale)}
          >
            {formatRelative(version.created_at, locale)}
          </span>
        </span>{" "}
        {version.message && (
          <span className="mt-1 block truncate text-muted">“{version.message}”</span>
        )}{" "}
        <span className="mt-0.5 block text-[11.5px] text-dim">
          {version.created_by?.display_name ?? t("versions.unknownAuthor")} ·{" "}
          {formatBytes(version.size_bytes, locale)} · {version.sha256.slice(0, 12)}
        </span>
      </button>
    </li>
  );
}

const selectDirty = (snapshot: SessionSnapshot) => snapshot.dirty;

/**
 * Versiegeschiedenis van een thema (`/editor/:themeId/versions`, F-TM-06/07, docs/04 § 3.4):
 * lijst met live-badge, auteur, tijd, bericht, bron en grootte; Monaco-diff tussen twee versies
 * of versie ↔ draft (naast elkaar of inline); downloaden, openen in de editor (draft terugzetten)
 * en rollback (bevestigen, blauwe vonken).
 */
export function VersionsPage() {
  const { themeId = "" } = useParams<{ themeId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const i18n = useI18n();
  const { t, tc, locale } = i18n;
  const narrow = useMediaQuery("(max-width: 899px)");
  const [attachFill, fillHeight] = useFillHeight({ bottom: 64, min: narrow ? 900 : 520 });
  const rollbackButtonRef = useRef<HTMLButtonElement>(null);
  const diffTitleRef = useRef<HTMLHeadingElement>(null);
  // Na een rollback is de rollbackknop (de opener van de dialoog) uitgeschakeld: de focus gaat
  // naar de kop van de nieuwe vergelijking in plaats van naar <body>.
  const [focusDiffTitle, setFocusDiffTitle] = useState(0);
  useEffect(() => {
    if (focusDiffTitle) diffTitleRef.current?.focus();
  }, [focusDiffTitle]);

  const themeQuery = useTheme(themeId);
  const theme = themeQuery.data;
  const versionsQuery = useVersionsInfinite(themeId, { limit: 50 });
  const versions = flattenPages(versionsQuery.data);
  const draftQuery = useDraft(themeId);
  const exportTheme = useExportTheme();
  const rollback = useRollback();
  const resetDraft = useResetDraft();
  const queryClient = useQueryClient();
  // Een open editortab met wijzigingen die (nog) niet op de server staan, telt ook als "gewijzigd".
  const localDirty = useSessionValue(peekSession(themeId), selectDirty, false);

  const [sideBySide, setSideBySide] = useState(!narrow);
  const [confirm, setConfirm] = useState<"rollback" | "reset" | null>(null);
  const [rollbackMessage, setRollbackMessage] = useState("");

  useShellCommand(theme?.slug ? `cssthema versions ${theme.slug}` : null);
  useDocumentTitle(theme?.name ? `${theme.name} · ${t("versions.title")}` : t("versions.title"));

  const liveVersion = theme?.published_version?.version_number ?? null;
  const latestVersion = theme?.latest_version_number ?? 0;
  const comparison: Comparison = resolveComparison(
    { from: searchParams.get("from"), to: searchParams.get("to") },
    { liveVersion, latestVersion },
  );
  const original = useSideSource(themeId, comparison.from, i18n);
  const modified = useSideSource(themeId, comparison.to, i18n);
  const diffStats = useDiff(themeId, comparison.from, comparison.to, {
    enabled: comparison.from !== null,
  });

  const select = (to: CompareRef) => {
    const from = defaultFrom(to, { liveVersion, latestVersion });
    setSearchParams(comparisonSearch({ from, to }), { replace: true });
  };

  const setFrom = (value: string) => {
    const from: CompareRef | null =
      value === "empty" ? null : value === "draft" ? "draft" : Number(value);
    setSearchParams(comparisonSearch({ from, to: comparison.to }), { replace: true });
  };

  if (themeQuery.isError) {
    return (
      <Callout
        tone="err"
        title={themeQuery.error.status === 404 ? t("versions.notFound") : t("versions.loadFailed")}
        actions={
          <ButtonLink to="/themes" size="sm">
            {t("versions.backToThemes")}
          </ButtonLink>
        }
      >
        {themeQuery.error.status === 404
          ? t("versions.notFoundText")
          : errorText(themeQuery.error, i18n)}
      </Callout>
    );
  }
  if (!theme) return <Loading />;

  const selectedVersion =
    typeof comparison.to === "number"
      ? versions.find((version) => version.version_number === comparison.to)
      : undefined;
  const toLabel = refLabel(comparison.to, t("versions.draft"), t("versions.empty"));
  const fromLabel = refLabel(comparison.from, t("versions.draft"), t("versions.empty"));
  const busy = rollback.isPending || resetDraft.isPending;

  const download = (version: number) =>
    exportTheme.mutate(
      { themeId, format: "css", version, fallbackName: `${theme.slug}@${version}.css` },
      { onError: (error) => toast.err(errorText(error, i18n)) },
    );

  /**
   * Openstaande editorwijzigingen eerst opslaan (anders botst de lock), daarna de actuele lock
   * uit de cache. Lukt opslaan niet (conflict, offline), dan vervangt de actie ze bewust.
   */
  const freshLock = async (): Promise<number> => {
    try {
      await peekSession(themeId)?.flush();
    } catch {
      // zie hierboven
    }
    return (
      queryClient.getQueryData<Theme>(themeKeys.detail(themeId))?.lock_version ?? theme.lock_version
    );
  };

  /** De open editorsessie (als die er is) op de nieuwe serverdraft zetten. */
  const syncEditor = async (draft?: Draft) => {
    const session = peekSession(themeId);
    if (!session) return;
    try {
      const fresh = draft ?? (await fetchDraft(themeId));
      queryClient.setQueryData(themeKeys.draft(themeId), fresh);
      session.replaceWithServer(fresh);
    } catch {
      // De editor haalt de draft zelf opnieuw op (query ongeldig gemaakt).
    }
  };

  const doRollback = async (versionNumber: number) => {
    try {
      const result = await rollback.mutateAsync({
        themeId,
        versionNumber,
        lockVersion: await freshLock(),
        message: rollbackMessage.trim() || null,
      });
      setConfirm(null);
      setRollbackMessage("");
      void syncEditor();
      if (rollbackButtonRef.current) fx.rollback(rollbackButtonRef.current);
      toast.ok(t("versions.rolledBack", { n: result.data.version_number, source: versionNumber }));
      select(result.data.version_number);
      setFocusDiffTitle((count) => count + 1);
    } catch (error) {
      setConfirm(null);
      if (isApiError(error) && error.status === 412) {
        void themeQuery.refetch();
        toast.err(t("versions.changedMeanwhile"));
      } else {
        toast.err(errorText(error, i18n));
      }
    }
  };

  const doReset = async (versionNumber: number) => {
    try {
      const result = await resetDraft.mutateAsync({
        themeId,
        versionNumber,
        lockVersion: await freshLock(),
      });
      await syncEditor(result.data);
      setConfirm(null);
      toast.ok(t("versions.draftReset", { n: versionNumber }));
      navigate(`/editor/${themeId}`);
    } catch (error) {
      setConfirm(null);
      if (isApiError(error) && error.status === 412) {
        void themeQuery.refetch();
        toast.err(t("versions.changedMeanwhile"));
      } else {
        toast.err(errorText(error, i18n));
      }
    }
  };

  const openInEditor = (versionNumber: number) => {
    if (theme.draft_dirty || localDirty) setConfirm("reset");
    else void doReset(versionNumber);
  };

  // Zonder live versie valt er niets te vergelijken: "nog niet gepubliceerd" (neutraal).
  const neverPublished = liveVersion === null;
  const draftChanged = !neverPublished && theme.draft_dirty;

  return (
    <div ref={attachFill} className="flex min-w-0 flex-col" style={{ height: fillHeight }}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          to={`/editor/${theme.id}`}
          className="text-[13px] text-muted no-underline hover:text-white"
          aria-label={t("versions.backToEditor", { name: theme.name })}
        >
          ← {theme.name}
        </Link>
        <span aria-hidden className="text-dim">
          ·
        </span>
        <CardTitle className="text-[19px]">{t("versions.title")}</CardTitle>
        <ul
          className="m-0 flex list-none flex-wrap gap-1.5 p-0"
          aria-label={t("versions.statusTags")}
        >
          {themeStatusTags(theme).map((tag) => (
            <li key={tag.key}>
              <Tag tone={tag.tone}>{t(tag.key, tag.params)}</Tag>
            </li>
          ))}
        </ul>
        <span className="ml-auto text-[12.5px] text-dim">
          {tc("versions.count", latestVersion)}
        </span>
      </div>

      <div className={cn("flex min-h-0 flex-1 gap-3", narrow ? "flex-col" : "flex-row")}>
        <section
          aria-label={t("versions.listLabel")}
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-line-strong bg-black/25",
            narrow ? "max-h-[38%]" : "w-[340px] flex-none",
          )}
        >
          <ul className="m-0 min-h-0 flex-1 list-none space-y-1 overflow-auto p-1.5">
            <li>
              <button
                type="button"
                aria-pressed={comparison.to === "draft"}
                onClick={() => select("draft")}
                className={cn(
                  "w-full rounded-lg border-l-[3px] px-3 py-2 text-left text-[12.5px] outline-none",
                  "focus-visible:outline-2 focus-visible:outline-white",
                  draftChanged ? "border-mid" : "border-white/15",
                  comparison.to === "draft" ? "bg-white/14 text-white" : "text-fg hover:bg-white/6",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span aria-hidden className={draftChanged ? "text-mid" : "text-dim"}>
                    ○
                  </span>
                  <b className="text-heading">{t("versions.draft")}</b>{" "}
                  {neverPublished ? (
                    <Tag>{t("versions.draftNeverLive")}</Tag>
                  ) : draftChanged ? (
                    <Tag tone="mid">{t("versions.draftChanged")}</Tag>
                  ) : (
                    <Tag>{t("versions.draftSame")}</Tag>
                  )}{" "}
                  {theme.draft_updated_at && (
                    <span
                      className="ml-auto text-[11.5px] text-dim"
                      title={formatDateTime(theme.draft_updated_at, locale)}
                    >
                      {formatRelative(theme.draft_updated_at, locale)}
                    </span>
                  )}
                </span>{" "}
                <span className="mt-0.5 block text-[11.5px] text-dim">
                  {formatBytes(draftQuery.data?.size_bytes ?? theme.draft_size_bytes, locale)}
                </span>
              </button>
            </li>
            {versionsQuery.isPending ? (
              <li>
                <Loading />
              </li>
            ) : versionsQuery.isError ? (
              <li className="px-2 text-[12.5px] text-err">
                {errorText(versionsQuery.error, i18n)}
              </li>
            ) : versions.length === 0 ? (
              <li className="px-3 py-2 text-[12.5px] text-muted">{t("versions.none")}</li>
            ) : (
              versions.map((version) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  selected={comparison.to === version.version_number}
                  onSelect={() => select(version.version_number)}
                />
              ))
            )}
          </ul>
          {versionsQuery.hasNextPage && (
            <div className="border-t border-line p-1.5">
              <Button
                variant="mini"
                disabled={versionsQuery.isFetchingNextPage}
                onClick={() => void versionsQuery.fetchNextPage()}
              >
                {t("versions.loadMore")}
              </Button>
            </div>
          )}
        </section>

        <section
          aria-label={t("versions.diffLabel", { from: fromLabel, to: toLabel })}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line-strong bg-black/25"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Field
              label={t("versions.compareWith")}
              className="flex items-center gap-2 [&_label]:m-0"
            >
              <Select
                value={comparison.from === null ? "empty" : String(comparison.from)}
                onChange={(event) => setFrom(event.target.value)}
                className="w-auto py-1 text-[12.5px]"
              >
                <option value="empty">{t("versions.empty")}</option>
                {comparison.to !== "draft" && <option value="draft">{t("versions.draft")}</option>}
                {versions
                  .filter((version) => version.version_number !== comparison.to)
                  .map((version) => (
                    <option key={version.id} value={version.version_number}>
                      v{version.version_number}
                      {version.is_live ? ` (${t("versions.live")})` : ""}
                    </option>
                  ))}
              </Select>
            </Field>
            <h2
              ref={diffTitleRef}
              tabIndex={-1}
              className="m-0 rounded-sm font-bold text-heading outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {fromLabel} ⟷ {toLabel}
            </h2>
            {comparison.from !== null && diffStats.data && (
              <span className="text-[12.5px]">
                <span className="text-ok">+{diffStats.data.stats.added}</span>{" "}
                <span className="text-err">−{diffStats.data.stats.removed}</span>
              </span>
            )}
            <div role="group" aria-label={t("versions.viewLabel")} className="ml-auto flex gap-1">
              <Button variant="mini" aria-pressed={sideBySide} onClick={() => setSideBySide(true)}>
                {t("versions.sideBySide")}
              </Button>
              <Button
                variant="mini"
                aria-pressed={!sideBySide}
                onClick={() => setSideBySide(false)}
              >
                {t("versions.inline")}
              </Button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            {original.error || modified.error ? (
              <Callout tone="err" className="m-3">
                {original.error ?? modified.error}
              </Callout>
            ) : original.pending || modified.pending ? (
              <Loading />
            ) : (
              <ErrorBoundary
                fallback={(error, reset) => (
                  <Callout
                    tone="err"
                    className="m-3"
                    title={t("versions.monacoFailed")}
                    actions={
                      <Button variant="alt" size="sm" onClick={reset}>
                        {t("versions.retry")}
                      </Button>
                    }
                  >
                    {error.message}
                  </Callout>
                )}
              >
                <Suspense fallback={<Loading />}>
                  <DiffView
                    original={original.css}
                    modified={modified.css}
                    sideBySide={sideBySide}
                    ariaLabel={t("versions.diffLabel", { from: fromLabel, to: toLabel })}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
            {typeof comparison.to === "number" ? (
              <>
                <Button variant="alt" size="sm" onClick={() => download(comparison.to as number)}>
                  ⤓ {t("versions.download", { n: comparison.to })}
                </Button>
                <Button
                  variant="alt"
                  size="sm"
                  disabled={busy || Boolean(theme.deleted_at)}
                  onClick={() => openInEditor(comparison.to as number)}
                >
                  {t("versions.openInEditor")}
                </Button>
                <Button
                  ref={rollbackButtonRef}
                  size="sm"
                  disabled={busy || Boolean(theme.deleted_at) || Boolean(selectedVersion?.is_live)}
                  onClick={() => setConfirm("rollback")}
                  title={selectedVersion?.is_live ? t("versions.alreadyLive") : undefined}
                >
                  ↺ {t("versions.rollback", { n: comparison.to })}
                </Button>
                {selectedVersion?.is_live && (
                  <span className="text-[12px] text-dim">{t("versions.alreadyLive")}</span>
                )}
              </>
            ) : (
              <ButtonLink to={`/editor/${theme.id}`} size="sm">
                {t("versions.editDraft")}
              </ButtonLink>
            )}
          </div>
        </section>
      </div>

      {typeof comparison.to === "number" && (
        <>
          <ConfirmDialog
            open={confirm === "rollback"}
            title={t("versions.rollbackTitle", { n: comparison.to })}
            command={`cssthema rollback ${theme.slug} v${comparison.to}`}
            confirmLabel={t("versions.rollbackConfirm", { n: comparison.to })}
            busy={rollback.isPending}
            onCancel={() => setConfirm(null)}
            onConfirm={() => void doRollback(comparison.to as number)}
          >
            <p className="m-0">
              {t("versions.rollbackText", { n: comparison.to, next: latestVersion + 1 })}
            </p>
            {(theme.draft_dirty || localDirty) && (
              <p className="mt-2 mb-0 text-mid">{t("versions.rollbackDraftWarning")}</p>
            )}
            <Field label={t("versions.rollbackMessage")}>
              <Textarea
                rows={2}
                maxLength={500}
                value={rollbackMessage}
                onChange={(event) => setRollbackMessage(event.target.value)}
                placeholder={t("versions.rollbackMessagePlaceholder", { n: comparison.to })}
              />
            </Field>
          </ConfirmDialog>
          <ConfirmDialog
            open={confirm === "reset"}
            title={t("versions.resetTitle", { n: comparison.to })}
            command={`cssthema reset ${theme.slug} v${comparison.to}`}
            confirmLabel={t("versions.resetConfirm")}
            tone="danger"
            busy={resetDraft.isPending}
            onCancel={() => setConfirm(null)}
            onConfirm={() => void doReset(comparison.to as number)}
          >
            {t("versions.resetText", { n: comparison.to })}
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}
