"""Splitst themes/algemeen.css in modules voor /host/<hostname>.css (stappenplan C2).

algemeen.css blijft de bron: pas dat bestand aan en draai daarna

    python scripts/themes/modules.py

De modules komen in themes/modules/:

- alg-kern.css: kop, tokens, basis, formulieren, tabellen, hulpklassen en het slot (00-20, 99);
- alg-fw-<framework>.css: Bootstrap, Tabler, AdminLTE, Material, Vue, Bulma, overige, ExtJS
  (30-40; Bulma is het eerste blok van 35);
- alg-app-<app>.css: de app-specifieke blokken (60).

Een host laadt alg-kern, de frameworks die de app gebruikt en eventueel zijn app-blok, in
die volgorde (dezelfde volgorde als in algemeen.css; alleen het slot (99) zit al in de kern).
Elke regel uit algemeen.css zit in precies één module.

Snelheid: algemeen.css herkent een app aan haar head (`html:has(> head > meta[...])`) en
Bulma aan de pagina (`body:has(.navbar-burger, ...)`). Zo'n :has() over het hele document
laat Chromium bij elke DOM-wijziging de hele pagina herberekenen (tot 200 ms per wijziging).
Een alg-app-module gaat alleen naar de host van die app en alg-fw-bulma alleen naar
Bulma-apps; daar is de herkenning altijd waar. In die modules wordt `:has(X)` daarom
`:not(X)`: geldt altijd voor html of body, kost niets en houdt dezelfde specificiteit, zodat
de cascade gelijk blijft aan algemeen.css. Bewakers die pagina's of toestanden van één app
onderscheiden (`base[href="/setup/"]` van UniFi, `:has(#loginform)`, Grafana licht) blijven.

Buiten de alg-app-modules mag geen :has() over het hele document overblijven; dan stopt het
script met een melding.

`--check` controleert dat de modules bij algemeen.css horen en dat elke naam in
themes/hosts-modules.conf bestaat (CI).
"""

import argparse
import itertools
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
THEMES = ROOT / "themes"
SOURCE = THEMES / "algemeen.css"
TARGET = THEMES / "modules"
CONF = THEMES / "hosts-modules.conf"

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
# Blokken zonder nummer met een eigen module; de andere horen bij de sectie ervoor.
SUBMODULES = {"BULMA": "alg-fw-bulma"}

_HEADER = re.compile(r"^/\* =+\n   (?P<num>\d\d) (?P<title>[^\n]*)\n", re.MULTILINE)
_SUBHEADER = re.compile(r"^/\* =+\n   (?P<word>[A-Z]+)\b")
_BLOCK_START = re.compile(r"^/\* =+\n", re.MULTILINE)

# Commentaar en strings: daarin wordt niets herschreven.
_SKIP = re.compile(r"/\*.*?\*/|\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'", re.DOTALL)
# Het begin van een bewaker: html, :root of body met direct :has( of :is(:has(.
_GUARD = re.compile(r"(?<![\w\-.#:\\])(?P<subject>html|:root|body)(?=:has\(|:is\(:has\()")
_HEAD = re.compile(r"\s*>\s*head\s*>")
# Bewakers die pagina's van één app onderscheiden (UniFi /setup/ en /manage/): blijven.
_PAGE = re.compile(r"\s*>\s*head\s*>\s*base\b")


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
    de genummerde sectie ervoor, behalve die uit SUBMODULES; alles vóór de eerste genummerde
    sectie bij de kern)."""
    starts = [m.start() for m in _BLOCK_START.finditer(css)]
    if not starts or starts[0] != 0:
        starts.insert(0, 0)
    starts.append(len(css))
    modules: dict[str, list[str]] = {}
    section = current = "alg-kern"
    for begin, end in itertools.pairwise(starts):
        chunk = css[begin:end]
        header = _HEADER.match(chunk)
        sub = _SUBHEADER.match(chunk)
        if header:
            section = current = module_name(header["num"], header["title"])
        elif sub:
            current = SUBMODULES.get(sub["word"], section)
        modules.setdefault(current, []).append(chunk)
    return {name: "".join(parts) for name, parts in modules.items()}


# --- bewakers herschrijven ---------------------------------------------------------------------


def _close(css: str, open_at: int) -> int:
    """Index van de `)` bij de `(` op open_at (strings en escapes tellen niet mee)."""
    depth = 0
    i = open_at
    while i < len(css):
        ch = css[i]
        if ch == "\\":
            i += 2
            continue
        if ch in "\"'":
            end = css.find(ch, i + 1)
            while end > 0 and css[end - 1] == "\\":
                end = css.find(ch, end + 1)
            if end < 0:
                break
            i = end + 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"geen sluithaakje bij positie {open_at}")


def _items(text: str) -> list[str]:
    """Een selectorlijst splitsen op de komma's van het hoogste niveau."""
    items, depth, start, i = [], 0, 0, 0
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch in "\"'":
            i = text.index(ch, i + 1) + 1
            continue
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            items.append(text[start:i])
            start = i + 1
        i += 1
    items.append(text[start:])
    return items


