"""Export (`.css`, bundel) en import (upload) van thema's."""

import io
import json
import zipfile

from sqlalchemy.ext.asyncio import AsyncEngine

from cssthema.domain.export.bundle import Bundle, BundleTheme, BundleVersion, build_bundle
from tests.integration.api_helpers import Api, audit_actions, unique_slug

THEMES = "/api/v1/themes"


async def test_export_css(api: Api) -> None:
    theme = await api.published_theme(css="a { color: red }")
    await api.save_draft(theme, "a { color: blue }")
    await api.publish(theme)

    response = await api.client.get(f"{THEMES}/{theme['id']}/export")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/css; charset=utf-8"
    assert response.headers["Content-Disposition"] == f'attachment; filename="{theme["slug"]}.css"'
    assert response.text.endswith("a{color:blue}")
    assert response.text.startswith("/*! cssthema · ")

    response = await api.client.get(
        f"{THEMES}/{theme['id']}/export", params={"format": "css", "version": 1}
    )
    assert response.text.endswith("a{color:red}")
    response = await api.client.get(f"{THEMES}/{theme['id']}/export", params={"version": 7})
    assert response.status_code == 404


async def test_export_unpublished_css_is_conflict(api: Api) -> None:
    theme = await api.create_theme(css="a{}")
    response = await api.client.get(f"{THEMES}/{theme['id']}/export")
    assert response.status_code == 409


async def test_bundle_round_trip(api: Api, engine: AsyncEngine) -> None:
    palettes = (await api.client.get("/api/v1/palettes")).json()
    nord = next(p for p in palettes if p["slug"] == "nord")
    theme = await api.published_theme(
        css="a { color: red }", palette_id=nord["id"], tags=["homelab"], description="Donker"
    )
    await api.save_draft(theme, "a { color: green }")
    await api.publish(theme, "Groen")
    await api.save_draft(theme, "a { color: blue } /* nog bezig */")

    response = await api.client.get(f"{THEMES}/{theme['id']}/export", params={"format": "bundle"})
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/zip"
    filename = f"{theme['slug']}.cssthema.zip"
    assert response.headers["Content-Disposition"] == f'attachment; filename="{filename}"'
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert archive.read("versions/v1.css") == b"a { color: red }"
    assert manifest["live_version"] == 2
    assert manifest["theme"]["palette_slug"] == "nord"
    assert [v["message"] for v in manifest["versions"]] == [None, "Groen"]

    # De slug bestaat nog: standaard wordt het `<slug>-2`.
    response = await api.client.post(
        f"{THEMES}/import", files={"file": (filename, response.content, "application/zip")}
    )
    assert response.status_code == 201, response.text
    imported = response.json()
    assert imported["slug"] == f"{theme['slug']}-2"
    assert response.headers["Location"] == f"{THEMES}/{imported['id']}"
    assert imported["name"] == "Integratietest"
    assert imported["description"] == "Donker"
    assert imported["tags"] == ["homelab"]
    assert imported["palette_id"] == nord["id"]
    assert imported["latest_version_number"] == 2
    assert imported["published_version"]["version_number"] == 2
    assert imported["published_version"]["source"] == "import"
    assert imported["draft_dirty"] is True

    draft = (await api.client.get(f"{THEMES}/{imported['id']}/draft")).json()
    assert draft["css"] == "a { color: blue } /* nog bezig */"
    v1 = (await api.client.get(f"{THEMES}/{imported['id']}/versions/1")).json()
    assert v1["css_source"] == "a { color: red }"
    assert v1["is_live"] is False
    public = await api.client.get(f"/{imported['slug']}.css")
    assert public.status_code == 200
    assert ":root{--ct-bg:#2e3440;" in public.text
    assert public.text.endswith("a{color:green}")

    actions = await audit_actions(engine, imported["id"])
    assert actions == [
        (
            "theme.import",
            {
                "format": "bundle",
                "file": filename,
                "slug": imported["slug"],
                "on_conflict": "rename",
                "versions": 2,
                "live_version": 2,
            },
        )
    ]


