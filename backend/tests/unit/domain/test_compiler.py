import hashlib
import re
from datetime import UTC, datetime, timedelta, timezone

from cssthema.domain.css.compiler import compile_css, etag_for

PUBLISHED = datetime(2026, 10, 5, 12, 4, 31, tzinfo=UTC)
HEADER_RE = re.compile(
    r"^/\*! cssthema · (?P<slug>[a-z0-9-]+) · v(?P<n>\d+) · (?P<at>\S+) · "
    r"sha256:(?P<hash>[0-9a-f]{12}) \*/\n"
)


def test_header_body_and_hash() -> None:
    result = compile_css(
        "a {\n  color: red;\n}\n",
        slug="proxmox",
        version_number=8,
        published_at=PUBLISHED,
        palette_tokens=None,
    )
    match = HEADER_RE.match(result.css)
    assert match is not None
    assert match["slug"] == "proxmox"
    assert match["n"] == "8"
    assert match["at"] == "2026-10-05T12:04Z"
    body = result.css[match.end() :]
    assert body == "a{color:red}"
    assert match["hash"] == hashlib.sha256(body.encode()).hexdigest()[:12]
    encoded = result.css.encode("utf-8")
    assert result.sha256 == hashlib.sha256(encoded).digest()
    assert result.size_bytes == len(encoded)
    assert result.sha256_hex == result.sha256.hex()


def test_palette_tokens_come_first() -> None:
    result = compile_css(
        ".x { background: var(--ct-bg) }",
        slug="nord",
        version_number=1,
        published_at=PUBLISHED,
        palette_tokens={"bg": "#2e3440", "font-mono": '"JetBrains Mono", monospace'},
    )
    body = result.css.split("\n", 1)[1]
    assert body == (
        ':root{--ct-bg:#2e3440;--ct-font-mono:"JetBrains Mono",monospace}'
        ".x{background:var(--ct-bg)}"
    )


def test_palette_goes_after_leading_imports() -> None:
    # @import (en @charset, @layer-statements, @namespace) moet vóór alle andere regels
    # staan; anders negeert de browser de @import en verliest het thema zijn fonts.
    source = (
        "/*! licentie */\n@layer base, theme;\n"
        '@import url("https://fonts.googleapis.com/css2?family=Inter");\n'
        '@namespace svg url("http://www.w3.org/2000/svg");\n'
        "@layer base { p { margin: 0 } }\nbody { font-family: Inter }"
    )
    result = compile_css(
        source, slug="x1", version_number=1, published_at=PUBLISHED, palette_tokens={"bg": "#000"}
    )
    body = result.css.split("\n", 1)[1]
    assert body == (
        "/*! licentie */@layer base,theme;"
        '@import url("https://fonts.googleapis.com/css2?family=Inter");'
        '@namespace svg url("http://www.w3.org/2000/svg");'
        ":root{--ct-bg:#000}@layer base{p{margin:0}}body{font-family:Inter}"
    )


def test_palette_after_an_import_without_semicolon() -> None:
    result = compile_css(
        '@import "a.css"',
        slug="x1",
        version_number=1,
        published_at=PUBLISHED,
        palette_tokens={"bg": "#000"},
    )
    assert result.css.split("\n", 1)[1] == '@import "a.css";:root{--ct-bg:#000}'


def test_local_time_is_converted_to_utc() -> None:
    local = PUBLISHED.astimezone(timezone(timedelta(hours=2)))
    result = compile_css("", slug="x1", version_number=1, published_at=local, palette_tokens=None)
    assert "· 2026-10-05T12:04Z ·" in result.css


def test_end_tag_is_escaped_defensively() -> None:
    result = compile_css(
        "a::after { content: '</style>' }"
        ' b { background: url("data:image/svg+xml,<svg></svg>") }',
        slug="x1",
        version_number=1,
        published_at=PUBLISHED,
        palette_tokens=None,
    )
    assert "</" not in result.css
    assert "\\3c /style>" in result.css


def test_media_range_keeps_its_less_than() -> None:
    result = compile_css(
        "@media (width < 600px) { a { color: red } }",
        slug="x1",
        version_number=1,
        published_at=PUBLISHED,
        palette_tokens=None,
    )
    assert "(width<600px)" in result.css.replace(" ", "")


def test_same_input_gives_the_same_hash() -> None:
    args = {"slug": "x1", "version_number": 1, "published_at": PUBLISHED, "palette_tokens": None}
    assert compile_css("a{}", **args).sha256 == compile_css("a {}", **args).sha256


def test_etag_for() -> None:
    digest = hashlib.sha256(b"x").digest()
    assert etag_for(digest) == f'"sha256-{digest.hex()[:16]}"'
