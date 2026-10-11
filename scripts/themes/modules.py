"""Splitst themes/algemeen.css in modules voor /host/<hostname>.css (stappenplan C2).

algemeen.css blijft de bron: pas dat bestand aan en draai daarna

    python scripts/themes/modules.py

De modules komen in themes/modules/:

- alg-kern.css: kop, tokens, basis, formulieren, tabellen, hulpklassen en het slot (00-20, 99);
- alg-fw-<framework>.css: Bootstrap, Tabler, AdminLTE, Material, Vue, overige, ExtJS (30-40);
- alg-app-<app>.css: de app-specifieke blokken (60).

Een host laadt alg-kern, de frameworks die de app gebruikt en eventueel zijn app-blok, in
die volgorde (dezelfde volgorde als in algemeen.css; alleen het slot (99) zit al in de kern).
Elke regel uit algemeen.css zit in precies één module; `--check` controleert dat de modules
bij algemeen.css horen (CI).
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "themes" / "algemeen.css"
TARGET = ROOT / "themes" / "modules"

FRAMEWORKS = {
    "30": "bootstrap",
    "31": "tabler",
    "32": "adminlte",
    "33": "material",
    "34": "vue",
    "35": "overig",
    "40": "extjs",
}
KERN = {"00", "01", "10", "11", "12", "20", "99"}

_HEADER = re.compile(r"^/\* =+\n   (?P<num>\d\d) (?P<title>[^\n]*)\n", re.MULTILINE)
_BLOCK_START = re.compile(r"^/\* =+\n", re.MULTILINE)


def _slug(title: str) -> str:
    name = title.split(" (", 1)[0].split(" - ", 1)[0]
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", name).strip("-")


def module_name(num: str, title: str) -> str:
    if num in KERN:
        return "alg-kern"
    if num in FRAMEWORKS:
        return f"alg-fw-{FRAMEWORKS[num]}"
    if num == "60":
        return f"alg-app-{_slug(title)}"
    raise ValueError(f"onbekende sectie {num} {title}")


def split(css: str) -> dict[str, str]:
    """Modulenaam → inhoud, in de volgorde van algemeen.css (blokken zonder nummer horen bij
    de genummerde sectie ervoor; alles vóór de eerste genummerde sectie bij de kern)."""
    starts = [m.start() for m in _BLOCK_START.finditer(css)]
    if not starts or starts[0] != 0:
        starts.insert(0, 0)
    starts.append(len(css))
    modules: dict[str, list[str]] = {}
    current = "alg-kern"
    for begin, end in zip(starts, starts[1:], strict=False):
        chunk = css[begin:end]
        header = _HEADER.match(chunk)
        if header:
            current = module_name(header["num"], header["title"])
        modules.setdefault(current, []).append(chunk)
    return {name: "".join(parts) for name, parts in modules.items()}


def banner(name: str) -> str:
    return (
        f"/* {name}.css - gegenereerd uit algemeen.css door scripts/themes/modules.py;\n"
        "   niet met de hand aanpassen. Laadt na alg-kern.css (zie themes/README.md). */\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--check", action="store_true", help="alleen controleren, niets schrijven")
    args = parser.parse_args()

    css = SOURCE.read_text(encoding="utf-8")
    modules = split(css)
    if sum(len(content) for content in modules.values()) != len(css):
        print("modules.py: niet alles uit algemeen.css zit in een module", file=sys.stderr)
        return 1
    wanted = {f"{name}.css": banner(name) + content for name, content in modules.items()}

    if args.check:
        present = {p.name for p in TARGET.glob("alg-*.css")} if TARGET.exists() else set()
        stale = [
            name
            for name, content in wanted.items()
            if not (TARGET / name).exists()
            or (TARGET / name).read_text(encoding="utf-8") != content
        ]
        extra = sorted(present - set(wanted))
        if stale or extra:
            print(
                "themes/modules is verouderd: draai python scripts/themes/modules.py "
                f"(verschil: {', '.join(stale + extra)})",
                file=sys.stderr,
            )
            return 1
        return 0

    TARGET.mkdir(exist_ok=True)
    for old in TARGET.glob("alg-*.css"):
        if old.name not in wanted:
            old.unlink()
    for name, content in wanted.items():
        (TARGET / name).write_text(content, encoding="utf-8")
    sizes = ", ".join(f"{n.removesuffix('.css')} {len(c.encode()) // 1024} KB" for n, c in wanted.items())
    print(f"{len(wanted)} modules in {TARGET.relative_to(ROOT)}: {sizes}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
