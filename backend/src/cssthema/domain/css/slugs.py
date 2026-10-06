"""Slugs: de publieke naam van een thema in `/{slug}.css`.

Het formaat is hetzelfde als de CHECK-constraint op `themes.slug` (docs/03 § 4.9) en de
regex in nginx (docker/nginx/conf.d/cssthema.conf). Gereserveerde woorden botsen met
routes van cssthema zelf en worden in de applicatie geweigerd.
"""

import re
import unicodedata

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$"
SLUG_MIN_LENGTH = 2
SLUG_MAX_LENGTH = 64
FALLBACK_SLUG = "thema"

_SLUG_RE = re.compile(SLUG_PATTERN)
_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")

RESERVED_SLUGS = frozenset(
    {
        "api",
        "themes",
        "assets",
        "healthz",
        "readyz",
        "metrics",
        "nginx-health",
        "preview-bridge",
        "index",
        "favicon",
        "robots",
        "static",
        "admin",
        "editor",
        "login",
        "logout",
        "import",
        "discovery",
        "ai",
        "palettes",
        "jobs",
        "settings",
        "services",
        "dashboard",
        "cssthema",
    }
)


class InvalidSlug(ValueError):  # noqa: N818  (domeinnaam uit het bouwplan)
    """De slug voldoet niet aan het formaat of is gereserveerd."""

    def __init__(self, slug: str, reason: str) -> None:
        super().__init__(reason)
        self.slug = slug
        self.reason = reason


def slugify(name: str) -> str:
    """Maakt een slug uit een vrije naam: `Proxmox (Nord)` → `proxmox-nord`.

    Accenten verdwijnen (NFKD + ASCII), alles wat geen letter of cijfer is wordt één
    streepje. Te kort (minder dan 2 tekens) wordt `thema`. Het resultaat kan nog een
    gereserveerd woord zijn; `validate_slug` controleert dat.
    """
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = _NON_SLUG_CHARS.sub("-", ascii_name.lower()).strip("-")
    slug = slug[:SLUG_MAX_LENGTH].rstrip("-")
    if len(slug) < SLUG_MIN_LENGTH:
        return FALLBACK_SLUG
    return slug


def is_valid_slug(slug: str) -> bool:
    """Formaat klopt en het woord is niet gereserveerd."""
    return _SLUG_RE.fullmatch(slug) is not None and slug not in RESERVED_SLUGS


def validate_slug(slug: str) -> None:
    """Gooit `InvalidSlug` met een Nederlandse reden als de slug niet bruikbaar is."""
    if len(slug) < SLUG_MIN_LENGTH:
        raise InvalidSlug(slug, f"Een slug heeft minstens {SLUG_MIN_LENGTH} tekens.")
    if len(slug) > SLUG_MAX_LENGTH:
        raise InvalidSlug(slug, f"Een slug heeft hoogstens {SLUG_MAX_LENGTH} tekens.")
    if _SLUG_RE.fullmatch(slug) is None:
        raise InvalidSlug(
            slug,
            "Alleen kleine letters, cijfers en streepjes; begin en eindig met een letter "
            "of cijfer.",
        )
    if slug in RESERVED_SLUGS:
        raise InvalidSlug(slug, f"'{slug}' is gereserveerd voor cssthema zelf.")


def with_suffix(slug: str, number: int) -> str:
    """`proxmox` + 2 → `proxmox-2`, ingekort zodat het resultaat binnen 64 tekens past."""
    suffix = f"-{number}"
    base = slug[: SLUG_MAX_LENGTH - len(suffix)].rstrip("-")
    return f"{base}{suffix}"
