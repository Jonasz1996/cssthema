import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOKENS,
  isColorValue,
  orderedTokens,
  paletteCss,
  tokenKind,
  tokenValue,
  tokenVar,
} from "./tokens";

describe("palet-tokens", () => {
  it("tokenVar maakt de CSS-variabele", () => {
    expect(tokenVar("bg")).toBe("--ct-bg");
    expect(tokenVar("accent-fg")).toBe("--ct-accent-fg");
  });

  it("orderedTokens: vaste volgorde, onbekende alfabetisch erachter", () => {
    const tokens = { zeta: "1", radius: "8px", bg: "#000", alpha: "2", fg: "#fff" };
    expect(orderedTokens(tokens).map(([name]) => name)).toEqual([
      "bg",
      "fg",
      "radius",
      "alpha",
      "zeta",
    ]);
  });

  it.each([
    ["#fff", true],
    ["#1e1e1eaa", true],
    ["rgb(0 0 0 / 50%)", true],
    ["oklch(70% 0.1 200)", true],
    ["transparent", true],
    ["CurrentColor", true],
    ["10px", false],
    ["#ggg", false],
    ["ui-monospace, monospace", false],
    ["url(x.png)", false],
  ])("isColorValue(%s) = %s", (value, expected) => {
    expect(isColorValue(value)).toBe(expected);
  });

  it("tokenKind herkent kleur, lengte, lettertype en de rest", () => {
    expect(tokenKind("bg", "#000")).toBe("color");
    expect(tokenKind("radius", "10px")).toBe("length");
    expect(tokenKind("radius", ".5rem")).toBe("length");
    expect(tokenKind("font-sans", "Inter, sans-serif")).toBe("font");
    expect(tokenKind("shadow", "0 1px 2px black")).toBe("other");
  });

  it("paletteCss zet de tokens op :root in vaste volgorde", () => {
    expect(paletteCss({ fg: "#fff", bg: "#000" })).toBe(
      ":root {\n  --ct-bg: #000;\n  --ct-fg: #fff;\n}\n",
    );
  });

  it("tokenValue valt terug op het standaardpalet", () => {
    expect(tokenValue({ tokens: { bg: "#123" } }, "bg")).toBe("#123");
    expect(tokenValue({ tokens: {} }, "bg")).toBe(DEFAULT_TOKENS.bg);
    expect(tokenValue(null, "radius")).toBe("10px");
  });
});
