import { describe, expect, it } from "vitest";
import { formatColor, generateTemplate, parseColor } from "../template/generate";

const PAGE = `<!doctype html><html><head><style>
  body { background-color: rgb(20, 20, 20); color: rgb(229, 229, 229); }
  header { background-color: rgb(40, 40, 40); }
  .btn-primary { background-color: rgb(37, 99, 235); color: rgb(255, 255, 255); }
  .card { background-color: rgb(40, 40, 40); border: 1px solid rgb(80, 80, 80); }
  a { color: rgb(96, 165, 250); }
</style></head><body>
  <header><a href="#">Home</a></header>
  <main>
    <div class="card"><h2>Titel</h2><input type="text"></div>
    <div class="card css-1x2y3z"><button class="btn-primary">Opslaan</button></div>
  </main>
</body></html>`;

function render(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // jsdom past de stijlen van een DOMParser-document niet toe: in een iframe wel.
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const target = frame.contentDocument!;
  target.open();
  target.write(doc.documentElement.outerHTML);
  target.close();
  const view = frame.contentWindow!;
  return generateTemplate({
    document: target,
    getStyle: (element) => view.getComputedStyle(element),
    source: "test · pagina",
    date: "2026-10-20",
  });
}

describe("parseColor", () => {
  it("leest rgb, rgba en hex", () => {
    expect(formatColor(parseColor("rgb(20, 20, 20)")!)).toBe("#141414");
    expect(formatColor(parseColor("rgba(0, 0, 0, 0.5)")!)).toBe("rgba(0, 0, 0, 0.5)");
    expect(formatColor(parseColor("#abc")!)).toBe("#aabbcc");
    expect(parseColor("transparent")!.a).toBe(0);
    expect(parseColor("oklch(0.5 0.1 200)")).toBeNull();
  });
});

describe("generateTemplate", () => {
  const css = render(PAGE);

  it("zet de kleuren van de pagina als startwaarde in :root", () => {
    expect(css).toMatch(/--tpl-achtergrond:\s+#141414;/);
    expect(css).toMatch(/--tpl-tekst:\s+#e5e5e5;/);
    expect(css).toMatch(/--tpl-kop-achtergrond:\s+#282828;/);
    expect(css).toMatch(/--tpl-accent:\s+#2563eb;/);
    expect(css).toMatch(/--tpl-link:\s+#[0-9a-f]{6};/);
  });

  it("laat dezelfde kleur naar de eerste rol verwijzen", () => {
    expect(css).toMatch(/--tpl-paneel-achtergrond:\s+var\(--tpl-kop-achtergrond\);/);
  });

  it("maakt regels alleen voor wat op de pagina staat, met variabelen", () => {
    expect(css).toContain("header {\n  background-color: var(--tpl-kop-achtergrond) !important;");
    expect(css).toContain(".card {");
    expect(css).toContain(".btn-primary {");
    expect(css).not.toMatch(/^footer/m);
    expect(css).not.toContain("css-1x2y3z");
    // Regels gebruiken geen vaste kleuren, alleen :root.
    const rules = css.slice(css.indexOf("/* Basis"));
    expect(rules).not.toMatch(/#[0-9a-f]{6}|rgb\(/);
  });
});
