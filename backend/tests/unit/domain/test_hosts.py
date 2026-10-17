# ruff: noqa: E501
import pytest

from cssthema.domain import hosts
from cssthema.domain.hosts import Part, build_css, build_js, parse_npm_config


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("proxmox100.jbogaert.be", "proxmox100.jbogaert.be"),
        ("  Proxmox100.JBogaert.be. ", "proxmox100.jbogaert.be"),
        ("https://nextcloud.jbogaert.be/apps/files", "nextcloud.jbogaert.be"),
        ("homeassistant.jbogaert.be:8123", "homeassistant.jbogaert.be"),
        ("*", "*"),
        ("localhost", "localhost"),
    ],
)
def test_normalize_hostname(raw: str, expected: str) -> None:
    assert hosts.normalize_hostname(raw) == expected


@pytest.mark.parametrize("raw", ["", "a..b", "-a.be", "a_b.be", "*.jbogaert.be", "x" * 64 + ".be"])
def test_normalize_hostname_rejects(raw: str) -> None:
    with pytest.raises(ValueError):
        hosts.normalize_hostname(raw)


def test_style_and_script_names() -> None:
    assert hosts.normalize_style_name("alg-proxmox.css") == "alg-proxmox"
    assert hosts.normalize_style_name("Home_Assistant") == "Home_Assistant"
    assert hosts.normalize_script_name("algemeen.js") == "algemeen"
    for bad in ("../x", "a/b", ".verborgen", "a*/b", "a..b"):
        with pytest.raises(ValueError):
            hosts.normalize_style_name(bad)
    with pytest.raises(ValueError):
        hosts.normalize_script_name("Algemeen")


def test_normalize_names_dedupes_in_order_and_limits() -> None:
    assert hosts.normalize_names(["b", "a.css", "b", " "], kind="styles") == ["b", "a"]
    with pytest.raises(ValueError, match="Hoogstens"):
        hosts.normalize_names([f"s{i}" for i in range(11)], kind="scripts")


def test_build_css_joins_parts_and_marks_missing_ones() -> None:
    css = build_css(
        "proxmox.x.be",
        "proxmox.x.be",
        [
            Part("algemeen", "a{}", "bestand"),
            Part("weg", None),
            Part("alg-proxmox", "b{}\n", "thema v2"),
        ],
        enabled=True,
    )
    assert css.startswith("/* cssthema: proxmox.x.be (koppeling proxmox.x.be) */\n")
    assert "/* --- algemeen (bestand) --- */\na{}\n" in css
    assert '/* cssthema: "weg" niet gevonden */' in css
    assert css.index("algemeen") < css.index("alg-proxmox")


def test_build_without_binding_or_disabled() -> None:
    assert "geen koppeling" in build_css("x.be", None, [], enabled=True)
    assert "staat uit" in build_js("x.be", "x.be", [], enabled=False)


def test_build_js_separates_scripts() -> None:
    js = build_js(
        "x.be", "*", [Part("a", "f()", "bestand"), Part("b", "g()", "bestand")], enabled=True
    )
    assert "try {\nf()\n}" in js
    assert js.index("f()") < js.index("g()")


CONFIG = """# Per proxy host in NPM -> Advanced: vervang je huidige sub_filter-regel.

# proxmox100.jbogaert.be
sub_filter '</head>' '<link rel="stylesheet" href="https://css.jbogaert.be/algemeen.css"><link rel="stylesheet" href="https://css.jbogaert.be/alg-proxmox.css"><script src="https://css.jbogaert.be/algemeen.js" defer></script></head>';
sub_filter_once on;
proxy_set_header Accept-Encoding "";

# nextcloud.jbogaert.be, cloud.jbogaert.be  (CSP: via /alg-thema/ op het eigen domein)
# alg-thema loopt via het eigen domein
location ^~ /alg-thema/ {
    proxy_pass https://css.jbogaert.be/;
}
sub_filter '</head>' '<link rel="stylesheet" href="/alg-thema/algemeen.css"><link rel="stylesheet" href="/alg-thema/alg-nextcloud.css"></head>';

sub_filter '</head>' '<link rel="stylesheet" href="https://css.jbogaert.be/host/$host.css"></head>';
"""


