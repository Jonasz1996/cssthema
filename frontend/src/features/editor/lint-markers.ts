import type { LintIssue, LintResult } from "@/api/types";

/**
 * Lint-meldingen van de server (`POST /themes/{id}/lint`) → markers voor Monaco
 * (`editor.setModelMarkers`). Puur: geen Monaco-import, de ernst-waarden komen als parameter
 * mee (`monaco.MarkerSeverity`), zodat dit zonder editor te testen is.
 *
 * De server telt regels en kolommen vanaf 1 in Unicode-codepunten (Python); Monaco telt
 * UTF-16-eenheden. Een melding markeert het woord op die plek (property, url, selector), of
 * anders één teken.
 */

/** Eigenaar van onze markers op een model (los van Monaco's eigen CSS-validatie). */
export const LINT_MARKER_OWNER = "cssthema-lint";

export interface MarkerSeverities {
  error: number;
  warning: number;
  info: number;
}

/** Vorm van `monaco.editor.IMarkerData` die we invullen. */
export interface LintMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
  code: string;
  source: string;
}

/** 1-based kolom in codepunten → 1-based kolom in UTF-16-eenheden. */
export function codePointColumnToUtf16(line: string, column: number): number {
  let units = 0;
  let points = 1;
  for (const char of line) {
    if (points >= column) break;
    units += char.length;
    points += 1;
  }
  // Voorbij het einde van de regel: tel de rest als gewone tekens.
  return units + 1 + Math.max(0, column - points);
}

const WORD = /[\w\-#.%@!]/;

/** Eindkolom (exclusief, 1-based) van het woord dat op `column` begint. */
function wordEnd(line: string, column: number): number {
  let index = column - 1;
  if (index >= line.length) return line.length + 1;
  if (!WORD.test(line[index]!)) return column + 1;
  // url(…) en strings: tot het sluitende haakje/aanhalingsteken.
  const rest = line.slice(index);
  const call = /^[\w-]+\([^)]*\)?/.exec(rest);
  if (call) return column + call[0].length;
  while (index < line.length && WORD.test(line[index]!)) index += 1;
  return index + 1;
}

export interface LintMarkerOptions {
  severities: MarkerSeverities;
  /** Bronlabel in de hover, bv. `cssthema`. */
  source?: string;
}

/** Eén melding → marker; regel en kolom worden binnen het document gehouden. */
export function lintIssueToMarker(
  issue: LintIssue,
  lines: readonly string[],
  { severities, source = "cssthema" }: LintMarkerOptions,
): LintMarker {
  const lineCount = Math.max(lines.length, 1);
  const lineNumber = Math.min(Math.max(Math.trunc(issue.line) || 1, 1), lineCount);
  const text = lines[lineNumber - 1] ?? "";
  let startColumn = codePointColumnToUtf16(text, Math.max(Math.trunc(issue.column) || 1, 1));
  startColumn = Math.min(startColumn, text.length + 1);
  let endColumn = wordEnd(text, startColumn);
  if (endColumn <= startColumn) endColumn = startColumn + 1;
  // Melding achter het einde van de regel (bv. "niet gesloten"): markeer het laatste teken.
  if (startColumn > text.length && text.length > 0) {
    startColumn = text.length;
    endColumn = text.length + 1;
  }
  const severity =
    issue.severity === "error"
      ? severities.error
      : issue.severity === "warning"
        ? severities.warning
        : severities.info;
  return {
    startLineNumber: lineNumber,
    startColumn,
    endLineNumber: lineNumber,
    endColumn,
    message: issue.message,
    severity,
    code: issue.rule,
    source,
  };
}

/** Alle fouten en waarschuwingen van een lint-resultaat → markers (fouten eerst). */
export function lintMarkers(
  result: LintResult | null | undefined,
  text: string,
  options: LintMarkerOptions,
): LintMarker[] {
  if (!result) return [];
  const lines = text.split(/\r\n|\r|\n/);
  return [...result.errors, ...result.warnings].map((issue) =>
    lintIssueToMarker(issue, lines, options),
  );
}

export interface LintCounts {
  errors: number;
  warnings: number;
}

export function lintCounts(result: LintResult | null | undefined): LintCounts {
  return { errors: result?.errors.length ?? 0, warnings: result?.warnings.length ?? 0 };
}

/** Meldingen gesorteerd op plaats (voor het probleempaneel), fouten vóór waarschuwingen. */
export function sortedIssues(result: LintResult | null | undefined): LintIssue[] {
  if (!result) return [];
  const rank = (issue: LintIssue) => (issue.severity === "error" ? 0 : 1);
  return [...result.errors, ...result.warnings].sort(
    (a, b) => rank(a) - rank(b) || a.line - b.line || a.column - b.column,
  );
}
