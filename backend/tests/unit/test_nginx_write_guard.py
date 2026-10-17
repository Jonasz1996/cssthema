"""nginx laat schrijven op /api/ alleen toe via TRUSTED_PROXIES of vanaf de machine zelf.

Fase 1 heeft geen login; zonder deze regel kon iedereen die poort 80 rechtstreeks bereikt
(LAN, andere containers) Authentik in NPM omzeilen. Het gedrag zelf test de CI-job
"Installatie zonder Docker" met een echte nginx; hier de configuratie en het script.
"""

import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[3]
SCRIPT = ROOT / "docker/nginx/entrypoint/40-cssthema-real-ip.sh"
CONF = ROOT / "docker/nginx/conf.d/cssthema.conf"


def run_script(tmp_path: Path, proxies: str) -> subprocess.CompletedProcess[str]:
    # Vast script uit de repo, geen invoer van buiten.
    return subprocess.run(  # noqa: S603
        ["/bin/sh", str(SCRIPT)],
        env={
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "TRUSTED_PROXIES": proxies,
            "CSSTHEMA_REAL_IP_CONF": str(tmp_path / "real-ip.conf"),
        },
        capture_output=True,
        text=True,
        check=False,
    )


def geo_entries(conf: str) -> list[str]:
    match = re.search(r"geo \$realip_remote_addr \$ct_trusted_peer \{\n(.*?)\n\}", conf, re.S)
    assert match, conf
    return [line.strip() for line in match.group(1).splitlines()]


def test_trusted_peers_are_the_proxies_and_localhost(tmp_path: Path) -> None:
    result = run_script(tmp_path, "192.0.2.10, 172.16.0.0/12,127.0.0.1")
    assert result.returncode == 0, result.stderr
    conf = (tmp_path / "real-ip.conf").read_text()
    assert "set_real_ip_from 192.0.2.10;" in conf
    assert "set_real_ip_from 172.16.0.0/12;" in conf
    # Op het adres van de verbinding ($realip_remote_addr), niet op $remote_addr: dat is na
    # real_ip al de client uit X-Forwarded-For, en die kan iedereen verzinnen.
    assert geo_entries(conf) == [
        "default 0;",
        "127.0.0.1 1;",
        "::1 1;",
        "192.0.2.10 1;",
        "172.16.0.0/12 1;",
    ]  # 127.0.0.1 niet dubbel (nginx waarschuwt dan)


def test_invalid_proxy_is_refused(tmp_path: Path) -> None:
    result = run_script(tmp_path, "192.0.2.10;allow all")
    assert result.returncode != 0
    assert "ongeldige waarde in TRUSTED_PROXIES" in result.stderr


def api_location() -> str:
    conf = CONF.read_text()
    match = re.search(r"\n    location /api/ \{\n(.*?)\n    \}\n", conf, re.S)
    assert match
    return match.group(1)


def test_api_writes_need_a_trusted_peer() -> None:
    conf = CONF.read_text()
    assert re.search(
        r"map \$request_method \$ct_api_write \{\s*GET\s+0;\s*HEAD\s+0;\s*OPTIONS\s+0;"
        r"\s*default\s+1;\s*\}",
        conf,
    )
    assert re.search(
        r'map "\$ct_api_write:\$ct_trusted_peer" \$ct_api_write_denied \{\s*"1:0"\s+1;'
        r"\s*default\s+0;\s*\}",
        conf,
    )
    location = api_location()
    guard = location.index("if ($ct_api_write_denied) {")
    assert guard < location.index("proxy_pass")
    assert '"code":"proxy_required"' in location
    assert "default_type application/problem+json;" in location


DASHBOARD_SCRIPT = ROOT / "docker/nginx/entrypoint/41-cssthema-dashboard-host.sh"


def run_dashboard_script(tmp_path: Path, hosts: str | None) -> subprocess.CompletedProcess[str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "CSSTHEMA_DASHBOARD_HOST_CONF": str(tmp_path / "dashboard-host.conf"),
    }
    if hosts is not None:
        env["DASHBOARD_HOST"] = hosts
    # Vast script uit de repo, geen invoer van buiten.
    return subprocess.run(  # noqa: S603
        ["/bin/sh", str(DASHBOARD_SCRIPT)], env=env, capture_output=True, text=True, check=False
    )


def map_entries(conf: str) -> list[str]:
    match = re.search(r"map \$host \$ct_dashboard_host \{\n(.*?)\n\}", conf, re.S)
    assert match, conf
    return [line.strip() for line in match.group(1).splitlines()]


def test_dashboard_hosts_map(tmp_path: Path) -> None:
    result = run_dashboard_script(tmp_path, "Cssthema.Example.be, localhost localhost")
    assert result.returncode == 0, result.stderr
    entries = map_entries((tmp_path / "dashboard-host.conf").read_text())
    assert entries == ["default 0;", "cssthema.example.be 1;", "localhost 1;"]


def test_dashboard_host_defaults_to_localhost(tmp_path: Path) -> None:
    for hosts in (None, ""):
        result = run_dashboard_script(tmp_path, hosts)
        assert result.returncode == 0, result.stderr
        entries = map_entries((tmp_path / "dashboard-host.conf").read_text())
        assert entries == ["default 0;", "localhost 1;"]


def test_invalid_dashboard_host_is_refused(tmp_path: Path) -> None:
    for hosts in ("https://x", "x:80", "default"):
        result = run_dashboard_script(tmp_path, hosts)
        assert result.returncode == 1, hosts
        assert "ongeldige hostnaam" in result.stderr
    result = run_dashboard_script(tmp_path, " , ")
    assert result.returncode == 1
    assert "is leeg" in result.stderr


def location_body(conf: str, header: str) -> str:
    start = conf.index(f"\n    location {header} {{\n")
    return conf[start : conf.index("\n    }\n", start)]


def test_dashboard_only_locations() -> None:
    # Alleen het eerste server-blok (poort 80); de interne refresh-server heeft geen SPA.
    conf = CONF.read_text()
    for header in ("/api/", "^~ /assets/", "= /preview-bridge.js", "/"):
        assert "if ($ct_dashboard_host = 0) {" in location_body(conf, header), header
    api = location_body(conf, "/api/")
    trusted = api.index("if ($ct_trusted_peer = 0) {")
    assert trusted < api.index("proxy_pass")
    assert "return 403" in api[trusted : api.index("}", trusted)]