def test_parse_npm_config() -> None:
    imported, skipped = parse_npm_config(CONFIG)
    by_host = {host.hostname: host for host in imported}
    assert list(by_host) == ["proxmox100.jbogaert.be", "nextcloud.jbogaert.be", "cloud.jbogaert.be"]
    assert by_host["proxmox100.jbogaert.be"].styles == ["algemeen", "alg-proxmox"]
    assert by_host["proxmox100.jbogaert.be"].scripts == ["algemeen"]
    assert by_host["nextcloud.jbogaert.be"].styles == ["algemeen", "alg-nextcloud"]
    assert by_host["cloud.jbogaert.be"].scripts == []
    assert skipped == []


def test_comment_starting_with_a_file_name_is_not_a_hostname() -> None:
    imported, skipped = parse_npm_config(
        "# algemeen.css eerst\nsub_filter '</head>' '<link href=\"https://c.be/a.css\"></head>';"
    )
    assert imported == []
    assert len(skipped) == 1


def test_parse_npm_config_without_hostname() -> None:
    imported, skipped = parse_npm_config(
        "sub_filter '</head>' '<link href=\"https://c.be/a.css\"></head>';"
    )
    assert imported == []
    assert skipped[0].line == 1


# De regel ligt vast (getest op NPM 2.16): docs en scripts/regel.py geven exact dezelfde tekst.
MAIN_RULE = """\
# cssthema: zelfde regel in elke proxy host
sub_filter '</head>' '<link rel="stylesheet" href="https://css.jbogaert.be/host/$host.css"><script src="https://css.jbogaert.be/host/$host.js" defer></script></head>';
sub_filter_once on;
set $ct_ae $http_accept_encoding;
if ($http_accept ~* "text/html") { set $ct_ae ""; }
more_set_input_headers "Accept-Encoding: $ct_ae";
# /cssthema
"""

OWN_DOMAIN_RULE = """\
# cssthema: zelfde regel in elke proxy host (eigen domein, alleen CSS)
sub_filter '</head>' '<link rel="stylesheet" href="/alg-thema/host/$host.css"></head>';
sub_filter_once on;
set $ct_ae $http_accept_encoding;
if ($http_accept ~* "text/html") { set $ct_ae ""; }
more_set_input_headers "Accept-Encoding: $ct_ae";
location ^~ /alg-thema/ {
    limit_except GET HEAD { deny all; }
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
    proxy_ssl_server_name on;
    proxy_pass https://css.jbogaert.be/;
}
# /cssthema
"""

OWN_DOMAIN_SCRIPT_RULE = """\
# cssthema: zelfde regel in elke proxy host (eigen domein, CSS en script)
sub_filter '</head>' '<link rel="stylesheet" href="/alg-thema/host/$host.css"><script src="/alg-thema/host/$host.js" defer></script></head>';
sub_filter_once on;
set $ct_ae $http_accept_encoding;
if ($http_accept ~* "text/html") { set $ct_ae ""; }
more_set_input_headers "Accept-Encoding: $ct_ae";
location ^~ /alg-thema/ {
    limit_except GET HEAD { deny all; }
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
    proxy_ssl_server_name on;
    proxy_pass https://css.jbogaert.be/;
}
# /cssthema
"""


@pytest.mark.parametrize("base", ["https://css.jbogaert.be", "https://css.jbogaert.be/"])
def test_snippets_are_exactly_the_tested_rule(base: str) -> None:
    assert hosts.snippet(base) == MAIN_RULE
    assert hosts.snippet_own_domain(base) == OWN_DOMAIN_RULE
    assert hosts.snippet_own_domain(base, script=True) == OWN_DOMAIN_SCRIPT_RULE


def test_snippet_never_replaces_npms_location() -> None:
    # Met `location / {` in Advanced vervangt NPM zijn eigen location (en de Access List).
    for text in (MAIN_RULE, OWN_DOMAIN_RULE, OWN_DOMAIN_SCRIPT_RULE):
        assert "location / {" not in text
        assert "proxy_set_header Accept-Encoding" not in text
        assert text.startswith(hosts.SNIPPET_START)
        assert text.rstrip().endswith(hosts.SNIPPET_END)
    assert ".js" not in OWN_DOMAIN_RULE


@pytest.mark.parametrize("rule", [MAIN_RULE, OWN_DOMAIN_RULE, OWN_DOMAIN_SCRIPT_RULE])
def test_import_ignores_the_new_rule_and_keeps_reading_old_ones(rule: str) -> None:
    # Een geplakte Advanced met de nieuwe regel (markeringen, set/if/more_set_input_headers)
    # levert niets op en stoort de oude regels eronder niet.
    text = (
        f"# app.jbogaert.be\n{rule}\n"
        "# oud.jbogaert.be\n"
        "sub_filter '</head>' '<link rel=\"stylesheet\" href=\"https://css.x.be/alg-oud.css\"></head>';\n"
        "sub_filter_once on;\n"
        'proxy_set_header Accept-Encoding "";\n'
    )
    imported, skipped = parse_npm_config(text)
    assert [(h.hostname, h.styles) for h in imported] == [("oud.jbogaert.be", ["alg-oud"])]
    assert skipped == []


