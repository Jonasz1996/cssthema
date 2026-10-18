import { describe, expect, it } from "vitest";
import { makeTheme, makeVersionSummary } from "@/api/testing/fixtures";
import { isDeleted, themeBadges, themeSeverity } from "./status";

const live = makeVersionSummary({ version_number: 7 });

describe("themeBadges", () => {
  it("nooit gepubliceerd", () => {
    expect(themeBadges(makeTheme())).toEqual([{ kind: "never", tone: "default" }]);
  });

  it("live, met draft gewijzigd erbij", () => {
    expect(themeBadges(makeTheme({ status: "published", published_version: live }))).toEqual([
      { kind: "live", tone: "ok", version: 7 },
    ]);
    expect(
      themeBadges(makeTheme({ status: "published", published_version: live, draft_dirty: true })),
    ).toEqual([
      { kind: "live", tone: "ok", version: 7 },
      { kind: "dirty", tone: "mid" },
    ]);
  });

  it("waarschuwt als een handgemaakt bestand voorgaat", () => {
    const badges = themeBadges(makeTheme({ shadowed_by_file: true }));
    expect(badges.map((b) => b.kind)).toEqual(["never", "shadowed"]);
    expect(badges[1]?.tone).toBe("warn");
  });

  it("verwijderd verbergt de rest", () => {
    expect(
      themeBadges(
        makeTheme({
          deleted_at: "2026-10-01T00:00:00Z",
          published_version: live,
          draft_dirty: true,
          shadowed_by_file: true,
        }),
      ),
    ).toEqual([{ kind: "deleted", tone: "err" }]);
  });
});

describe("themeSeverity / isDeleted", () => {
  it("geeft de randkleur van de kaart", () => {
    expect(themeSeverity(makeTheme())).toBe("default");
    expect(themeSeverity(makeTheme({ published_version: live }))).toBe("ok");
    expect(themeSeverity(makeTheme({ published_version: live, draft_dirty: true }))).toBe("mid");
    expect(themeSeverity(makeTheme({ deleted_at: "2026-10-01T00:00:00Z" }))).toBe("err");
  });

  it("isDeleted kijkt naar deleted_at", () => {
    expect(isDeleted({ deleted_at: null })).toBe(false);
    expect(isDeleted({ deleted_at: "2026-10-01T00:00:00Z" })).toBe(true);
  });
});
