"""Thema-scripts: `.js`-bestanden in CSS_FILES_DIR uploaden, bekijken, vervangen, verwijderen."""

import hashlib
import os
import shutil
import stat
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from cssthema.services import script_files
from tests.integration.api_helpers import Api, unique_slug

SCRIPTS = "/api/v1/scripts"
ARCHIVE = ".scripts-archief"
BODY = b"(() => { document.body.dataset.net = '1'; })();\n"


async def upload(
    api: Api, filename: str, data: bytes = BODY, **form: str
) -> tuple[int, dict[str, Any]]:
    response = await api.client.post(
        SCRIPTS, files={"file": (filename, data, "text/javascript")}, data=form
    )
    body: dict[str, Any] = response.json()
    return response.status_code, body


async def script_audit(engine: AsyncEngine, name: str) -> list[tuple[str, dict[str, Any]]]:
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT action, changes FROM audit_logs "
                "WHERE entity_type = 'script' AND changes->>'name' = :name ORDER BY id"
            ),
            {"name": name},
        )
        return [(row[0], row[1]) for row in result.all()]


def mode(path: Path) -> int:
    return stat.S_IMODE(os.lstat(path).st_mode)


async def test_upload_new_script(api: Api, engine: AsyncEngine) -> None:
    name = unique_slug()
    status, script = await upload(api, f"{name}.js")
    assert status == 201, script
    assert script == {
        "name": name,
        "filename": f"{name}.js",
        "size_bytes": len(BODY),
        "modified_at": script["modified_at"],
        "url": f"https://css.example.be/{name}.js",
        "sha256": hashlib.sha256(BODY).hexdigest(),
        "world_readable": True,
    }
    path = api.css_dir / f"{name}.js"
    assert path.read_bytes() == BODY
    assert mode(path) == 0o644  # nginx leest als een andere gebruiker
    # geen tijdelijke bestanden achtergelaten, geen archief bij een nieuw script
    assert sorted(p.name for p in api.css_dir.iterdir()) == [f"{name}.js"]

    listed = (await api.client.get(SCRIPTS)).json()
    assert listed == [script]
    assert await script_audit(engine, name) == [
        (
            "script.upload",
            {
                "name": name,
                "file": f"{name}.js",
                "size_bytes": len(BODY),
                "sha256": script["sha256"],
                "replaced": False,
                "archived_as": None,
            },
        )
    ]


async def test_upload_sets_location(api: Api) -> None:
    name = unique_slug()
    response = await api.client.post(SCRIPTS, files={"file": (f"{name}.js", BODY)})
    assert response.status_code == 201
    assert response.headers["Location"] == f"{SCRIPTS}/{name}"


async def test_mode_is_0644_regardless_of_umask(api: Api) -> None:
    name = unique_slug()
    previous = os.umask(0o077)
    try:
        status, _ = await upload(api, f"{name}.js")
    finally:
        os.umask(previous)
    assert status == 201
    assert mode(api.css_dir / f"{name}.js") == 0o644


async def test_conflict_and_replace(api: Api, engine: AsyncEngine) -> None:
    name = unique_slug()
    await upload(api, f"{name}.js", b"console.log(1);\n")

    status, problem = await upload(api, f"{name}.js", b"console.log(2);\n")
    assert status == 409
    assert problem["code"] == "script_conflict"
    assert problem["name"] == name
    assert (api.css_dir / f"{name}.js").read_bytes() == b"console.log(1);\n"
    assert not (api.css_dir / ARCHIVE).exists()

    status, script = await upload(api, f"{name}.js", b"console.log(2);\n", replace="true")
    assert status == 200, script
    assert script["sha256"] == hashlib.sha256(b"console.log(2);\n").hexdigest()
    path = api.css_dir / f"{name}.js"
    assert path.read_bytes() == b"console.log(2);\n"
    assert mode(path) == 0o644

    # de vorige versie staat in het verborgen archief, dat niet in de lijst komt
    (archived,) = (api.css_dir / ARCHIVE).iterdir()
    assert archived.name.startswith(f"{name}.") and archived.name.endswith(".js")
    assert archived.read_bytes() == b"console.log(1);\n"
    assert [s["name"] for s in (await api.client.get(SCRIPTS)).json()] == [name]

    # nog eens vervangen: een tweede archiefbestand (ook binnen dezelfde seconde)
    status, _ = await upload(api, f"{name}.js", b"console.log(3);\n", replace="true")
    assert status == 200
    archive = sorted(p.read_bytes() for p in (api.css_dir / ARCHIVE).iterdir())
    assert archive == [b"console.log(1);\n", b"console.log(2);\n"]

    actions = await script_audit(engine, name)
    assert [action for action, _ in actions] == ["script.upload"] * 3
    assert actions[1][1]["replaced"] is True
    assert actions[1][1]["archived_as"] == f"{ARCHIVE}/{archived.name}"


