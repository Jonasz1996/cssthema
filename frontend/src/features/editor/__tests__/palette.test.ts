import { describe, expect, it } from "vitest";
import {
  isCssColor,
  paletteCompletionContext,
  paletteCss,
  paletteInsertText,
  paletteTokens,
  paletteVariableAt,
} from "../palette";

const NORD = {
  "font-mono": "ui-monospace, monospace",
  accent: "#88c0d0",
  bg: "#2e3440",
  radius: "6px",
  fg: "#eceff4",
  zebra: "oklch(70% 0.1 200)",
};

describe("palette tokens", () => {
  it("orders the standard tokens first and flags colours", () => {
    const tokens = paletteTokens(NORD);
    expect(tokens.map((token) => token.name)).toEqual([
      "bg",
      "fg",
      "accent",
      "radius",
      "font-mono",
      "zebra",
    ]);
    expect(tokens[0]).toEqual({ name: "bg", variable: "--ct-bg", value: "#2e3440", isColor: true });
    expect(tokens.find((token) => token.name === "radius")?.isColor).toBe(false);
    expect(tokens.find((token) => token.name === "zebra")?.isColor).toBe(true);
    expect(paletteTokens(null)).toEqual([]);
  });

  it("drops invalid token names", () => {
    expect(
      paletteTokens({ "bad name": "#fff", "}x": "#000", ok: "#111" }).map((t) => t.name),
    ).toEqual(["ok"]);
  });

  it("recognises colours but not keywords", () => {
    expect(isCssColor("#abc")).toBe(true);
    expect(isCssColor(" rgb(0 0 0 / 50%) ")).toBe(true);
    expect(isCssColor("hsl(10, 20%, 30%)")).toBe(true);
    expect(isCssColor("red")).toBe(false);
    expect(isCssColor("#abcde")).toBe(false);
    expect(isCssColor("6px")).toBe(false);
  });

  it("builds :root variables and escapes characters that could break out", () => {
    expect(paletteCss({ bg: "#000", fg: "#fff" })).toBe(":root{--ct-bg:#000;--ct-fg:#fff}");
    expect(paletteCss({})).toBe("");
    const evil = paletteCss({ bg: "red;}</style><script>alert(1)</script>" });
    expect(evil).not.toMatch(/[<>]/);
    expect(evil).not.toContain(";}");
    expect(evil.startsWith(":root{--ct-bg:red\\3b \\7d ")).toBe(true);
  });
});

describe("palette autocomplete context", () => {
  it("after var( → plain variable names", () => {
    expect(paletteCompletionContext("  color: var(")).toEqual({
      start: 13,
      prefix: "",
      wrapInVar: false,
    });
    expect(paletteCompletionContext("  color: var(--ct-a")).toEqual({
      start: 13,
      prefix: "--ct-a",
      wrapInVar: false,
    });
  });

  it("in a value → wrapped in var(…)", () => {
    expect(paletteCompletionContext("a { color: ")).toEqual({
      start: 11,
      prefix: "",
      wrapInVar: true,
    });
    expect(paletteCompletionContext("  border: 1px solid --c")).toEqual({
      start: 20,
      prefix: "--c",
      wrapInVar: true,
    });
  });

  it("a custom property name at the start of a declaration → plain", () => {
    expect(paletteCompletionContext(":root { --ct")).toEqual({
      start: 8,
      prefix: "--ct",
      wrapInVar: false,
    });
  });

  it("no palette suggestions in selectors, strings or ordinary words", () => {
    expect(paletteCompletionContext("a:hover")).toBeNull();
    expect(paletteCompletionContext("  color: re")).toBeNull();
    expect(paletteCompletionContext("  content: '")).toBeNull();
    expect(paletteCompletionContext("  colo")).toBeNull();
    expect(paletteCompletionContext("a::before { x")).toBeNull();
  });

  it("inserts var(--ct-x) or --ct-x depending on the context", () => {
    const [token] = paletteTokens({ accent: "#88c0d0" });
    expect(paletteInsertText(token!, { start: 0, prefix: "", wrapInVar: true })).toBe(
      "var(--ct-accent)",
    );
    expect(paletteInsertText(token!, { start: 0, prefix: "", wrapInVar: false })).toBe(
      "--ct-accent",
    );
  });

  it("finds the --ct-* word under the cursor for the hover", () => {
    const line = "  color: var(--ct-accent-fg);";
    expect(paletteVariableAt(line, 16)).toEqual({ start: 13, name: "accent-fg" });
    expect(paletteVariableAt(line, 3)).toBeNull();
  });
});
