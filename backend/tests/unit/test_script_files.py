"""Thema-scripts zonder database: namen, inhoud en het schrijven in CSS_FILES_DIR."""

import os
import re
import stat
from pathlib import Path

import pytest

from cssthema.domain.css.slugs import SLUG_PATTERN
from cssthema.services import script_files
from cssthema.services.errors import (
    InvalidInputError,
    InvalidScriptNameError,
    PayloadTooLargeError,
    ScriptConflictError,
    StateConflictError,
    StorageUnavailableError,
    UnsupportedMediaTypeError,
)

NGINX_JS_LOCATION = re.compile(r"^/[a-z0-9][a-z0-9-]{0,62}[a-z0-9]\.js$")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("algemeen", "algemeen"),
        ("Algemeen", "algemeen"),
        ("Netwerk Achtergrond", "netwerk-achtergrond"),
        ("netwerk_achtergrond", "netwerk-achtergrond"),
        ("jquery.min", "jquery-min"),
        ("  Café Crème!! ", "cafe-creme"),
        ("--x--y--", "x-y"),
        ("a" * 64, "a" * 64),
        ("12", "12"),
    ],
)
def test_normalize_name(raw: str, expected: str) -> None:
    name = script_files.normalize_name(raw)
    assert name == expected
    assert re.fullmatch(SLUG_PATTERN, name)
    assert NGINX_JS_LOCATION.fullmatch(f"/{name}.js")


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "x",
        "€€€",
        "-",
        "a" * 65,
        "../x",
        "a/b",
        "a\\b",
        ".verborgen",
        "..",
        "preview-bridge",
    ],
)
def test_normalize_name_rejects(raw: str) -> None:
    with pytest.raises(InvalidScriptNameError) as info:
        script_files.normalize_name(raw, field="name")
    assert info.value.status == 422
    assert info.value.errors == [
        {"loc": ["body", "name"], "msg": info.value.detail, "type": "invalid_script_name"}
    ]


def test_preview_bridge_is_reserved() -> None:
    # nginx serveert /preview-bridge.js met een exacte location uit de SPA, nooit uit css-files.
    conf = (Path(__file__).parents[3] / "docker/nginx/conf.d/cssthema.conf").read_text()
    assert "location = /preview-bridge.js" in conf
    assert not script_files.is_served_name("preview-bridge")


@pytest.mark.parametrize(
    ("filename", "name", "expected"),
    [
        ("algemeen.js", None, "algemeen"),
        ("ALGEMEEN.JS", None, "algemeen"),
        ("/home/jonas/algemeen.js", None, "algemeen"),
        ("C:\\temp\\algemeen.js", None, "algemeen"),
        ("upload.js", "Netwerk", "netwerk"),
        ("upload.js", "netwerk.js", "netwerk"),
        ("upload.js", "   ", "upload"),
    ],
)
def test_script_name(filename: str, name: str | None, expected: str) -> None:
    assert script_files.script_name(filename, name) == expected


@pytest.mark.parametrize("filename", ["a.css", "a.mjs", "a.js.map", "a", "", "a.json"])
def test_script_name_requires_js(filename: str) -> None:
    with pytest.raises(UnsupportedMediaTypeError):
        script_files.script_name(filename, "naam")


def test_check_content() -> None:
    script_files.check_content(b"void 0;")
    script_files.check_content("\ufeffconsole.log('\u00e9')".encode())
    script_files.check_content(b"a" * script_files.MAX_SCRIPT_BYTES)
    with pytest.raises(PayloadTooLargeError):
        script_files.check_content(b"a" * (script_files.MAX_SCRIPT_BYTES + 1))
    for data in (b"", b"\n\t ", b"\xc3\x28", b"a\0b", "x".encode("utf-16")):
        with pytest.raises(InvalidInputError):
            script_files.check_content(data)


# --- schrijven, archiveren en lijst ---------------------------------------------------------


def _mode(path: Path) -> int:
    return stat.S_IMODE(os.lstat(path).st_mode)


