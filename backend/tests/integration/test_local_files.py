"""Handgemaakte CSS-bestanden in CSS_FILES_DIR (Jonas' migratiepad naar cssthema)."""

import os

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from cssthema.services import import_export
from tests.integration.api_helpers import Api, audit_actions, unique_slug

LOCAL = "/api/v1/themes/local-files"


async def test_list_local_files(api: Api) -> None:
    good = unique_slug()
    taken = await api.create_theme()
    (api.css_dir / f"{good}.css").write_text("a { color: red }")
    (api.css_dir / f"{taken['slug']}.css").write_text("a{}")
    (api.css_dir / "Niet Geldig.css").write_text("a{}")
    (api.css_dir / "api.css").write_text("a{}")
    (api.css_dir / "groot.css").write_text("a" * (1024 * 1024 + 1))
    (api.css_dir / "leesmij.txt").write_text("geen css")
    (api.css_dir / ".verborgen.css").write_text("a{}")
    (api.css_dir / "map.css").mkdir()
    (api.css_dir / "link.css").symlink_to(api.css_dir / f"{good}.css")

    files = {f["name"]: f for f in (await api.client.get(LOCAL)).json()}
    assert set(files) == {
        f"{good}.css",
        f"{taken['slug']}.css",
        "Niet Geldig.css",
        "api.css",
        "groot.css",
        "link.css",
    }
    assert files[f"{good}.css"]["importable"] is True
    assert files[f"{good}.css"]["slug"] == good
    assert files[f"{good}.css"]["size_bytes"] == len("a { color: red }")
    assert files[f"{taken['slug']}.css"]["importable"] is False
    assert files[f"{taken['slug']}.css"]["theme_id"] == taken["id"]
    assert files["Niet Geldig.css"]["slug"] is None
    assert "gereserveerd" in files["api.css"]["reason"]
    assert "KB" in files["groot.css"]["reason"]
    assert "link" in files["link.css"]["reason"].lower()

    dashboard = (await api.client.get("/api/v1/dashboard")).json()
    assert dashboard["local_files"] == {"dir": str(api.css_dir), "total": 6, "importable": 1}

    # het thema met dezelfde slug wordt door het bestand overschaduwd
    detail = (await api.client.get(f"/api/v1/themes/{taken['id']}")).json()
    assert detail["shadowed_by_file"] is True


