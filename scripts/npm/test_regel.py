# ruff: noqa: E501  (de regels voor NPM staan er letterlijk in)
"""Tests voor regel.py: cd backend && uv run pytest ../scripts/npm -q"""

from __future__ import annotations

import json
import stat
import sys
import urllib.error
import urllib.request
from argparse import Namespace
from email.message import Message
from pathlib import Path
from typing import Any

import pytest
import regel

BASIS = "https://css.jbogaert.be"
OUDE_HOSTS = {"css.jbogaert.be", "cssthema.jbogaert.be"}

HOOFDREGEL = """# cssthema: zelfde regel in elke proxy host
sub_filter '</head>' '<link rel="stylesheet" href="https://css.jbogaert.be/host/$host.css"><script src="https://css.jbogaert.be/host/$host.js" defer></script></head>';
sub_filter_once on;
set $ct_ae $http_accept_encoding;
if ($http_accept ~* "text/html") { set $ct_ae ""; }
more_set_input_headers "Accept-Encoding: $ct_ae";
# /cssthema
"""

EIGEN_DOMEIN = """# cssthema: zelfde regel in elke proxy host (eigen domein, alleen CSS)
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

EIGEN_DOMEIN_SCRIPT = EIGEN_DOMEIN.replace(
    "(eigen domein, alleen CSS)", "(eigen domein, CSS en script)"
).replace(
    '$host.css"></head>', '$host.css"><script src="/alg-thema/host/$host.js" defer></script></head>'
)

OUD = (
    'sub_filter \'</head>\' \'<link rel="stylesheet" href="https://css.jbogaert.be/alg-kern.css">'
    '<link rel="stylesheet" href="https://css.jbogaert.be/alg-proxmox.css">'
    '<script src="https://css.jbogaert.be/algemeen.js" defer></script></head>\';\n'
    "sub_filter_once on;\n"
    'proxy_set_header Accept-Encoding "";\n'
)

AUTHENTIK = """# Increase buffer size for large headers
proxy_buffers 8 16k;
proxy_buffer_size 32k;

location / {
    proxy_pass          $forward_scheme://$server:$port;
    proxy_set_header Upgrade $http_upgrade;
    auth_request     /outpost.goauthentik.io/auth/nginx;
    error_page       401 = @goauthentik_proxy_signin;
    auth_request_set $auth_cookie $upstream_http_set_cookie;
    add_header       Set-Cookie $auth_cookie;
}

location /outpost.goauthentik.io {
    proxy_pass          http://outpost.lan:9000/outpost.goauthentik.io;
    proxy_set_header    X-Original-URL $scheme://$http_host$request_uri;
    proxy_pass_request_body off;
    proxy_set_header    Content-Length "";
}

