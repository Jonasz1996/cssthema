import { describe, expect, it } from "vitest";
import {
  collectSnapshotSymbols,
  cssEscapeIdent,
  selectorCompletionContext,
  unescapeCss,
} from "../lib/snapshot-symbols";

const HTML =
  '<!doctype html><html class="theme-light"><head><style>.from-head{--head-var: 1px}</style>' +
  '</head><body class="app" style="--body-gap: 8px;color:red">' +
  '<div id="main" class="panel panel-primary"><span class="panel">a</span>' +
  '<i class="sm:flex 2col"></i><p id="has space">x</p></div>' +
  '<ha-card id="card"><template shadowrootmode="open">' +
  "<style>.shadow-css{--shadow-var: blue}</style>" +
  '<button class="shadow-btn" style="--btn-size:  12px  ">b</button>' +
  "</template></ha-card></body></html>";

const CSS = [
  `/* .commented { --commented: 1 } */
  :root { --accent: #e57000; --font: "Inter", sans-serif; }
  .panel, .card > .title:hover { margin: 0.5em; background: url(img/bg.png) }
  @media (min-width: 40.5em) { .responsive { display: flex } }
  @font-face { font-family: X; src: url(data:font/woff2;base64,AAAA.BBBB) }
  [data-x=".not-a-class"] { color: red }
  .sm\\:hidden, #sidebar, .\\31 0col { --accent: #000; --long: ${"x".repeat(150)} }
  .block--mod:hover { color: red }`,
];

describe("collectSnapshotSymbols", () => {
  const symbols = collectSnapshotSymbols({ html: HTML, stylesheets: CSS });

  it("collects classes from the page (with counts, also in shadow roots), then from the CSS", () => {
    const names = symbols.classes.map((item) => `${item.name}:${item.count}`);
    // Pagina eerst (meest gebruikt eerst), dan alleen-CSS alfabetisch (aantal 0).
    expect(names.slice(0, 2)).toEqual(["panel:2", "2col:1"]);
    expect(names).toEqual(
      expect.arrayContaining([
        "app:1",
        "theme-light:1",
        "panel-primary:1",
        "sm:flex:1",
        "shadow-btn:1",
        "card:0",
        "title:0",
        "responsive:0",
        "sm:hidden:0",
        "10col:0",
        "block--mod:0",
        "from-head:0",
        "shadow-css:0",
      ]),
    );
    const page = symbols.classes.filter((item) => item.count > 0).length;
    expect(symbols.classes.slice(page).map((item) => item.name)).toEqual(
      [...symbols.classes.slice(page).map((item) => item.name)].sort((a, b) => a.localeCompare(b)),
    );
    // Geen waarden, at-rules, strings of commentaar.
    const all = symbols.classes.map((item) => item.name);
    for (const wrong of ["5em", "png", "BBBB", "not-a-class", "commented"]) {
      expect(all).not.toContain(wrong);
    }
  });

  it("collects ids from the page and the CSS, skipping ids with spaces", () => {
    expect(symbols.ids).toEqual([
      { name: "card", count: 1 },
      { name: "main", count: 1 },
      { name: "sidebar", count: 0 },
    ]);
  });

  it("collects variables from the CSS, style blocks and style attributes (first value wins)", () => {
    const variables = Object.fromEntries(symbols.variables.map((item) => [item.name, item.value]));
    expect(variables).toMatchObject({
      "--accent": "#e57000",
      "--font": '"Inter", sans-serif',
      "--body-gap": "8px",
      "--btn-size": "12px",
      "--head-var": "1px",
      "--shadow-var": "blue",
    });
    expect(variables["--long"]).toHaveLength(100);
    expect(variables["--long"]!.endsWith("…")).toBe(true);
    expect(variables).not.toHaveProperty("--commented");
    expect(variables).not.toHaveProperty("--mod");
    const names = symbols.variables.map((item) => item.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("caps every list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `<b class="c${i}" id="i${i}"></b>`).join("");
    const css = Array.from({ length: 30 }, (_, i) => `:root{--v${i}:1}`).join("");
    const capped = collectSnapshotSymbols({ html: many, stylesheets: [css] }, 10);
    expect(capped.classes).toHaveLength(10);
    expect(capped.ids).toHaveLength(10);
    expect(capped.variables).toHaveLength(10);
  });

  it("stays linear on huge values without braces", () => {
    const blob = `.a{src:url(data:font/woff2;base64,${"A".repeat(400_000)})}`;
    const started = performance.now();
    const result = collectSnapshotSymbols({ html: "", stylesheets: [blob] });
    expect(result.classes.map((item) => item.name)).toEqual(["a"]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("CSS identifiers", () => {
  it("escapes like CSS.escape and unescapes selector escapes", () => {
    expect(cssEscapeIdent("panel")).toBe("panel");
    expect(cssEscapeIdent("sm:flex")).toBe("sm\\:flex");
    expect(cssEscapeIdent("w-1/2")).toBe("w-1\\/2");
    expect(cssEscapeIdent("2col")).toBe("\\32 col");
    expect(cssEscapeIdent("-2x")).toBe("-\\32 x");
    expect(cssEscapeIdent("-")).toBe("\\-");
    expect(cssEscapeIdent("é-ok_1")).toBe("é-ok_1");
    expect(unescapeCss("sm\\:flex")).toBe("sm:flex");
    expect(unescapeCss("\\31 0col")).toBe("10col");
    expect(unescapeCss("\\0 x")).toBe("�x");
  });
});

describe("selectorCompletionContext", () => {
  const ctx = (text: string) => selectorCompletionContext(text);

  it("suggests classes and ids where a selector is written", () => {
    expect(ctx(".pa")).toEqual({ kind: "class", prefix: ".pa" });
    expect(ctx("a{}\n#ma")).toEqual({ kind: "id", prefix: "#ma" });
    expect(ctx("div.")).toEqual({ kind: "class", prefix: "." });
    expect(ctx(".a:hover .b, .")).toEqual({ kind: "class", prefix: "." });
    expect(ctx("@media (max-width: 600px) {\n  .")).toEqual({ kind: "class", prefix: "." });
    expect(ctx("@supports (display: grid) { @layer x { #")).toEqual({ kind: "id", prefix: "#" });
    // CSS nesting: binnen een regel is `.x` een geneste selector.
    expect(ctx(".card {\n  color: red;\n  .")).toEqual({ kind: "class", prefix: "." });
    expect(ctx(".card { &:hover .ti")).toEqual({ kind: "class", prefix: ".ti" });
  });

  it("stays out of values, comments, strings and at-rule preludes", () => {
    expect(ctx("a { color: #")).toBeNull();
    expect(ctx("a { color: #ff")).toBeNull();
    expect(ctx("a {\n  margin: 0.")).toBeNull();
    expect(ctx("a {\n  box-shadow: 0 0 1px red,\n    0 0 2px #")).toBeNull();
    expect(ctx("a { background: url(img.")).toBeNull();
    expect(ctx("/* .")).toBeNull();
    expect(ctx('a::after { content: ".')).toBeNull();
    expect(ctx("@media (min-width: 40.")).toBeNull();
    expect(ctx("@font-face {\n  src: url(x.")).toBeNull();
    expect(ctx("@keyframes spin {\n  .")).toBeNull();
    expect(ctx("a { color: red }")).toBeNull();
    // Na een afgesloten commentaar en string gaat het gewoon verder.
    expect(ctx('/* x */ a[title="}"] { } .')).toEqual({ kind: "class", prefix: "." });
  });
});
