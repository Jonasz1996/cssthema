"""Host-koppelingen (/api/v1/hosts) en de publieke bundels /host/<hostname>.css|.js."""

import uuid
from typing import Any

from cssthema.domain import host_health as host_health_domain
from cssthema.services import host_health
from tests.integration.api_helpers import Api

HOSTS = "/api/v1/hosts"


def hostname() -> str:
    return f"it-{uuid.uuid4().hex[:10]}.example.be"


async def create(api: Api, **payload: Any) -> dict[str, Any]:
    payload.setdefault("hostname", hostname())
    response = await api.client.post(HOSTS, json=payload)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


async def test_bundle_combines_files_and_published_themes(api: Api) -> None:
    (api.css_dir / "algemeen.css").write_text("body{color:gray}\n")
    (api.css_dir / "algemeen.js").write_text("window.netwerk=1\n")
    theme = await api.published_theme(css="a { color: red; }")
    host = await create(
        api, styles=["algemeen.css", theme["slug"], "ontbreekt"], scripts=["algemeen"]
    )
    assert host["css_url"] == f"https://css.example.be/host/{host['hostname']}.css"

    response = await api.client.get(f"/host/{host['hostname']}.css")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/css; charset=utf-8"
    assert response.headers["Access-Control-Allow-Origin"] == "*"
    css = response.text
    assert "body{color:gray}" in css
    assert "a{color:red}" in css
    assert css.index("body{color:gray}") < css.index("a{color:red}")
    assert '"ontbreekt" niet gevonden' in css

    js = await api.client.get(f"/host/{host['hostname']}.js")
    assert js.headers["Content-Type"] == "text/javascript; charset=utf-8"
    assert "window.netwerk=1" in js.text

    etag = response.headers["ETag"]
    again = await api.client.get(f"/host/{host['hostname']}.css", headers={"If-None-Match": etag})
    assert again.status_code == 304


async def test_default_binding_and_unknown_host(api: Api) -> None:
    unknown = hostname()
    response = await api.client.get(f"/host/{unknown}.css", follow_redirects=True)
    assert response.status_code == 200
    assert "geen koppeling" in response.text

    (api.css_dir / "standaard.css").write_text("html{}\n")
    await create(api, hostname="*", styles=["standaard"])
    response = await api.client.get(f"/host/{unknown}.css", follow_redirects=True)
    assert "html{}" in response.text
    assert "(koppeling *)" in response.text


async def test_disabled_host_gets_nothing_not_even_default(api: Api) -> None:
    (api.css_dir / "standaard.css").write_text("html{}\n")
    await create(api, hostname="*", styles=["standaard"])
    host = await create(api, styles=["standaard"], enabled=False)
    response = await api.client.get(f"/host/{host['hostname']}.css")
    assert "html{}" not in response.text
    assert "staat uit" in response.text


async def test_invalid_hostname_is_404(api: Api) -> None:
    response = await api.client.get("/host/a..b.css")
    assert response.status_code == 404


async def test_crud_and_conflict(api: Api) -> None:
    host = await create(api, hostname="  HTTPS://It-Crud.Example.be/ ", styles=["a"])
    assert host["hostname"] == "it-crud.example.be"

    conflict = await api.client.post(HOSTS, json={"hostname": "it-crud.example.be"})
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "host_conflict"

    updated = await api.client.put(
        f"{HOSTS}/{host['id']}",
        json={"hostname": "it-crud.example.be", "styles": ["b", "a"], "scripts": []},
    )
    assert updated.status_code == 200
    assert updated.json()["styles"] == ["b", "a"]
    assert "/host/it-crud.example.be.css" in await api.refreshed()

    listed = (await api.client.get(HOSTS)).json()
    assert any(item["id"] == host["id"] for item in listed)

    deleted = await api.client.delete(f"{HOSTS}/{host['id']}")
    assert deleted.status_code == 204
    missing = await api.client.delete(f"{HOSTS}/{host['id']}")
    assert missing.status_code == 404


async def test_invalid_names_are_rejected(api: Api) -> None:
    response = await api.client.post(HOSTS, json={"hostname": hostname(), "styles": ["../x"]})
    assert response.status_code == 422


async def test_publishing_a_theme_refreshes_hosts_that_use_it(api: Api) -> None:
    theme = await api.create_theme()
    host = await create(api, styles=[theme["slug"]])
    api.refresh_calls.clear()
    await api.save_draft(theme, "a{color:blue}")
    await api.publish(theme)
    assert f"/host/{host['hostname']}.css" in await api.refreshed()


async def test_import_from_npm_config(api: Api) -> None:
    first, second = hostname(), hostname()
    text = (
        f"# {first}\n"
        'sub_filter \'</head>\' \'<link rel="stylesheet" href="https://css.x.be/algemeen.css">'
        '<link rel="stylesheet" href="https://css.x.be/alg-proxmox.css">'
        '<script src="https://css.x.be/algemeen.js" defer></script></head>\';\n'
        f"# {second}\n"
        'sub_filter \'</head>\' \'<link rel="stylesheet" href="/alg-thema/algemeen.css">'
        "</head>';\n"
    )
    response = await api.client.post(f"{HOSTS}/import", json={"text": text})
    assert response.status_code == 200, response.text
    assert sorted(response.json()["created"]) == sorted([first, second])

    again = await api.client.post(f"{HOSTS}/import", json={"text": text})
    assert sorted(again.json()["unchanged"]) == sorted([first, second])

    listed = {item["hostname"]: item for item in (await api.client.get(HOSTS)).json()}
    assert listed[first]["styles"] == ["algemeen", "alg-proxmox"]
    assert listed[first]["scripts"] == ["algemeen"]
    assert listed[second]["scripts"] == []


