import { describe, expect, it } from "vitest";
import { PreviewError } from "../preview/errors";
import {
  buildSnapshotDocument,
  isScriptUrl,
  MAX_SNAPSHOT_CHARS,
  neutraliseStyleText,
} from "../preview/snapshot-document";
import { previewCsp } from "../preview/srcdoc";

const BRIDGE = "/* cssthema preview bridge */ window.ok = 1;";

function build(html: string, stylesheets: string[] = []) {
  return buildSnapshotDocument({
    bridgeSource: BRIDGE,
    bridgeHash: "h4sh=",
    title: 'Preview van "app"',
    html,
    stylesheets,
  });
}

/** De srcdoc zoals de iframe hem parst. */
function parse(srcdoc: string): Document {
  return new DOMParser().parseFromString(srcdoc, "text/html");
}

describe("snapshot document (srcdoc)", () => {
  it("starts the head with the same CSP and ends it with palette, live CSS and the bridge", () => {
    const srcdoc = build("<html><head><title>App</title></head><body><p>hi</p></body></html>", [
      "p{color:red}",
      "p{color:blue}",
    ]);
    expect(srcdoc.startsWith("<!doctype html>\n")).toBe(true);
    const doc = parse(srcdoc);
    const head = Array.from(doc.head.children);
    expect(head[0]!.localName).toBe("meta");
    expect(head[0]!.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(head[0]!.getAttribute("content")).toBe(previewCsp("h4sh="));
    expect(doc.title).toBe('Preview van "app"');
    // App-CSS in paginavolgorde, daarna palet en live CSS (het thema wint), dan de bridge.
    const order = head
      .filter((element) => element.localName === "style" || element.localName === "script")
      .map((element) => element.id || element.getAttribute("data-ct-app") || element.localName);
    expect(order).toEqual(["1", "2", "ct-palette", "ct-live", "script"]);
    expect(doc.querySelector('[data-ct-app="1"]')?.textContent).toBe("p{color:red}");
    expect(doc.querySelector('[data-ct-app="2"]')?.textContent).toBe("p{color:blue}");
    expect(doc.querySelector("script")?.textContent).toBe(BRIDGE);
    expect(doc.getElementById("ct-demo-base")).toBeNull();
    expect(doc.body.innerHTML.trim()).toBe("<p>hi</p>");
  });

  it("wraps the live CSS in the rest of the host stack", () => {
    const doc = parse(
      buildSnapshotDocument({
        bridgeSource: BRIDGE,
        bridgeHash: "h4sh=",
        title: "app",
        html: "<html><head></head><body></body></html>",
        stylesheets: [".app{}"],
        stack: {
          before: [
            { name: "alg-kern", css: ":root{--alg-tekst:#ddd}" },
            { name: 'x"y', css: "a{content:'</style><script>x()</script>'}" },
          ],
          after: [{ name: "alg-fw-bootstrap", css: ".btn{}" }],
        },
      }),
    );
    const order = Array.from(doc.head.querySelectorAll("style, script")).map(
      (element) =>
        element.id ||
        element.getAttribute("data-ct-part") ||
        element.getAttribute("data-ct-app") ||
        element.localName,
    );
    // App, stapel vóór het thema, palet, live draft, stapel erna, bridge.
    expect(order).toEqual([
      "1",
      "alg-kern",
      'x"y',
      "ct-palette",
      "ct-live",
      "alg-fw-bootstrap",
      "script",
    ]);
    expect(doc.querySelector('[data-ct-part="alg-kern"]')?.getAttribute("data-ct-stack")).toBe(
      "before",
    );
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(doc.querySelector('[data-ct-part="x\\"y"]')?.textContent).toContain("<\\/style>");
    expect(
      doc.querySelector('[data-ct-part="alg-fw-bootstrap"]')?.getAttribute("data-ct-stack"),
    ).toBe("after");
  });

  it("counts the stack in the size limit", () => {
    const half = "a".repeat(MAX_SNAPSHOT_CHARS / 2);
    const input = {
      bridgeSource: BRIDGE,
      bridgeHash: "h",
      title: "t",
      html: "<p></p>",
      stylesheets: [half],
    };
    expect(() => buildSnapshotDocument(input)).not.toThrow();
    expect(() =>
      buildSnapshotDocument({ ...input, stack: { before: [{ name: "k", css: half }], after: [] } }),
    ).toThrow(PreviewError);
  });

  it("puts inline head styles after the linked CSS, keeping their media", () => {
    const doc = parse(
      build(
        '<html><head><link rel="stylesheet" href="../../_css/0123456789abcdef.css">' +
          '<style media="print">.a{}</style><style>.b{}</style></head><body></body></html>',
        [".linked{}"],
      ),
    );
    const styles = Array.from(doc.querySelectorAll("style[data-ct-app]"), (style) => [
      style.textContent,
      style.getAttribute("media"),
    ]);
    expect(styles).toEqual([
      [".linked{}", null],
      [".a{}", "print"],
      [".b{}", null],
    ]);
    expect(doc.querySelector("link")).toBeNull();
  });

  it("neutralises </style in the app CSS so it cannot close its block", () => {
    const evil =
      'a{content:"</style><script>alert(1)</script>"}</STYLE><img src=x onerror=alert(1)>';
    const doc = parse(build("<p>x</p>", [evil]));
    expect(doc.querySelectorAll("script")).toHaveLength(1); // alleen de bridge
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    expect(doc.querySelector('[data-ct-app="1"]')?.textContent).toBe(neutraliseStyleText(evil));
    expect(neutraliseStyleText("a</style>b</Style")).toBe("a<\\/style>b<\\/Style");
  });

  it("copies only safe attributes of <html> and <body>", () => {
    const doc = parse(
      build(
        '<html lang="nl" dir="ltr" class="theme-dark" data-mode="x" manifest="app.appcache" ' +
          'xmlns="http://www.w3.org/1999/xhtml" onload="evil()"><head></head>' +
          '<body id="top" class="app" style="--accent: red" data-route="home" onclick="evil()" ' +
          'background="javascript:evil()" data-href="javascript:evil()"></body></html>',
      ),
    );
    const html = doc.documentElement;
    expect(Array.from(html.attributes, (a) => a.name).sort()).toEqual([
      "class",
      "data-mode",
      "dir",
      "lang",
    ]);
    expect(html.className).toBe("theme-dark");
    const body = doc.body;
    expect(Array.from(body.attributes, (a) => `${a.name}=${a.value}`).sort()).toEqual([
      "class=app",
      "data-route=home",
      "id=top",
      "style=--accent: red",
    ]);
  });

  it("strips scripts, frames, plugins, base, meta refresh, links and event handlers", () => {
    const doc = parse(
      build(
        "<html><body>" +
          '<div class="keep" onclick="evil()" onmouseover="evil()">ok</div>' +
          "<script>evil()</script><noscript><p>geen js</p></noscript>" +
          '<iframe src="https://evil.example"></iframe><object data="x.swf"></object>' +
          '<embed src="x.swf"><base href="https://evil.example/">' +
          '<meta http-equiv="refresh" content="0;url=https://evil.example"><meta name="x" content="y">' +
          '<link rel="stylesheet" href="https://evil.example/x.css">' +
          '<svg><script>evil()</script><a xlink:href="javascript:evil()"><text>s</text></a>' +
          '<set attributeName="href" to="javascript:evil()"></set></svg>' +
          '<a href="https://app.lan/settings" class="nav">ga</a>' +
          '<a href="java\tscript:evil()">tab</a><a href=" JAVASCRIPT:evil()">upper</a>' +
          '<form action="javascript:evil()"><button formaction="javascript:evil()">b</button>' +
          '<input autofocus name="q"></form>' +
          '<img src="logo.png" alt="logo"><iframe srcdoc="<script>evil()</script>"></iframe>' +
          '<div srcdoc="x" data-x="1">d</div>' +
          "</body></html>",
      ),
    );
    const body = doc.body;
    expect(
      body.querySelectorAll("script, noscript, iframe, object, embed, base, link"),
    ).toHaveLength(0);
    expect(body.querySelector("meta[http-equiv]")).toBeNull();
    expect(body.querySelector('meta[name="x"]')).not.toBeNull();
    expect(body.innerHTML).not.toMatch(/evil\(|onclick|onmouseover|autofocus|srcdoc/i);
    // Gewone attributen en links blijven (attribuutselectors van het thema moeten blijven werken).
    expect(body.querySelector(".keep")?.textContent).toBe("ok");
    expect(body.querySelector("a.nav")?.getAttribute("href")).toBe("https://app.lan/settings");
    expect(body.querySelector("img")?.getAttribute("src")).toBe("logo.png");
    expect(body.querySelector('[data-x="1"]')?.textContent).toBe("d");
    expect(body.querySelector("input")?.getAttribute("name")).toBe("q");
  });

  it("keeps declarative shadow roots and cleans their content too", () => {
    const html =
      '<html><head><link rel="stylesheet" href="../../_css/aaaaaaaaaaaaaaaa.css"></head><body>' +
      '<ha-card class="card"><template shadowrootmode="open">' +
      '<link rel="stylesheet" href="../../../_css/bbbbbbbbbbbbbbbb.css">' +
      "<style>.inner{color:red}</style><script>evil()</script>" +
      '<button class="inner" onclick="evil()">in shadow</button>' +
      '<template shadowrootmode="open"><img src=x onerror="evil()"></template>' +
      "</template></ha-card></body></html>";
    const srcdoc = build(html, [".doc{}", ".shadow{}</style>"]);
    expect(srcdoc).toContain('<template shadowrootmode="open">');
    expect(srcdoc).not.toMatch(/evil|onclick|onerror/);
    const template = parse(srcdoc).querySelector("ha-card > template") as HTMLTemplateElement;
    expect(template.getAttribute("shadowrootmode")).toBe("open");
    const content = template.content;
    expect(content.querySelector("button.inner")?.textContent).toBe("in shadow");
    expect(content.querySelector("script, link")).toBeNull();
    // De link in de shadow root wordt een <style> met dezelfde (onschadelijk gemaakte) CSS.
    expect(Array.from(content.querySelectorAll("style"), (style) => style.textContent)).toEqual([
      ".shadow{}<\\/style>",
      ".inner{color:red}",
    ]);
  });

  it("drops shadow-root links when the stylesheet list does not match the links", () => {
    const html =
      '<html><head><link rel="stylesheet" href="../../_css/aaaaaaaaaaaaaaaa.css"></head><body>' +
      '<x-el><template shadowrootmode="open">' +
      '<link rel="stylesheet" href="../../../_css/bbbbbbbbbbbbbbbb.css"><p>p</p>' +
      "</template></x-el></body></html>";
    // Eén bestand ontbrak bij de import: de volgorde is niet meer te vertrouwen.
    const template = parse(build(html, [".a{}"])).querySelector("template") as HTMLTemplateElement;
    expect(template.content.querySelector("link, style")).toBeNull();
    expect(template.content.querySelector("p")?.textContent).toBe("p");
  });

  it("refuses a bridge that could break out and a snapshot that is too large", () => {
    expect(() =>
      buildSnapshotDocument({
        bridgeSource: "x</script>",
        bridgeHash: "h",
        title: "t",
        html: "",
        stylesheets: [],
      }),
    ).toThrow(PreviewError);
    const huge = "a".repeat(MAX_SNAPSHOT_CHARS / 2);
    const error = (() => {
      try {
        build("<p>x</p>", [huge, huge]);
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(PreviewError);
    expect((error as PreviewError).code).toBe("snapshotTooLarge");
    expect((error as PreviewError).params).toEqual({ size: 25, max: 24 });
  });

  it("recognises script URLs, also hidden with control characters or in lists", () => {
    expect(isScriptUrl("javascript:alert(1)")).toBe(true);
    expect(isScriptUrl("  JavaScript:alert(1)")).toBe(true);
    expect(isScriptUrl("java\tscr\nipt:alert(1)")).toBe(true);
    expect(isScriptUrl("vbscript:x")).toBe(true);
    expect(isScriptUrl("#a;javascript:alert(1)")).toBe(true);
    expect(isScriptUrl("background: url('javascript:alert(1)')")).toBe(true);
    expect(isScriptUrl("https://app.lan/?q=javascript")).toBe(false);
    expect(isScriptUrl("/javascript:docs")).toBe(false);
    expect(isScriptUrl("color: red")).toBe(false);
  });
});
