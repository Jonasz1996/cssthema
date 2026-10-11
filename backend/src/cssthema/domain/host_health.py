"""Gezondheid van een proxy host: is de `sub_filter`-regel actief en mag de app het thema laden?

Puur: de service (`services/host_health.py`) haalt `https://<host>/` op en geeft status,
headers en het begin van de HTML hier door.
"""

import re
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import urlsplit


class Level(StrEnum):
    OK = "ok"
    WARN = "warn"
    ERROR = "error"
    UNKNOWN = "unknown"


class Code(StrEnum):
    RULE_ACTIVE = "rule_active"  # de regel met /host/<host>.css staat in de pagina
    OLD_RULE = "old_rule"  # een eigen sub_filter met losse bestanden (werkt, maar niet via Hosts)
    NO_RULE = "no_rule"  # geen thema in de pagina: geen sub_filter, of Accept-Encoding ontbreekt
    CSP_BLOCKED = "csp_blocked"  # de CSP van de app laat het CSS-domein niet toe
    LOGIN = "login"  # doorgestuurd naar een login (Authentik): niet te controleren
    NOT_HTML = "not_html"
    HTTP_ERROR = "http_error"
    UNREACHABLE = "unreachable"


@dataclass(frozen=True, slots=True)
class Verdict:
    level: Level
    code: Code
    detail: str


def is_login_redirect(hostname: str, location: str) -> bool:
    """Een redirect naar een andere host of naar de Authentik-outpost.

    Een redirect binnen dezelfde host (bv. naar `/login` van de app zelf) volgt de service
    gewoon: ook die pagina krijgt het thema.
    """
    target = urlsplit(location)
    if target.hostname and target.hostname.lower() != hostname:
        return True
    return "outpost.goauthentik.io" in location.lower()


def classify(
    hostname: str,
    public_base_url: str,
    *,
    status: int,
    content_type: str,
    csp: str | None,
    html: str,
) -> Verdict:
    """Oordeel over een antwoord dat geen redirect is."""
    if status == 401:
        return Verdict(Level.UNKNOWN, Code.LOGIN, "De app vraagt eerst een login (401).")
    if "html" not in content_type.lower():
        if status >= 500:
            return Verdict(Level.ERROR, Code.HTTP_ERROR, f"De app antwoordt met {status}.")
        return Verdict(Level.UNKNOWN, Code.NOT_HTML, f"Geen HTML-pagina ({content_type or '?'}).")

    lowered = html.lower()
    own_domain = f"/alg-thema/host/{hostname}.css" in lowered
    if f"/host/{hostname}.css" in lowered:
        verdict = Verdict(Level.OK, Code.RULE_ACTIVE, "De regel voor alle hosts is actief.")
    elif _has_old_rule(lowered, public_base_url):
        verdict = Verdict(
            Level.WARN,
            Code.OLD_RULE,
            "Eigen sub_filter met losse bestanden: werkt, maar volgt de Hosts-pagina niet. "
            "Vervang hem door de regel voor alle hosts.",
        )
    elif status >= 500:
        return Verdict(Level.ERROR, Code.HTTP_ERROR, f"De app antwoordt met {status}.")
    else:
        return Verdict(
            Level.ERROR,
            Code.NO_RULE,
            "Geen thema in de pagina. Staat de sub_filter-regel in deze proxy host, met "
            'proxy_set_header Accept-Encoding ""?',
        )

    if not own_domain and csp and not csp_allows_style(csp, public_base_url):
        return Verdict(
            Level.WARN,
            Code.CSP_BLOCKED,
            "De Content-Security-Policy van de app weigert stylesheets van het CSS-domein. "
            "Gebruik voor deze host de variant via /alg-thema/ op het eigen domein.",
        )
    return verdict


def _has_old_rule(lowered_html: str, public_base_url: str) -> bool:
    base = public_base_url.rstrip("/").lower()
    if "/alg-thema/" in lowered_html:
        return True
    return bool(base) and re.search(re.escape(base) + r"/[^\"'\s>]+\.css", lowered_html) is not None


def csp_allows_style(csp: str, public_base_url: str) -> bool:
    """Laat deze CSP een stylesheet van `public_base_url` toe?

    Kijkt naar `style-src-elem`, dan `style-src`, dan `default-src` (de eerste die er is).
    Geen van drieën: alles mag. Nonces en hashes tellen niet: de regel heeft er geen.
    """
    directives: dict[str, list[str]] = {}
    for part in csp.split(";"):
        tokens = part.strip().split()
        if tokens:
            directives.setdefault(tokens[0].lower(), [t.lower() for t in tokens[1:]])
    sources = None
    for name in ("style-src-elem", "style-src", "default-src"):
        if name in directives:
            sources = directives[name]
            break
    if sources is None:
        return True
    target = urlsplit(public_base_url)
    scheme = (target.scheme or "https").lower()
    host = (target.hostname or "").lower()
    for source in sources:
        if source in ("*", f"{scheme}:"):
            return True
        if _source_matches(source, scheme, host):
            return True
    return False


def _source_matches(source: str, scheme: str, host: str) -> bool:
    if source.startswith("'"):
        return False
    value = source
    if "://" in value:
        source_scheme, value = value.split("://", 1)
        if source_scheme != scheme and not (source_scheme == "http" and scheme == "https"):
            return False
    value = value.split("/", 1)[0].split(":", 1)[0]
    if value.startswith("*."):
        return host.endswith(value[1:])
    return value == host
