import io
import json
import zipfile
from datetime import UTC, datetime

import pytest

from cssthema.domain.export.bundle import (
    MAX_ENTRIES,
    Bundle,
    BundleError,
    BundleTheme,
    BundleVersion,
    build_bundle,
    decode_css,
    read_bundle,
)

AT = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)
LIMIT = 512 * 1024


def sample() -> Bundle:
    return Bundle(
        theme=BundleTheme(
            slug="proxmox",
            name="Proxmox",
            description="Donker",
            tags=("homelab",),
            palette_slug="nord",
        ),
        draft="a{color:blue}",
        versions=(
            BundleVersion(1, "a{color:red}", "eerste", "manual", AT),
            BundleVersion(2, "a{color:green}", None, "rollback", AT),
        ),
        live_version=2,
        exported_at=AT,
    )


def zip_bytes(files: dict[str, str | bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def manifest(**overrides: object) -> str:
    data: dict[str, object] = {
        "format": "cssthema-bundle",
        "format_version": 1,
        "exported_at": "2026-10-05T12:00:00Z",
        "theme": {"slug": "x1", "name": "X"},
        "live_version": None,
        "draft": "draft.css",
        "versions": [],
    }
    data.update(overrides)
    return json.dumps(data)


def test_round_trip() -> None:
    data = build_bundle(sample())
    bundle = read_bundle(data, max_css_bytes=LIMIT)
    assert bundle.theme == sample().theme
    assert bundle.draft == "a{color:blue}"
    assert [(v.number, v.css, v.message, v.source) for v in bundle.versions] == [
        (1, "a{color:red}", "eerste", "manual"),
        (2, "a{color:green}", None, "rollback"),
    ]
    assert bundle.live_version == 2
    assert bundle.live is not None and bundle.live.number == 2
    assert bundle.versions[0].created_at == AT


def test_layout_and_determinism() -> None:
    data = build_bundle(sample())
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.namelist() == [
            "manifest.json",
            "draft.css",
            "versions/v1.css",
            "versions/v2.css",
        ]
        parsed = json.loads(archive.read("manifest.json"))
    assert parsed["format"] == "cssthema-bundle"
    assert parsed["versions"][0]["file"] == "versions/v1.css"
    assert build_bundle(sample()) == data


@pytest.mark.parametrize(
    ("files", "fragment"),
    [
        ({"draft.css": ""}, "manifest.json ontbreekt"),
        ({"alg-a.css": "", "algemeen.js": "", "LEESMIJ.txt": ""}, "geen cssthema-bundel"),
        ({"thema/manifest.json": manifest(), "thema/draft.css": ""}, "niet de map zelf"),
        ({"manifest.json": "{nee"}, "geen geldige JSON"),
        ({"manifest.json": "[]"}, "object"),
        ({"manifest.json": manifest(format="iets")}, "geen cssthema-bundel"),
        ({"manifest.json": manifest(format_version=2)}, "niet ondersteund"),
        ({"manifest.json": manifest()}, "ontbreekt"),
        ({"manifest.json": manifest(), "draft.css": "", "../x.css": ""}, "Ongeldig pad"),
        ({"manifest.json": manifest(), "draft.css": "", "/abs.css": ""}, "Ongeldig pad"),
        ({"manifest.json": manifest(), "draft.css": "", "x.js": ""}, "Alleen manifest.json"),
        ({"manifest.json": manifest(), "draft.css": b"\xff\xfe"}, "UTF-8"),
        ({"manifest.json": manifest(), "draft.css": "a\0b"}, "NUL"),
        (
            {"manifest.json": manifest(live_version=3), "draft.css": ""},
            "live_version",
        ),
        (
            {
                "manifest.json": manifest(
                    versions=[{"number": 1, "file": "versions/v1.css", "sha256": "00"}]
                ),
                "draft.css": "",
                "versions/v1.css": "a{}",
            },
            "beschadigd",
        ),
        (
            {
                "manifest.json": manifest(versions=[{"number": 1, "file": "draft.css"}]),
                "draft.css": "",
            },
            "ongeldig bestand",
        ),
        (
            {
                "manifest.json": manifest(
                    versions=[{"number": 1}, {"number": 1}],
                ),
                "draft.css": "",
                "versions/v1.css": "",
            },
            "dubbel",
        ),
    ],
)
def test_invalid_bundles(files: dict[str, str | bytes], fragment: str) -> None:
    with pytest.raises(BundleError, match=fragment):
        read_bundle(zip_bytes(files), max_css_bytes=LIMIT)


def test_not_a_zip() -> None:
    with pytest.raises(BundleError, match="geen geldig zip"):
        read_bundle(b"PK\x03\x04 kapot", max_css_bytes=LIMIT)


def test_css_limit_is_enforced_on_the_real_size() -> None:
    files = {"manifest.json": manifest(), "draft.css": "a" * 2000}
    with pytest.raises(BundleError, match="te groot"):
        read_bundle(zip_bytes(files), max_css_bytes=1000)


def test_too_many_entries() -> None:
    files: dict[str, str | bytes] = {f"f{i}.css": "" for i in range(MAX_ENTRIES + 1)}
    with pytest.raises(BundleError, match="meer dan"):
        read_bundle(zip_bytes(files), max_css_bytes=LIMIT)


def test_decode_css_strips_bom() -> None:
    assert decode_css("﻿a{}".encode(), "x.css") == "a{}"
