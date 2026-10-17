"""Preview in de editor: de stapel van een host (/api/v1/preview/stack) en wie een thema krijgt."""

import uuid
from typing import Any

from tests.integration.api_helpers import Api

PREVIEW = "/api/v1/preview"


def hostname() -> str:
    return f"it-{uuid.uuid4().hex[:10]}.example.be"


async def bind(api: Api, host: str, styles: list[str], **extra: Any) -> None:
    response = await api.client.post(
        "/api/v1/hosts", json={"hostname": host, "styles": styles, **extra}
    )
    assert response.status_code == 201, response.text


async def get_stack(api: Api, host: str, theme: str) -> dict[str, Any]:
    response = await api.client.get(f"{PREVIEW}/stack", params={"hostname": host, "theme": theme})
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


async def test_stack_splits_around_the_edited_theme(api: Api) -> None:
    (api.css_dir / "it-kern.css").write_text(":root{--alg-tekst:#ddd}\n")
    module = await api.published_theme(css=".fw { color: red }")
    edited = await api.published_theme(css=".app { color: blue }")
    host = hostname()
    await bind(api, host, ["it-kern", edited["slug"], module["slug"], "it-ontbreekt"])

    stack = await get_stack(api, host, edited["slug"])
    assert stack["binding"] == host
    assert stack["enabled"] is True
    assert stack["contains_theme"] is True
    assert [p["name"] for p in stack["before"]] == ["it-kern"]
    assert stack["before"][0]["source"] == "bestand"
    assert stack["before"][0]["css"] == ":root{--alg-tekst:#ddd}\n"
    # De gepubliceerde versie van het bewerkte thema zelf zit er niet in.
    assert [p["name"] for p in stack["after"]] == [module["slug"], "it-ontbreekt"]
    assert stack["after"][0]["source"] == "thema v1"
    assert stack["after"][0]["css"].endswith(".fw{color:red}")
    assert stack["after"][1] == {"name": "it-ontbreekt", "source": "", "css": None}
    assert ".app" not in str(stack)


async def test_stack_of_a_host_without_own_binding_is_the_default(api: Api) -> None:
    (api.css_dir / "it-standaard.css").write_text("html{}\n")
    await bind(api, "*", ["it-standaard"])
    stack = await get_stack(api, hostname(), "it-bewerkt")
    assert stack["binding"] == "*"
    assert stack["contains_theme"] is False
    # Niet in de stapel: alles staat ervoor, de draft komt achteraan.
    assert [p["name"] for p in stack["before"]] == ["it-standaard"]
    assert stack["after"] == []


async def test_stack_of_a_disabled_or_unbound_host_is_empty(api: Api) -> None:
    (api.css_dir / "it-kern.css").write_text("html{}\n")
    host = hostname()
    await bind(api, host, ["it-kern"], enabled=False)
    stack = await get_stack(api, host, "it-kern")
    assert stack == {
        "hostname": host,
        "binding": host,
        "enabled": False,
        "excluded": False,
        "contains_theme": False,
        "before": [],
        "after": [],
    }
    unbound = await get_stack(api, hostname(), "it-kern")
    assert unbound["binding"] is None
    assert unbound["enabled"] is True
    assert unbound["before"] == []


async def test_stack_normalises_and_checks_its_input(api: Api) -> None:
    host = hostname()
    stack = await get_stack(api, f"https://{host.upper()}/", "it-x")
    assert stack["hostname"] == host

    bad_host = await api.client.get(
        f"{PREVIEW}/stack", params={"hostname": "geen host!", "theme": "it-x"}
    )
    assert bad_host.status_code == 422
    assert bad_host.json()["errors"][0]["loc"] == ["query", "hostname"]
    bad_theme = await api.client.get(f"{PREVIEW}/stack", params={"hostname": host, "theme": "../x"})
    assert bad_theme.status_code == 422
    assert bad_theme.json()["errors"][0]["loc"] == ["query", "theme"]


async def test_usage_lists_active_bindings_and_the_default(api: Api) -> None:
    slug = "it-gebruikt"
    first, second, off, other = sorted(hostname() for _ in range(4))
    await bind(api, first, [slug])
    await bind(api, second, ["it-iets", slug])
    await bind(api, off, [slug], enabled=False)
    await bind(api, other, ["it-iets"])

    response = await api.client.get(f"{PREVIEW}/usage", params={"theme": slug})
    assert response.status_code == 200, response.text
    usage = response.json()
    mine = [h for h in usage["hostnames"] if h.startswith("it-")]
    assert mine == [first, second]
    assert usage["default"] is False
    assert {first, second, off, other} <= set(usage["bound"])
    assert "*" not in usage["bound"]

    await bind(api, "*", [slug])
    usage = (await api.client.get(f"{PREVIEW}/usage", params={"theme": slug})).json()
    assert usage["default"] is True


async def test_never_injected_host_has_an_empty_stack(api: Api) -> None:
    (api.css_dir / "it-kern.css").write_text(":root{}\n")
    excluded = hostname()
    await bind(api, excluded, ["it-kern", "it-uit"])
    settings = api.app.state.settings
    api.app.state.settings = settings.model_copy(update={"excluded_hosts": [excluded]})

    stack = await get_stack(api, excluded, "it-uit")
    assert stack["excluded"] is True
    assert stack["enabled"] is False
    assert stack["before"] == stack["after"] == []
    assert (await get_stack(api, "css.example.be", "it-uit"))["excluded"] is True

    usage = (await api.client.get(f"{PREVIEW}/usage", params={"theme": "it-uit"})).json()
    assert excluded not in usage["hostnames"]
    # Ook niet als terugval voor `*` in de preview.
    assert {excluded, "css.example.be"} <= set(usage["bound"])
