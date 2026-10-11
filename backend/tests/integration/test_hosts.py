"""Host-koppelingen (/api/v1/hosts) en de publieke bundels /host/<hostname>.css|.js."""

import uuid
from typing import Any

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
    response = await api.client.get(f"/host/{unknown}.css")
    assert response.status_code == 200
    assert "geen koppeling" in response.text

    (api.css_dir / "standaard.css").write_text("html{}\n")
    await create(api, hostname="*", styles=["standaard"])
    response = await api.client.get(f"/host/{unknown}.css")
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
