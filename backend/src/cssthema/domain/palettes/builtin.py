"""Ingebouwde paletten (pure data) en de omzetting naar `--ct-*`-variabelen.

De migratie `0002_fase1` seedt dezelfde waarden (gekopieerd, zodat de migratie stabiel
blijft als deze module later verandert); een unit-test bewaakt dat ze gelijk blijven.
Tokens volgens docs/03 § 4.8.
"""

import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass

TOKEN_NAMES = (
    "bg",
    "surface",
    "fg",
    "muted",
    "accent",
    "accent-fg",
    "success",
    "warning",
    "danger",
    "border",
    "radius",
    "font-sans",
    "font-mono",
)
CSS_VAR_PREFIX = "--ct-"

_TOKEN_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
# Een tokenwaarde mag de declaratie of het blok niet kunnen beëindigen.
_FORBIDDEN_IN_VALUE = re.compile(r"[;{}<>\\\n\r]|/\*|\*/")

_MONO_STACK = 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace'
_SANS_STACK = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
_CODE_STACK = '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace'


@dataclass(frozen=True, slots=True)
class BuiltinPalette:
    id: uuid.UUID
    slug: str
    name: str
    tokens: Mapping[str, str]


def _palette(number: int, slug: str, name: str, **tokens: str) -> BuiltinPalette:
    values = {key.replace("_", "-"): value for key, value in tokens.items()}
    if tuple(values) != TOKEN_NAMES:
        raise ValueError(f"de tokens van palet {slug} kloppen niet met TOKEN_NAMES")
    return BuiltinPalette(
        id=uuid.UUID(f"00000000-0000-7000-8000-{number:012d}"),
        slug=slug,
        name=name,
        tokens=values,
    )


BUILTIN_PALETTES: tuple[BuiltinPalette, ...] = (
    _palette(
        101,
        "terminal",
        "Terminal",
        bg="#141414",
        surface="#1e1e1e",
        fg="#dddddd",
        muted="#999999",
        accent="#aaaaaa",
        accent_fg="#000000",
        success="#8fd6a4",
        warning="#e6b56b",
        danger="#e58b8b",
        border="#333333",
        radius="10px",
        font_sans=_MONO_STACK,
        font_mono=_MONO_STACK,
    ),
    _palette(
        102,
        "nord",
        "Nord",
        bg="#2e3440",
        surface="#3b4252",
        fg="#eceff4",
        muted="#d8dee9",
        accent="#88c0d0",
        accent_fg="#2e3440",
        success="#a3be8c",
        warning="#ebcb8b",
        danger="#bf616a",
        border="#4c566a",
        radius="6px",
        font_sans=_SANS_STACK,
        font_mono=_CODE_STACK,
    ),
    _palette(
        103,
        "dracula",
        "Dracula",
        bg="#282a36",
        surface="#343746",
        fg="#f8f8f2",
        muted="#6272a4",
        accent="#bd93f9",
        accent_fg="#282a36",
        success="#50fa7b",
        warning="#f1fa8c",
        danger="#ff5555",
        border="#44475a",
        radius="6px",
        font_sans=_SANS_STACK,
        font_mono=_CODE_STACK,
    ),
    _palette(
        104,
        "catppuccin-mocha",
        "Catppuccin Mocha",
        bg="#1e1e2e",
        surface="#313244",
        fg="#cdd6f4",
        muted="#a6adc8",
        accent="#cba6f7",
        accent_fg="#11111b",
        success="#a6e3a1",
        warning="#f9e2af",
        danger="#f38ba8",
        border="#45475a",
        radius="8px",
        font_sans=_SANS_STACK,
        font_mono=_CODE_STACK,
    ),
    _palette(
        105,
        "gruvbox-dark",
        "Gruvbox Dark",
        bg="#282828",
        surface="#3c3836",
        fg="#ebdbb2",
        muted="#a89984",
        accent="#fe8019",
        accent_fg="#282828",
        success="#b8bb26",
        warning="#fabd2f",
        danger="#fb4934",
        border="#504945",
        radius="4px",
        font_sans=_SANS_STACK,
        font_mono=_CODE_STACK,
    ),
    _palette(
        106,
        "solarized-dark",
        "Solarized Dark",
        bg="#002b36",
        surface="#073642",
        fg="#93a1a1",
        muted="#657b83",
        accent="#268bd2",
        accent_fg="#fdf6e3",
        success="#859900",
        warning="#b58900",
        danger="#dc322f",
        border="#586e75",
        radius="4px",
        font_sans=_SANS_STACK,
        font_mono=_CODE_STACK,
    ),
    _palette(
        107,
        "tokyo-night",
        "Tokyo Night",
        bg="#1a1b26",
        surface="#24283b",
        fg="#c0caf5",
        muted="#9aa5ce",
        accent="#7aa2f7",
        accent_fg="#1a1b26",
        success="#9ece6a",
        warning="#e0af68",
        danger="#f7768e",
        border="#3b4261",
        radius="6px",
        font_sans=_SANS_STACK,
        font_mono=_CODE_STACK,
    ),
)


def ordered_tokens(tokens: Mapping[str, object]) -> dict[str, str]:
    """Tokens in de vaste volgorde van TOKEN_NAMES, daarna de rest alfabetisch.

    JSONB bewaart de volgorde van sleutels niet; zo blijven API en gecompileerde CSS
    voorspelbaar.
    """
    rank = {name: index for index, name in enumerate(TOKEN_NAMES)}
    names = sorted(tokens, key=lambda name: (rank.get(name, len(rank)), name))
    return {name: str(tokens[name]) for name in names}


def validate_tokens(tokens: Mapping[str, str]) -> None:
    """Gooit `ValueError` als een naam of waarde niet veilig in CSS past."""
    for name, value in tokens.items():
        if not _TOKEN_NAME_RE.fullmatch(name):
            raise ValueError(f"ongeldige tokennaam: {name!r}")
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"lege of ongeldige waarde voor token {name!r}")
        if _FORBIDDEN_IN_VALUE.search(value):
            raise ValueError(f"ongeldige tekens in de waarde van token {name!r}")


def palette_to_css_vars(tokens: Mapping[str, str]) -> str:
    """`{"bg": "#000"}` → `:root{--ct-bg:#000;}`; lege mapping → lege string."""
    if not tokens:
        return ""
    validate_tokens(tokens)
    declarations = "".join(
        f"{CSS_VAR_PREFIX}{name}:{value.strip()};" for name, value in tokens.items()
    )
    return f":root{{{declarations}}}"