async def test_replace_without_existing_file_is_new(api: Api) -> None:
    status, _ = await upload(api, f"{unique_slug()}.js", replace="true")
    assert status == 201


@pytest.mark.parametrize(
    ("filename", "name", "expected"),
    [
        ("Algemeen.JS", None, "algemeen"),
        ("netwerk_achtergrond.js", None, "netwerk-achtergrond"),
        ("jquery.min.js", None, "jquery-min"),
        ("upload.js", "Netwerk Achtergrond", "netwerk-achtergrond"),
        ("upload.js", "  Café Crème.js ", "cafe-creme"),
        ("C:\\Users\\jonas\\algemeen.js", None, "algemeen"),
    ],
)
async def test_names_are_normalized(
    api: Api, filename: str, name: str | None, expected: str
) -> None:
    form = {"name": name} if name is not None else {}
    status, script = await upload(api, filename, **form)
    assert status == 201, script
    assert script["name"] == expected
    assert (api.css_dir / f"{expected}.js").exists()


@pytest.mark.parametrize(
    ("filename", "name", "field"),
    [
        ("upload.js", "../x", "name"),
        ("upload.js", "../../etc/passwd", "name"),
        ("upload.js", "a/b", "name"),
        ("upload.js", "a\\b", "name"),
        ("upload.js", ".verborgen", "name"),
        ("upload.js", "x", "name"),
        ("upload.js", "€€€", "name"),
        ("upload.js", "a" * 65, "name"),
        ("upload.js", "preview-bridge", "name"),
        ("upload.js", "Preview_Bridge.js", "name"),
        (".verborgen.js", None, "file"),
        ("../x.js", None, "file"),
        ("a/b.js", None, "file"),
        (".js", None, "file"),
        ("preview-bridge.js", None, "file"),
    ],
)
async def test_invalid_names(api: Api, filename: str, name: str | None, field: str) -> None:
    form = {"name": name} if name is not None else {}
    status, problem = await upload(api, filename, **form)
    assert status == 422, problem
    assert problem["code"] == "invalid_script_name"
    assert problem["errors"][0]["loc"] == ["body", field]
    assert sorted(p.name for p in api.css_dir.iterdir()) == []


@pytest.mark.parametrize(
    "filename", ["thema.css", "script.txt", "module.mjs", "script", "x.js.txt"]
)
async def test_only_js_files(api: Api, filename: str) -> None:
    status, problem = await upload(api, filename)
    assert status == 415
    assert problem["code"] == "unsupported_media_type"


async def test_size_limit(api: Api) -> None:
    limit = script_files.MAX_SCRIPT_BYTES
    status, problem = await upload(api, "groot.js", b"a" * (limit + 1))
    assert status == 413
    assert problem["code"] == "payload_too_large"
    assert problem["limit_bytes"] == limit
    assert not (api.css_dir / "groot.js").exists()

    status, script = await upload(api, "net-genoeg.js", b"a" * limit)
    assert status == 201
    assert script["size_bytes"] == limit


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"\xff\xfeconsole.log(1)", "UTF-8"),
        ("console.log('é')".encode("latin-1"), "UTF-8"),
        (b"console.log(1);\0", "NUL"),
        ("x".encode("utf-16-le"), "NUL"),
        (b"", "leeg"),
        (b"  \n", "leeg"),
    ],
)
async def test_invalid_content(api: Api, data: bytes, message: str) -> None:
    status, problem = await upload(api, "inhoud.js", data)
    assert status == 422
    assert problem["code"] == "validation_error"
    assert message in problem["detail"]
    assert problem["errors"][0]["loc"] == ["body", "file"]
    assert not (api.css_dir / "inhoud.js").exists()


