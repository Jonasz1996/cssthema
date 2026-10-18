import type { LintIssue, LintResult } from "@/api/types";
import { Button, Empty } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { sortedIssues } from "../lint-markers";

export interface ProblemsPanelProps {
  id: string;
  lint: LintResult | undefined;
  onSelect: (issue: LintIssue) => void;
  onClose: () => void;
}

/** Probleempaneel onder de editor: alle lint-meldingen, klikbaar naar de regel. */
export function ProblemsPanel({ id, lint, onSelect, onClose }: ProblemsPanelProps) {
  const { t, tc } = useI18n();
  const issues = sortedIssues(lint);
  return (
    <section
      id={id}
      aria-label={t("editor.problemsTitle")}
      className="flex max-h-[34%] min-h-[96px] flex-none flex-col border-t border-line bg-black/35"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] tracking-[.08em] text-muted uppercase">
        {t("editor.problemsTitle")}
        <span className="normal-case tracking-normal text-dim">
          {tc("editor.errors", lint?.errors.length ?? 0)} ·{" "}
          {tc("editor.warnings", lint?.warnings.length ?? 0)}
        </span>
        <Button
          variant="mini"
          size="icon"
          tone="danger"
          className="ml-auto"
          aria-label={t("editor.problemsClose")}
          title={t("editor.problemsClose")}
          onClick={onClose}
        >
          ✕
        </Button>
      </div>
      {issues.length === 0 ? (
        <Empty className="px-3">{t("editor.problemsNone")}</Empty>
      ) : (
        <ul className="m-0 min-h-0 list-none overflow-auto p-1">
          {issues.map((issue, index) => {
            const error = issue.severity === "error";
            return (
              <li key={`${issue.rule}-${issue.line}-${issue.column}-${index}`}>
                <button
                  type="button"
                  onClick={() => onSelect(issue)}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-md border-l-2 px-2 py-1 text-left text-[12.5px]",
                    "hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-white",
                    error ? "border-err" : "border-mid",
                  )}
                >
                  <span aria-hidden className={error ? "text-err" : "text-mid"}>
                    {error ? "✕" : "⚠"}
                  </span>
                  <span className="sr-only">
                    {error ? t("editor.severityError") : t("editor.severityWarning")}
                  </span>
                  <span className="text-fg">{issue.message}</span>
                  <span className="ml-auto flex-none text-dim">
                    {issue.rule} ·{" "}
                    {t("editor.lineColumn", { line: issue.line, column: issue.column })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
