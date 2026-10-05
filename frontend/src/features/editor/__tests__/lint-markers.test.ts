import { describe, expect, it } from "vitest";
import { makeLintResult } from "@/api/testing/fixtures";
import type { LintIssue } from "@/api/types";
import {
  codePointColumnToUtf16,
  lintCounts,
  lintIssueToMarker,
  lintMarkers,
  sortedIssues,
} from "../lint-markers";

const severities = { error: 8, warning: 4, info: 2 };

function issue(overrides: Partial<LintIssue>): LintIssue {
  return {
    rule: "unknown-property",
    severity: "warning",
    message: "Onbekende property",
    line: 1,
    column: 1,
    ...overrides,
  } as LintIssue;
}

describe("lint markers (server lint → Monaco)", () => {
  const css = [
    "body {",
    "  colr: red;",
    "  background: url(https://evil.example/x.png);",
    "  content: '😀'; color: bluee;",
    "}",
  ].join("\n");
  const lines = css.split("\n");

  it("marks the whole property name at the reported 1-based position", () => {
    const marker = lintIssueToMarker(issue({ line: 2, column: 3 }), lines, { severities });
    expect(marker).toEqual({
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 7,
      message: "Onbekende property",
      severity: 4,
      code: "unknown-property",
      source: "cssthema",
    });
  });

  it("marks a whole url(…) call for external URLs, with error severity", () => {
    const marker = lintIssueToMarker(
      issue({ rule: "external-url", severity: "error", line: 3, column: 15, message: "Extern" }),
      lines,
      { severities, source: "lint" },
    );
    expect(marker.severity).toBe(8);
    expect(marker.source).toBe("lint");
    expect(lines[2]!.slice(marker.startColumn - 1, marker.endColumn - 1)).toBe(
      "url(https://evil.example/x.png)",
    );
  });

  it("converts code-point columns (server) to UTF-16 columns (Monaco)", () => {
    // 'color' staat na een emoji (2 UTF-16-eenheden, 1 codepunt).
    const line = lines[3]!;
    const codePoints = Array.from(line).indexOf("c", 14) + 1;
    expect(codePointColumnToUtf16(line, codePoints)).toBe(line.indexOf("color") + 1);
    const marker = lintIssueToMarker(issue({ line: 4, column: codePoints }), lines, { severities });
    expect(line.slice(marker.startColumn - 1, marker.endColumn - 1)).toBe("color");
    expect(codePointColumnToUtf16("abc", 1)).toBe(1);
    expect(codePointColumnToUtf16("abc", 6)).toBe(6);
    // Uit de review: de server meldt `colr` op 1:21 (codepunten); in Monaco is dat kolom 24.
    const emoji = 'a { content: "😀😀😀"; colr: red; }';
    expect(codePointColumnToUtf16(emoji, 21)).toBe(24);
    expect(emoji.slice(23, 27)).toBe("colr");
  });

  it("clamps positions outside the document instead of throwing", () => {
    const below = lintIssueToMarker(issue({ line: 99, column: 1 }), lines, { severities });
    expect(below.startLineNumber).toBe(5);
    const zero = lintIssueToMarker(issue({ line: 0, column: 0 }), lines, { severities });
    expect(zero).toMatchObject({ startLineNumber: 1, startColumn: 1 });
    // Voorbij het einde van de regel (bv. "niet gesloten"): het laatste teken.
    const pastEnd = lintIssueToMarker(issue({ line: 1, column: 40 }), lines, { severities });
    expect(pastEnd).toMatchObject({ startColumn: 6, endColumn: 7 });
    const empty = lintIssueToMarker(issue({ line: 1, column: 3 }), [""], { severities });
    expect(empty).toMatchObject({ startLineNumber: 1, startColumn: 1, endColumn: 2 });
  });

  it("marks one character on punctuation", () => {
    const marker = lintIssueToMarker(issue({ line: 1, column: 6 }), lines, { severities });
    expect(marker).toMatchObject({ startColumn: 6, endColumn: 7 });
  });

  it("maps a whole lint result, errors first, and counts", () => {
    const result = makeLintResult({
      errors: [issue({ severity: "error", rule: "parse-error", line: 5, column: 1 })],
      warnings: [issue({ line: 2, column: 3 }), issue({ line: 1, column: 1, rule: "empty-rule" })],
    });
    const markers = lintMarkers(result, css, { severities });
    expect(markers.map((marker) => marker.code)).toEqual([
      "parse-error",
      "unknown-property",
      "empty-rule",
    ]);
    expect(lintMarkers(undefined, css, { severities })).toEqual([]);
    expect(lintCounts(result)).toEqual({ errors: 1, warnings: 2 });
    expect(lintCounts(null)).toEqual({ errors: 0, warnings: 0 });
    expect(sortedIssues(result).map((item) => `${item.severity}:${item.line}`)).toEqual([
      "error:5",
      "warning:1",
      "warning:2",
    ]);
  });

  it("handles CRLF line endings", () => {
    const markers = lintMarkers(
      makeLintResult({ warnings: [issue({ line: 2, column: 3 })] }),
      "a {\r\n  colr: red;\r\n}",
      { severities },
    );
    expect(markers[0]).toMatchObject({ startLineNumber: 2, startColumn: 3, endColumn: 7 });
  });
});
