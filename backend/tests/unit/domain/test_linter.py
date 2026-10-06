import pytest

from cssthema.domain.css.linter import (
    MAX_ISSUES_PER_RULE,
    LintResult,
    classify_url,
    lint,
    normalize_selector,
)

HOSTS = frozenset({"fonts.googleapis.com", "fonts.gstatic.com", "css.example.be"})


def run(css: str, *, max_bytes: int = 512 * 1024) -> LintResult:
    return lint(css, allowed_hosts=HOSTS, max_bytes=max_bytes)


def rules(result: LintResult, severity: str = "error") -> list[str]:
    issues = result.errors if severity == "error" else result.warnings
    return [issue.rule for issue in issues]


# --- algemeen -------------------------------------------------------------------------


@pytest.mark.parametrize("css", ["", "   \n\t ", "/* alleen commentaar */"])
def test_empty_css_is_ok(css: str) -> None:
    result = run(css)
    assert result.ok
    assert result.warnings == ()


def test_valid_css_has_no_issues() -> None:
    css = """
@import url("https://fonts.googleapis.com/css2?family=Inter");
:root { --ct-bg: #000; --x: calc(1px + 2px); }
@media (min-width: 600px) { .a > .b:hover { color: var(--ct-bg) !important; } }
@font-face { font-family: X; src: url(/fonts/x.woff2) format("woff2"); font-display: swap; }
@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }
.logo { background: url(data:image/png;base64,iVBORw0KGgo=) no-repeat, url("#icon"); }
.c { background-image: image-set("a.png" 1x, "https://css.example.be/b.png" 2x); }
.d { -webkit-user-select: none; -moz-appearance: none; -ms-overflow-style: none; }
"""
    result = run(css)
    assert result.errors == ()
    assert result.warnings == ()


def test_positions_are_one_based() -> None:
    result = run("a {\n  color: red;\n  background: url(https://evil.example/x.png);\n}")
    (issue,) = result.errors
    assert (issue.line, issue.column, issue.rule) == (3, 15, "external-url")
    assert issue.severity == "error"
    assert "evil.example" in issue.message


def test_size_bytes_counts_utf8() -> None:
    assert run("a{content:'é'}").size_bytes == len("a{content:'é'}".encode())


# --- too-large -------------------------------------------------------------------------


def test_too_large_stops_further_checks() -> None:
    result = run("<" * 200, max_bytes=100)
    assert rules(result) == ["too-large"]
    assert result.size_bytes == 200


def test_exactly_the_limit_is_ok() -> None:
    assert run("a{}" + " " * 97, max_bytes=100).ok


# --- parse-error -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "css",
    [
        "a { color: red;",
        "a { color: red; }}",
        "a { content: 'open; }",
        "a { color: red; } /* open",
        "a { background: url(x.png; }",
        "a { color red; }",
        "a color: red; }",
        "a { width: calc((1px + 2px); }",
        "a { background: url(x y.png); }",
    ],
)
def test_parse_errors(css: str) -> None:
    result = run(css)
    assert "parse-error" in rules(result)
    assert not result.ok


@pytest.mark.parametrize(
    "css",
    [
        "a { content: '}' }",
        'a { content: "/* geen commentaar */" }',
        "a { background: url('x).png') }",
        "a::after { content: '\\'' }",
    ],
)
def test_braces_in_strings_are_not_parse_errors(css: str) -> None:
    assert run(css).ok


# --- external-import / external-url ----------------------------------------------------


@pytest.mark.parametrize(
    "css",
    [
        "@import url(https://evil.example/x.css);",
        '@import "https://evil.example/x.css";',
        "@import url('//evil.example/x.css');",
        '@import url("http://evil.example/x.css") screen;',
    ],
)
def test_external_import(css: str) -> None:
    assert rules(run(css)) == ["external-import"]


@pytest.mark.parametrize(
    "css",
    [
        '@import "base.css";',
        "@import url(/themes/base.css);",
        '@import url("https://fonts.googleapis.com/css2?family=Inter");',
        '@import "https://css.example.be/x.css";',
    ],
)
def test_allowed_import(css: str) -> None:
    assert run(css).ok