location @goauthentik_proxy_signin {
    internal;
    return 302 /outpost.goauthentik.io/start?rd=$scheme://$http_host$request_uri;
}
"""

CSP_OUD = """location ^~ /alg-thema/ {
  proxy_pass https://css.jbogaert.be/;
  proxy_set_header Host css.jbogaert.be;
  proxy_ssl_server_name on;
}
sub_filter '</head>' '<link rel="stylesheet" href="/alg-thema/algemeen.css"><script src="/alg-thema/algemeen.js" defer></script></head>';
sub_filter_once on;
proxy_set_header Accept-Encoding "";
"""


def nieuw(oud: str, **kw: Any) -> regel.Resultaat:
    return regel.nieuwe_config(oud, BASIS, OUDE_HOSTS, **kw)


@pytest.fixture(autouse=True)
def geen_netwerk(monkeypatch: pytest.MonkeyPatch) -> None:
    def urlopen(*args: Any, **kw: Any) -> Any:
        pytest.fail("geen netwerk in de tests")

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)


# --- het blok -----------------------------------------------------------------------------


def test_regel_blok_letterlijk() -> None:
    assert regel.regel_blok(BASIS) == HOOFDREGEL
    assert regel.regel_blok(BASIS + "/") == HOOFDREGEL
    assert regel.regel_blok(BASIS, eigen_domein=True) == EIGEN_DOMEIN
    assert regel.regel_blok(BASIS, eigen_domein=True, met_script=True) == EIGEN_DOMEIN_SCRIPT


def test_regel_blok_gelijk_aan_backend() -> None:
    hosts = pytest.importorskip("cssthema.domain.hosts")
    if not hasattr(hosts, "snippet_own_domain"):
        pytest.skip("de backend heeft de regel met markeringen nog niet")
    assert regel.regel_blok(BASIS) == hosts.snippet(BASIS)
    assert regel.regel_blok(BASIS, eigen_domein=True) == hosts.snippet_own_domain(BASIS)
    assert regel.regel_blok(BASIS, eigen_domein=True, met_script=True) == hosts.snippet_own_domain(
        BASIS, script=True
    )


# --- lezen --------------------------------------------------------------------------------


def test_ontleden_zoals_nginx() -> None:
    tekst = (
        "# commentaar; met { haakjes\n"
        "sub_filter '</head>' 'a;b{c}#d</head>';\n"
        'if ($http_accept ~* "text/html") { set $ct_ae ""; }\n'
        "return 200 ${host}x#y;\n"
        "location / {\n  proxy_pass http://a; # weg\n}\n"
    )
    stellingen, commentaar = regel.ontleden(tekst)
    assert [s.naam for s in stellingen] == ["sub_filter", "if", "return", "location"]
    assert stellingen[0].args == ["</head>", "a;b{c}#d</head>"]
    assert stellingen[1].kinderen is not None and stellingen[1].kinderen[0].args == ["$ct_ae", ""]
    assert stellingen[2].args == ["200", "${host}x#y"]
    assert tekst[stellingen[3].begin : stellingen[3].einde].endswith("# weg\n}")
    assert [(c.tekst, c.diepte) for c in commentaar] == [
        ("# commentaar; met { haakjes", 0),
        ("# weg", 1),
    ]


@pytest.mark.parametrize(
    "tekst", ["location / {\n", "}\n", "sub_filter 'a\n", "proxy_pass x", "; x;"]
)
def test_ontleden_kapot(tekst: str) -> None:
    with pytest.raises(regel.ConfigError):
        regel.ontleden(tekst)
    r = nieuw(tekst)
    assert r.nieuw is None and r.reden.startswith("handmatig nakijken")


# --- de nieuwe config ---------------------------------------------------------------------


def test_oude_regel_per_host_wordt_hoofdregel() -> None:
    oud = "client_max_body_size 50m;\n" + OUD + "proxy_buffering off;\n"
    r = nieuw(oud)
    assert r.nieuw == "client_max_body_size 50m;\n" + HOOFDREGEL + "proxy_buffering off;\n"
    assert not r.eigen_domein


def test_authentik_blijft_letterlijk_staan() -> None:
    r = nieuw(AUTHENTIK + "\n" + OUD)
    assert r.nieuw == AUTHENTIK + "\n" + HOOFDREGEL


def test_csp_app_krijgt_eigen_domein_zonder_script() -> None:
    r = nieuw(CSP_OUD)
    assert r.nieuw == EIGEN_DOMEIN
    assert r.eigen_domein and not r.met_script and r.had_script
    assert regel._variant(r) == "eigen domein, alleen CSS (had ook een script: zie --met-script)"


def test_csp_app_met_script() -> None:
    r = nieuw(CSP_OUD, met_script=True)
    assert r.nieuw == EIGEN_DOMEIN_SCRIPT and r.met_script


def test_alleen_location_alg_thema_is_genoeg_voor_eigen_domein() -> None:
    oud = "location ^~ /alg-thema/ {\n  proxy_pass https://css.jbogaert.be/;\n}\n" + OUD
    assert nieuw(oud).nieuw == EIGEN_DOMEIN


@pytest.mark.parametrize("blok", [HOOFDREGEL, EIGEN_DOMEIN, EIGEN_DOMEIN_SCRIPT])
def test_tweede_keer_verandert_niets(blok: str) -> None:
    oud = AUTHENTIK + "\n" + blok + "proxy_buffering off;\n"
    assert nieuw(oud).nieuw == oud
    # Een bestaande variant met script blijft zo, ook zonder --met-script.
    assert nieuw(oud, met_script=True).nieuw == oud if blok != EIGEN_DOMEIN else True


def test_oude_regel_van_backend_zonder_markeringen() -> None:
    oud = (
        'sub_filter \'</head>\' \'<link rel="stylesheet" href="https://css.jbogaert.be/host/$host.css">'
        '<script src="https://css.jbogaert.be/host/$host.js" defer></script></head>\';\n'
        "sub_filter_once on;\n"
        'proxy_set_header Accept-Encoding "";\n'
        "set $ct_ae $http_accept_encoding;\n"
        'if ($http_accept ~* "text/html") { set $ct_ae ""; }\n'
        'more_set_input_headers "Accept-Encoding: $ct_ae";\n'
        "more_clear_input_headers Accept-Encoding;\n"
    )
    assert nieuw(oud).nieuw == HOOFDREGEL


def test_geen_thema_regels_dan_achteraan() -> None:
    assert nieuw("").nieuw == HOOFDREGEL
    assert nieuw("proxy_buffering off;\n\n\n").nieuw == "proxy_buffering off;\n\n" + HOOFDREGEL


def test_eigen_location_met_sub_filter_handmatig() -> None:
    oud = (
        "location / {\n"
        '  proxy_set_header Accept-Encoding "";\n'
        "  sub_filter '</head>' '<link rel=\"stylesheet\" href=\"https://css.jbogaert.be/a.css\"></head>';\n"
        "  include conf.d/include/proxy.conf;\n"
        "}\n"
    )
    r = nieuw(oud)
    assert r.nieuw is None and r.reden.endswith("binnen een eigen location /")
    r = nieuw(AUTHENTIK.replace("    add_header ", "    sub_filter_once on;\n    add_header ", 1))
    assert r.nieuw is None and r.reden.endswith("binnen location / met Authentik")


def test_eigen_location_zonder_sub_filter_mag() -> None:
    oud = "location / {\n  proxy_pass $forward_scheme://$server:$port;\n}\n" + OUD
    assert (
        nieuw(oud).nieuw
        == "location / {\n  proxy_pass $forward_scheme://$server:$port;\n}\n" + HOOFDREGEL
    )


def test_thema_links_in_andere_location_handmatig() -> None:
    oud = "location /app {\n  sub_filter '</head>' '<link href=\"/alg-thema/a.css\"></head>';\n}\n"
    r = nieuw(oud)
    assert r.nieuw is None and "location /app" in r.reden


def test_andere_sub_filter_in_andere_location_blijft() -> None:
    oud = "location /api {\n  sub_filter 'http://' 'https://';\n}\n" + OUD
    assert (
        nieuw(oud).nieuw == "location /api {\n  sub_filter 'http://' 'https://';\n}\n" + HOOFDREGEL
    )


@pytest.mark.parametrize(
    ("sub_filter", "reden"),
    [
        (
            "sub_filter '</head>' '<link rel=\"stylesheet\" href=\"https://theme-park.dev/x/dark.css\"></head>';",
            "theme-park.dev",
        ),
        (
            "sub_filter '</head>' '<link href=\"https://theme-park.dev/a.css\">"
            '<link href="https://css.jbogaert.be/b.css"></head>\';',
            "theme-park.dev",
        ),
        ("sub_filter 'http://intern' 'https://extern';", "zonder thema-links"),
    ],
)
def test_andere_sub_filter_handmatig(sub_filter: str, reden: str) -> None:
    r = nieuw(sub_filter + "\nsub_filter_once on;\n")
    assert r.nieuw is None and reden in r.reden


def test_oude_links_met_tikfout_en_oud_domein() -> None:
    oud = (
        'sub_filter \'</head>\' \'<link rel="stylesheet" href="https://cssthema.jbogaert.be/a.css">'
        '<script src="hhttps://cssthema.jbogaert.be/algemeen.js" defer></script></head>\';\n'
    )
    assert nieuw(oud).nieuw == HOOFDREGEL
    ip = "sub_filter '</head>' '<link href=\"https://192.168.0.164:18358/c.css\"></head>';\n"
    assert nieuw(ip).nieuw is None
    r = regel.nieuwe_config(ip, BASIS, {*OUDE_HOSTS, "192.168.0.164:18358"})
    assert r.nieuw == HOOFDREGEL


def test_escaped_aanhalingstekens() -> None:
    oud = "sub_filter '</head>' '<link rel=\\\"stylesheet\\\" href=\\\"https://css.jbogaert.be/a.css\\\"></head>';\n"
    assert nieuw(oud).nieuw == HOOFDREGEL


def test_meerdere_directives_op_een_regel() -> None:
    oud = "sub_filter_once on;  proxy_buffering off;\n" + OUD.replace("sub_filter_once on;\n", "")
    assert nieuw(oud).nieuw == HOOFDREGEL + "proxy_buffering off;\n"
    oud = "\tgzip off; sub_filter_once on;\n" + OUD.replace("sub_filter_once on;\n", "")
    assert nieuw(oud).nieuw == "\tgzip off;\n" + HOOFDREGEL


def test_blok_nooit_binnen_een_location() -> None:
    oud = "location /x {\n  proxy_pass http://a;\n} " + OUD
    assert nieuw(oud).nieuw == "location /x {\n  proxy_pass http://a;\n}\n" + HOOFDREGEL
    oud = "location /x {\n  proxy_pass http://a;\n} sub_filter_once on; location /y {\n}\n"
    assert nieuw(oud).nieuw == (
        "location /x {\n  proxy_pass http://a;\n}\n" + HOOFDREGEL + "location /y {\n}\n"
    )


def test_vangnet_als_een_tweede_keer_nog_iets_verandert(monkeypatch: pytest.MonkeyPatch) -> None:
    echt = regel._vervangen

    def binnen_location(oud: str, *args: Any) -> str:
        nieuw = echt(oud, *args)
        return nieuw if nieuw.startswith("location") else "location /x {\n" + nieuw + "}\n"

    monkeypatch.setattr(regel, "_vervangen", binnen_location)
    r = nieuw(OUD)
    assert r.nieuw is None and "ongewone opmaak" in r.reden


def test_commentaar_achter_een_oude_regel_gaat_mee() -> None:
    oud = 'proxy_set_header Accept-Encoding ""; # voor sub_filter\n# eigen notitie\n'
    assert nieuw(oud).nieuw == HOOFDREGEL + "# eigen notitie\n"


def test_markering_zonder_einde_handmatig() -> None:
    r = nieuw(HOOFDREGEL.replace("# /cssthema\n", ""))
    assert r.nieuw is None and "# /cssthema" in r.reden


def test_commentaar_met_cssthema_domein_is_geen_markering() -> None:
    oud = "# cssthema.jbogaert.be staat in EXCLUDED_HOSTS\n" + OUD
    assert nieuw(oud).nieuw == "# cssthema.jbogaert.be staat in EXCLUDED_HOSTS\n" + HOOFDREGEL


def test_crlf_blijft_crlf() -> None:
    oud = OUD.replace("\n", "\r\n") + "proxy_buffering off;\r\n"
    assert nieuw(oud).nieuw == HOOFDREGEL.replace("\n", "\r\n") + "proxy_buffering off;\r\n"


def test_oude_links_voor_hosts_conf() -> None:
    oud = (
        OUD
        + "location /app {\n  sub_filter '</head>' '<link href=\"/alg-thema/x.css\"></head>';\n}\n"
    )
    assert regel.oude_links(oud, OUDE_HOSTS) == [
        "https://css.jbogaert.be/alg-kern.css",
        "https://css.jbogaert.be/alg-proxmox.css",
        "https://css.jbogaert.be/algemeen.js",
        "/alg-thema/x.css",
    ]
    assert regel.oude_links(HOOFDREGEL, OUDE_HOSTS) == []


# --- plan, back-up, uitvoeren -------------------------------------------------------------


def opties(**kw: Any) -> Namespace:
    standaard = {
        "basis": BASIS,
        "dashboard": "cssthema.jbogaert.be",
        "uitsluiten": "",
        "oud_domein": "",
        "host": "",
        "met_script": False,
    }
    return Namespace(**{**standaard, **kw})


def host(
    host_id: int, naam: str, advanced: str, *, enabled: bool = True, online: bool = True
) -> dict[str, Any]:
    return {
        "id": host_id,
        "domain_names": [naam],
        "enabled": enabled,
        "advanced_config": advanced,
        "meta": {"nginx_online": online, "nginx_err": None},
    }


HOSTS = [
    host(1, "proxmox100.jbogaert.be", OUD),
    host(2, "adguard.jbogaert.be", AUTHENTIK + OUD),
    host(3, "portainer.jbogaert.be", CSP_OUD),
    host(4, "cssthema.jbogaert.be", AUTHENTIK),
    host(5, "css.jbogaert.be", ""),
    host(6, "vaultwarden.jbogaert.be", ""),
    host(7, "oud.jbogaert.be", OUD, enabled=False),
    host(8, "kapot.jbogaert.be", OUD, online=False),
    host(9, "klaar.jbogaert.be", HOOFDREGEL),
]


def test_plan() -> None:
    plannen = {p.namen[0]: p for p in regel.plan_maken(HOSTS, opties(uitsluiten="vault"))}
    assert {n: (p.status, p.reden) for n, p in plannen.items()} == {
        "adguard.jbogaert.be": ("gewijzigd", "hoofdregel"),
        "css.jbogaert.be": ("overgeslagen", "nooit: domein van --basis"),
        "cssthema.jbogaert.be": ("overgeslagen", "nooit: dashboard (--dashboard)"),
        "kapot.jbogaert.be": ("overgeslagen", "offline in NPM: eerst die fout oplossen"),
        "klaar.jbogaert.be": ("al goed", ""),
        "oud.jbogaert.be": ("overgeslagen", "uitgeschakeld in NPM"),
        "portainer.jbogaert.be": (
            "gewijzigd",
            "eigen domein, alleen CSS (had ook een script: zie --met-script)",
        ),
        "proxmox100.jbogaert.be": ("gewijzigd", "hoofdregel"),
        "vaultwarden.jbogaert.be": ("overgeslagen", "uitgesloten (--uitsluiten)"),
    }
    assert plannen["oud.jbogaert.be"].links  # ook uitgeschakelde hosts in --hosts-conf
    assert not plannen["css.jbogaert.be"].links


def test_plan_een_host_en_meerdere_dashboards() -> None:
    plannen = regel.plan_maken(HOSTS, opties(host="Portainer.jbogaert.be"))
    assert [p.id for p in plannen] == [3]
    plannen = regel.plan_maken(HOSTS, opties(dashboard="x.be, proxmox100.jbogaert.be"))
    assert {p.id: p.reden for p in plannen}[1] == "nooit: dashboard (--dashboard)"


def test_hosts_conf_leest_cssthema_in(tmp_path: Path) -> None:
    pad = tmp_path / "oude-links.conf"
    assert regel.hosts_conf_schrijven(pad, regel.plan_maken(HOSTS, opties())) == 5
    with pytest.raises(FileExistsError):  # een tweede run maakt het overzicht niet kleiner
        regel.hosts_conf_schrijven(pad, regel.plan_maken(HOSTS, opties(host="oud.jbogaert.be")))
    hosts = pytest.importorskip("cssthema.domain.hosts")
    geimporteerd, overgeslagen = hosts.parse_npm_config(pad.read_text(encoding="utf-8"))
    assert not overgeslagen
    per_host = {h.hostname: (h.styles, h.scripts) for h in geimporteerd}
    assert per_host["proxmox100.jbogaert.be"] == (["alg-kern", "alg-proxmox"], ["algemeen"])
    assert per_host["portainer.jbogaert.be"] == (["algemeen"], ["algemeen"])
    assert set(per_host) == {
        "adguard.jbogaert.be",
        "kapot.jbogaert.be",
        "oud.jbogaert.be",
        "portainer.jbogaert.be",
        "proxmox100.jbogaert.be",
    }


def test_backup_alleen_voor_eigenaar(tmp_path: Path) -> None:
    pad = tmp_path / "backup.json"
    plannen = [p for p in regel.plan_maken(HOSTS, opties()) if p.status == "gewijzigd"]
    regel.backup_schrijven(pad, "http://npm:81", plannen)
    assert stat.S_IMODE(pad.stat().st_mode) == 0o600
    data = json.loads(pad.read_text(encoding="utf-8"))
    assert [(h["id"], h["advanced_config"]) for h in data["hosts"]] == [
        (2, AUTHENTIK + OUD),
        (3, CSP_OUD),
        (1, OUD),
        (6, ""),
    ]
    with pytest.raises(FileExistsError):
        regel.backup_schrijven(pad, "http://npm:81", plannen)


class FakeNpm:
    """NPM in het klein: `kapot` in Advanced laat nginx -t falen."""

    base = "http://npm:81"

    def __init__(self, hosts: list[dict[str, Any]]) -> None:
        self.data: dict[int, dict[str, Any]] = {h["id"]: json.loads(json.dumps(h)) for h in hosts}
        self.puts: list[tuple[int, str]] = []

    def hosts(self) -> list[dict[str, Any]]:
        return list(self.data.values())

    def host(self, host_id: int) -> dict[str, Any]:
        if host_id not in self.data:
            raise urllib.error.HTTPError("x", 404, "Not Found", {}, None)  # type: ignore[arg-type]
        return self.data[host_id]

    def advanced_zetten(self, host_id: int, advanced: str) -> None:
        self.puts.append((host_id, advanced))
        h = self.data[host_id]
        h["advanced_config"] = advanced
        fout = "kapot" in advanced
        h["meta"] = {
            "nginx_online": not fout,
            "nginx_err": 'Command failed\nnginx: [emerg] unknown directive "kapot"\nnginx: test failed'
            if fout
            else None,
        }


def test_toepassen_en_terugzetten(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    npm = FakeNpm(HOSTS)
    plannen = regel.plan_maken(npm.hosts(), opties())
    backup = tmp_path / "backup.json"
    assert regel.toepassen(npm, plannen, backup) == 0  # type: ignore[arg-type]
    assert [i for i, _ in npm.puts] == [2, 3, 1, 6]
    assert npm.data[1]["advanced_config"] == HOOFDREGEL
    assert npm.data[3]["advanced_config"] == EIGEN_DOMEIN
    assert "teruggezet" not in capsys.readouterr().out

    npm.puts.clear()
    assert regel.terugzetten(npm, backup, "") == 0  # type: ignore[arg-type]
    assert {h["id"]: h["advanced_config"] for h in HOSTS} == {
        i: h["advanced_config"] for i, h in npm.data.items()
    }
    assert regel.terugzetten(npm, backup, "proxmox100.jbogaert.be") == 0  # type: ignore[arg-type]
    assert "al goed" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        regel.terugzetten(npm, backup, "bestaat.niet")  # type: ignore[arg-type]


def test_fout_zet_meteen_terug_en_stopt(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    npm = FakeNpm(HOSTS)
    plannen = regel.plan_maken(npm.hosts(), opties())
    gewijzigd = [p for p in plannen if p.status == "gewijzigd"]
    gewijzigd[1].nieuw = "kapot;\n"  # portainer
    assert regel.toepassen(npm, plannen, tmp_path / "b.json") == 1  # type: ignore[arg-type]
    assert [i for i, _ in npm.puts] == [2, 3, 3]  # adguard, portainer, portainer terug; 1 en 6 niet
    assert npm.data[3]["advanced_config"] == CSP_OUD
    assert npm.data[3]["meta"]["nginx_online"] is True
    assert npm.data[1]["advanced_config"] == OUD
    uit = capsys.readouterr().out
    assert 'FOUT: nginx: [emerg] unknown directive "kapot"' in uit
    assert "teruggezet" in uit and "Gestopt" in uit


def test_terugzetten_slaat_andere_host_met_zelfde_id_over(tmp_path: Path) -> None:
    pad = tmp_path / "b.json"
    pad.write_text(
        json.dumps(
            {"hosts": [{"id": 1, "domain_names": ["iets.anders.be"], "advanced_config": ""}]}
        ),
        encoding="utf-8",
    )
    npm = FakeNpm(HOSTS)
    assert regel.terugzetten(npm, pad, "") == 1  # type: ignore[arg-type]
    assert not npm.puts


class Antwoord:
    def __init__(self, soort: str, tekst: str) -> None:
        self.headers = Message()
        self.headers["Content-Type"] = soort
        self.tekst = tekst

    def __enter__(self) -> Antwoord:
        return self

    def __exit__(self, *args: Any) -> None:
        pass

    def read(self, n: int = -1) -> bytes:
        return self.tekst.encode()[:n]


@pytest.mark.parametrize(
    ("antwoord", "probleem"),
    [
        (Antwoord("text/css; charset=utf-8", "/* cssthema: * (koppeling *) */\n"), ""),
        (Antwoord("text/css", "/* cssthema: * staat uit (koppeling *) */\n"), ""),
        (
            Antwoord("text/css", "/* cssthema: geen koppeling voor * en geen standaard (*) */\n"),
            "cssthema heeft nog geen koppeling * (pagina Hosts)",
        ),
        (
            Antwoord("text/css", "body{}"),
            "https://css.jbogaert.be/host/*.css komt niet van cssthema",
        ),
        (Antwoord("text/html", "/* cssthema: */"), "komt niet van cssthema"),
        (urllib.error.HTTPError("x", 404, "Not Found", Message(), None), "geeft HTTP 404"),
        (urllib.error.URLError("Name or service not known"), "niet bereikbaar (Name or service"),
    ],
)
def test_basis_controleren(monkeypatch: pytest.MonkeyPatch, antwoord: Any, probleem: str) -> None:
    gevraagd: list[str] = []

    def urlopen(req: Any, timeout: float) -> Any:
        gevraagd.append(req.full_url)
        if isinstance(antwoord, Exception):
            raise antwoord
        return antwoord

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    uit = regel.basis_controleren(BASIS)
    assert (probleem in uit) if probleem else uit == ""
    assert gevraagd == ["https://css.jbogaert.be/host/*.css"]


def test_aantal_hosts() -> None:
    assert regel.aantal_hosts(1) == "1 host"
    assert regel.aantal_hosts(0) == "0 hosts"
    assert regel.aantal_hosts(2, "proxy host") == "2 proxy hosts"


# --- login en de hele run -----------------------------------------------------------------


def test_login_vraagt_code_alleen_bij_2fa(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NPM_WACHTWOORD", "pw")
    monkeypatch.delenv("NPM_CODE", raising=False)
    gevraagd: list[str] = []

    def invoer(vraag: str) -> str:
        gevraagd.append(vraag)
        return "123 456"

    monkeypatch.setattr("builtins.input", invoer)

    def zonder_2fa(url: str, data: Any = None, token: Any = None, method: str = "") -> Any:
        return {"token": "t1"}

    monkeypatch.setattr(regel, "_http_json", zonder_2fa)
    assert regel.npm_login("http://npm:81", "a@b.be") == "t1"
    assert gevraagd == []

    codes: list[str] = []

    def met_2fa(url: str, data: Any = None, token: Any = None, method: str = "") -> Any:
        if url.endswith("/api/tokens"):
            return {"requires_2fa": True, "challenge_token": "c"}
        codes.append(data["code"])
        if len(codes) == 1:
            raise urllib.error.HTTPError(url, 401, "nee", {}, None)  # type: ignore[arg-type]
        return {"token": "t2"}

    monkeypatch.setattr(regel, "_http_json", met_2fa)
    assert regel.npm_login("http://npm:81", "a@b.be") == "t2"
    assert codes == ["123456", "123456"] and len(gevraagd) == 2


def test_proefrun_verandert_niets_en_toont_geen_geheimen(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    geheim = 'proxy_set_header X-Sleutel "niet-tonen-123";\n'
    hosts = [
        host(1, "proxmox100.jbogaert.be", geheim + "\n\n" + "proxy_buffering off;\n" + OUD),
        host(2, "klaar.jbogaert.be", geheim + HOOFDREGEL),
        host(3, "database.jbogaert.be", geheim + "sub_filter 'a' 'b';\n"),
    ]
    npm = FakeNpm(hosts)
    monkeypatch.setattr(regel, "npm_login", lambda base, gebruiker: "t")
    monkeypatch.setattr(regel, "Npm", lambda base, token: npm)
    monkeypatch.setattr(regel, "basis_controleren", lambda basis: "")
    conf = tmp_path / "oud.conf"
    argv = ["regel.py", "--npm", "http://npm:81/", "--basis", BASIS + "/"]
    argv += ["--dashboard", "cssthema.jbogaert.be", "--hosts-conf", str(conf)]
    monkeypatch.setattr(sys, "argv", argv)
    regel.main()
    uit = capsys.readouterr().out
    assert not npm.puts
    assert "niet-tonen-123" not in uit
    assert "-proxy_set_header Accept-Encoding" in uit and "+# cssthema" in uit
    assert "database.jbogaert.be  handmatig nakijken: eigen sub_filter zonder thema-links" in uit
    assert "Proefrun" in uit and "Let op" not in uit and conf.exists()


@pytest.mark.parametrize(("antwoord", "puts"), [("nee", 0), ("", 0), ("ja", 2)])
def test_toepassen_vraagt_eerst_als_het_css_domein_niet_klopt(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    antwoord: str,
    puts: int,
) -> None:
    npm = FakeNpm([host(1, "proxmox100.jbogaert.be", OUD), host(2, "adguard.jbogaert.be", OUD)])
    monkeypatch.setattr(regel, "npm_login", lambda base, gebruiker: "t")
    monkeypatch.setattr(regel, "Npm", lambda base, token: npm)
    monkeypatch.setattr(regel, "basis_controleren", lambda basis: "x geeft HTTP 404")
    monkeypatch.setattr("builtins.input", lambda vraag: antwoord)
    argv = ["regel.py", "--npm", "http://npm:81", "--basis", BASIS, "--dashboard", "c.be"]
    argv += ["--toepassen", "--backup", str(tmp_path / "b.json")]
    monkeypatch.setattr(sys, "argv", argv)
    with pytest.raises(SystemExit) as e:
        regel.main()
    uit = capsys.readouterr().out
    assert "Let op: x geeft HTTP 404." in uit
    assert len(npm.puts) == puts
    assert e.value.code == (0 if puts else "Gestopt: er is niets veranderd.")
    assert ("Klaar: 2 hosts gewijzigd" in uit) == bool(puts)


@pytest.mark.parametrize(
    "extra",
    [
        ["--basis", "https://css.jbogaert.be'; deny all; #"],
        ["--basis", BASIS],  # geen --dashboard
    ],
)
def test_ongeldige_opties(monkeypatch: pytest.MonkeyPatch, extra: list[str]) -> None:
    monkeypatch.setattr(sys, "argv", ["regel.py", "--npm", "http://npm:81", *extra])
    monkeypatch.setattr(regel, "npm_login", lambda base, gebruiker: pytest.fail("geen login"))
    with pytest.raises(SystemExit) as e:
        regel.main()
    assert e.value.code == 2


def test_bestaand_hosts_conf_niet_overschrijven(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    conf = tmp_path / "oude-links.conf"
    conf.write_text("# uit stap 1\n", encoding="utf-8")
    argv = ["regel.py", "--npm", "http://npm:81", "--basis", BASIS, "--dashboard", "c.be"]
    monkeypatch.setattr(sys, "argv", [*argv, "--hosts-conf", str(conf)])
    monkeypatch.setattr(regel, "npm_login", lambda base, gebruiker: pytest.fail("geen login"))
    with pytest.raises(SystemExit) as e:
        regel.main()
    assert e.value.code == 2
    assert conf.read_text(encoding="utf-8") == "# uit stap 1\n"
