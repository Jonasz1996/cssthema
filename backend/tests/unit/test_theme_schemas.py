import uuid

import pytest
from pydantic import ValidationError

from cssthema.schemas.themes import (
    DraftUpdate,
    LocalImportRequest,
    ThemeCreate,
    ThemeTemplate,
    ThemeUpdate,
    VersionDiff,
)


def test_theme_create_cleans_name_and_tags() -> None:
    data = ThemeCreate(name="  Proxmox   Donker ", tags=["Homelab", "homelab ", "", " Dark  Mode "])
    assert data.name == "Proxmox Donker"
    assert data.tags == ["homelab", "dark mode"]


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "   "},
        {"name": "x" * 121},
        {"name": "a\x07b"},
        {"name": "x", "tags": ["x" * 41]},
        {"name": "x", "tags": [f"t{i}" for i in range(21)]},
        {"name": "x", "css": "a{}\0"},
        {"name": "x", "css": "a{}", "template": {"kind": "theme", "id": str(uuid.uuid4())}},
    ],
)
def test_theme_create_rejects(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ThemeCreate.model_validate(payload)


def test_template_requires_references() -> None:
    with pytest.raises(ValidationError, match="id is verplicht"):
        ThemeTemplate(kind="theme")
    with pytest.raises(ValidationError, match="version_number is verplicht"):
        ThemeTemplate(kind="version", id=uuid.uuid4())
    assert ThemeTemplate().kind == "empty"


def test_theme_update_tracks_sent_fields() -> None:
    data = ThemeUpdate.model_validate({"description": None})
    assert data.model_fields_set == {"description"}
    for field in ("name", "slug", "tags"):
        with pytest.raises(ValidationError, match="mag niet null"):
            ThemeUpdate.model_validate({field: None})


def test_draft_update_rejects_nul() -> None:
    with pytest.raises(ValidationError):
        DraftUpdate(css="a\0")


def test_local_import_request_dedupes_names() -> None:
    data = LocalImportRequest(names=["a.css", "b.css", "a.css"])
    assert data.names == ["a.css", "b.css"]
    assert data.publish is True
    assert data.archive is True
    with pytest.raises(ValidationError):
        LocalImportRequest(names=[])


def test_version_diff_serializes_from() -> None:
    diff = VersionDiff.model_validate(
        {"from": 3, "to": "draft", "unified": "", "stats": {"added": 0, "removed": 0}}
    )
    assert diff.model_dump()["from"] == 3
    assert diff.model_dump_json().startswith('{"from":3')
