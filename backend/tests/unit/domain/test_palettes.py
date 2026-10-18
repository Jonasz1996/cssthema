import pytest

from cssthema.domain.palettes.builtin import (
    BUILTIN_PALETTES,
    TOKEN_NAMES,
    ordered_tokens,
    palette_to_css_vars,
    validate_tokens,
)


def test_builtin_palettes_are_complete_and_unique() -> None:
    slugs = [p.slug for p in BUILTIN_PALETTES]
    assert slugs == [
        "terminal",
        "nord",
        "dracula",
        "catppuccin-mocha",
        "gruvbox-dark",
        "solarized-dark",
        "tokyo-night",
    ]
    assert len({p.id for p in BUILTIN_PALETTES}) == len(BUILTIN_PALETTES)
    for palette in BUILTIN_PALETTES:
        assert tuple(palette.tokens) == TOKEN_NAMES
        validate_tokens(palette.tokens)


def test_terminal_palette_matches_the_ui() -> None:
    terminal = BUILTIN_PALETTES[0]
    assert terminal.tokens["bg"] == "#141414"
    assert terminal.tokens["fg"] == "#dddddd"
    assert terminal.tokens["radius"] == "10px"
    assert terminal.tokens["font-mono"].startswith("ui-monospace")


def test_palette_to_css_vars() -> None:
    assert palette_to_css_vars({}) == ""
    assert palette_to_css_vars({"bg": " #000 ", "accent-fg": "#fff"}) == (
        ":root{--ct-bg:#000;--ct-accent-fg:#fff;}"
    )


@pytest.mark.parametrize(
    "tokens",
    [
        {"bg": "#000;}body{display:none"},
        {"bg": "red</style>"},
        {"bg": "/* x */"},
        {"bg": ""},
        {"Bg": "#000"},
        {"bg": "#000\n"},
        {"bg": "\\3c"},
    ],
)
def test_unsafe_tokens_are_rejected(tokens: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        palette_to_css_vars(tokens)


def test_ordered_tokens() -> None:
    tokens = {"radius": "4px", "zeta": "1", "bg": "#000", "alpha": "2", "fg": "#fff"}
    assert list(ordered_tokens(tokens)) == ["bg", "fg", "radius", "alpha", "zeta"]