@pytest.mark.parametrize(
    "css",
    [
        "a { background: url(https://evil.example/x.png) }",
        'a { background: url("https://evil.example/x.png") }',
        "a { background: url(//evil.example/x.png) }",
        "a { background: url(https:\\\\evil.example/x.png) }",
        "a { background: url(https:evil.example/x.png) }",
        "a { background: url('ftp://evil.example/x.png') }",
        "a { background: url('ht\\9tps://evil.example/x.png') }",
        'a { background: image-set("https://evil.example/a.png" 1x) }',
        'a { background: -webkit-image-set(url("https://evil.example/a.png") 1x) }',
        "a { --img: 'https://evil.example/x.png' }",
        "@font-face { font-family: X; src: url(https://evil.example/x.woff2) }",
        'a { background: src("https://evil.example/x.png") }',
        "a { background: url(https://fonts.googleapis.com.evil.example/x.png) }",
    ],
)
def test_external_url(css: str) -> None:
    assert "external-url" in rules(run(css))


@pytest.mark.parametrize(
    "css",
    [
        "a { background: url(x.png) }",
        "a { background: url(../img/x.png) }",
        "a { background: url(/img/x.png) }",
        "a { background: url(#filter) }",
        "a { background: url(data:image/svg+xml;utf8,%3Csvg%3E) }",
        "a { background: url(https://fonts.gstatic.com/x.woff2) }",
        "a { background: url(HTTPS://FONTS.GSTATIC.COM/x.woff2) }",
        "a { --label: 'gewone tekst'; --rel: 'img/x.png' }",
        '@namespace svg url("http://www.w3.org/2000/svg");',
        "a { content: 'https://evil.example is maar tekst' }",
    ],
)
def test_allowed_urls(css: str) -> None:
    assert run(css).ok


@pytest.mark.parametrize(
    "css",
    [
        # Strings die via substitutie in image-set()/src() belanden (op elk nestniveau).
        'a{background-image:image-set(var(--n,"https://evil.example/x.png") 1x)}',
        ':root{--y:var(--nope,"https://evil.example/a.png")}'
        "a{background-image:image-set(var(--y) 1x)}",
        '@property --x{syntax:"*";inherits:false;initial-value:"https://evil.example/a.png"}'
        "a{background-image:image-set(var(--x) 1x)}",
        'a{background-image:-webkit-image-set(env(--q,"https://evil.example/x.png") 1x)}',
        'a{background-image:image-set(if(media(print):"https://evil.example/x.png";else:"a.png"))}',
        'a{background:src(var(--u,"//evil.example/x.png"))}',
        '@function --f(){result:"https://evil.example/x.png"}',
        'a{background-image:image-set(--f("https://evil.example/x.png") 1x)}',
        ':root{--y:foo(bar("https://evil.example/a.png"))}',
        ":root{--y:{a:'https://evil.example/a.png'}}",
        # De URL-parser negeert C0-tekens aan het begin en tabs/regeleinden overal.
        ':root{--y:"\\1 //evil.example/a.png"}',
        ':root{--y:"/\\9/evil.example/a.png"}',
    ],
)
def test_external_url_via_substitution(css: str) -> None:
    assert "external-url" in rules(run(css))


@pytest.mark.parametrize(
    "css",
    [
        'a{content:var(--label,"Tip: lees dit")}',
        'a{background-image:image-set(var(--n,"img/a.png") 1x)}',
        '@property --x{syntax:"*";inherits:false;initial-value:"https://fonts.gstatic.com/a"}',
        ':root{--y:var(--z,"data:image/png;base64,AAAA")}',
    ],
)
def test_substitution_without_external_urls_is_ok(css: str) -> None:
    assert run(css).ok


def test_classify_url_follows_browser_quirks() -> None:
    assert classify_url(" \thttps://fonts.gstatic.com/x ", HOSTS) is None
    assert classify_url("h\nttps://evil.example/", HOSTS) is not None
    assert classify_url("/\\evil.example/x", HOSTS) is not None
    assert classify_url("https://fonts.gstatic.com.:443/x", HOSTS) is None
    assert classify_url("https://user@evil.example/", HOSTS) is not None
    rule, _ = classify_url("JaVaScRiPt:alert(1)", HOSTS) or ("", "")
    assert rule == "script-vector"