def _as_not(argument: str) -> str:
    """`:has(> head > x)` wordt `:not(head > x)`: zelfde specificiteit, altijd waar."""
    return ":not(" + re.sub(r"^\s*>\s*", "", argument) + ")"


def _rewrite_guard(css: str, at: int, subject: str) -> tuple[str, int]:
    """Herschrijft de :has()/:is(:has())-reeks na html, :root of body op positie `at`.

    Geeft de nieuwe tekst van die reeks en de positie in `css` waar ze eindigt.
    """
    out = []
    pos = at
    while True:
        if css.startswith(":has(", pos):
            end = _close(css, pos + 4)
            argument = css[pos + 5 : end]
            app = _HEAD.match(argument) and not _PAGE.match(argument)
            out.append(_as_not(argument) if subject == "body" or app else css[pos : end + 1])
            pos = end + 1
        elif css.startswith(":is(:has(", pos):
            end = _close(css, pos + 3)
            items = [item.strip() for item in _items(css[pos + 4 : end])]
            only_has = all(
                item.startswith(":has(") and _close(item, 4) == len(item) - 1 for item in items
            )
            arguments = [item[5:-1] for item in items]
            app = (
                subject != "body"
                and only_has
                and any(_HEAD.match(a) for a in arguments)
                and not any(_PAGE.match(a) for a in arguments)
            )
            if app:
                out.append(":is(" + ", ".join(_as_not(a) for a in arguments) + ")")
            else:
                out.append(css[pos : end + 1])
            pos = end + 1
        else:
            return "".join(out), pos


def cheap_guards(name: str, css: str) -> str:
    """Herschrijft de :has()-herkenning in een alg-app-module (op html of :root) of in
    alg-fw-bulma (op body) naar :not(); andere modules blijven ongewijzigd."""
    if name.startswith("alg-app-"):
        subjects = {"html", ":root"}
    elif name == "alg-fw-bulma":
        subjects = {"body"}
    else:
        return css
    skip = [m.span() for m in _SKIP.finditer(css)]
    out = []
    pos = 0
    for m in _GUARD.finditer(css):
        if m.start() < pos or m["subject"] not in subjects:
            continue
        if any(a <= m.start() < b for a, b in skip):
            continue
        guard, end = _rewrite_guard(css, m.end(), m["subject"])
        out.append(css[pos : m.end()] + guard)
        pos = end
    out.append(css[pos:])
    return "".join(out)


def expensive_guards(name: str, css: str) -> list[str]:
    """Wat na cheap_guards nog aan :has() over het hele document in een module staat (hoort
    leeg te zijn). In een alg-app-module telt alleen de head-herkenning (bewakers op body of
    UniFi's base[href] onderscheiden pagina's van die ene app); alg-kern en de alg-fw-modules
    (de stapel van * en de frameworks) mogen geen html-, :root- of body:has() hebben. Zo valt
    het ook op als Bulma door een andere blokkop weer in alg-fw-overig belandt."""
    code = _SKIP.sub("", css)
    if name.startswith("alg-app-"):
        found = re.finditer(r":has\(\s*>\s*head\s*>(?!\s*base\b)", code)
    else:
        found = _GUARD.finditer(code)
    return [code[m.start() : m.start() + 60] for m in found]