async def test_utf8_with_bom_is_accepted(api: Api) -> None:
    data = "\ufeffconsole.log('é');\n".encode()
    status, _ = await upload(api, "bom.js", data)
    assert status == 201
    assert (api.css_dir / "bom.js").read_bytes() == data


async def test_symlink_or_directory_is_never_overwritten(api: Api, tmp_path: Path) -> None:
    outside = tmp_path / "buiten.js"
    outside.write_text("origineel")
    (api.css_dir / "link.js").symlink_to(outside)
    (api.css_dir / "map.js").mkdir()

    for filename in ("link.js", "map.js"):
        for form in ({}, {"replace": "true"}):
            status, problem = await upload(api, filename, **form)
            assert status == 409, problem
            assert problem["code"] == "state_conflict"
    assert outside.read_text() == "origineel"
    assert (api.css_dir / "link.js").is_symlink()
    assert (api.css_dir / "map.js").is_dir()
    assert not (api.css_dir / ARCHIVE).exists()


async def test_list_only_served_regular_files(api: Api, tmp_path: Path) -> None:
    (api.css_dir / "algemeen.js").write_bytes(BODY)
    (api.css_dir / "b2.js").write_text("void 0;")
    (api.css_dir / "prive.js").write_text("void 0;")
    (api.css_dir / "prive.js").chmod(0o600)
    # niet in de lijst: nginx serveert ze niet (of het is geen gewoon bestand)
    (api.css_dir / ".verborgen.js").write_text("x")
    (api.css_dir / "Hoofdletters.js").write_text("x")
    (api.css_dir / "a.js").write_text("x")
    (api.css_dir / "-streep.js").write_text("x")
    (api.css_dir / "preview-bridge.js").write_text("x")
    (api.css_dir / "algemeen.css").write_text("a{}")
    (api.css_dir / "leesmij.txt").write_text("x")
    (api.css_dir / "map.js").mkdir()
    (api.css_dir / "link.js").symlink_to(api.css_dir / "algemeen.js")
    (tmp_path / "buiten.js").write_text("x")
    (api.css_dir / "buiten.js").symlink_to(tmp_path / "buiten.js")
    (api.css_dir / ARCHIVE).mkdir()
    (api.css_dir / ARCHIVE / "oud.js").write_text("x")
    (api.css_dir / ".algemeen.abc.tmp").write_text("x")

    scripts = (await api.client.get(SCRIPTS)).json()
    assert [s["name"] for s in scripts] == ["algemeen", "b2", "prive"]
    first = scripts[0]
    assert first["sha256"] == hashlib.sha256(BODY).hexdigest()
    assert first["url"] == "https://css.example.be/algemeen.js"
    assert first["world_readable"] is True
    assert scripts[2]["world_readable"] is False  # nginx zou 403 geven


async def test_list_without_directory(api: Api) -> None:
    shutil.rmtree(api.css_dir)
    response = await api.client.get(SCRIPTS)
    assert response.status_code == 200
    assert response.json() == []

    status, problem = await upload(api, "algemeen.js")
    assert status == 503
    assert problem["code"] == "storage_unavailable"
    assert "bestaat niet" in problem["title"]
    assert "Traceback" not in str(problem)
    assert (await api.client.get(f"{SCRIPTS}/algemeen")).status_code == 404
    assert (await api.client.delete(f"{SCRIPTS}/algemeen")).status_code == 404


