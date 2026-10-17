import type * as Monaco from "monaco-editor/editor/editor.api";
import { describe, expect, it } from "vitest";
import { collectSnapshotSymbols } from "../lib/snapshot-symbols";
import { registerSnapshotProviders, setModelPalette, setModelSnapshot } from "../monaco/providers";

/** Net genoeg Monaco om de provider te registreren en aan te roepen. */
class FakeRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

type Provider = Monaco.languages.CompletionItemProvider;
const providers: Provider[] = [];
const fakeMonaco = {
  Range: FakeRange,
  languages: {
    CompletionItemKind: { Variable: 4, Class: 5, Reference: 17, Color: 15 },
    registerCompletionItemProvider: (_language: string, provider: Provider) => {
      providers.push(provider);
      return { dispose() {} };
    },
  },
} as unknown as typeof Monaco;

registerSnapshotProviders(fakeMonaco, {
  onPage: (count, page) => `${count}× op ${page}`,
  inCss: (hostname) => `CSS van ${hostname}`,
  variable: (value, hostname) => `${value} · ${hostname}`,
});

const URI = "inmemory://cssthema/themes/t1.css";

/** Suggesties met de cursor op het einde van `text`. */
function suggest(text: string): Monaco.languages.CompletionItem[] {
  const lines = text.split("\n");
  const position = { lineNumber: lines.length, column: lines.at(-1)!.length + 1 };
  const model = {
    uri: { toString: () => URI },
    getLineContent: (line: number) => lines[line - 1]!,
    getValueInRange: () => text,
  };
  const result = providers[0]!.provideCompletionItems(
    model as unknown as Monaco.editor.ITextModel,
    position as Monaco.Position,
    {} as Monaco.languages.CompletionContext,
    {} as Monaco.CancellationToken,
  ) as Monaco.languages.CompletionList;
  return result.suggestions;
}

const symbols = collectSnapshotSymbols({
  html: '<body class="app sm:flex"><div id="main"></div></body>',
  stylesheets: [":root{--accent:#e57000;--ct-bg:#000}.only-css{}"],
});

describe("snapshot autocomplete provider", () => {
  it("suggests nothing without a snapshot for the model", () => {
    setModelSnapshot(URI, null);
    expect(suggest(".a")).toEqual([]);
  });

  it("suggests escaped classes and ids in selector position, with where they come from", () => {
    setModelSnapshot(URI, { hostname: "app.lan", page: "start", symbols });
    const classes = suggest("a { }\n.s");
    expect(classes.map((item) => [item.label, item.insertText, item.detail])).toEqual([
      [".app", ".app", "1× op start"],
      [".sm\\:flex", ".sm\\:flex", "1× op start"],
      [".only-css", ".only-css", "CSS van app.lan"],
    ]);
    expect(classes[0]!.range).toEqual(new FakeRange(2, 1, 2, 3));
    expect(suggest("#").map((item) => item.label)).toEqual(["#main"]);
    // In een waarde (kleur, getal) geen id's, classes of variabelen.
    expect(suggest("a { color: #")).toEqual([]);
    expect(suggest("a { margin: 0.")).toEqual([]);
  });

  it("suggests the app's variables in values, without duplicating palette tokens", () => {
    setModelSnapshot(URI, { hostname: "app.lan", page: "start", symbols });
    const inValue = suggest("a { color: ");
    expect(inValue.map((item) => [item.label, item.insertText, item.detail])).toEqual([
      ["--accent", "var(--accent)", "#e57000 · app.lan"],
      ["--ct-bg", "var(--ct-bg)", "#000 · app.lan"],
    ]);
    expect(suggest("a { color: var(--").map((item) => item.insertText)).toEqual([
      "--accent",
      "--ct-bg",
    ]);
    setModelPalette(URI, { name: "Nord", tokens: { bg: "#2e3440" } });
    expect(suggest("a { color: ").map((item) => item.label)).toEqual(["--accent"]);
    setModelPalette(URI, null);
  });

  it("forgets the snapshot when the source switches", () => {
    setModelSnapshot(URI, { hostname: "app.lan", page: "start", symbols });
    setModelSnapshot(URI, null);
    expect(suggest(".")).toEqual([]);
    expect(suggest("a { color: ")).toEqual([]);
  });
});