def test_write_new_and_replace(tmp_path: Path) -> None:
    assert script_files._write_script(tmp_path, "algemeen", b"v1", replace=False) is None
    path = tmp_path / "algemeen.js"
    assert path.read_bytes() == b"v1"
    assert _mode(path) == 0o644

    with pytest.raises(ScriptConflictError):
        script_files._write_script(tmp_path, "algemeen", b"v2", replace=False)

    archived = script_files._write_script(tmp_path, "algemeen", b"v2", replace=True)
    assert archived is not None
    assert re.fullmatch(r"\.scripts-archief/algemeen\.\d{8}T\d{6}Z(-\d+)?\.js", archived)
    assert (tmp_path / archived).read_bytes() == b"v1"
    assert path.read_bytes() == b"v2"
    assert _mode(tmp_path / ".scripts-archief") == 0o750
    # geen tijdelijke bestanden achtergelaten
    assert sorted(p.name for p in tmp_path.iterdir()) == [".scripts-archief", "algemeen.js"]


def test_replace_keeps_a_root_owned_file_by_moving_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Een met de hand gezet bestand dat de api niet kan lezen, wordt verplaatst i.p.v. gekopieerd.
    (tmp_path / "algemeen.js").write_bytes(b"van root")

    def unreadable(_source: Path, _target: Path) -> None:
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(script_files, "_copy", unreadable)
    archived = script_files._write_script(tmp_path, "algemeen", b"nieuw", replace=True)
    assert archived is not None
    assert (tmp_path / archived).read_bytes() == b"van root"
    assert (tmp_path / "algemeen.js").read_bytes() == b"nieuw"


def test_archive_dir_must_be_a_real_directory(tmp_path: Path) -> None:
    elsewhere = tmp_path / "elders"
    elsewhere.mkdir()
    directory = tmp_path / "css-files"
    directory.mkdir()
    (directory / ".scripts-archief").symlink_to(elsewhere)
    (directory / "algemeen.js").write_bytes(b"v1")
    with pytest.raises(StorageUnavailableError):
        script_files._delete_script(directory, "algemeen")
    assert (directory / "algemeen.js").read_bytes() == b"v1"
    assert list(elsewhere.iterdir()) == []


def test_write_refuses_symlink_target(tmp_path: Path) -> None:
    outside = tmp_path / "buiten.txt"
    outside.write_text("origineel")
    directory = tmp_path / "css-files"
    directory.mkdir()
    (directory / "link.js").symlink_to(outside)
    with pytest.raises(StateConflictError):
        script_files._write_script(directory, "link", b"x", replace=True)
    assert outside.read_text() == "origineel"


def test_write_requires_directory(tmp_path: Path) -> None:
    with pytest.raises(StorageUnavailableError):
        script_files._write_script(tmp_path / "ontbreekt", "algemeen", b"x", replace=False)
    (tmp_path / "bestand").write_text("x")
    with pytest.raises(StorageUnavailableError):
        script_files._write_script(tmp_path / "bestand", "algemeen", b"x", replace=False)


def test_delete_moves_to_archive(tmp_path: Path) -> None:
    (tmp_path / "algemeen.js").write_bytes(b"v1")
    archived = script_files._delete_script(tmp_path, "algemeen")
    assert not (tmp_path / "algemeen.js").exists()
    assert (tmp_path / archived).read_bytes() == b"v1"
    # tweede keer in dezelfde seconde: een eigen archiefnaam
    (tmp_path / "algemeen.js").write_bytes(b"v2")
    second = script_files._delete_script(tmp_path, "algemeen")
    assert second != archived
    assert (tmp_path / second).read_bytes() == b"v2"


def test_scan_skips_what_nginx_does_not_serve(tmp_path: Path) -> None:
    (tmp_path / "b.js").write_text("x")  # één teken: nginx-regex vraagt er minstens twee
    (tmp_path / "ab.js").write_text("x")
    (tmp_path / "ab-.js").write_text("x")
    (tmp_path / "zz.js").write_text("x")
    (tmp_path / "zz.JS").write_text("x")
    entries = script_files._scan(tmp_path)
    assert [e.name for e in entries] == ["ab", "zz"]
    assert script_files._scan(tmp_path / "ontbreekt") == []
