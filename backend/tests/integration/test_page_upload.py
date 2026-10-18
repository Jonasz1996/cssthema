"""Een opgeslagen webpagina uploaden als snapshot (/api/v1/pages)."""

import io
import uuid
import zipfile
from typing import Any

from tests.integration.api_helpers import Api

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20


def host() -> str:
    return f"pg-{uuid.uuid4().hex[:8]}.example.be"


def saved_page(hostname: str, body: str = "Hoi") -> bytes:
    """Zoals Chrome "Webpagina, volledig": Portainer.html + Portainer_files/."""
    html = (
        f"<!DOCTYPE html>\n<!-- saved from url=(0030)https://{hostname}/#!/home -->\n"
        '<html class="app"><head><meta charset="utf-8"><title>Portainer</title>'
        '<link rel="stylesheet" href="./Portainer_files/main.css">'
        '<link rel="stylesheet" href="https://cdn.example.com/extern.css">'
        '<link rel="icon" href="./Portainer_files/logo.png">'
        "<style>.kop{background:url(Portainer_files/logo%20groot.png)}</style>"
        '<script src="./Portainer_files/app.js"></script><script>alert(1)</script>'
        '</head><body class="theme-dark">'
        f'<div id="main" class="card x"><img src="Portainer_files/logo.png" alt="">{body}</div>'
        "</body></html>"
    )
    files = {
        "Portainer.html": html.encode(),
        "Portainer_files/main.css": (
            b'@import "deel.css";\n:root{--pt-bg:#123}\n.card{background:url(logo.png)}'
        ),
        "Portainer_files/deel.css": b".x{color:blue;font:12px/1 f}"
        b"@font-face{font-family:f;src:url(f.woff2)}",
        "Portainer_files/logo.png": PNG,
        "Portainer_files/logo groot.png": PNG + b"1",
        "Portainer_files/f.woff2": b"wOF2" + b"0" * 10,
        "Portainer_files/app.js": b"alert(2)",
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


async def upload(api: Api, data: bytes, name: str, **form: str) -> Any:
    return await api.client.post(
        "/api/v1/pages", files={"file": (name, data, "application/octet-stream")}, data=form
    )


async def test_saved_page_zip_becomes_a_snapshot_with_its_css_and_images(api: Api) -> None:
    name = host()
    response = await upload(api, saved_page(name), "Portainer.zip")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["hostname"] == name
    assert result["page"] == "portainer"
    assert result["service_created"] is True
    assert result["stylesheets"] == 1
    assert result["missing_stylesheets"] == ["https://cdn.example.com/extern.css"]
    assert result["inlined_files"] == 3

    document = (await api.client.get(f"/api/v1/snapshots/{result['snapshot_id']}/document")).json()
    html = document["html"]
    assert "<script" not in html and "alert" not in html
    assert 'class="card x"' in html
    assert 'src="data:image/png;base64,' in html
    assert 'url("data:image/png;base64,' in html  # <style> in de kop
    assert "_files/main.css" not in html and "/_css/" not in html
    assert len(document["stylesheets"]) == 1
    css = document["stylesheets"][0]
    assert ".x{color:blue" in css  # @import ingevoegd
    assert "data:font/woff2;base64," in css
    assert "data:image/png;base64," in css

    services = (await api.client.get("/api/v1/services")).json()
    service = next(s for s in services if s["hostname"] == name)
    assert service["name"] == "Portainer"
    assert service["snapshots"][0]["page"] == "portainer"
    assert service["snapshots"][0]["has_document"] is True


async def test_reupload_keeps_the_snapshot_id(api: Api) -> None:
    name = host()
    first = (await upload(api, saved_page(name), "Portainer.zip")).json()
    second = (await upload(api, saved_page(name, "Nieuw"), "Portainer.zip")).json()
    assert second["snapshot_id"] == first["snapshot_id"]
    assert second["service_created"] is False
    document = (await api.client.get(f"/api/v1/snapshots/{second['snapshot_id']}/document")).json()
    assert "Nieuw" in document["html"]


async def test_plain_html_needs_a_hostname_when_none_is_in_the_page(api: Api) -> None:
    page = b"<html><head><style>.a{color:red}</style></head><body class='a'>x</body></html>"
    response = await upload(api, page, "login.html")
    assert response.status_code == 422
    assert "hostnaam" in response.json()["detail"]

    name = host()
    response = await upload(api, page, "login.html", hostname=f"https://{name}/login", page="Login")
    assert response.status_code == 200, response.text
    assert response.json()["hostname"] == name
    assert response.json()["page"] == "login"


async def test_rejects_a_capture_zip_and_junk(api: Api) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("vastgelegd/a/start/info.json", b"{}")
        archive.writestr("vastgelegd/a/start/snapshot.html", b"<html></html>")
    response = await upload(api, buffer.getvalue(), "deel1.zip", hostname="a.example.be")
    assert response.status_code == 422
    response = await upload(api, b"\x00\x01\x02", "x.bin", hostname="a.example.be")
    assert response.status_code == 422
