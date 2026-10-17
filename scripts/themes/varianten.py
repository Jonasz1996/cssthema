"""Maakt kleurvarianten van het algemene thema (stappenplan C4): themes/varianten/alg-var-*.css.

Een variant overschrijft alleen de `--alg-*`-tokens uit `:root` van algemeen.css; laad hem
als laatste (op de Hosts-pagina: onderaan de lijst van een host, of bij `*` voor alles).
Knoppen en statusvlakken worden zo nodig donkerder gemaakt tot de tekst erop minstens 4.5:1
haalt (WCAG AA). `--check` controleert dat de bestanden up-to-date zijn (CI).

    python scripts/themes/varianten.py [--check]
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "themes" / "varianten"

# Per variant: de bronkleuren van het palet; de rest wordt afgeleid.
PALETTES: dict[str, dict[str, str]] = {
    "nord": {
        "titel": "Nord (nordtheme.com)",
        "diep": "#242933",
        "basis": "#2e3440",
        "vlak": "#3b4252",
        "vlak2": "#434c5e",
        "tekst": "#d8dee9",
        "sterk": "#eceff4",
        "gedempt": "#a7b1c2",
        "link": "#88c0d0",
        "accent": "#88c0d0",
        "knop": "#5e81ac",
        "ok": "#a3be8c",
        "fout": "#bf616a",
        "waarschuwing": "#ebcb8b",
        "info": "#81a1c1",
    },
    "dracula": {
        "titel": "Dracula (draculatheme.com)",
        "diep": "#191a21",
        "basis": "#21222c",
        "vlak": "#282a36",
        "vlak2": "#343746",
        "tekst": "#f8f8f2",
        "sterk": "#ffffff",
        "gedempt": "#b2b8d6",
        "link": "#bd93f9",
        "accent": "#bd93f9",
        "knop": "#6272a4",
        "ok": "#50fa7b",
        "fout": "#ff5555",
        "waarschuwing": "#f1fa8c",
        "info": "#8be9fd",
    },
    "catppuccin": {
        "titel": "Catppuccin Mocha (catppuccin.com)",
        "diep": "#11111b",
        "basis": "#181825",
        "vlak": "#1e1e2e",
        "vlak2": "#313244",
        "tekst": "#cdd6f4",
        "sterk": "#ffffff",
        "gedempt": "#a6adc8",
        "link": "#89b4fa",
        "accent": "#cba6f7",
        "knop": "#7f6aa8",
        "ok": "#a6e3a1",
        "fout": "#f38ba8",
        "waarschuwing": "#f9e2af",
        "info": "#89dceb",
    },
    "gruvbox": {
        "titel": "Gruvbox dark (github.com/morhetz/gruvbox)",
        "diep": "#1d2021",
        "basis": "#282828",
        "vlak": "#32302f",
        "vlak2": "#3c3836",
        "tekst": "#ebdbb2",
        "sterk": "#fbf1c7",
        "gedempt": "#bdae93",
        "link": "#83a598",
        "accent": "#fe8019",
        "knop": "#7c6f64",
        "ok": "#b8bb26",
        "fout": "#fb4934",
        "waarschuwing": "#fabd2f",
        "info": "#83a598",
    },
    "oceaan": {
        "titel": "Oceaan (donkerblauw met cyaan accent)",
        "diep": "#050b14",
        "basis": "#0b1726",
        "vlak": "#102033",
        "vlak2": "#16304a",
        "tekst": "#d4e4f2",
        "sterk": "#ffffff",
        "gedempt": "#93abc2",
        "link": "#6fd3ff",
        "accent": "#38bdf8",
        "knop": "#1f6f99",
        "ok": "#6ee7a8",
        "fout": "#f78c8c",
        "waarschuwing": "#f5c46b",
        "info": "#7cc4ff",
    },
}

WHITE = "#ffffff"
DARK = "#111111"


def rgb(color: str) -> tuple[int, int, int]:
    value = color.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def hex_(r: float, g: float, b: float) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, round(c))) for c in (r, g, b)))


def luminance(color: str) -> float:
    def channel(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = rgb(color)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def mix(a: str, b: str, amount: float) -> str:
    ra, rb = rgb(a), rgb(b)
    return hex_(*(x + (y - x) * amount for x, y in zip(ra, rb, strict=True)))


def darken_for(background: str, text: str, minimum: float = 4.5) -> str:
    """`background` stap voor stap donkerder tot `text` erop minstens `minimum` haalt."""
    color = background
    for _ in range(40):
        if contrast(color, text) >= minimum:
            return color
        color = mix(color, "#000000", 0.05)
    return color


def lighten_for(color: str, background: str, minimum: float = 4.5) -> str:
    """Tekstkleur stap voor stap lichter tot ze op `background` minstens `minimum` haalt."""
    for _ in range(40):
        if contrast(color, background) >= minimum:
            return color
        color = mix(color, WHITE, 0.06)
    return color


def rgba(color: str, alpha: float) -> str:
    r, g, b = rgb(color)
    return f"rgba({r}, {g}, {b}, {alpha:g})"


def render(name: str, p: dict[str, str]) -> str:
    basis = p["basis"]
    # Leestekst moet ook op het lichtste vlak (vlak2) leesbaar blijven.
    tekst = lighten_for(p["tekst"], p["vlak2"], 7.0)
    gedempt = lighten_for(p["gedempt"], p["vlak2"], 4.5)
    link = lighten_for(p["link"], p["vlak2"], 4.5)
    knop = darken_for(p["knop"], WHITE)
    knop_hover = darken_for(mix(knop, WHITE, 0.08), WHITE)
    ok_vlak = darken_for(p["ok"], WHITE)
    fout_vlak = darken_for(p["fout"], WHITE)
    accent = ", ".join(str(c) for c in rgb(p["accent"]))
    status = {k: lighten_for(p[k], p["vlak2"], 4.5) for k in ("ok", "fout", "waarschuwing", "info")}
    tokens = {
        "--alg-achtergrond": (
            f"radial-gradient(circle, {p['vlak2']}, {p['vlak']}, {basis}, {p['diep']}) "
            "center / cover no-repeat fixed"
        ),
        "--alg-achtergrond-kleur": basis,
        "--alg-glas": rgba(p["vlak"], 0.8),
        "--alg-glas-sterk": rgba(p["vlak"], 0.95),
        "--alg-vlak": p["vlak"],
        "--alg-vlak-2": p["vlak2"],
        "--alg-paneel": rgba(p["sterk"], 0.04),
        "--alg-rij": rgba(p["sterk"], 0.05),
        "--alg-rij-hover": rgba(p["sterk"], 0.09),
        "--alg-rij-actief": rgba(p["accent"], 0.18),
        "--alg-zebra": rgba(p["sterk"], 0.025),
        "--alg-veld": rgba(p["diep"], 0.85),
        "--alg-autofill": p["basis"],
        "--alg-rand": rgba(p["tekst"], 0.1),
        "--alg-rand-sterk": rgba(p["tekst"], 0.17),
        "--alg-rand-hover": rgba(p["accent"], 0.45),
        "--alg-tekst": tekst,
        "--alg-tekst-sterk": p["sterk"],
        "--alg-gedempt": gedempt,
        "--alg-zwak": mix(gedempt, basis, 0.3),
        "--alg-placeholder": gedempt,
        "--alg-link": link,
        "--alg-link-hover": p["sterk"],
        "--alg-code": link,
        "--alg-knop": knop,
        "--alg-knop-hover": knop_hover,
        "--alg-gloed": f"0 0 22px {rgba(p['accent'], 0.3)}",
        "--alg-accent": accent,
        "--alg-focus-rand": p["accent"],
        "--alg-ok": status["ok"],
        "--alg-fout": status["fout"],
        "--alg-waarschuwing": status["waarschuwing"],
        "--alg-info": status["info"],
        "--alg-ok-vlak": ok_vlak,
        "--alg-fout-vlak": fout_vlak,
        "--alg-waarschuwing-vlak": p["waarschuwing"],
        "--alg-info-vlak": p["info"],
        "--alg-ok-tint": rgba(p["ok"], 0.12),
        "--alg-fout-tint": rgba(p["fout"], 0.12),
        "--alg-waarschuwing-tint": rgba(p["waarschuwing"], 0.12),
        "--alg-info-tint": rgba(p["info"], 0.12),
        "--alg-ok-rand": rgba(p["ok"], 0.35),
        "--alg-fout-rand": rgba(p["fout"], 0.35),
        "--alg-waarschuwing-rand": rgba(p["waarschuwing"], 0.35),
        "--alg-info-rand": rgba(p["info"], 0.35),
        "--alg-scrollbar": mix(p["vlak2"], p["tekst"], 0.25),
    }
    checks = {
        "tekst/vlak-2": contrast(tekst, p["vlak2"]),
        "knop": contrast(knop, WHITE),
        "knop-hover": contrast(knop_hover, WHITE),
        "ok-vlak": contrast(ok_vlak, WHITE),
        "fout-vlak": contrast(fout_vlak, WHITE),
        "waarschuwing-vlak": contrast(p["waarschuwing"], DARK),
        "info-vlak": contrast(p["info"], DARK),
    }
    lines = [
        f"/* alg-var-{name}.css: kleurvariant {p['titel']} van het algemene thema.",
        " * Gemaakt met scripts/themes/varianten.py; pas dat script aan, niet dit bestand.",
        " * Laad als laatste, na algemeen.css (of alg-kern + modules) en alg-<app>.css.",
        " * Contrast (WCAG): "
        + ", ".join(f"{label} {value:.1f}:1" for label, value in checks.items()),
        " */",
        ":root {",
        *(f"  {key}: {value};" for key, value in tokens.items()),
        "}",
        "",
    ]
    failing = [label for label, value in checks.items() if value < 4.5]
    if failing:
        raise SystemExit(f"{name}: te weinig contrast voor {', '.join(failing)}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="alleen controleren (CI)")
    args = parser.parse_args()
    expected = {f"alg-var-{name}.css": render(name, p) for name, p in PALETTES.items()}
    if args.check:
        stale = [
            n
            for n, text in expected.items()
            if not (TARGET / n).is_file() or (TARGET / n).read_text() != text
        ]
        extra = sorted(p.name for p in TARGET.glob("alg-var-*.css") if p.name not in expected)
        if stale or extra:
            print(f"verouderd: {stale}, overbodig: {extra}", file=sys.stderr)
            print("Draai: python scripts/themes/varianten.py", file=sys.stderr)
            return 1
        return 0
    TARGET.mkdir(parents=True, exist_ok=True)
    for old in TARGET.glob("alg-var-*.css"):
        if old.name not in expected:
            old.unlink()
    for filename, text in expected.items():
        (TARGET / filename).write_text(text)
        print(f"{filename}: {len(text)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
