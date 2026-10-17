"""Host-koppelingen (/api/v1/hosts) en de publieke bundels /host/<hostname>.css|.js."""

import time
import uuid
from typing import Any

import pytest

from cssthema.db.models import Service
from cssthema.domain import host_health as host_health_domain
from cssthema.services import css_delivery, host_health
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
    assert "more_set_input_headers" in options["snippet"]
    assert "/alg-thema/host/$host.css" in options["snippet_own_domain"]
    assert ".js" not in options["snippet_own_domain"]
    assert "/alg-thema/host/$host.js" in options["snippet_own_domain_script"]
    assert "proxy_pass https://css.example.be/;" in options["snippet_own_domain"]
    assert options["excluded_hosts"] == ["css.example.be"]


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


# --- nooit injecteren, diensten, 'laatst geladen' en bulk ------------------------------------


def exclude(api: Api, *, dashboard: list[str] = (), excluded: list[str] = ()) -> None:  # type: ignore[assignment]
    settings = api.app.state.settings
    api.app.state.settings = settings.model_copy(
        update={"dashboard_host": list(dashboard), "excluded_hosts": list(excluded)}
    )


async def add_services(api: Api, hostnames: list[str]) -> None:
    async with api.app.state.sessionmaker() as session:
        for name in hostnames:
            session.add(Service(slug=name.split(".")[0], name=name, base_url=f"https://{name}/"))
        await session.commit()


async def test_never_injected_hosts_get_the_off_bundle(api: Api) -> None:
    (api.css_dir / "standaard.css").write_text("html{}\n")
    (api.css_dir / "standaard.js").write_text("void 0\n")
    await create(api, hostname="*", styles=["standaard"], scripts=["standaard"])
    dashboard, excluded = hostname(), hostname()
    exclude(api, dashboard=[dashboard], excluded=[excluded])
    # Zelfs met een eigen koppeling: nooit iets.
    await create(api, hostname=excluded, styles=["standaard"], scripts=["standaard"])
    for name in ("css.example.be", dashboard, excluded):
        for kind in ("css", "js"):
            response = await api.client.get(f"/host/{name}.{kind}")
            assert response.status_code == 200, name
            assert "staat uit (nooit injecteren" in response.text
            assert "html{}" not in response.text
            assert "void 0" not in response.text

    overview = await health(api)
    assert all(h["hostname"] not in ("css.example.be", dashboard) for h in overview["hosts"])
    item = entry(overview, excluded)
    assert item["excluded"] is True
    assert item["level"] == "unknown"
    assert item["stale"] is False
    options = (await api.client.get(f"{HOSTS}/options")).json()
    assert options["excluded_hosts"] == sorted(["css.example.be", dashboard, excluded])


async def test_check_covers_services_that_follow_the_default(api: Api) -> None:
    await create(api, hostname="*", styles=["a"])
    bound = (await create(api, styles=["a"]))["hostname"]
    follower, seen_only, excluded = hostname(), hostname(), hostname()
    await add_services(api, [follower, bound, excluded])
    await api.client.get(f"/host/{seen_only}.css")
    exclude(api, excluded=[excluded])
    checked: list[str] = []

    async def fetch(name: str) -> dict[str, Any]:
        checked.append(name)
        verdict = host_health_domain.Verdict(
            host_health_domain.Level.OK, host_health_domain.Code.RULE_ACTIVE, "ok"
        )
        return host_health._result(verdict, 200)

    state = api.app.state
    await host_health.run_check(state.sessionmaker, state.redis, state.settings, fetch=fetch)
    assert follower in checked
    assert bound in checked
    # Namen die alleen uit 'laatst geladen' komen (van buitenaf), en uitgesloten hosts: nooit.
    assert seen_only not in checked
    assert excluded not in checked

    overview = await health(api)
    item = entry(overview, follower)
    assert (item["bound"], item["service"], item["level"]) == (False, True, "ok")
    assert item["check"]["code"] == "rule_active"
    assert entry(overview, bound)["service"] is True
    assert entry(overview, seen_only)["check"] is None
    assert all(h["hostname"] != excluded for h in overview["hosts"])


async def test_bound_host_that_never_loaded_is_a_warning(api: Api) -> None:
    fresh, old, loaded = (await create(api))["hostname"], (await create(api))["hostname"], ""
    off = (await create(api, enabled=False))["hostname"]
    loaded = (await create(api))["hostname"]
    await api.client.get(f"/host/{loaded}.css")
    await api.app.state.redis.zadd(host_health.SEEN_KEY, {old: int(time.time()) - 15 * 86400})

    overview = await health(api)
    assert (entry(overview, fresh)["stale"], entry(overview, fresh)["level"]) == (True, "warn")
    assert (entry(overview, old)["stale"], entry(overview, old)["level"]) == (True, "warn")
    assert (entry(overview, loaded)["stale"], entry(overview, loaded)["level"]) == (
        False,
        "unknown",
    )
    assert (entry(overview, off)["stale"], entry(overview, off)["level"]) == (False, "unknown")


