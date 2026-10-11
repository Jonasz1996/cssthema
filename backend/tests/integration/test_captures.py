"""Capture-zips van vastleggen.py importeren (/api/v1/captures) en de preview-documenten."""

import io
import json
import uuid
import zipfile
from typing import Any

from tests.integration.api_helpers import Api

CSS_A = "0123456789abcdef.css"
CSS_B = "fedcba9876543210.css"


def host() -> str:
    return f"it-{uuid.uuid4().hex[:8]}.example.be"


def capture_zip(
    hostname: str, *, title: str = "App", extra: dict[str, bytes] | None = None
) -> bytes:
    folder = hostname.replace(".", "-")
    info = {
        "titel": title,
        "dienst": hostname,
        "start_url": f"https://{hostname}/",
        "url": f"https://{hostname}/login",
        "http_status": 200,
        "status": "inlogpagina",
        "inlogpagina": True,
        "frameworks": ["bootstrap"],
        "variabelen": {"--bs-body-bg": "#fff"},
        "vastgelegd": "2026-10-06 13:38:07",
        "thema": {"links": [{"href": "https://css.jbogaert.be/proxmox.css"}], "csp_fouten": []},
    }
    html = (
        '<!DOCTYPE html><html class="app"><head>'
        f'<link rel="stylesheet" href="../../_css/{CSS_A}">'
        f'<link rel="stylesheet" href="../../_css/{CSS_B}">'
        '</head><body class="login"><div id="main" class="card x">Hoi</div></body></html>'
    )
    files = {
        f"vastgelegd/_css/{CSS_A}": b".card{color:red}",
        f"vastgelegd/_css/{CSS_B}": b".x{color:blue}",
        f"vastgelegd/{folder}/start/info.json": json.dumps(info).encode(),
        f"vastgelegd/{folder}/start/snapshot.html": html.encode(),
        f"vastgelegd/{folder}/start/origineel.jpg": b"\xff\xd8\xff" + uuid.uuid4().bytes,
        "vastgelegd/overzicht.json": b"[]",
        **(extra or {}),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


async def upload(api: Api, data: bytes, name: str = "vastgelegd-deel1.zip") -> Any:
    return await api.client.post(
        "/api/v1/captures", files={"file": (name, data, "application/zip")}
    )


async def service_of(api: Api, hostname: str) -> dict[str, Any]:
    services = (await api.client.get("/api/v1/services")).json()
    result: dict[str, Any] = next(s for s in services if s["hostname"] == hostname)
    return result


async def test_import_creates_service_snapshot_and_preview_document(api: Api) -> None:
    name = host()
    response = await upload(api, capture_zip(name))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["services_created"] == [name]
    assert result["snapshots"] == 1

    service = await service_of(api, name)
    assert service["name"] == "App"
    snapshot = service["snapshots"][0]
    assert snapshot["page"] == "start"
    assert snapshot["page_kind"] == "login"
    assert snapshot["status"] == "inlogpagina"
    assert snapshot["has_document"] is True
    assert snapshot["frameworks"] == ["bootstrap"]
    assert snapshot["class_count"] == 4
    assert snapshot["theme_links"] == ["https://css.jbogaert.be/proxmox.css"]

    document = (await api.client.get(f"/api/v1/snapshots/{snapshot['id']}/document")).json()
    assert document["hostname"] == name
    assert 'class="card x"' in document["html"]
    assert document["stylesheets"] == [".card{color:red}", ".x{color:blue}"]

    image = await api.client.get(snapshot["screenshots"]["origineel"])
    assert image.status_code == 200
    assert image.headers["Content-Type"] == "image/jpeg"
    assert image.content.startswith(b"\xff\xd8\xff")


async def test_reimport_replaces_the_snapshot_of_that_page(api: Api) -> None:
    name = host()
    await upload(api, capture_zip(name))
    response = await upload(api, capture_zip(name, title="Nieuw"))
    assert response.json()["services_updated"] == [name]
    service = await service_of(api, name)
    assert len(service["snapshots"]) == 1


async def test_unsafe_paths_are_ignored_and_bad_zips_refused(api: Api) -> None:
    name = host()
    evil = {"../../etc/passwd/info.json": b"{}", "/abs/info.json": b"{}"}
    response = await upload(api, capture_zip(name, extra=evil))
    assert response.status_code == 200
    assert response.json()["skipped"] == []

    assert (await upload(api, b"geen zip")).status_code == 422
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("los.css", "a{}")
    assert (await upload(api, buffer.getvalue())).status_code == 422


async def test_delete_service_and_unknown_snapshot(api: Api) -> None:
    name = host()
    await upload(api, capture_zip(name))
    service = await service_of(api, name)
    response = await api.client.delete(f"/api/v1/services/{service['id']}")
    assert response.status_code == 204
    services = (await api.client.get("/api/v1/services")).json()
    assert all(s["hostname"] != name for s in services)
    missing = await api.client.get(f"/api/v1/snapshots/{uuid.uuid4()}/document")
    assert missing.status_code == 404
