import type { LintIssue } from "@/api/types";
import type { MessageKey } from "@/lib/i18n";

/** Lint-regels per controle in de publiceerdialoog (docs/04 § 3.3). */
const PARSE_RULES = new Set(["parse-error"]);
const EXTERNAL_RULES = new Set(["external-url", "external-import"]);

export interface PublishCheck {
  key: MessageKey;
  ok: boolean;
  issues: LintIssue[];
}

/** De drie controles: parsebaar, geen externe URL's, overige beveiligingsregels. */
export function publishChecks(errors: readonly LintIssue[]): PublishCheck[] {
  const parse = errors.filter((issue) => PARSE_RULES.has(issue.rule));
  const external = errors.filter((issue) => EXTERNAL_RULES.has(issue.rule));
  const other = errors.filter(
    (issue) => !PARSE_RULES.has(issue.rule) && !EXTERNAL_RULES.has(issue.rule),
  );
  return [
    {
      key: parse.length ? "editor.checkParseFailed" : "editor.checkParse",
      ok: !parse.length,
      issues: parse,
    },
    {
      key: external.length ? "editor.checkExternalFailed" : "editor.checkExternal",
      ok: !external.length,
      issues: external,
    },
    {
      key: other.length ? "editor.checkOtherFailed" : "editor.checkOther",
      ok: !other.length,
      issues: other,
    },
  ];
}