def test_comments_with_version_numbers_are_not_hostnames() -> None:
    text = (
        "# app.jbogaert.be\n"
        "# 1.5 MB limiet, v2.0 notities\n"
        "sub_filter '</head>' '<link rel=\"stylesheet\" href=\"https://css.x.be/alg-app.css\"></head>';\n"
    )
    hosts, skipped = parse_npm_config(text)
    assert [h.hostname for h in hosts] == ["app.jbogaert.be"]
    assert skipped == []


def test_scripts_are_isolated_from_each_other() -> None:
    js = build_js("a.be", "a.be", [Part("een", "throw 1"), Part("twee", "ok()")], enabled=True)
    assert js.count("try {") == 2
    assert 'console.error("cssthema: script een", e)' in js


def test_build_css_strips_a_bom_per_part() -> None:
    css = build_css("a.be", "a.be", [Part("een", "a{}"), Part("bom", "﻿:root{--x:1}")], enabled=True)
    assert "﻿" not in css
    assert "\n:root{--x:1}\n" in css


def test_an_unclosed_block_does_not_swallow_the_next_part() -> None:
    css = build_css(
        "a.be",
        "a.be",
        [
            Part("kapot", ".x-panel { color: red; @media (x) { a { b: c", "bestand"),
            Part("nord", ":root{--v:1}"),
        ],
        enabled=True,
    )
    broken, variant = css.split("/* --- nord")
    assert "a { b: c\n}}}\n" in broken  # alle drie afgesloten, vóór de variant
    assert '"kapot" aangevuld (3 keer } ontbrak)' in broken
    assert variant.endswith(":root{--v:1}\n")


def test_open_comment_and_stray_brace_are_sealed_too() -> None:
    css = build_css(
        "a.be",
        "a.be",
        [Part("c", "a{} /* open {"), Part("s", "b{}}"), Part("v", ":root{}")],
        enabled=True,
    )
    assert "/* open {\n*/\n" in css
    # Een } te veel neemt de volgende regel mee: die is nu een lege regel, niet :root.
    assert "b{}}\n:not(*){}\n" in css
    assert "aangevuld (commentaar niet afgesloten)" in css
    assert "aangevuld (} te veel)" in css


def test_braces_in_strings_comments_and_escapes_do_not_count() -> None:
    css = build_css(
        "a.be",
        "a.be",
        [Part("ok", 'a{content:"{"} b{content:\'}\'} /* { */ c\\{d{} e{x:"a\\"{"}')],
        enabled=True,
    )
    assert "aangevuld" not in css


def test_imports_of_every_part_move_to_the_top() -> None:
    fonts = '/* fonts */\n@charset "utf-8";\n@import url("https://fonts.googleapis.com/css2?family=Inter");\nbody{font-family:Inter}'
    css = build_css("a.be", "a.be", [Part("kern", "a{}"), Part("fonts", fonts)], enabled=True)
    head, rest = css.split("/* --- kern")
    assert '@import url("https://fonts.googleapis.com/css2?family=Inter");' in head
    assert '/* cssthema: @import uit "fonts" naar boven gehaald */' in head
    assert "@import" not in rest
    assert "body{font-family:Inter}" in rest
    assert '@charset "utf-8";' in rest  # blijft staan (de browser negeert hem daar)


def test_edit_names() -> None:
    assert hosts.edit_names(["a", "b"], "add", "nord", None) == ["a", "b", "nord"]
    assert hosts.edit_names(["a", "nord"], "add", "nord", None) == ["a", "nord"]
    assert hosts.edit_names(["a", "b"], "remove", "a", None) == ["b"]
    assert hosts.edit_names(["a", "x", "b"], "replace", "x", "y") == ["a", "y", "b"]
    assert hosts.edit_names(["a", "x", "y"], "replace", "x", "y") == ["a", "y"]
    with pytest.raises(ValueError):
        hosts.edit_names(["a"], "replace", "a", None)


def test_excluded_bundle_says_it_is_off() -> None:
    assert hosts.build_excluded("cssthema.jbogaert.be").startswith(
        "/* cssthema: cssthema.jbogaert.be staat uit"
    )