async def test_seen_cannot_be_filled_by_anyone(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(host_health, "MAX_SEEN", 3)
    redis = api.app.state.redis
    bound = (await create(api))["hostname"]
    await api.client.get(f"/host/{bound}.css")
    expired = hostname()
    long_ago = int(time.time()) - 40 * 86400
    await redis.zadd(host_health.SEEN_KEY, {expired: long_ago})
    await redis.zadd(host_health.SEEN_UNKNOWN_KEY, {expired: long_ago})
    junk = [hostname() for _ in range(4)]
    for name in junk:
        assert (await api.client.get(f"/host/{name}.css")).status_code == 302

    seen = await host_health.seen(redis)
    assert bound in seen  # een eigen koppeling valt er nooit uit
    assert expired not in seen  # ouder dan 30 dagen: eerst weg
    assert junk[0] not in seen  # daarna de oudste
    assert all(name in seen for name in junk[1:])  # nieuwe namen komen er altijd bij
    assert await redis.zcard(host_health.SEEN_UNKNOWN_KEY) == 3


async def test_forget_all_unbound_hosts(api: Api) -> None:
    bound = (await create(api))["hostname"]
    unbound = hostname()
    await api.client.get(f"/host/{bound}.css")
    await api.client.get(f"/host/{unbound}.css")
    response = await api.client.delete(f"{HOSTS}/seen")
    assert response.status_code == 204
    seen = await host_health.seen(api.app.state.redis)
    assert bound in seen
    assert unbound not in seen


async def bulk(api: Api, **payload: Any) -> dict[str, Any]:
    response = await api.client.post(f"{HOSTS}/bulk", json=payload)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def styles_of(listed: list[dict[str, Any]], name: str) -> list[str]:
    return next(h for h in listed if h["hostname"] == name)["styles"]


async def test_bulk_add_replace_remove_and_toggle(api: Api) -> None:
    a = (await create(api, styles=["kern"], scripts=["algemeen"]))["hostname"]
    b = (await create(api, styles=["kern", "oud"]))["hostname"]
    await create(api, hostname="*", styles=["kern"])
    excluded = (await create(api, styles=["kern"]))["hostname"]
    exclude(api, excluded=[excluded])
    api.refresh_calls.clear()

    result = await bulk(api, hostnames=None, action="add", name="alg-var-nord.css")
    assert {a, b, "*"} <= set(result["changed"])
    assert {"hostname": excluded, "reason": result["skipped"][0]["reason"]} in result["skipped"]
    listed = (await api.client.get(HOSTS)).json()
    assert styles_of(listed, a) == ["kern", "alg-var-nord"]
    assert styles_of(listed, "*") == ["kern", "alg-var-nord"]
    assert styles_of(listed, excluded) == ["kern"]
    refreshed = await api.refreshed()
    assert {f"/host/{a}.css", f"/host/{a}.js", "/host/*.css"} <= set(refreshed)
    assert f"/host/{excluded}.css" not in refreshed

    unknown = hostname()
    result = await bulk(
        api, hostnames=[a, b, unknown], action="replace", name="oud", replacement="nieuw"
    )
    assert (result["changed"], result["unchanged"]) == ([b], [a])
    assert result["skipped"] == [{"hostname": unknown, "reason": "Geen eigen koppeling."}]
    assert styles_of((await api.client.get(HOSTS)).json(), b) == ["kern", "nieuw", "alg-var-nord"]

    result = await bulk(api, hostnames=[a], action="remove", kind="scripts", name="algemeen")
    assert result["changed"] == [a]
    result = await bulk(api, hostnames=[a, b], action="disable")
    assert sorted(result["changed"]) == sorted([a, b])
    assert sorted((await bulk(api, hostnames=[a, b], action="disable"))["unchanged"]) == sorted(
        [a, b]
    )
    listed = {h["hostname"]: h for h in (await api.client.get(HOSTS)).json()}
    assert listed[a]["scripts"] == []
    assert listed[a]["enabled"] is False


async def test_bulk_respects_the_limit_and_validates(api: Api) -> None:
    full = (await create(api, styles=[f"s{i}" for i in range(20)]))["hostname"]
    result = await bulk(api, hostnames=[full], action="add", name="nog-een")
    assert result["skipped"] == [{"hostname": full, "reason": "Hoogstens 20 namen."}]
    for payload in (
        {"action": "add"},
        {"action": "replace", "name": "a"},
        {"action": "add", "name": "../x"},
        {"action": "add", "kind": "scripts", "name": "Hoofdletters"},
        {"action": "verwijderen", "name": "a"},
    ):
        response = await api.client.post(f"{HOSTS}/bulk", json=payload)
        assert response.status_code == 422, payload


async def test_import_refreshes_in_the_background_and_keeps_trying(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(css_delivery, "REFRESH_RETRY_DELAY_S", 0)
    first = hostname()
    text = f"# {first}\nsub_filter '</head>' '<link href=\"https://css.x.be/a.css\"></head>';\n"
    api.refresh_calls.clear()
    # Meer 429's dan een gewone refresh probeert: op de achtergrond valt toch niets weg.
    api.refresh_statuses = [429] * 6
    response = await api.client.post(f"{HOSTS}/import", json={"text": text})
    assert response.status_code == 200
    calls = await api.refreshed()
    assert calls.count(f"/host/{first}.css") + calls.count(f"/host/{first}.js") == 8
    assert api.refresh_statuses == []
