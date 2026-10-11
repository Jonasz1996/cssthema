"""Hosts: welke thema's en scripts een proxy host krijgt via `/host/<hostname>.css|.js`.

Elke proxy host in NPM krijgt dezelfde `sub_filter`-regel met `$host` (de hostnaam van het
verzoek). cssthema zoekt daarbij de koppeling op en voegt de gekoppelde thema's (of
CSS-bestanden) samen tot één stylesheet, en de scripts tot één script. De koppeling `*` geldt
voor elke host zonder eigen koppeling.

Puur: geen I/O. Namen zijn zo beperkt dat ze veilig in een CSS-/JS-commentaar passen.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from urllib.parse import urlsplit

DEFAULT_HOST = "*"
MAX_STYLES = 20
MAX_SCRIPTS = 10
MAX_IMPORT_CHARS = 1024 * 1024

_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
HOSTNAME_RE = re.compile(rf"^(?=.{{1,253}}$){_LABEL}(?:\.{_LABEL})*$")
# Een thema-slug of de naam van een bestand in css-files (zonder `.css`), zoals nginx ze
# serveert; geen `/`, geen `..` en geen `*/`, dus veilig in een commentaar.
STYLE_NAME_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9_-]|\.(?!\.)){0,126}$")
SCRIPT_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$")

_URL_ATTR_RE = re.compile(r"""(?:href|src)\s*=\s*["']([^"'\s>]+)["']""", re.IGNORECASE)
_HOST_LIST_SPLIT = re.compile(r"[\s,;]+")


def normalize_hostname(raw: str) -> str:
    """`https://Proxmox100.jbogaert.be/` → `proxmox100.jbogaert.be`; `*` blijft `*`.

    Raises ValueError bij een ongeldige naam.
    """
    value = raw.strip().lower()
    if value == DEFAULT_HOST:
        return value
    if "://" in value:
        value = urlsplit(value).hostname or ""
    else:
        value = value.split("/", 1)[0].split(":", 1)[0]
    value = value.rstrip(".")
    if not HOSTNAME_RE.fullmatch(value):
        raise ValueError("Geen geldige hostnaam (bv. proxmox.jouwdomein.be, of * voor alle hosts).")
    return value


def normalize_style_name(raw: str) -> str:
    value = raw.strip().removesuffix(".css")
    if not STYLE_NAME_RE.fullmatch(value):
        raise ValueError(
            f"'{raw.strip()[:80]}' is geen geldige naam van een thema of CSS-bestand "
            "(letters, cijfers, - _ en ., zonder .css)."
        )
    return value


def normalize_script_name(raw: str) -> str:
    value = raw.strip().removesuffix(".js")
    if not SCRIPT_NAME_RE.fullmatch(value):
        raise ValueError(
            f"'{raw.strip()[:80]}' is geen geldige scriptnaam (kleine letters, cijfers en -)."
        )
    return value


def normalize_names(raw: Iterable[str], *, kind: str) -> list[str]:
    """Normaliseert en ontdubbelt, in de opgegeven volgorde."""
    normalize = normalize_style_name if kind == "styles" else normalize_script_name
    limit = MAX_STYLES if kind == "styles" else MAX_SCRIPTS
    names = list(dict.fromkeys(normalize(item) for item in raw if item.strip()))
    if len(names) > limit:
        raise ValueError(f"Hoogstens {limit} namen.")
    return names


# --- samenvoegen ------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Part:
    """Eén thema of script in de bundel; `content` is None als het niet gevonden is."""

    name: str
    content: str | None
    source: str = ""  # "bestand", "thema" of "" (niet gevonden)


def build_css(hostname: str, matched: str | None, parts: Sequence[Part], *, enabled: bool) -> str:
    lines = [_header(hostname, matched, enabled=enabled)]
    for part in parts:
        if part.content is None:
            lines.append(f'/* cssthema: "{part.name}" niet gevonden */\n')
            continue
        lines.append(f"/* --- {part.name} ({part.source}) --- */\n")
        lines.append(part.content if part.content.endswith("\n") else part.content + "\n")
    return "".join(lines)


def build_js(hostname: str, matched: str | None, parts: Sequence[Part], *, enabled: bool) -> str:
    lines = [_header(hostname, matched, enabled=enabled)]
    for part in parts:
        if part.content is None:
            lines.append(f'/* cssthema: script "{part.name}" niet gevonden */\n')
            continue
        # De `;` beschermt tegen een script dat zonder puntkomma eindigt.
        lines.append(f"/* --- {part.name} --- */\n;")
        lines.append(part.content if part.content.endswith("\n") else part.content + "\n")
    return "".join(lines)


def _header(hostname: str, matched: str | None, *, enabled: bool) -> str:
    if matched is None:
        return f"/* cssthema: geen koppeling voor {hostname} en geen standaard (*) */\n"
    if not enabled:
        return f"/* cssthema: {hostname} staat uit (koppeling {matched}) */\n"
    return f"/* cssthema: {hostname} (koppeling {matched}) */\n"


# --- importeren uit een NPM-config ------------------------------------------------------------


@dataclass(slots=True)
class ImportedHost:
    hostname: str
    styles: list[str] = field(default_factory=list)
    scripts: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class SkippedLine:
    line: int
    reason: str


def parse_npm_config(text: str) -> tuple[list[ImportedHost], list[SkippedLine]]:
    """Leest `# <hostnaam>`-commentaar en de `sub_filter`-regels eronder.

    Zo werkt het met `npm-sub_filter-per-dienst.conf` en met geplakte Advanced-blokken
    waarboven je de hostnaam als commentaar zet. Een commentaar met meerdere hostnamen
    (`# a.be, b.be`) geldt voor allemaal. Uit elke `href`/`src` in een `sub_filter` telt
    alleen de bestandsnaam: `https://css.x.be/alg-proxmox.css`, `/alg-thema/algemeen.js`.
    """
    hosts: dict[str, ImportedHost] = {}
    skipped: list[SkippedLine] = []
    current: list[str] = []
    for number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if line.startswith("#"):
            names = _hostnames_in_comment(line[1:])
            if names:
                current = names
            continue
        if not line.startswith("sub_filter ") and not line.startswith("sub_filter\t"):
            continue
        styles, scripts = _names_in_sub_filter(line)
        if not styles and not scripts:
            continue
        if not current:
            skipped.append(SkippedLine(number, "sub_filter zonder # hostnaam erboven"))
            continue
        for hostname in current:
            host = hosts.setdefault(hostname, ImportedHost(hostname))
            host.styles = list(dict.fromkeys([*host.styles, *styles]))[:MAX_STYLES]
            host.scripts = list(dict.fromkeys([*host.scripts, *scripts]))[:MAX_SCRIPTS]
    return list(hosts.values()), skipped


def _hostnames_in_comment(comment: str) -> list[str]:
    """Hostnamen vooraan in een commentaar (`# a.be, b.be  (CSP: ...)`); anders leeg."""
    names = []
    for token in _HOST_LIST_SPLIT.split(comment.strip()):
        if not token:
            continue
        try:
            name = normalize_hostname(token)
        except ValueError:
            break
        if "." not in name or name.endswith((".css", ".js")) or token.startswith("http"):
            break
        names.append(name)
    return names


def _names_in_sub_filter(line: str) -> tuple[list[str], list[str]]:
    styles: list[str] = []
    scripts: list[str] = []
    for url in _URL_ATTR_RE.findall(line):
        basename = urlsplit(url).path.rsplit("/", 1)[-1]
        if "$" in basename:
            continue  # al de regel met $host
        try:
            if basename.endswith(".css"):
                styles.append(normalize_style_name(basename))
            elif basename.endswith(".js"):
                scripts.append(normalize_script_name(basename))
        except ValueError:
            continue
    return styles, scripts


def snippet(public_base_url: str, *, via_own_domain: bool = False) -> str:
    """De `sub_filter`-regel die in elke proxy host hetzelfde is."""
    base = "/alg-thema" if via_own_domain else public_base_url.rstrip("/")
    return (
        f'sub_filter \'</head>\' \'<link rel="stylesheet" href="{base}/host/$host.css">'
        f'<script src="{base}/host/$host.js" defer></script></head>\';\n'
        "sub_filter_once on;\n"
        'proxy_set_header Accept-Encoding "";\n'
    )
