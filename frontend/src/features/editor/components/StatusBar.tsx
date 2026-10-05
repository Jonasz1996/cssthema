import type { ReactNode } from "react";
import type { LintResult } from "@/api/types";
import { Button } from "@/components/ui";
import { apiErrorText } from "@/features/themes/lib/errors";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DraftSession, SaveState } from "../autosave/draft-session";
import { useSessionValue } from "../autosave/sessions";
import { formatBytes, utf8Length } from "../lib/format";
import { type SaveStatusView, saveStatusView } from "../lib/save-status";
import { lintCounts } from "../lint-markers";
import type { CursorPosition } from "./CodeEditor";

/** Vaste waarde zolang er nog geen sessie is (stabiel voor `useSyncExternalStore`). */
const IDLE: SaveState = { kind: "saved", at: null };

const toneClass: Record<SaveStatusView["tone"], string> = {
  ok: "text-ok",
  mid: "text-mid",
  err: "text-err",
  busy: "text-muted",
};

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

export interface StatusBarProps {
  session: DraftSession | undefined;
  lint: LintResult | undefined;
  lintPending: boolean;
  cursor: CursorPosition | null;
  paletteName: string | null;
  problemsOpen: boolean;
  problemsId: string;
  onToggleProblems: () => void;
  /** Klik op de status bij conflict/offline/fout. */
  onStatusAction: (state: SaveState) => void;
}

/**
 * Statusbalk onder de editor (docs/04 § 3.2): autosave-toestand, fouten en waarschuwingen
 * (klik = probleempaneel), grootte, cursorpositie, taal en gekoppeld palet.
 */
export function StatusBar({
  session,
  lint,
  lintPending,
  cursor,
  paletteName,
  problemsOpen,
  problemsId,
  onToggleProblems,
  onStatusAction,
}: StatusBarProps) {
  const i18n = useI18n();
  const { t, tc, locale } = i18n;
  const state = useSessionValue<SaveState>(session, (snapshot) => snapshot.state, IDLE);
  const bytes = useSessionValue(session, (snapshot) => utf8Length(snapshot.css), 0);
  const view = saveStatusView(state, locale);
  const counts = lintCounts(lint);
  const actionKey =
    state.kind === "conflict" || state.kind === "offline" || state.kind === "error"
      ? (`editor.saveAction_${state.kind}` as const)
      : null;
  const label = t(view.key, view.params);
  const detail = state.kind === "error" ? apiErrorText(state, i18n) : undefined;

  return (
    <div
      aria-label={t("editor.statusBarLabel")}
      role="group"
      className="flex min-h-8 flex-wrap items-center gap-y-1 border-t border-line bg-black/40 px-1 py-1 text-[12px] text-muted"
    >
      <span role="status" aria-live="polite" className="contents">
        {actionKey ? (
          <Button
            variant="mini"
            className={cn("mx-1 py-0.5", toneClass[view.tone])}
            onClick={() => onStatusAction(state)}
            title={detail ?? t(actionKey)}
          >
            <span aria-hidden>{view.icon}</span> {label}
          </Button>
        ) : (
          <Cell className={toneClass[view.tone]}>
            <span aria-hidden>{view.icon}</span> {label}
          </Cell>
        )}
      </span>
      <span aria-hidden className="text-line-strong">
        │
      </span>
      <Button
        variant="mini"
        className={cn("mx-1 py-0.5", counts.errors > 0 && "text-err")}
        aria-expanded={problemsOpen}
        aria-controls={problemsId}
        onClick={onToggleProblems}
        title={t("editor.problemsToggle")}
      >
        <span aria-hidden>✕</span> {tc("editor.errors", counts.errors)}
      </Button>
      <Button
        variant="mini"
        className={cn("mx-1 py-0.5", counts.warnings > 0 && "text-mid")}
        aria-expanded={problemsOpen}
        aria-controls={problemsId}
        onClick={onToggleProblems}
        title={t("editor.problemsToggle")}
      >
        <span aria-hidden>⚠</span> {tc("editor.warnings", counts.warnings)}
      </Button>
      {lintPending && (
        <Cell className="text-dim">
          <span className="sr-only">{t("editor.linting")}</span>
          <span aria-hidden>…</span>
        </Cell>
      )}
      <span aria-hidden className="text-line-strong">
        │
      </span>
      <Cell>{formatBytes(bytes, locale)}</Cell>
      {cursor && (
        <Cell>{t("editor.cursorPosition", { line: cursor.line, column: cursor.column })}</Cell>
      )}
      <Cell>CSS</Cell>
      <Cell className="ml-auto">
        {paletteName ? t("editor.paletteName", { name: paletteName }) : t("editor.noPalette")}
      </Cell>
    </div>
  );
}
