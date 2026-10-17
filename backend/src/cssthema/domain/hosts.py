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

import tinycss2
from tinycss2.ast import AtRule

from cssthema.domain.css.compiler import split_leading_statements

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
# Een echte domeinnaam eindigt op letters (`.be`, `.local`), niet op `1.5` of `v2.0`.
_TLD_RE = re.compile(r"[a-z][a-z-]*[a-z]")


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


def edit_names(names: Sequence[str], action: str, name: str, replacement: str | None) -> list[str]:
    """Bulkactie op een lijst: `add` (achteraan, zoals een kleurvariant), `remove`, of
    `replace` (op de plaats van de oude; stond de nieuwe er al, dan blijft hij één keer staan)."""
    if action == "add":
        return list(names) if name in names else [*names, name]
    if action == "remove":
        return [item for item in names if item != name]
    if action == "replace" and replacement:
        return list(dict.fromkeys(replacement if item == name else item for item in names))
    raise ValueError(f"Onbekende actie: {action}")


# --- samenvoegen ------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Part:
    """Eén thema of script in de bundel; `content` is None als het niet gevonden is."""

    name: str
    content: str | None
    source: str = ""  # "bestand", "thema" of "" (niet gevonden)


def build_css(hostname: str, matched: str | None, parts: Sequence[Part], *, enabled: bool) -> str:
    """Eén stylesheet uit de delen, in volgorde.

    Vroeger had elk deel een eigen `<link>`; nu staan ze achter elkaar, dus houden we ze los
    van elkaar: een BOM vooraan valt weg (anders hoort hij bij de eerste selector), een niet
    afgesloten commentaar of blok sluiten we af (anders slokt het het volgende deel op, zoals
    de kleurvariant), en `@import` vooraan een deel gaat naar het begin van de bundel (daarna
    negeert de browser het).
    """
    imports: list[str] = []
    lines: list[str] = []
    for part in parts:
        if part.content is None:
            lines.append(f'/* cssthema: "{part.name}" niet gevonden */\n')
            continue
        head, css = _leading_imports(part.content.removeprefix("﻿"))
        if head:
            imports.append(f'/* cssthema: @import uit "{part.name}" naar boven gehaald */\n')
            imports.append(head)
        lines.append(f"/* --- {part.name} ({part.source}) --- */\n")
        lines.append(css if css.endswith("\n") else css + "\n")
        lines.append(_seal(part.name, css))
    return _header(hostname, matched, enabled=enabled) + "".join(imports) + "".join(lines)


def _leading_imports(css: str) -> tuple[str, str]:
    """(`@import`-regels vooraan, rest): de rest houdt `@charset`/`@layer`/`@namespace`."""
    if "@import" not in css.lower():
        return "", css
    head, rest = split_leading_statements(css)
    imports: list[str] = []
    kept: list[str] = []
    for node in tinycss2.parse_stylesheet(head, skip_comments=False):
        if isinstance(node, AtRule) and node.lower_at_keyword == "import":
            imports.append(node.serialize() + "\n")
        else:
            kept.append(node.serialize())
    return "".join(imports), "".join(kept) + rest


# Commentaar, strings en escapes overslaan; alleen { en } tellen. Een string stopt (zoals in
# CSS) bij het einde van de regel.
_CSS_BLOCK_RE = re.compile(
    r"""(?P<comment>/\*.*?(?P<end>\*/|\Z))|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|\\.|[{}]""",
    re.DOTALL,
)


def _seal(name: str, css: str) -> str:
    """Wat er na een deel moet zodat het het volgende niet raakt: `*/` en `}` die ontbreken, of
    een lege regel die een `}` te veel opvangt (anders valt de eerste regel van het volgende
    deel weg). Leeg als het deel in orde is."""
    depth = 0
    stray = False
    open_comment = False
    for match in _CSS_BLOCK_RE.finditer(css):
        piece = match.group()
        if match.group("comment") is not None:
            open_comment = not match.group("end")
        elif piece == "{":
            if depth == 0:
                stray = False  # deze regel ving de } te veel al op
            depth += 1
        elif piece == "}":
            if depth:
                depth -= 1
            else:
                stray = True
    problems = []
    closing = ""
    if open_comment:
        closing += "*/"
        problems.append("commentaar niet afgesloten")
    if depth:
        closing += "}" * depth
        problems.append(f"{depth} keer }} ontbrak")
    if stray:
        closing += ":not(*){}"
        problems.append("} te veel")
    if not problems:
        return ""
    return f'{closing}\n/* cssthema: "{name}" aangevuld ({", ".join(problems)}) */\n'


