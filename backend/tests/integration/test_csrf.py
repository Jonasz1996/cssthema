"""CSRF in fase 1: muterende calls alleen vanaf het dashboard zelf (Sec-Fetch-Site / Origin).

Zonder login is elke request de admin. Een multipart-POST heeft in de browser geen preflight
nodig, dus zonder deze controle kon elke pagina (ook een andere app op hetzelfde domein)
`algemeen.js` vervangen, dat daarna in elke app draait.
"""

from typing import Any

import pytest

from tests.integration.api_helpers import Api, unique_slug

SCRIPTS = "/api/v1/scripts"
EVIL = b"alert(document.cookie);\n"

# public_base_url in de fixture is https://css.example.be; de testclient spreekt http://test aan.
FOREIGN: list[dict[str, str]] = [
    {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Origin": "https://evil.example"},
    # Een andere app op hetzelfde domein: same-site, met de cookie van Authentik.
    {"Sec-Fetch-Site": "same-site", "Origin": "https://nextcloud.example.be"},
    # Zonder Fetch Metadata (gewone http naar het IP van de container): alleen Origin.
    {"Origin": "https://evil.example"},
    {"Origin": "http://test:8096"},  # zelfde host, andere poort (een andere app)
    {"Origin": "null"},  # sandboxed iframe, data:-URL
    # Een app met `location /alg-thema/` naar cssthema: voor de browser same-origin (SEC-3).
    {"Sec-Fetch-Site": "same-origin", "Origin": "https://nextcloud.example.be"},
    {"Sec-Fetch-Site": "none", "Origin": "https://nextcloud.example.be"},
]
OWN: list[dict[str, str]] = [
    {},  # curl, scripts
    {"Sec-Fetch-Site": "same-origin", "Origin": "https://css.example.be"},
    {"Sec-Fetch-Site": "none"},
    {"Origin": "https://css.example.be"},  # PUBLIC_BASE_URL
    {"Origin": "http://test"},  # de host die de browser aansprak
    # De Vite-devserver (changeOrigin) verandert alleen de poort in Host.
    {"Sec-Fetch-Site": "same-origin", "Origin": "http://test:5173"},
]


async def upload(
    api: Api, name: str, headers: dict[str, str], data: bytes = EVIL
) -> tuple[int, dict[str, Any]]:
    response = await api.client.post(
        SCRIPTS,
        files={"file": (f"{name}.js", data, "text/javascript")},
        data={"replace": "true"},
        headers=headers,
    )
    body: dict[str, Any] = response.json()
    return response.status_code, body


@pytest.mark.parametrize("headers", FOREIGN)
async def test_upload_from_another_site_is_refused(api: Api, headers: dict[str, str]) -> None:
    name = unique_slug()
    original = api.css_dir / f"{name}.js"
    original.write_bytes(b"void 0;\n")

    status, body = await upload(api, name, headers)

    assert status == 403, body
    assert body["code"] == "csrf_failed"
    assert body["type"] == "https://cssthema.dev/problems/csrf-failed"
    # Niets vervangen en niets gearchiveerd.
    assert original.read_bytes() == b"void 0;\n"
    assert sorted(p.name for p in api.css_dir.iterdir()) == [f"{name}.js"]


@pytest.mark.parametrize("headers", OWN)
async def test_upload_from_the_dashboard_or_curl_works(api: Api, headers: dict[str, str]) -> None:
    status, body = await upload(api, unique_slug(), headers, data=b"void 0;\n")
    assert status == 201, body


async def test_delete_from_another_site_is_refused(api: Api) -> None:
    name = unique_slug()
    (api.css_dir / f"{name}.js").write_bytes(b"void 0;\n")
    response = await api.client.delete(
        f"{SCRIPTS}/{name}", headers={"Sec-Fetch-Site": "cross-site"}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "csrf_failed"
    assert (api.css_dir / f"{name}.js").exists()


async def test_reading_from_another_site_still_works(api: Api) -> None:
    # Lezen verandert niets (en een browser geeft het antwoord zonder CORS niet aan de pagina).
    headers = {"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"}
    assert (await api.client.get(SCRIPTS, headers=headers)).status_code == 200
    assert (await api.client.get("/api/v1/meta", headers=headers)).status_code == 200


async def test_theme_mutations_are_protected_too(api: Api) -> None:
    headers = {"Sec-Fetch-Site": "same-site", "Origin": "https://app.example.be"}
    slug = unique_slug()
    response = await api.client.post(
        "/api/v1/themes", json={"name": "CSRF", "slug": slug}, headers=headers
    )
    assert response.status_code == 403
    assert response.json()["code"] == "csrf_failed"
    assert (await api.client.get(f"/api/v1/themes?q={slug}")).json()["items"] == []

    theme = await api.create_theme()
    response = await api.client.put(
        f"/api/v1/themes/{theme['id']}/draft",
        json={"css": "body{color:red}"},
        headers={"If-Match": f'"lv-{theme["lock_version"]}"', **headers},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "csrf_failed"


async def test_dashboard_host_may_write(api: Api) -> None:
    # Het dashboard op een eigen naam (DASHBOARD_HOST), ook als Host iets anders is.
    headers = {"Origin": "https://cssthema.example.be"}
    status, _ = await upload(api, unique_slug(), headers, data=b"void 0;\n")
    assert status == 403
    settings = api.app.state.settings
    api.app.state.settings = settings.model_copy(update={"dashboard_host": ["cssthema.example.be"]})
    status, body = await upload(api, unique_slug(), headers, data=b"void 0;\n")
    assert status == 201, body
    # Een andere poort op die naam is een andere origin.
    status, _ = await upload(api, unique_slug(), {"Origin": "https://cssthema.example.be:8443"})
    assert status == 403