def banner(name: str) -> str:
    text = (
        f"/* {name}.css - gegenereerd uit algemeen.css door scripts/themes/modules.py;\n"
        "   niet met de hand aanpassen. Laadt na alg-kern.css (zie themes/README.md)."
    )
    if name.startswith("alg-app-"):
        text += (
            "\n   Alleen voor de host van deze app: de herkenning html:has(> head > ...) uit\n"
            "   algemeen.css staat hier als html:not(head > ...) (altijd waar, zelfde\n"
            "   specificiteit, geen herberekening van de hele pagina bij elke DOM-wijziging)."
        )
    elif name == "alg-fw-bulma":
        text += (
            "\n   Alleen voor Bulma-apps: de herkenning body:has(...) uit algemeen.css staat hier\n"
            "   als body:not(...) (altijd waar, zelfde specificiteit, geen herberekening van de\n"
            "   hele pagina bij elke DOM-wijziging)."
        )
    return text + " */\n"


# --- hosts-modules.conf ------------------------------------------------------------------------

_URL_ATTR = re.compile(r"""(?:href|src)\s*=\s*["']([^"'\s>]+)["']""", re.IGNORECASE)


def conf_names(text: str) -> list[str]:
    """De bestandsnamen (alg-kern.css, algemeen.js ...) uit de sub_filter-regels van de conf."""
    names: list[str] = []
    for line in text.splitlines():
        if line.strip().startswith("sub_filter"):
            names += [url.rsplit("/", 1)[-1] for url in _URL_ATTR.findall(line)]
    return list(dict.fromkeys(name for name in names if "$" not in name))


def unknown_names(text: str, modules: set[str]) -> list[str]:
    """Namen uit de conf zonder module of bestand in themes/ (de bundel gaf "niet gevonden")."""
    present = set(modules)
    for folder in (THEMES, THEMES / "apps", THEMES / "varianten"):
        present |= {p.name for p in folder.glob("*.css")} | {p.name for p in folder.glob("*.js")}
    return [name for name in conf_names(text) if name not in present]


def check_conf(modules: set[str]) -> int:
    """1 (met een melding) als hosts-modules.conf een module of bestand noemt dat niet bestaat."""
    if unknown := unknown_names(CONF.read_text(encoding="utf-8"), modules):
        print(
            f"themes/hosts-modules.conf noemt onbekende bestanden: {', '.join(unknown)}",
            file=sys.stderr,
        )
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--check", action="store_true", help="alleen controleren, niets schrijven")
    args = parser.parse_args()

    css = SOURCE.read_text(encoding="utf-8")
    modules = split(css)
    if sum(len(content) for content in modules.values()) != len(css):
        print("modules.py: niet alles uit algemeen.css zit in een module", file=sys.stderr)
        return 1
    modules = {name: cheap_guards(name, content) for name, content in modules.items()}
    for name, content in modules.items():
        if left := expensive_guards(name, content):
            print(f"modules.py: {name} houdt :has()-herkenning: {left[0]} ...", file=sys.stderr)
            return 1
    wanted = {f"{name}.css": banner(name) + content for name, content in modules.items()}
    status = check_conf(set(wanted))

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
        return status

    TARGET.mkdir(exist_ok=True)
    for old in TARGET.glob("alg-*.css"):
        if old.name not in wanted:
            old.unlink()
    for name, content in wanted.items():
        (TARGET / name).write_text(content, encoding="utf-8")
    sizes = ", ".join(
        f"{n.removesuffix('.css')} {len(c.encode()) // 1024} KB" for n, c in wanted.items()
    )
    print(f"{len(wanted)} modules in {TARGET.relative_to(ROOT)}: {sizes}")
    return status


if __name__ == "__main__":
    sys.exit(main())
