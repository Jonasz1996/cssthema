import { describe, expect, it } from "vitest";
import { makeVersionSummary } from "@/api/testing/fixtures";
import {
  comparisonSearch,
  defaultFrom,
  liveVersionOf,
  parseCompareRef,
  refLabel,
  resolveComparison,
} from "../compare";

describe("version comparison (URL ⇄ state)", () => {
  it("parses refs: numbers, draft, live", () => {
    expect(parseCompareRef("7", 3)).toBe(7);
    expect(parseCompareRef("draft", 3)).toBe("draft");
    expect(parseCompareRef("live", 3)).toBe(3);
    expect(parseCompareRef("live", null)).toBeUndefined();
    expect(parseCompareRef("0", 3)).toBeUndefined();
    expect(parseCompareRef("-1", 3)).toBeUndefined();
    expect(parseCompareRef("abc", 3)).toBeUndefined();
    expect(parseCompareRef(null, 3)).toBeUndefined();
  });

  it("defaults: previous version, or live for the draft", () => {
    expect(defaultFrom(5, { liveVersion: 5, latestVersion: 5 })).toBe(4);
    expect(defaultFrom(1, { liveVersion: 1, latestVersion: 1 })).toBeNull();
    expect(defaultFrom("draft", { liveVersion: 3, latestVersion: 5 })).toBe(3);
    expect(defaultFrom("draft", { liveVersion: null, latestVersion: 2 })).toBe(2);
    expect(defaultFrom("draft", { liveVersion: null, latestVersion: 0 })).toBeNull();
  });

  it("resolves the URL with sensible fallbacks", () => {
    const info = { liveVersion: 3, latestVersion: 5 };
    expect(resolveComparison({ from: null, to: null }, info)).toEqual({ from: 2, to: 3 });
    expect(resolveComparison({ from: "live", to: "draft" }, info)).toEqual({
      from: 3,
      to: "draft",
    });
    expect(resolveComparison({ from: "empty", to: "1" }, info)).toEqual({ from: null, to: 1 });
    expect(resolveComparison({ from: "4", to: "4" }, info)).toEqual({ from: null, to: 4 });
    expect(resolveComparison({ from: "bogus", to: "bogus" }, info)).toEqual({ from: 2, to: 3 });
    expect(
      resolveComparison({ from: null, to: null }, { liveVersion: null, latestVersion: 0 }),
    ).toEqual({
      from: null,
      to: "draft",
    });
  });

  it("round-trips through the query string", () => {
    expect(comparisonSearch({ from: null, to: 1 })).toBe("?from=empty&to=1");
    expect(comparisonSearch({ from: 3, to: "draft" })).toBe("?from=3&to=draft");
    const params = new URLSearchParams(comparisonSearch({ from: 2, to: 5 }));
    expect(
      resolveComparison(
        { from: params.get("from"), to: params.get("to") },
        {
          liveVersion: 5,
          latestVersion: 5,
        },
      ),
    ).toEqual({ from: 2, to: 5 });
  });

  it("labels and finds the live version", () => {
    expect(refLabel(7, "draft", "(leeg)")).toBe("v7");
    expect(refLabel("draft", "draft", "(leeg)")).toBe("draft");
    expect(refLabel(null, "draft", "(leeg)")).toBe("(leeg)");
    const versions = [
      makeVersionSummary({ version_number: 2, is_live: false }),
      makeVersionSummary({ version_number: 1, is_live: true }),
    ];
    expect(liveVersionOf(versions)?.version_number).toBe(1);
    expect(liveVersionOf([])).toBeNull();
  });
});