async def test_bundle_import_conflicts(api: Api) -> None:
    theme = await api.published_theme(css="a { color: red }")
    bundle = (
        await api.client.get(f"{THEMES}/{theme['id']}/export", params={"format": "bundle"})
    ).content

    response = await api.client.post(
        f"{THEMES}/import",
        files={"file": ("x.cssthema.zip", bundle)},
        data={"on_conflict": "fail"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "slug_conflict"

    response = await api.client.post(
        f"{THEMES}/import",
        files={"file": ("x.cssthema.zip", bundle)},
        data={"on_conflict": "new_version", "publish": "false"},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == theme["id"]
    assert updated["latest_version_number"] == 2
    assert updated["published_version"]["version_number"] == 1  # niet gepubliceerd

    response = await api.client.post(
        f"{THEMES}/import",
        files={"file": ("x.cssthema.zip", bundle)},
        data={"on_conflict": "rename", "publish": "false"},
    )
    renamed = response.json()
    assert renamed["published_version"] is None
    assert renamed["latest_version_number"] == 1


async def test_import_css_file(api: Api, engine: AsyncEngine) -> None:
    slug = unique_slug()
    response = await api.client.post(
        f"{THEMES}/import",
        files={"file": (f"{slug}.css", b"\xef\xbb\xbfbody { color: red }", "text/css")},
        data={"publish": "true"},
    )
    assert response.status_code == 201, response.text
    theme = response.json()
    assert theme["slug"] == slug
    assert theme["published_version"]["source"] == "import"
    assert theme["published_version"]["message"] == f"Geïmporteerd uit {slug}.css"
    assert (await api.client.get(f"/{slug}.css")).text.endswith("body{color:red}")
    assert f"/{slug}.css" in api.refresh_calls

    # zelfde naam, nieuwe versie op het bestaande thema
    response = await api.client.post(
        f"{THEMES}/import",
        files={"file": (f"{slug}.css", b"body { color: blue }")},
        data={"on_conflict": "new_version", "publish": "true"},
    )
    assert response.status_code == 200
    assert response.json()["published_version"]["version_number"] == 2
    assert (await api.client.get(f"/{slug}.css")).text.endswith("body{color:blue}")

    # met een naam, zonder publiceren
    name_slug = unique_slug()
    response = await api.client.post(
        f"{THEMES}/import",
        files={"file": ("whatever.css", b"a{}")},
        data={"name": name_slug},
    )
    assert response.status_code == 201
    assert response.json()["slug"] == name_slug
    assert response.json()["published_version"] is None
    actions = [a for a, _ in await audit_actions(engine, theme["id"])]
    assert actions == ["theme.import", "theme.import"]


async def test_import_errors(api: Api) -> None:
    async def upload(name: str, data: bytes, **form: str) -> tuple[int, dict[str, object]]:
        response = await api.client.post(
            f"{THEMES}/import", files={"file": (name, data)}, data=form
        )
        return response.status_code, response.json()

    status, body = await upload("x.txt", b"a{}")
    assert (status, body["code"]) == (415, "unsupported_media_type")
    status, body = await upload("x.cssthema.zip", b"PK\x03\x04kapot")
    assert (status, body["code"]) == (422, "validation_error")
    status, body = await upload(f"{unique_slug()}.css", b"\xff\xfe")
    assert (status, body["code"]) == (422, "validation_error")
    status, body = await upload(f"{unique_slug()}.css", b"a" * (1024 * 1024 + 1))
    assert (status, body["code"]) == (413, "payload_too_large")
    status, body = await upload("api.css", b"a{}")
    assert (status, body["code"]) == (422, "invalid_slug")
    status, body = await upload(
        f"{unique_slug()}.css", b"a { background: url(//evil.example/x) }", publish="true"
    )
    assert (status, body["code"]) == (422, "theme_lint_failed")
    status, body = await upload(f"{unique_slug()}.css", b"a{}", on_conflict="overwrite")
    assert status == 422


async def test_long_file_names_are_shortened(api: Api) -> None:
    filename = unique_slug() + "-" + "x" * 600 + ".css"
    response = await api.client.post(
        f"{THEMES}/import", files={"file": (filename, b"a{}")}, data={"publish": "true"}
    )
    assert response.status_code == 201, response.text
    theme = response.json()
    assert len(theme["slug"]) <= 64
    assert len(theme["name"]) <= 120
    message = theme["published_version"]["message"]
    assert len(message) <= 500
    assert message.endswith("x.css")


async def test_bundle_with_odd_metadata(api: Api) -> None:
    slug = unique_slug()
    data = build_bundle(
        Bundle(
            theme=BundleTheme(
                slug=slug,
                name="Naam\0met NUL",
                description="Beschrijving\0",
                tags=("Tag\0", "x" * 80),
                palette_slug="bestaat-niet",
            ),
            draft="a{}",
            versions=(BundleVersion(1, "a { color: red }", "Bericht\0 " + "y" * 600),),
            live_version=1,
        )
    )
    response = await api.client.post(f"{THEMES}/import", files={"file": ("b.zip", data)})
    assert response.status_code == 201, response.text
    theme = response.json()
    assert theme["slug"] == slug
    assert theme["name"] == "Naammet NUL"
    assert theme["description"] == "Beschrijving"
    assert theme["tags"] == ["tag", "x" * 40]
    assert theme["palette_id"] is None
    message = theme["published_version"]["message"]
    assert "\0" not in message
    assert message.startswith("Bericht yyy")
    assert len(message) <= 500