async def test_directory_not_writable(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    def denied(*_args: object, **_kwargs: object) -> tuple[int, str]:
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(script_files.tempfile, "mkstemp", denied)
    status, problem = await upload(api, "algemeen.js")
    assert status == 503
    assert problem["code"] == "storage_unavailable"
    assert problem["title"] == "CSS_FILES_DIR is niet schrijfbaar voor de api"
    assert "10001" in problem["detail"]


@pytest.mark.skipif(os.geteuid() == 0, reason="root mag altijd schrijven")
async def test_directory_not_writable_for_real(api: Api) -> None:
    api.css_dir.chmod(0o555)
    try:
        status, problem = await upload(api, "algemeen.js")
    finally:
        api.css_dir.chmod(0o755)
    assert status == 503
    assert problem["title"] == "CSS_FILES_DIR is niet schrijfbaar voor de api"


async def test_unexpected_storage_error(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    def full(*_args: object, **_kwargs: object) -> None:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(script_files, "_write_all", full)
    status, problem = await upload(api, "algemeen.js")
    assert status == 500
    assert problem["code"] == "storage_error"
    assert "No space left on device" in problem["detail"]
    assert sorted(p.name for p in api.css_dir.iterdir()) == []  # tijdelijk bestand opgeruimd


async def test_get_script(api: Api) -> None:
    name = unique_slug()
    await upload(api, f"{name}.js")

    response = await api.client.get(f"{SCRIPTS}/{name}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/javascript; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert "content-disposition" not in response.headers
    assert response.content == BODY

    response = await api.client.get(f"{SCRIPTS}/{name}", params={"download": "1"})
    assert response.status_code == 200
    assert response.headers["content-disposition"] == f'attachment; filename="{name}.js"'
    assert response.content == BODY


async def test_get_unknown_or_unsafe_is_404(api: Api, tmp_path: Path) -> None:
    (tmp_path / "geheim.js").write_text("geheim")
    (api.css_dir / "link.js").symlink_to(tmp_path / "geheim.js")
    (api.css_dir / "map.js").mkdir()
    (api.css_dir / "Hoofd.js").write_text("x")
    (api.css_dir / "preview-bridge.js").write_text("x")
    for name in ("onbekend", "link", "map", "Hoofd", "preview-bridge", "..", "a", "x.js"):
        response = await api.client.get(f"{SCRIPTS}/{name}")
        assert response.status_code == 404, name
        assert response.json()["code"] == "not_found"


async def test_delete_moves_to_archive(api: Api, engine: AsyncEngine) -> None:
    name = unique_slug()
    await upload(api, f"{name}.js")

    response = await api.client.delete(f"{SCRIPTS}/{name}")
    assert response.status_code == 204
    assert not (api.css_dir / f"{name}.js").exists()
    (archived,) = (api.css_dir / ARCHIVE).iterdir()
    assert archived.read_bytes() == BODY
    assert (await api.client.get(SCRIPTS)).json() == []
    assert (await api.client.get(f"{SCRIPTS}/{name}")).status_code == 404

    actions = await script_audit(engine, name)
    assert actions[-1] == (
        "script.delete",
        {"name": name, "archived_as": f"{ARCHIVE}/{archived.name}"},
    )

    response = await api.client.delete(f"{SCRIPTS}/{name}")
    assert response.status_code == 404

    # opnieuw uploaden met dezelfde naam is een nieuw script
    status, _ = await upload(api, f"{name}.js")
    assert status == 201


async def test_delete_never_touches_symlinks_or_directories(api: Api, tmp_path: Path) -> None:
    (tmp_path / "doel.js").write_text("x")
    (api.css_dir / "link.js").symlink_to(tmp_path / "doel.js")
    (api.css_dir / "map.js").mkdir()
    for name in ("link", "map", "onbekend", "preview-bridge"):
        response = await api.client.delete(f"{SCRIPTS}/{name}")
        assert response.status_code == 404, name
    assert (api.css_dir / "link.js").is_symlink()
    assert (tmp_path / "doel.js").exists()
    assert (api.css_dir / "map.js").is_dir()
