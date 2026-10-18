"""Dashboard en paletten (alleen lezen)."""

import uuid

from tests.integration.api_helpers import Api

BUILTIN = {
    "terminal",
    "nord",
    "dracula",
    "catppuccin-mocha",
    "gruvbox-dark",
    "solarized-dark",
    "tokyo-night",
}


async def test_palettes(api: Api) -> None:
    palettes = (await api.client.get("/api/v1/palettes")).json()
    builtin = [p for p in palettes if p["is_builtin"]]
    assert {p["slug"] for p in builtin} == BUILTIN
    assert palettes[: len(builtin)] == builtin  # ingebouwde eerst
    terminal = next(p for p in palettes if p["slug"] == "terminal")
    assert terminal["tokens"]["bg"] == "#141414"
    assert list(terminal["tokens"])[:3] == ["bg", "surface", "fg"]

    before = terminal["theme_count"]
    await api.create_theme(palette_id=terminal["id"])
    response = await api.client.get(f"/api/v1/palettes/{terminal['id']}")
    assert response.status_code == 200
    assert response.json()["theme_count"] == before + 1

    response = await api.client.get(f"/api/v1/palettes/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_dashboard(api: Api) -> None:
    before = (await api.client.get("/api/v1/dashboard")).json()
    published = await api.published_theme()
    dirty = await api.published_theme()
    await api.save_draft(dirty, "a { color: blue }")
    deleted = await api.create_theme()
    await api.client.delete(f"/api/v1/themes/{deleted['id']}")
    draft_only = await api.create_theme(css="a{}")

    after = (await api.client.get("/api/v1/dashboard")).json()
    assert after["themes_total"] == before["themes_total"] + 3
    assert after["themes_published"] == before["themes_published"] + 2
    assert after["themes_draft_dirty"] == before["themes_draft_dirty"] + 2  # dirty + draft_only
    assert after["themes_deleted"] == before["themes_deleted"] + 1
    assert after["palettes_total"] >= len(BUILTIN)
    assert [t["id"] for t in after["recent"][:3]] == [
        draft_only["id"],
        dirty["id"],
        published["id"],
    ]
    assert len(after["recent"]) <= 5
