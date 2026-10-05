import pytest

from cssthema.domain.css.minify import minify


@pytest.mark.parametrize(
    ("css", "expected"),
    [
        # Vóór ':' blijft één spatie (in een selector is dat een combinator).
        ("a { color : red ; }", "a{color :red}"),
        ("a {\n  color: red;\n  margin: 0 auto;\n}\n", "a{color:red;margin:0 auto}"),
        ("/* weg */ a { color: red } /* ook weg */", "a{color:red}"),
        ("/*! licentie */\na { color: red }", "/*! licentie */a{color:red}"),
        ("a > b ~ c , d { x: 1 }", "a>b~c,d{x:1}"),
        ("a :hover { x: 1 }", "a :hover{x:1}"),
        ("a:hover { x: 1 }", "a:hover{x:1}"),
        ("a * b { x: 1 }", "a * b{x:1}"),
        ("a [href] { x: 1 }", "a [href]{x:1}"),
        ("a { width: calc(100% - 2 * 10px) }", "a{width:calc(100% - 2 * 10px)}"),
        ("a { width: calc( 1px + var( --x ) ) }", "a{width:calc(1px + var(--x))}"),
        ("a { --gap: 1px + 2px; }", "a{--gap:1px + 2px}"),
        ("a { color: red !important; }", "a{color:red!important}"),
        ("a { ; ; color: red;; ; }", "a{color:red}"),
        ("a { font: 12px / 1.5 serif }", "a{font:12px/1.5 serif}"),
        (
            "@media screen and (min-width: 600px) { a { x: 1 } }",
            "@media screen and (min-width:600px){a{x:1}}",
        ),
        ("a{}", "a{}"),
        ("", ""),
    ],
)
def test_minify(css: str, expected: str) -> None:
    assert minify(css) == expected


@pytest.mark.parametrize(
    "css",
    [
        'a::after { content: "  twee  spaties ; { } " }',
        "a { background: url(  x.png  ) }",
        'a { background: url( "a b.png" ) }',
        "a::after { content: '\\201C' }",
        'a { font-family: "Fira  Code", monospace }',
    ],
)
def test_strings_and_urls_survive(css: str) -> None:
    out = minify(css)
    if "twee" in css:
        assert '"  twee  spaties ; { } "' in out
    if "url(  x.png" in css:
        assert "url(x.png)" in out
    if "a b.png" in css:
        assert '"a b.png"' in out
    if "Fira" in css:
        assert '"Fira  Code"' in out
    assert minify(out) == out


def test_tokens_that_would_merge_stay_separated() -> None:
    # Zonder scheiding zou `a/**/b` → `ab` één ident worden.
    out = minify("a/**/b{x:1}")
    assert out != "ab{x:1}"
    assert minify(out) == out
    assert minify("a { margin: 1px -2px }") == "a{margin:1px -2px}"


@pytest.mark.parametrize(
    "css",
    [
        ":root{--ct-bg:#000}\n.a { color: var(--ct-bg); }",
        "@supports (display: grid) and (not (display: inline-grid)) { .x { display: grid } }",
        "@font-face { font-family: X; src: url(x.woff2) format('woff2'); }",
        "a{}b{}/*! x */",
        "a { grid-template-areas: 'a b' 'c d'; }",
        ".a .b > .c + .d ~ .e { margin: -1px 0 0 -2px }",
    ],
)
def test_minify_is_idempotent(css: str) -> None:
    once = minify(css)
    assert minify(once) == once
