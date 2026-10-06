import { useIsFetching } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { isApiError, isNetworkError, lintIssuesOf } from "@/api/client";
import { useDiff, useLint, usePublishTheme } from "@/api/queries/editor";
import { themeKeys } from "@/api/queries/keys";
import type { LintIssue, Theme, Version } from "@/api/types";
import { Button, Code, Details, Dialog, Field, Loading, Textarea, toast } from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { fx } from "@/lib/fx";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DraftSession } from "../autosave/draft-session";
import { useSessionSnapshot } from "../autosave/sessions";
import { publishChecks } from "../lib/publish-checks";
import { UnifiedDiff } from "./UnifiedDiff";

export interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  session: DraftSession;
  onPublished?: (version: Version) => void;
}

/**
 * Publiceerdialoog (F-ED-10, docs/04 § 3.3): nieuwe versie, +/− regels t.o.v. live (met diff),
 * bericht, validatie-uitslag en live-URL. Publiceren kan pas als alles op de server staat en
 * er geen lint-fouten zijn; bij succes vonken en een kleine explosie.
 */
export function PublishDialog(props: PublishDialogProps) {
  if (!props.open) return null;
  return <PublishDialogContent {...props} />;
}

function PublishDialogContent({ onClose, theme, session, onPublished }: PublishDialogProps) {
  const i18n = useI18n();
  const { t, tc } = i18n;
  const snapshot = useSessionSnapshot(session);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<{ text: string; issues: LintIssue[] } | null>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const publish = usePublishTheme();

  const state = snapshot?.state.kind ?? "saved";
  const synced = state === "saved";
  const live = theme.published_version?.version_number ?? null;
  const nextVersion = theme.latest_version_number + 1;
  const lint = useLint(theme.id, snapshot?.css);
  const diff = useDiff(theme.id, live, "draft", { enabled: synced && live !== null });
  const errors = lint.data?.errors ?? [];
  const warnings = lint.data?.warnings ?? [];
  const checks = publishChecks(errors);
  const lintReady = lint.data !== undefined && !lint.isPlaceholderData;
  // `draft_dirty` rekent de server uit (draft én palet t.o.v. live); na een autosave haalt de
  // editor het thema opnieuw op, en tot dat binnen is weten we het nog niet zeker.
  const themeFetching = useIsFetching({ queryKey: themeKeys.detail(theme.id), exact: true }) > 0;
  const unchanged = live !== null && synced && !theme.draft_dirty;

  const blocked: MessageKey | null =
    state === "conflict"
      ? "editor.publishBlockedConflict"
      : state === "offline"
        ? "editor.publishBlockedOffline"
        : state === "error"
          ? "editor.publishBlockedError"
          : !synced || (unchanged && themeFetching)
            ? "editor.publishWaitSave"
            : unchanged
              ? "editor.publishNothing"
              : errors.length
                ? "editor.publishBlockedErrors"
                : null;

  const submit = async (retried = false): Promise<void> => {
    if (!snapshot || blocked || !lintReady) return;
    setFailure(null);
    try {
      const result = await publish.mutateAsync({
        themeId: theme.id,
        // Uit de sessie zelf: na `refreshLock()` staat daar al de nieuwe lock.
        expectedLockVersion: session.getSnapshot().lockVersion,
        message: message.trim() || null,
      });
      session.setLockVersion(result.lockVersion);
      if (publishRef.current) fx.publish(publishRef.current);
      toast.ok(t("editor.published", { n: result.data.version_number, slug: theme.slug }));
      onPublished?.(result.data);
      onClose();
    } catch (error) {
      if (isApiError(error) && error.status === 412) {
        // Alleen de lock schoof op (bv. verwijderen + herstellen): één keer opnieuw proberen.
        if (!retried && (await session.refreshLock())) return submit(true);
        session.markConflict(error.current, "publish");
        onClose();
        return;
      }
      if (isNetworkError(error)) {
        setFailure({ text: t("editor.offlineError"), issues: [] });
        return;
      }
      setFailure({ text: errorText(error, i18n), issues: lintIssuesOf(error) });
    }
  };

  const busy = publish.isPending;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="md"
      command={`cssthema publish ${theme.slug}`}
      title={t("editor.publishTitle", { slug: theme.slug })}
      footer={
        <>
          <Button
            ref={publishRef}
            onClick={() => void submit()}
            disabled={Boolean(blocked) || !lintReady || busy}
            aria-busy={busy || undefined}
          >
            {busy ? t("editor.publishing") : t("editor.publishButton", { n: nextVersion })}
          </Button>
          <Button variant="alt" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          {blocked && (
            <span role="status" className="text-[12.5px] text-mid">
              {t(blocked, { n: live ?? 0 })}
            </span>
          )}
        </>
      }
    >
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">{t("editor.publishNewVersion")}</dt>
        <dd className="m-0 font-bold text-heading">v{nextVersion}</dd>
        <dt className="text-muted">
          {live === null
            ? t("editor.publishChangesFirst")
            : t("editor.publishChanges", { n: live })}
        </dt>
        <dd className="m-0">
          {live === null ? (
            <span className="text-dim">{t("editor.publishFirst")}</span>
          ) : !synced || diff.isPending ? (
            <span className="text-dim">…</span>
          ) : diff.isError ? (
            <span className="text-err">{errorText(diff.error, i18n)}</span>
          ) : (
            <>
              <span className="text-ok">+{diff.data.stats.added}</span>{" "}
              <span className="text-err">−{diff.data.stats.removed}</span>{" "}
              {tc("editor.publishLines", diff.data.stats.added + diff.data.stats.removed)}
            </>
          )}
        </dd>
      </dl>
      {live !== null && synced && diff.data && diff.data.unified && (
        <Details summary={t("editor.publishShowDiff")} className="mt-2">
          <UnifiedDiff
            unified={diff.data.unified}
            label={t("editor.publishDiffLabel", { n: live })}
          />
        </Details>
      )}

      <Field label={t("editor.publishMessage")} hint={t("editor.publishMessageHint")}>
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t("editor.publishMessagePlaceholder")}
          maxLength={500}
          rows={2}
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </Field>

      <h3 className="mt-4 mb-1 text-[11.5px] font-normal tracking-[.08em] text-muted uppercase">
        {t("editor.publishValidation")}
      </h3>
      {!lint.data ? (
        <Loading label={t("editor.linting")} />
      ) : (
        <ul className="m-0 list-none p-0" aria-busy={lint.isFetching || undefined}>
          {checks.map((check) => (
            <li key={check.key} className="py-0.5">
              <span aria-hidden className={check.ok ? "text-ok" : "text-err"}>
                {check.ok ? "✓" : "✕"}
              </span>{" "}
              {t(check.key)}
              {check.issues.length > 0 && (
                <ul className="m-0 mt-0.5 mb-1 ml-5 list-none p-0 text-[12px] text-err">
                  {check.issues.map((issue, index) => (
                    <li key={index}>
                      {t("editor.lineColumn", { line: issue.line, column: issue.column })} ·{" "}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          <li className="py-0.5">
            <span aria-hidden className={warnings.length ? "text-mid" : "text-ok"}>
              {warnings.length ? "⚠" : "✓"}
            </span>{" "}
            {warnings.length
              ? tc("editor.checkWarnings", warnings.length)
              : t("editor.checkNoWarnings")}
          </li>
        </ul>
      )}

      <p className="mt-4 mb-0 text-[12.5px] text-muted">
        {t("editor.publishLiveAt")} <Code className="break-all">{theme.public_url}</Code>
      </p>
      {theme.shadowed_by_file && (
        <p className="mt-1.5 mb-0 text-[12.5px] text-mid">{t("editor.publishShadowed")}</p>
      )}

      {failure && (
        <div
          role="alert"
          className={cn(
            "mt-3 rounded-[10px] border border-err/60 bg-err/8 px-3.5 py-2.5 text-[12.5px]",
          )}
        >
          <p className="m-0 text-heading">{failure.text}</p>
          {failure.issues.length > 0 && (
            <ul className="m-0 mt-1 list-none p-0 text-err">
              {failure.issues.map((issue, index) => (
                <li key={index}>
                  {t("editor.lineColumn", { line: issue.line, column: issue.column })} ·{" "}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
