import type { LintIssue } from "@/api/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Lint-meldingen (bv. uit 422 `theme_lint_failed`): regel:kolom · regel-id · bericht. */
export function LintIssueList({
  issues,
  className,
}: {
  issues: readonly LintIssue[];
  className?: string;
}) {
  const { t } = useI18n();
  if (!issues.length) return null;
  return (
    <ul className={cn("m-0 mt-1.5 list-none p-0 text-[12px] leading-[1.55]", className)}>
      {issues.map((issue, index) => (
        <li key={`${issue.line}:${issue.column}:${issue.rule}:${index}`} className="flex gap-2">
          <span className={issue.severity === "error" ? "text-err" : "text-mid"} aria-hidden>
            {issue.severity === "error" ? "✕" : "⚠"}
          </span>
          <span className="min-w-0">
            <span className="text-dim">
              {t("import.lintPosition", { line: issue.line, column: issue.column })} ·{" "}
            </span>
            <code className="text-code">{issue.rule}</code>
            <span className="text-fg"> · {issue.message}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
