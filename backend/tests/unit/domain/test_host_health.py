"""Oordeel over de pagina van een proxy host (cssthema.domain.host_health)."""

import pytest

from cssthema.domain.host_health import Code, Level, classify, csp_allows_style, is_login_redirect

BASE = "https://css.jbogaert.be"
HOST = "sonarr.jbogaert.be"


def judge(html: str, *, status: int = 200, csp: str | None = None, ctype: str = "text/html"):
    return classify(HOST, BASE, status=status, content_type=ctype, csp=csp, html=html)


def test_new_rule_is_ok() -> None:
    html = f'<head><link rel="stylesheet" href="{BASE}/host/{HOST}.css"></head>'
    assert judge(html).code is Code.RULE_ACTIVE
    assert judge(html).level is Level.OK


def test_old_rule_is_warning() -> None:
    html = f'<head><link rel="stylesheet" href="{BASE}/alg-sonarr.css"></head>'
    assert judge(html).code is Code.OLD_RULE
    assert judge('<link href="/alg-thema/algemeen.css">').code is Code.OLD_RULE


def test_no_rule_is_error() -> None:
    verdict = judge("<html><head></head></html>")
    assert verdict.code is Code.NO_RULE
    assert verdict.level is Level.ERROR


def test_server_error_without_theme() -> None:
    assert judge("<html></html>", status=502).code is Code.HTTP_ERROR


def test_not_html_and_401() -> None:
    assert judge("{}", ctype="application/json").code is Code.NOT_HTML
    assert judge("", status=401).code is Code.LOGIN


def test_csp_blocking_the_css_domain_is_a_warning() -> None:
    html = f'<link href="{BASE}/host/{HOST}.css">'
    verdict = judge(html, csp="default-src 'self'; style-src 'self' 'unsafe-inline'")
    assert verdict.code is Code.CSP_BLOCKED
    assert judge(html, csp="style-src 'self' https://css.jbogaert.be").code is Code.RULE_ACTIVE


def test_own_domain_variant_ignores_csp() -> None:
    html = f'<link href="/alg-thema/host/{HOST}.css">'
    verdict = judge(html, csp="default-src 'self'")
    assert verdict.code is Code.RULE_ACTIVE


@pytest.mark.parametrize(
    ("csp", "allowed"),
    [
        ("script-src 'self'", True),
        ("default-src 'self'", False),
        ("default-src *", True),
        ("style-src https:", True),
        ("style-src *.jbogaert.be", True),
        ("style-src https://*.jbogaert.be/", True),
        ("style-src http://css.jbogaert.be", True),
        ("style-src 'self'; style-src-elem css.jbogaert.be", True),
        ("style-src css.jbogaert.be; style-src-elem 'self'", False),
        ("style-src https://cdn.example.com", False),
        ("style-src 'nonce-abc'", False),
    ],
)
def test_csp_allows_style(csp: str, allowed: bool) -> None:
    assert csp_allows_style(csp, BASE) is allowed


def test_login_redirects() -> None:
    assert is_login_redirect(HOST, "https://auth.jbogaert.be/flows/x")
    assert is_login_redirect(HOST, f"https://{HOST}/outpost.goauthentik.io/start?rd=/")
    assert not is_login_redirect(HOST, f"https://{HOST}/login")
