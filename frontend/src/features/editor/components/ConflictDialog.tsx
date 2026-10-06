import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { fetchDraft } from "@/api/queries/editor";
import { themeKeys } from "@/api/queries/keys";
import type { Draft } from "@/api/types";
import { Button, Dialog, Loading, toast } from "@/components/ui";
import { apiErrorText, errorText } from "@/features/themes/lib/errors";
import { useI18n } from "@/lib/i18n";
import type { DraftSession } from "../autosave/draft-session";
import { useSessionSnapshot } from "../autosave/sessions";
import { formatTime } from "../lib/format";
import { DiffView } from "./DiffView";
import { ErrorBoundary } from "./ErrorBoundary";

export interface ConflictDialogProps {
  open: boolean;
  onClose: () => void;
  session: DraftSession;
  slug: string;
}

type Busy = "reload" | "overwrite" | "diff" | null;

/**
 * Conflict bij autosave (412) of bij het terugzetten van lokaal bewaarde wijzigingen op een
 * nieuwere serverversie. Keuzes: herladen (serverversie wint), mijn versie overschrijven, of
 * eerst de verschillen bekijken (Monaco-diff: server links, mijn versie rechts).
 */
export function ConflictDialog({ open, onClose, session, slug }: ConflictDialogProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const queryClient = useQueryClient();
  const snapshot = useSessionSnapshot(session);
  const [busy, setBusy] = useState<Busy>(null);
  const [server, setServer] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  const focusDiff = useRef(false);

  const state = snapshot?.state;
  const conflict = state?.kind === "conflict" ? state : null;

  // Elke nieuwe conflictmelding (of een andere tab) begint zonder diff: een diff van een
  // vorig conflict toont serverinhoud die intussen niet meer klopt.
  const [shownFor, setShownFor] = useState(conflict);
  if (conflict !== shownFor) {
    setShownFor(conflict);
    setServer(null);
    setError(null);
  }

  // Na "Diff bekijken" verdwijnt die knop: de focus gaat naar de diff in plaats van naar <body>.
  useEffect(() => {
    if (server && focusDiff.current) {
      focusDiff.current = false;
      diffRef.current?.focus();
    }
  }, [server]);

  const loadServer = async (): Promise<Draft> => {
    const draft = await fetchDraft(session.themeId);
    queryClient.setQueryData(themeKeys.draft(session.themeId), draft);
    setServer(draft);
    return draft;
  };

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure, i18n));
    } finally {
      setBusy(null);
    }
  };

  const reload = () =>
    run("reload", async () => {
      const draft = await loadServer();
      session.replaceWithServer(draft);
      toast(t("editor.conflictReloaded"));
      close();
    });

  const overwrite = () =>
    run("overwrite", async () => {
      const draft = await loadServer();
      const result = await session.overwrite(draft.lock_version);
      if (result.state.kind === "saved") {
        toast.ok(t("editor.conflictOverwritten"));
        close();
      } else if (result.state.kind === "error") {
        setError(apiErrorText(result.state, i18n));
      }
    });

  const showDiff = () =>
    run("diff", async () => {
      focusDiff.current = true;
      await loadServer();
    });

  const close = () => {
    setServer(null);
    setError(null);
    onClose();
  };

  const who = conflict?.current?.updated_by?.display_name;
  const when = conflict?.current?.updated_at
    ? formatTime(conflict.current.updated_at, locale)
    : null;
  const description =
    conflict?.origin === "restore"
      ? t("editor.conflictRestoreText")
      : who && when
        ? t("editor.conflictTextBy", { name: who, time: when })
        : t("editor.conflictText");

  return (
    <Dialog
      open={open && Boolean(conflict)}
      onClose={close}
      dismissible={busy === null}
      size={server ? "lg" : "md"}
      command={`cssthema conflict ${slug}`}
      title={t("editor.conflictTitle")}
      description={description}
      footer={
        <>
          <Button
            onClick={() => void reload()}
            disabled={busy !== null}
            aria-busy={busy === "reload" || undefined}
          >
            {t("editor.conflictReload")}
          </Button>
          <Button
            variant="danger"
            onClick={() => void overwrite()}
            disabled={busy !== null}
            aria-busy={busy === "overwrite" || undefined}
          >
            {t("editor.conflictOverwrite")}
          </Button>
          {!server && (
            <Button
              variant="alt"
              onClick={() => void showDiff()}
              disabled={busy !== null}
              aria-busy={busy === "diff" || undefined}
            >
              {t("editor.conflictShowDiff")}
            </Button>
          )}
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-muted">{t("editor.conflictSafe")}</p>
      {error && (
        <p role="alert" className="mt-2 mb-0 text-[12.5px] text-err">
          {error}
        </p>
      )}
      {server && snapshot && (
        <div
          ref={diffRef}
          tabIndex={-1}
          role="group"
          aria-label={t("editor.conflictDiffRegion")}
          className="mt-3 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <div className="mb-1 flex justify-between text-[11.5px] text-muted">
            <span>{t("editor.conflictServerSide", { n: server.lock_version })}</span>
            <span>{t("editor.conflictMineSide")}</span>
          </div>
          <div className="h-[46vh] overflow-hidden rounded-lg border border-line">
            <ErrorBoundary
              fallback={(failure) => <p className="p-3 text-err">{failure.message}</p>}
            >
              <Suspense fallback={<Loading />}>
                <DiffView
                  original={server.css}
                  modified={snapshot.css}
                  ariaLabel={t("editor.conflictDiffLabel")}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      )}
    </Dialog>
  );
}