def build_js(hostname: str, matched: str | None, parts: Sequence[Part], *, enabled: bool) -> str:
    lines = [_header(hostname, matched, enabled=enabled)]
    for part in parts:
        if part.content is None:
            lines.append(f'/* cssthema: script "{part.name}" niet gevonden */\n')
            continue
        # Elk script in een eigen try: een fout in het ene houdt de volgende niet tegen (zoals
        # bij losse <script>-tags). Gevolg: `let`/`const`/`class` bovenaan zijn niet meer
        # globaal voor de andere scripts; `var` en functies wel.
        lines.append(f"/* --- {part.name} --- */\ntry {{\n")
        lines.append(part.content if part.content.endswith("\n") else part.content + "\n")
        lines.append(f'}} catch (e) {{ console.error("cssthema: script {part.name}", e); }}\n')
    return "".join(lines)


def build_excluded(hostname: str) -> str:
    """Bundel (CSS of JS) voor een host die nooit iets krijgt: zoals een koppeling die uit staat."""
    return (
        f"/* cssthema: {hostname} staat uit (nooit injecteren: dashboard, CSS-domein of "
        "EXCLUDED_HOSTS) */\n"
    )


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
        if (
            "." not in name
            or name.endswith((".css", ".js"))
            or token.startswith("http")
            or not _TLD_RE.fullmatch(name.rsplit(".", 1)[1])
        ):
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


# --- de regel voor NPM ------------------------------------------------------------------------

SNIPPET_START = "# cssthema"
SNIPPET_END = "# /cssthema"
OWN_DOMAIN_PREFIX = "/alg-thema"

# Accept-Encoding leeg, alleen voor HTML-navigaties: anders comprimeert de app en vindt
# sub_filter geen </head>. `proxy_set_header` op server-niveau werkt in NPM niet: zijn eigen
# `location /` (include proxy.conf) zet eigen proxy_set_header-regels en erft dus niets.
# `more_set_input_headers` (headers-more, zit in OpenResty) erft die location wel. JS, CSS en
# JSON van de app blijven zo gecomprimeerd.
_ACCEPT_ENCODING_LINES = (
    "set $ct_ae $http_accept_encoding;\n"
    'if ($http_accept ~* "text/html") { set $ct_ae ""; }\n'
    'more_set_input_headers "Accept-Encoding: $ct_ae";\n'
)


def _tags(base: str, *, script: bool) -> str:
    tags = f'<link rel="stylesheet" href="{base}/host/$host.css">'
    if script:
        tags += f'<script src="{base}/host/$host.js" defer></script>'
    return tags + "</head>"


def snippet(public_base_url: str) -> str:
    """Het blok voor Advanced (server-niveau) van elke proxy host; overal hetzelfde.

    Nooit binnen een `location /`: dan vervangt NPM zijn eigen location (en de Access List).
    De markeringen `# cssthema…` en `# /cssthema` laten scripts het blok terugvinden.
    """
    base = public_base_url.rstrip("/")
    return (
        f"{SNIPPET_START}: zelfde regel in elke proxy host\n"
        f"sub_filter '</head>' '{_tags(base, script=True)}';\n"
        "sub_filter_once on;\n"
        f"{_ACCEPT_ENCODING_LINES}"
        f"{SNIPPET_END}\n"
    )


def snippet_own_domain(public_base_url: str, *, script: bool = False) -> str:
    """Variant via `/alg-thema/` op het eigen domein, voor apps waarvan de CSP het CSS-domein
    weigert. Standaard alleen CSS: een script draait daar *same-origin* en zou de CSP van een
    wachtwoordkluis (Vaultwarden) omzeilen. De location stuurt alleen GET/HEAD door, zonder
    cookies of Authorization van de app.
    """
    base = public_base_url.rstrip("/")
    label = "CSS en script" if script else "alleen CSS"
    return (
        f"{SNIPPET_START}: zelfde regel in elke proxy host (eigen domein, {label})\n"
        f"sub_filter '</head>' '{_tags(OWN_DOMAIN_PREFIX, script=script)}';\n"
        "sub_filter_once on;\n"
        f"{_ACCEPT_ENCODING_LINES}"
        f"location ^~ {OWN_DOMAIN_PREFIX}/ {{\n"
        "    limit_except GET HEAD { deny all; }\n"
        '    proxy_set_header Cookie "";\n'
        '    proxy_set_header Authorization "";\n'
        "    proxy_connect_timeout 2s;\n"
        "    proxy_read_timeout 5s;\n"
        "    proxy_ssl_server_name on;\n"
        f"    proxy_pass {base}/;\n"
        "}\n"
        f"{SNIPPET_END}\n"
    )