async def test_options_list_themes_files_and_snippet(api: Api) -> None:
    (api.css_dir / "handgemaakt.css").write_text("a{}")
    (api.css_dir / "netwerk.js").write_text("1")
    theme = await api.published_theme(css="a{}")
    options = (await api.client.get(f"{HOSTS}/options")).json()
    assert "handgemaakt" in options["styles"]
    assert theme["slug"] in options["styles"]
    assert options["scripts"] == ["netwerk"]
    assert "https://css.example.be/host/$host.css" in options["snippet"]
    assert "/alg-thema/host/$host.css" in options["snippet_own_domain"]


# --- gezondheid (C3) --------------------------------------------------------------------------


async def health(api: Api) -> dict[str, Any]:
    response = await api.client.get(f"{HOSTS}/health")
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def entry(overview: dict[str, Any], name: str) -> dict[str, Any]:
    return next(h for h in overview["hosts"] if h["hostname"] == name)


async def test_health_lists_seen_hosts_and_missing_parts(api: Api) -> None:
    (api.css_dir / "algemeen.css").write_text("body{}\n")
    bound = await create(api, styles=["algemeen", "weg"], scripts=["geen-script"])
    unbound = hostname()
    await api.client.get(f"/host/{bound['hostname']}.css")
    await api.client.get(f"/host/{unbound}.css")
    # De nginx-refresh van cssthema zelf telt niet als geladen; .js ook niet.
    refreshed = hostname()
    await api.client.get(f"/host/{refreshed}.css", headers={"X-Cssthema-Refresh": "1"})
    await api.client.get(f"/host/{refreshed}.js")

    overview = await health(api)
    item = entry(overview, bound["hostname"])
    assert item["bound"] is True
    assert item["last_seen"] is not None
    assert item["missing_styles"] == ["weg"]
    assert item["missing_scripts"] == ["geen-script"]
    assert item["level"] == "warn"
    assert entry(overview, unbound)["bound"] is False
    assert all(h["hostname"] != refreshed for h in overview["hosts"])

    response = await api.client.delete(f"{HOSTS}/seen/{unbound}")
    assert response.status_code == 204
    assert all(h["hostname"] != unbound for h in (await health(api))["hosts"])


async def test_check_stores_results_per_bound_host(api: Api) -> None:
    good = await create(api, styles=["a"])
    bad = await create(api, styles=["a"])
    off = await create(api, styles=["a"], enabled=False)
    pages = {
        good["hostname"]: f'<link href="https://css.example.be/host/{good["hostname"]}.css">',
        bad["hostname"]: "<html><head></head></html>",
    }

    async def fetch(name: str) -> dict[str, Any]:
        verdict = host_health_domain.classify(
            name,
            "https://css.example.be",
            status=200,
            content_type="text/html",
            csp=None,
            html=pages.get(name, ""),
        )
        return host_health._result(verdict, 200)

    state = api.app.state
    checked = await host_health.run_check(
        state.sessionmaker, state.redis, state.settings, fetch=fetch
    )
    assert checked >= 2

    overview = await health(api)
    assert overview["check_running"] is False
    assert overview["check_finished_at"] is not None
    assert entry(overview, good["hostname"])["check"]["code"] == "rule_active"
    assert entry(overview, good["hostname"])["level"] in ("ok", "warn")
    assert entry(overview, bad["hostname"])["level"] == "error"
    assert entry(overview, off["hostname"])["check"] is None


async def test_check_endpoint_refuses_a_second_run(api: Api) -> None:
    await api.app.state.redis.set(host_health.CHECK_LOCK_KEY, "1")
    response = await api.client.post(f"{HOSTS}/check")
    assert response.status_code == 202
    assert response.json() == {"started": False}
    assert (await health(api))["check_running"] is True


async def test_unbound_hosts_share_the_default_bundle(api: Api) -> None:
    follower = hostname()
    response = await api.client.get(f"/host/{follower}.css")
    assert response.status_code == 302
    assert response.headers["Location"] == "*.css"
    js = await api.client.get(f"/host/{follower}.js")
    assert js.headers["Location"] == "*.js"
    # Ook de redirect telt als geladen.
    assert any(h["hostname"] == follower for h in (await health(api))["hosts"])


async def test_renaming_a_theme_updates_host_bindings(api: Api) -> None:
    theme = await api.published_theme(css="a { color: red; }")
    host = await create(api, styles=[theme["slug"], "andere"])
    new_slug = f"{theme['slug']}-nieuw"
    response = await api.client.patch(
        f"/api/v1/themes/{theme['id']}",
        json={"slug": new_slug},
        headers={"If-Match": f'"lv-{theme["lock_version"]}"'},
    )
    assert response.status_code == 200, response.text
    hosts = (await api.client.get(HOSTS)).json()
    assert next(h for h in hosts if h["id"] == host["id"])["styles"] == [new_slug, "andere"]
    assert f"/host/{host['hostname']}.css" in await api.refreshed()