async def test_import_local_files(api: Api, engine: AsyncEngine) -> None:
    first, second, broken = unique_slug(), unique_slug(), unique_slug()
    (api.css_dir / f"{first}.css").write_text("body { color: red }")
    (api.css_dir / f"{second}.css").write_text("body { color: blue }")
    (api.css_dir / f"{broken}.css").write_text("body { background: url(//evil.example/x) }")

    response = await api.client.post(
        f"{LOCAL}/import",
        json={"names": [f"{first}.css", f"{second}.css", f"{broken}.css", "../etc.css", "x.css"]},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    imported = {t["slug"]: t for t in result["imported"]}
    assert set(imported) == {first, second}
    assert imported[first]["source_file"] == f"{first}.css"
    assert imported[first]["archive_error"] is None
    assert imported[first]["shadowed_by_file"] is False
    assert imported[first]["published_version"]["source"] == "import"
    assert imported[first]["name"] == " ".join(p.capitalize() for p in first.split("-"))
    skipped = {s["name"]: s["reason"] for s in result["skipped"]}
    assert set(skipped) == {f"{broken}.css", "../etc.css", "x.css"}
    assert "Publiceren geweigerd" in skipped[f"{broken}.css"]

    # gearchiveerd: nginx valt door naar de api, die het thema serveert
    assert not (api.css_dir / f"{first}.css").exists()
    assert (api.css_dir / ".geimporteerd" / f"{first}.css").read_text() == "body { color: red }"
    assert (api.css_dir / f"{broken}.css").exists()
    response = await api.client.get(f"/{first}.css")
    assert response.status_code == 200
    assert response.text.endswith("body{color:red}")
    assert f"/{first}.css" in api.refresh_calls

    actions = await audit_actions(engine, imported[first]["id"])
    assert actions[0][0] == "theme.import"
    assert actions[0][1]["format"] == "local-file"

    # nog eens importeren: het bestand is weg
    response = await api.client.post(f"{LOCAL}/import", json={"names": [f"{first}.css"]})
    assert response.json()["imported"] == []


async def test_import_without_publish_or_archive(api: Api) -> None:
    slug = unique_slug()
    (api.css_dir / f"{slug}.css").write_text("body { background: url(//evil.example/x) }")
    response = await api.client.post(
        f"{LOCAL}/import", json={"names": [f"{slug}.css"], "publish": False, "archive": False}
    )
    (theme,) = response.json()["imported"]
    assert theme["published_version"] is None
    assert theme["latest_version_number"] == 0  # lint-fouten: alleen een draft
    assert theme["shadowed_by_file"] is True
    assert (api.css_dir / f"{slug}.css").exists()


async def test_unpublished_import_is_not_archived(api: Api) -> None:
    # Zonder live versie zou de URL na het archiveren 404 geven: het bestand blijft staan.
    draft, broken = unique_slug(), unique_slug()
    (api.css_dir / f"{draft}.css").write_text("body { color: red }")
    (api.css_dir / f"{broken}.css").write_text("body { background: url(//evil.example/x) }")
    response = await api.client.post(
        f"{LOCAL}/import",
        json={"names": [f"{draft}.css", f"{broken}.css"], "publish": False},
    )
    assert response.status_code == 200, response.text
    imported = {t["slug"]: t for t in response.json()["imported"]}
    assert set(imported) == {draft, broken}
    for slug, theme in imported.items():
        assert theme["published_version"] is None
        assert theme["shadowed_by_file"] is True
        assert "Niet gearchiveerd" in theme["archive_error"]
        assert (api.css_dir / f"{slug}.css").exists()
    assert not (api.css_dir / ".geimporteerd").exists()


async def test_directory_named_like_a_css_file_is_skipped(api: Api) -> None:
    good, folder = unique_slug(), unique_slug()
    (api.css_dir / f"{good}.css").write_text("a { color: red }")
    (api.css_dir / f"{folder}.css").mkdir()
    response = await api.client.post(
        f"{LOCAL}/import", json={"names": [f"{good}.css", f"{folder}.css"]}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert [t["slug"] for t in result["imported"]] == [good]
    assert result["skipped"] == [
        {"name": f"{folder}.css", "reason": import_export.REASON_NOT_REGULAR}
    ]
    assert (api.css_dir / f"{folder}.css").is_dir()


async def test_archive_failure_is_reported(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    slug = unique_slug()
    (api.css_dir / f"{slug}.css").write_text("a { color: red }")

    def refuse(source: object, target: object) -> None:
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(import_export.os, "rename", refuse)
    response = await api.client.post(f"{LOCAL}/import", json={"names": [f"{slug}.css"]})
    (theme,) = response.json()["imported"]
    assert "Permission denied" in theme["archive_error"]
    assert theme["shadowed_by_file"] is True
    assert theme["published_version"]["version_number"] == 1


async def test_archive_keeps_earlier_copies(api: Api) -> None:
    slug = unique_slug()
    archive = api.css_dir / ".geimporteerd"
    archive.mkdir()
    (archive / f"{slug}.css").write_text("oud")
    (api.css_dir / f"{slug}.css").write_text("a{}")
    await api.client.post(f"{LOCAL}/import", json={"names": [f"{slug}.css"]})
    names = sorted(os.listdir(archive))
    assert len(names) == 2
    assert (archive / f"{slug}.css").read_text() == "oud"


async def test_symlinks_are_not_followed(api: Api) -> None:
    slug = unique_slug()
    outside = api.css_dir.parent / "geheim.css"
    outside.write_text("a { color: red }")
    (api.css_dir / f"{slug}.css").symlink_to(outside)
    response = await api.client.post(f"{LOCAL}/import", json={"names": [f"{slug}.css"]})
    result = response.json()
    assert result["imported"] == []
    assert "link" in result["skipped"][0]["reason"].lower()
    assert outside.exists()


async def test_file_name_that_is_not_utf8(api: Api) -> None:
    # Bv. een Latin-1-naam via scp/SMB: de lijst mag daardoor niet stuk (was 500).
    good = unique_slug()
    (api.css_dir / f"{good}.css").write_text("a { color: red }")
    # os.fsdecode geeft de ruwe byte 0xE9 als surrogaat terug; zo komt hij ongewijzigd op schijf.
    (api.css_dir / os.fsdecode(b"caf\xe9.css")).write_bytes(b"a{}")

    response = await api.client.get(LOCAL)
    assert response.status_code == 200, response.text
    files = {f["name"]: f for f in response.json()}
    assert set(files) == {f"{good}.css", "caf\ufffd.css"}
    assert files[f"{good}.css"]["importable"] is True
    bad = files["caf\ufffd.css"]
    assert bad["importable"] is False
    assert bad["slug"] is None
    assert "UTF-8" in bad["reason"]

    dashboard = (await api.client.get("/api/v1/dashboard")).json()
    assert dashboard["local_files"]["total"] == 2
    assert dashboard["local_files"]["importable"] == 1

    # De weergavenaam is niet de echte naam: importeren ervan doet niets.
    response = await api.client.post(f"{LOCAL}/import", json={"names": ["caf\ufffd.css"]})
    assert response.status_code == 200, response.text
    assert response.json()["imported"] == []


async def test_missing_directory_is_empty(api: Api) -> None:
    api.css_dir.rmdir()
    assert (await api.client.get(LOCAL)).json() == []
    dashboard = (await api.client.get("/api/v1/dashboard")).json()
    assert dashboard["local_files"]["total"] == 0
