import { describe, expect, it } from "vitest";
import { makeTheme, makeVersionSummary } from "@/api/testing/fixtures";
import type { LintIssue } from "@/api/types";
import { diffLineKind } from "../lib/diff-lines";
import { formatBytes, formatRelative, formatTime, utf8Length } from "../lib/format";
import { publishChecks } from "../lib/publish-checks";
import { saveStatusView } from "../lib/save-status";
import { editorShortcut, LINT_DEBOUNCE_MS } from "../lib/shortcuts";
import { themeStatusTags } from "../lib/theme-status";

const issue = (rule: string, severity: "error" | "warning" = "error"): LintIssue =>
  ({ rule, severity, message: rule, line: 1, column: 1 }) as LintIssue;

describe("save status in the status bar", () => {
  it("shows the server time when saved", () => {
    const view = saveStatusView({ kind: "saved", at: "2026-10-05T10:04:31Z" }, "nl");
    expect(view).toMatchObject({ tone: "ok", key: "editor.saveSavedAt" });
    expect(view.params?.time).toMatch(/^\d{2}:04:31$/);
    expect(saveStatusView({ kind: "saved", at: null }, "nl").key).toBe("editor.saveSaved");
  });

  it("maps every state to a tone and text", () => {
    expect(saveStatusView({ kind: "pending" }, "nl")).toMatchObject({
      tone: "busy",
      key: "editor.saveSaving",
    });
    expect(saveStatusView({ kind: "saving" }, "nl")).toMatchObject({
      tone: "busy",
      key: "editor.saveSaving",
    });
    expect(saveStatusView({ kind: "conflict", current: null, origin: "save" }, "nl")).toMatchObject(
      {
        tone: "err",
        key: "editor.saveConflict",
      },
    );
    expect(saveStatusView({ kind: "offline", since: "x" }, "nl")).toMatchObject({
      tone: "mid",
      key: "editor.saveOffline",
    });
    expect(
      saveStatusView(
        { kind: "error", code: "x", message: "m", status: 413, fromServer: true },
        "nl",
      ),
    ).toMatchObject({ tone: "err", key: "editor.saveError" });
  });
});

describe("publish checks", () => {
  it("groups lint errors into parse / external / other", () => {
    const checks = publishChecks([
      issue("parse-error"),
      issue("external-url"),
      issue("import-rule"),
    ]);
    expect(checks.map((check) => [check.key, check.ok, check.issues.length])).toEqual([
      ["editor.checkParseFailed", false, 1],
      ["editor.checkExternalFailed", false, 1],
      ["editor.checkOtherFailed", false, 1],
    ]);
    expect(publishChecks([]).every((check) => check.ok)).toBe(true);
    expect(publishChecks([]).map((check) => check.key)).toEqual([
      "editor.checkParse",
      "editor.checkExternal",
      "editor.checkOther",
    ]);
  });
});

describe("keyboard shortcuts", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("Ctrl/⌘+S publishes, Ctrl+\\ toggles the preview", () => {
    expect(editorShortcut(key({ key: "s", ctrlKey: true }))).toBe("publish");
    expect(editorShortcut(key({ key: "S", metaKey: true, shiftKey: true }))).toBe("publish");
    expect(editorShortcut(key({ key: "\\", ctrlKey: true }))).toBe("togglePreview");
    expect(editorShortcut(key({ key: "#", code: "Backslash", ctrlKey: true }))).toBe(
      "togglePreview",
    );
  });

  it("uses the physical S key only on layouts without Latin letters", () => {
    // Cyrillisch: de S-toets geeft "ы".
    expect(editorShortcut(key({ key: "ы", code: "KeyS", ctrlKey: true }))).toBe("publish");
    // Dvorak: op de fysieke S-toets staat "o"; Ctrl+O blijft van de browser.
    expect(editorShortcut(key({ key: "o", code: "KeyS", ctrlKey: true }))).toBeNull();
  });

  it("ignores plain keys and AltGr combinations", () => {
    expect(editorShortcut(key({ key: "s" }))).toBeNull();
    expect(editorShortcut(key({ key: "s", ctrlKey: true, altKey: true }))).toBeNull();
    expect(editorShortcut(key({ key: "p", ctrlKey: true }))).toBeNull();
  });

  it("lints 400 ms after the last key", () => {
    expect(LINT_DEBOUNCE_MS).toBe(400);
  });
});

describe("theme status tags", () => {
  it("live version, draft changed, shadowed", () => {
    const theme = makeTheme({
      published_version: makeVersionSummary({ version_number: 7 }),
      draft_dirty: true,
      shadowed_by_file: true,
    });
    expect(themeStatusTags(theme)).toEqual([
      { tone: "ok", key: "editor.statusLive", params: { n: 7 } },
      { tone: "mid", key: "editor.statusDraftChanged" },
      { tone: "warn", key: "editor.statusShadowed" },
    ]);
  });

  it("never published and deleted; local changes count as changed", () => {
    const deleted = makeTheme({ published_version: null, deleted_at: "2026-10-05T10:00:00Z" });
    expect(themeStatusTags(deleted).map((tag) => tag.key)).toEqual([
      "editor.statusDeleted",
      "editor.statusNeverPublished",
    ]);
    const live = makeTheme({ published_version: makeVersionSummary(), draft_dirty: false });
    expect(themeStatusTags(live, { localDirty: true }).map((tag) => tag.key)).toContain(
      "editor.statusDraftChanged",
    );
  });
});

describe("formatting", () => {
  it("counts UTF-8 bytes like the server", () => {
    for (const text of ["", "abc", "é", "€", "😀", "a😀b\u{10ffff}", "\ud800x"]) {
      expect(utf8Length(text), JSON.stringify(text)).toBe(new TextEncoder().encode(text).length);
    }
  });

  it("formats sizes and times per locale", () => {
    expect(formatBytes(512, "nl")).toBe("512 B");
    expect(formatBytes(3482, "nl")).toBe("3,4 KB");
    expect(formatBytes(3482, "en")).toBe("3.4 KB");
    expect(formatBytes(5 * 1024 * 1024, "en")).toBe("5 MB");
    expect(formatTime("nonsense", "nl")).toBe("");
    const now = new Date("2026-10-05T12:00:00Z");
    expect(formatRelative("2026-10-05T11:58:00Z", "en", now)).toBe("2 minutes ago");
    expect(formatRelative("2026-10-04T12:00:00Z", "nl", now)).toBe("gisteren");
    expect(formatRelative("2026-10-05T11:59:50Z", "en", now)).toBe("now");
  });

  it("classifies unified diff lines", () => {
    expect(["--- v1", "+++ draft", "@@ -1 +1 @@", "+a", "-b", " c"].map(diffLineKind)).toEqual([
      "meta",
      "meta",
      "hunk",
      "add",
      "remove",
      "context",
    ]);
  });
});
