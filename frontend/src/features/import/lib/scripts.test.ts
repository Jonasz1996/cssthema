import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import type { Problem } from "@/api/types";
import {
  injectionSnippet,
  isScriptConflict,
  normalizeScriptName,
  problemScriptName,
  scriptTarget,
  shellWord,
  shortHash,
  siblingCssUrl,
} from "./scripts";

function conflict(extra: Record<string, unknown> = {}) {
  const problem = {
    type: "about:blank",
    title: "Script bestaat al",
    status: 409,
    code: "script_conflict",
    detail: "Er staat al een script algemeen.js.",
    ...extra,
  } as Problem;
  return new ApiError({ status: 409, code: "script_conflict", title: problem.title, problem });
}

describe("normalizeScriptName", () => {
  it("normaliseert zoals de server (backend script_files.normalize_name)", () => {
    expect(normalizeScriptName("Algemeen")).toEqual({ name: "algemeen", issue: null });
    expect(normalizeScriptName("Netwerk Achtergrond")).toEqual({
      name: "netwerk-achtergrond",
      issue: null,
    });
    expect(normalizeScriptName("jquery.min")).toEqual({ name: "jquery-min", issue: null });
    expect(normalizeScriptName("  Café_Ünïcode ")).toEqual({ name: "cafe-unicode", issue: null });
  });

  it("weigert lege namen, paden, verborgen namen, verkeerde lengte en gereserveerde namen", () => {
    expect(normalizeScriptName("   ").issue).toBe("empty");
    expect(normalizeScriptName("../x").issue).toBe("path");
    expect(normalizeScriptName("a/b").issue).toBe("path");
    expect(normalizeScriptName("a\\b").issue).toBe("path");
    expect(normalizeScriptName(".verborgen").issue).toBe("path");
    expect(normalizeScriptName("a")).toEqual({ name: "a", issue: "length" });
    expect(normalizeScriptName("日本")).toEqual({ name: null, issue: "length" });
    expect(normalizeScriptName("x".repeat(65)).issue).toBe("length");
    expect(normalizeScriptName("x".repeat(64)).issue).toBeNull();
    // Geen inkorten zoals bij thema-slugs: 64 tekens na normaliseren, anders fout.
    expect(normalizeScriptName("Preview Bridge")).toEqual({
      name: "preview-bridge",
      issue: "reserved",
    });
  });
});

describe("scriptTarget", () => {
  it("neemt de bestandsnaam zonder map en zonder .js", () => {
    expect(scriptTarget("Algemeen.JS")).toEqual({ name: "algemeen", issue: null });
    expect(scriptTarget("C:\\fakepath\\Klok Widget.js")).toEqual({
      name: "klok-widget",
      issue: null,
    });
  });

  it("het naamveld gaat voor, met of zonder .js; leeg = de bestandsnaam", () => {
    expect(scriptTarget("upload.js", "Netwerk.js")).toEqual({ name: "netwerk", issue: null });
    expect(scriptTarget("upload.js", "  ")).toEqual({ name: "upload", issue: null });
    expect(scriptTarget("upload.js", "x").issue).toBe("length");
  });
});

describe("hulpjes", () => {
  it("shortHash: de eerste 12 tekens", () => {
    expect(shortHash("a5e330f6b1a413f5c81104c1")).toBe("a5e330f6b1a4");
    expect(shortHash(null)).toBeNull();
  });

  it("shellWord: aanhalingstekens alleen als het moet", () => {
    expect(shellWord("algemeen.js")).toBe("algemeen.js");
    expect(shellWord("Klok Widget.js")).toBe("'Klok Widget.js'");
    expect(shellWord("it's.js")).toBe("'it'\\''s.js'");
  });

  it("siblingCssUrl: dezelfde basis als het script", () => {
    expect(siblingCssUrl("https://css.jbogaert.be/algemeen.js", "nord")).toBe(
      "https://css.jbogaert.be/nord.css",
    );
    expect(siblingCssUrl("http://localhost:8080/sub/x.js", "algemeen")).toBe(
      "http://localhost:8080/sub/algemeen.css",
    );
  });

  it("herkent een 409 script_conflict en leest de naam uit de Problem", () => {
    expect(isScriptConflict(conflict())).toBe(true);
    expect(problemScriptName(conflict({ name: "algemeen" }))).toBe("algemeen");
    expect(problemScriptName(conflict())).toBeNull();
    const other = new ApiError({ status: 409, code: "state_conflict", title: "x" });
    expect(isScriptConflict(other)).toBe(false);
    expect(isScriptConflict(new Error("x"))).toBe(false);
  });
});

describe("injectionSnippet", () => {
  const comments = { head: "kop", accessList: "access", websockets: "ws" };

  it("zet thema en script (defer) vóór </head>, met Accept-Encoding en sub_filter_once", () => {
    const snippet = injectionSnippet({
      cssUrl: "https://css.jbogaert.be/algemeen.css",
      scriptUrl: "https://css.jbogaert.be/algemeen.js",
      comments,
    });
    expect(snippet).toContain(
      `sub_filter '</head>' '<link rel="stylesheet" href="https://css.jbogaert.be/algemeen.css">` +
        `<script src="https://css.jbogaert.be/algemeen.js" defer></script></head>';`,
    );
    expect(snippet).toContain('proxy_set_header Accept-Encoding "";');
    expect(snippet).toContain("sub_filter_once on;");
    expect(snippet).toContain("include conf.d/include/proxy.conf;");
    expect(snippet).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(snippet.startsWith("# kop\nlocation / {\n")).toBe(true);
    expect(snippet).toContain("    # ws\n");
  });

  it("waarschuwt in de location zelf dat een Access List van NPM er niet meer geldt", () => {
    // NPM zet de Access List (auth_basic, allow/deny) alleen in zijn eigen `location /`, en die
    // laat NPM weg zodra Advanced er een bevat: de app zou dan zonder slot openstaan.
    const snippet = injectionSnippet({ cssUrl: null, scriptUrl: "https://x/a.js", comments });
    expect(snippet.startsWith("# kop\nlocation / {\n    # access\n")).toBe(true);
  });

  it("zonder thema alleen het script; enkele aanhalingstekens worden ontsnapt", () => {
    const snippet = injectionSnippet({
      cssUrl: null,
      scriptUrl: "https://x.example/it's.js",
      comments,
    });
    expect(snippet).not.toContain("<link");
    expect(snippet).toContain(
      `sub_filter '</head>' '<script src="https://x.example/it\\'s.js" defer></script></head>';`,
    );
  });
});
