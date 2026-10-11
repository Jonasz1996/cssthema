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


def test_snippet() -> None:
    text = hosts.snippet("https://css.jbogaert.be/")
    assert 'href="https://css.jbogaert.be/host/$host.css"' in text
    assert 'src="https://css.jbogaert.be/host/$host.js" defer' in text
    assert 'proxy_set_header Accept-Encoding "";' in text
    assert 'href="/alg-thema/host/$host.css"' in hosts.snippet("x", via_own_domain=True)


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
