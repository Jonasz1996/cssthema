import { describe, expect, it } from "vitest";
import { makeHostCheck, makeHostHealth } from "@/api/testing/fixtures";
import { BULK_CHOICES, bulkRequest, healthLabelKey, healthSummary } from "./hosts";

describe("healthSummary", () => {
  it("telt eigen koppelingen en diensten, niet *, uitgesloten, uitgeschakelde of alleen geladen", () => {
    const summary = healthSummary([
      makeHostHealth({ hostname: "*", level: "error" }),
      makeHostHealth({ hostname: "a.example", level: "ok" }),
      makeHostHealth({ hostname: "b.example", level: "warn" }),
      makeHostHealth({ hostname: "c.example", level: "error" }),
      makeHostHealth({
        hostname: "d.example",
        level: "unknown",
        check: makeHostCheck({ level: "unknown", code: "login" }),
      }),
      makeHostHealth({ hostname: "e.example", level: "unknown" }),
      makeHostHealth({ hostname: "off.example", enabled: false, level: "error" }),
      makeHostHealth({ hostname: "dash.example", excluded: true, level: "error" }),
      makeHostHealth({ hostname: "seen.example", bound: false, level: "error" }),
      makeHostHealth({ hostname: "svc.example", bound: false, service: true, level: "error" }),
    ]);
    expect(summary).toEqual({ ok: 1, login: 1, warn: 1, error: 2, unchecked: 1 });
  });

  it("is leeg zonder gegevens", () => {
    expect(healthSummary(undefined)).toEqual({
      ok: 0,
      login: 0,
      warn: 0,
      error: 0,
      unchecked: 0,
    });
  });
});

describe("healthLabelKey", () => {
  it("uitgesloten gaat voor alles, nooit (recent) geladen voor login of geen controle", () => {
    expect(healthLabelKey(makeHostHealth({ excluded: true, check: makeHostCheck() }))).toBe(
      "hosts.statusExcluded",
    );
    expect(healthLabelKey(makeHostHealth({ stale: true }))).toBe("hosts.levelStale");
    expect(
      healthLabelKey(
        makeHostHealth({
          stale: true,
          check: makeHostCheck({ level: "unknown", code: "login" }),
        }),
      ),
    ).toBe("hosts.levelStale");
    // Een echte bevinding van de controle zegt meer dan "niet geladen".
    expect(
      healthLabelKey(
        makeHostHealth({ stale: true, check: makeHostCheck({ level: "warn", code: "no_rule" }) }),
      ),
    ).toBe("hosts.checkNoRule");
  });
});

describe("bulkRequest", () => {
  it("zet de keuze om naar action en kind, met getrimde namen", () => {
    expect(bulkRequest("add-scripts", ["a.example"], " klok ", "x")).toEqual({
      hostnames: ["a.example"],
      action: "add",
      kind: "scripts",
      name: "klok",
      replacement: null,
    });
    expect(bulkRequest("replace-styles", null, "nord", " dracula ")).toEqual({
      hostnames: null,
      action: "replace",
      kind: "styles",
      name: "nord",
      replacement: "dracula",
    });
  });

  it("aan/uit zonder namen", () => {
    expect(bulkRequest("enable", ["*"], "nord", "x")).toEqual({
      hostnames: ["*"],
      action: "enable",
      kind: "styles",
    });
  });

  it("biedt elke actie aan, voor thema's en scripts", () => {
    expect(BULK_CHOICES.map((choice) => choice.value)).toEqual([
      "add-styles",
      "remove-styles",
      "replace-styles",
      "add-scripts",
      "remove-scripts",
      "replace-scripts",
      "enable",
      "disable",
    ]);
  });
});
