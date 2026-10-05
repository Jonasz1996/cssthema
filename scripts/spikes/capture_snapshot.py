# ruff: noqa: E501  (ingebedde JavaScript)
"""Spike S2 — prototype van de DOM-capture (docs/02 § 3.5).

Rendert een pagina met Playwright, serialiseert de *gerenderde* DOM inclusief open
shadow roots (als declaratieve `<template shadowrootmode="open">`), zet alle
stylesheets inline, verwijdert scripts en event-handlers, en meet hoe goed de
statische snapshot (zonder JavaScript) de echte pagina benadert.

Gebruik:
    uv run --with playwright==1.56.0 --with pillow \
        python scripts/spikes/capture_snapshot.py URL [URL ...] --out /tmp/snapshots

(Eenmalig: `uv run --with playwright==1.56.0 playwright install chromium`.)

Dit is spike-code: de productieversie komt in fase 2 in
`backend/src/cssthema/integrations/browser/capture.py`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from pathlib import Path

from PIL import Image, ImageChops
from playwright.async_api import Page, async_playwright

VIEWPORT = {"width": 1440, "height": 900}

# Draait in de pagina. Geeft {html, stats} terug.
SERIALIZE_JS = r"""
async () => {
  const VOID = new Set(["area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"]);
  const SKIP = new Set(["SCRIPT","NOSCRIPT","TEMPLATE"]);
  const stats = { elements: 0, shadowRoots: 0, inlinedSheets: 0, unreadableSheets: 0, canvases: 0 };
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const abs = (css, base) => css.replace(/url\(\s*(['"]?)(?!data:|#)([^'")]+)\1\s*\)/g,
      (m, q, u) => { try { return `url("${new URL(u, base).href}")`; } catch { return m; } });

  const sheetText = (sheet) => {
    try {
      const base = sheet.href || document.baseURI;
      return abs(Array.from(sheet.cssRules, (r) => r.cssText).join("\n"), base);
    } catch { stats.unreadableSheets++; return null; }
  };

  const adopted = (root) => (root.adoptedStyleSheets || [])
      .map(sheetText).filter(Boolean).map((t) => `<style data-ct="adopted">${t}</style>`).join("");

  const attrs = (el) => {
    let out = "";
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) continue;                       // event-handlers weg
      let v = a.value;
      if (/^(src|href|poster)$/i.test(a.name) && v && !/^(data:|#|javascript:)/i.test(v)) {
        try { v = new URL(v, document.baseURI).href; } catch {}
      }
      if (/^javascript:/i.test(v)) continue;
      out += ` ${a.name}="${escAttr(v)}"`;
    }
    return out;
  };

  const ser = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const p = node.parentNode;
      return p && p.nodeName === "STYLE" ? node.data : esc(node.data);
    }
    if (node.nodeType === Node.COMMENT_NODE) return "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;
    if (SKIP.has(el.tagName)) return "";
    stats.elements++;
    const tag = el.tagName.toLowerCase();

    // Externe stylesheet → inline <style> met CSSOM-tekst.
    if (tag === "link" && /stylesheet/i.test(el.rel) && el.sheet) {
      const t = sheetText(el.sheet);
      if (t !== null) { stats.inlinedSheets++; return `<style data-ct-href="${escAttr(el.href)}">${t}</style>`; }
    }
    if (tag === "style" && el.sheet) {
      const t = sheetText(el.sheet);   // CSS-in-JS (insertRule) staat niet in textContent
      if (t !== null) return `<style${attrs(el)}>${t}</style>`;
    }
    // Canvas (grafieken) → afbeelding.
    if (tag === "canvas") {
      stats.canvases++;
      try { return `<img src="${el.toDataURL()}" width="${el.width}" height="${el.height}" style="${escAttr(el.getAttribute("style") || "")}" class="${escAttr(el.className || "")}">`; }
      catch { return ""; }
    }
    // Formulierwaarden zichtbaar houden.
    let extra = "";
    if (tag === "input" && el.value && el.type !== "password") extra = ` value="${escAttr(el.value)}"`;

    let inner = "";
    if (el.shadowRoot) {
      stats.shadowRoots++;
      inner += `<template shadowrootmode="open">${adopted(el.shadowRoot)}${Array.from(el.shadowRoot.childNodes, ser).join("")}</template>`;
    }
    inner += Array.from(el.childNodes, ser).join("");
    if (VOID.has(tag)) return `<${tag}${attrs(el)}${extra}>`;
    return `<${tag}${attrs(el)}${extra}>${inner}</${tag}>`;
  };

  const html = "<!DOCTYPE html>" + ser(document.documentElement)
      .replace("</head>", adopted(document) + "</head>");
  return { html, stats, title: document.title };
}
"""

DOM_STABLE_JS = """
() => new Promise((resolve) => {
  let timer; const done = () => { obs.disconnect(); resolve(); };
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 500); });
  obs.observe(document, { subtree: true, childList: true, attributes: true });
  timer = setTimeout(done, 500);
  setTimeout(done, 15000);
})
"""


def diff_ratio(a: Path, b: Path) -> float:
    """Aandeel pixels dat merkbaar verschilt (0 = identiek)."""
    ia = Image.open(a).convert("RGB")
    ib = Image.open(b).convert("RGB").resize(ia.size)
    diff = ImageChops.difference(ia, ib).convert("L").point(lambda v: 255 if v > 24 else 0)
    hist = diff.histogram()
    return hist[255] / (ia.size[0] * ia.size[1])


async def capture(page: Page, url: str, out: Path) -> dict[str, object]:
    started = time.perf_counter()
    await page.goto(url, wait_until="networkidle", timeout=30_000)
    await page.evaluate(DOM_STABLE_JS)
    result = await page.evaluate(SERIALIZE_JS)
    elapsed = time.perf_counter() - started
    await page.screenshot(path=out / "original.png")
    (out / "snapshot.html").write_text(result["html"], encoding="utf-8")
    return {
        "title": result["title"],
        "stats": result["stats"],
        "capture_s": round(elapsed, 2),
        "html_kb": round(len(result["html"].encode()) / 1024, 1),
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("urls", nargs="+")
    parser.add_argument("--out", type=Path, default=Path("snapshots"))
    args = parser.parse_args()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        report = []
        for url in args.urls:
            out = args.out / re.sub(r"[^a-z0-9]+", "-", url.lower()).strip("-")
            out.mkdir(parents=True, exist_ok=True)
            # Vaste locale: zonder dit erft Chromium de container-locale (bv. "en-US@posix"),
            # waarop Grafana crasht bij het opstarten (gevonden in deze spike).
            live = await browser.new_page(viewport=VIEWPORT, locale="en-US")
            info = await capture(live, url, out)
            await live.close()

            # Snapshot renderen zoals de preview-iframe: zonder JavaScript.
            ctx = await browser.new_context(
                viewport=VIEWPORT, java_script_enabled=False, locale="en-US"
            )
            static = await ctx.new_page()
            await static.goto((out / "snapshot.html").resolve().as_uri())
            await static.wait_for_timeout(1000)
            await static.screenshot(path=out / "snapshot.png")
            await ctx.close()

            info["url"] = url
            info["pixel_diff"] = round(diff_ratio(out / "original.png", out / "snapshot.png"), 4)
            report.append(info)
            print(json.dumps(info, ensure_ascii=False))
        await browser.close()
    (args.out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