# --- script-vector -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "css",
    [
        "a { width: expression(alert(1)) }",
        "a { behavior: url(x.htc) }",
        "a { -ms-behavior: url(x.htc) }",
        "a { -moz-binding: url(x.xml#xss) }",
        "a { background: url(javascript:alert(1)) }",
        "a { background: url('javascript:alert(1)') }",
        "a { background: url(vbscript:msgbox) }",
        "a { background: url(  java\tscript:alert(1)) }",
        "a { width: EXPRESSION(1) }",
    ],
)
def test_script_vector(css: str) -> None:
    assert "script-vector" in rules(run(css))


@pytest.mark.parametrize(
    "css",
    [
        "a { content: 'expression(1)' }",
        ".behavior { color: red }",
        "a { transition-behavior: allow-discrete }",
        "a { content: 'javascript:' }",
    ],
)
def test_script_vector_negative(css: str) -> None:
    assert "script-vector" not in rules(run(css))


# --- html-in-css -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "css",
    [
        "</style><script>alert(1)</script>",
        "/* <b> */ a{}",
        "a::after { content: '<' }",
        "a::after { content: '\\3c' }",
        "a::after { content: '\\00003C' }",
        "a { background: url(x\\3c.png) }",
        "@media (width < 600px) { a { color: red } }",
    ],
)
def test_html_in_css(css: str) -> None:
    assert "html-in-css" in rules(run(css))


@pytest.mark.parametrize("css", ["a > b { color: red }", "a::after { content: '\\3d' }"])
def test_html_in_css_negative(css: str) -> None:
    assert "html-in-css" not in rules(run(css))


def test_issue_count_is_capped_per_rule() -> None:
    result = run("a{}" + "<" * 1000)
    assert rules(result).count("html-in-css") == MAX_ISSUES_PER_RULE


# --- waarschuwingen ------------------------------------------------------------------------


def test_unknown_property_is_a_warning() -> None:
    result = run("a { colr: red; color: red; --own: 1; -webkit-foo: 1; }")
    assert result.ok
    assert rules(result, "warning") == ["unknown-property"]
    assert "colr" in result.warnings[0].message


def test_descriptors_in_at_rules_are_known() -> None:
    css = (
        "@property --x { syntax: '<length>'; inherits: false; initial-value: 0px; }"
        "@page { size: A4; margin: 1cm; }"
    )
    # '<length>' bevat een '<' (html-in-css), maar geen onbekende descriptors.
    assert "unknown-property" not in rules(run(css), "warning")


def test_empty_rule_is_a_warning() -> None:
    result = run("a {}\n@media print {}\nb { /* leeg */ }")
    assert result.ok
    assert rules(result, "warning") == ["empty-rule", "empty-rule", "empty-rule"]


def test_duplicate_selector_on_the_same_level() -> None:
    result = run("a  >  b { color: red }\na>b { margin: 0 }\n@media print { a>b { color: blue } }")
    assert rules(result, "warning") == ["duplicate-selector"]
    assert result.warnings[0].line == 2
    assert "regel 1" in result.warnings[0].message


@pytest.mark.parametrize(
    "css",
    [
        'a { color: red }\n@import "x.css";',
        '@layer base { a { color: red } }\n@import "x.css";',
        '@namespace svg url("http://www.w3.org/2000/svg");\n@import "x.css";',
        '@media print { @import "x.css"; }',
    ],
)
def test_misplaced_import_is_a_warning(css: str) -> None:
    result = run(css)
    assert result.ok
    assert "misplaced-import" in rules(result, "warning")


def test_imports_after_charset_and_layer_statements_are_fine() -> None:
    css = '@charset "utf-8";\n@layer base, theme;\n@import "a.css";\n@import "b.css" layer(base);'
    assert "misplaced-import" not in rules(run(css), "warning")


def test_keyframe_steps_are_not_duplicate_selectors() -> None:
    css = "@keyframes x { from { opacity: 0 } from { opacity: 1 } }"
    assert "duplicate-selector" not in rules(run(css), "warning")


def test_normalize_selector() -> None:
    import tinycss2

    (rule,) = tinycss2.parse_stylesheet("a  >\n b , c  ~ d {}", skip_whitespace=True)
    assert normalize_selector(rule.prelude) == "a>b,c~d"
