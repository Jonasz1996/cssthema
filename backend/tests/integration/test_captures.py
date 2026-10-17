"""Capture-zips van vastleggen.py importeren (/api/v1/captures) en de preview-documenten."""

import io
import json
import uuid
import zipfile
from typing import Any

import pytest
from sqlalchemy import text

from tests.integration.api_helpers import Api

CSS_A = "0123456789abcdef.css"
CSS_B = "fedcba9876543210.css"


def host() -> str:
    return f"it-{uuid.uuid4().hex[:8]}.example.be"


def capture_zip(
    hostname: str,
    *,
    title: str = "App",
    extra: dict[str, bytes] | None = None,
    info: dict[str, Any] | None = None,
    pages: tuple[str, ...] = ("snapshot.html", "origineel.jpg"),
    html_body: str = "Hoi",
) -> bytes:
    """Zip zoals vastleggen.py; `info` vervangt info.json, `pages` kiest de paginabestanden."""
    folder = hostname.replace(".", "-")
    default_info = {
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
        f'</head><body class="login"><div id="main" class="card x">{html_body}</div></body></html>'
    )
    page_files = {
        "snapshot.html": html.encode(),
        "origineel.jpg": b"\xff\xd8\xff" + uuid.uuid4().bytes,
        "met-thema.jpg": b"\xff\xd8\xff" + uuid.uuid4().bytes,
    }
    files = {
        f"vastgelegd/_css/{CSS_A}": b".card{color:red}",
        f"vastgelegd/_css/{CSS_B}": b".x{color:blue}",
        f"vastgelegd/{folder}/start/info.json": json.dumps(
            default_info if info is None else info
        ).encode(),
        **{f"vastgelegd/{folder}/start/{name}": page_files[name] for name in pages},
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


# --- beschadigde zips en rare JSON ----------------------------------------------------------


def patched(data: bytes, member: str, *, central: dict[int, int], local: dict[int, int]) -> bytes:
    """Zet bytes in de central-directory- en local-header van `member` (vlaggen, methode)."""
    out = bytearray(data)
    name = member.encode()
    for signature, fields in ((b"PK\x01\x02", central), (b"PK\x03\x04", local)):
        offset = out.find(signature)
        while offset != -1:
            name_at = offset + (46 if signature == b"PK\x01\x02" else 30)
            if out[name_at : name_at + len(name)] == name:
                for at, value in fields.items():
                    out[offset + at] |= value
            offset = out.find(signature, offset + 4)
    return bytes(out)


def two_hosts_with_broken_second(broken: str) -> tuple[bytes, str, list[str]]:
    """Eerst een goede pagina (die al assets schrijft), dan een kapotte `snapshot.html`."""
    good, bad = f"it-a{uuid.uuid4().hex[:8]}.example.be", f"it-z{uuid.uuid4().hex[:8]}.example.be"
    member = f"vastgelegd/{bad.replace('.', '-')}/start/snapshot.html"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in (good, bad):
            with zipfile.ZipFile(io.BytesIO(capture_zip(name))) as source:
                for item in source.infolist():
                    if item.filename in archive.namelist():
                        continue
                    method = zipfile.ZIP_DEFLATED if broken == "deflate" else zipfile.ZIP_STORED
                    data = source.read(item)
                    if item.filename == member:
                        data = data * 20  # groot genoeg om in te knoeien
                    archive.writestr(item.filename, data, compress_type=method)
    data = buffer.getvalue()
    if broken in ("crc", "deflate"):
        info = zipfile.ZipFile(io.BytesIO(data)).getinfo(member)
        start = info.header_offset + 30 + len(member.encode()) + len(info.extra)
        corrupt = bytearray(data)
        for at in range(start + 20, start + 40):
            corrupt[at] ^= 0x55
        data = bytes(corrupt)
    elif broken == "encrypted":
        data = patched(data, member, central={8: 0x01}, local={6: 0x01})
    elif broken == "method":
        data = patched(data, member, central={10: 0x01}, local={8: 0x01})
    return data, member, [good, bad]


@pytest.mark.parametrize(
    ("broken", "message"),
    [
        ("crc", "beschadigd"),
        ("deflate", "beschadigd"),
        ("encrypted", "versleuteld"),
        ("method", "compressiemethode"),
    ],
)
async def test_damaged_member_gives_422(api: Api, broken: str, message: str) -> None:
    data, member, hostnames = two_hosts_with_broken_second(broken)
    response = await upload(api, data)
    assert response.status_code == 422, response.text
    problem = response.json()
    assert problem["code"] == "validation_error"
    assert member in problem["detail"]
    assert message in problem["detail"]
    # Niets van de zip blijft hangen, ook de goede eerste pagina niet.
    services = (await api.client.get("/api/v1/services")).json()
    assert not [s for s in services if s["hostname"] in hostnames]


async def test_nul_characters_and_wrong_json_types_are_cleaned(api: Api) -> None:
    name = host()
    info = {
        "titel": "Ap\u0000p",
        "dienst": name,
        "start_url": f"https://{name}/\u0000",
        "http_status": 2**40,
        "status": "o\u0000k",
        "frameworks": 5,
        "variabelen": {"--a\u0000": "x\u0000y"},
        "thema": {"links": "geen lijst", "csp_fouten": 3},
    }
    extra = {
        f"vastgelegd/{name.replace('.', '-')}/start/kleuren.json": json.dumps(
            {"bg\u0000": ["#fff\u0000"]}
        ).encode()
    }
    response = await upload(api, capture_zip(name, info=info, extra=extra), name="deel\u0000.zip")
    assert response.status_code == 200, response.text
    snapshot = (await service_of(api, name))["snapshots"][0]
    assert snapshot["title"] == "App"
    assert snapshot["status"] == "ok"
    assert snapshot["frameworks"] == []
    assert snapshot["theme_links"] == []
    assert snapshot["csp_errors"] == 0
    async with api.app.state.sessionmaker() as session:
        row = (
            await session.execute(
                text("SELECT http_status, css_variables, colors FROM dom_snapshots WHERE id = :id"),
                {"id": snapshot["id"]},
            )
        ).one()
    assert row.http_status is None
    assert row.css_variables == {"--a": "xy"}
    assert row.colors == {"bg": ["#fff"]}
