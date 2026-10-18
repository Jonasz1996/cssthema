"""Thema-API: de acceptatieflow van docs/07 § 4 en de randgevallen (fase 1)."""

import asyncio
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine

from tests.integration.api_helpers import Api, audit_actions, unique_slug

THEMES = "/api/v1/themes"


# --- acceptatieflow --------------------------------------------------------------------------


async def test_acceptance_flow(api: Api, engine: AsyncEngine) -> None:
    c = api.client
    slug = unique_slug()

    # 1. thema maken
    response = await c.post(THEMES, json={"name": "Proxmox Donker", "slug": slug})
    assert response.status_code == 201
    theme = response.json()
    assert response.headers["Location"] == f"{THEMES}/{theme['id']}"
    assert response.headers["ETag"] == '"lv-1"'
    assert theme["status"] == "draft"
    assert theme["public_url"] == f"https://css.example.be/{slug}.css"
    assert theme["published_version"] is None
    assert theme["draft_dirty"] is False
    assert theme["created_by"]["display_name"] == "Beheerder"

    # 2. draft lezen en opslaan met If-Match
    response = await c.get(f"{THEMES}/{theme['id']}/draft")
    assert response.status_code == 200
    etag = response.headers["ETag"]
    response = await c.put(
        f"{THEMES}/{theme['id']}/draft",
        json={"css": ".x-panel { background: #222; }"},
        headers={"If-Match": etag},
    )
    assert response.status_code == 200
    draft = response.json()
    assert response.headers["ETag"] == f'"lv-{draft["lock_version"]}"'
    assert draft["lock_version"] == 2
    assert draft["size_bytes"] == len(".x-panel { background: #222; }")
    assert draft["updated_by"]["display_name"] == "Beheerder"

    # 3. publiceren
    response = await c.post(
        f"{THEMES}/{theme['id']}/publish",
        json={"message": "Eerste versie", "expected_lock_version": draft["lock_version"]},
    )
    assert response.status_code == 201, response.text
    v1 = response.json()
    assert response.headers["Location"] == f"{THEMES}/{theme['id']}/versions/1"
    assert response.headers["ETag"] == '"lv-3"'
    assert v1["version_number"] == 1
    assert v1["is_live"] is True
    assert v1["source"] == "manual"
    assert v1["message"] == "Eerste versie"
    assert v1["css_compiled"].endswith(".x-panel{background:#222}")
    assert f"/*! cssthema · {slug} · v1 · " in v1["css_compiled"]

    # 4. publieke CSS met ETag, en 304 met If-None-Match
    response = await c.get(f"/{slug}.css")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/css; charset=utf-8"
    assert response.headers["X-Cssthema-Version"] == "1"
    assert response.headers["ETag"] == f'"sha256-{v1["sha256"][:16]}"'
    assert response.text == v1["css_compiled"]
    first_etag = response.headers["ETag"]
    response = await c.get(f"/{slug}.css", headers={"If-None-Match": first_etag})
    assert response.status_code == 304
    assert response.content == b""
    assert response.headers["ETag"] == first_etag

    # 5. tweede versie en rollback naar v1 → nieuwe versie (v3) met een nieuwe ETag
    theme["lock_version"] = 3
    await api.save_draft(theme, ".x-panel { background: #333; }")
    v2 = await api.publish(theme, "Lichter")
    assert v2["version_number"] == 2
    response = await c.get(f"/{slug}.css")
    assert response.headers["X-Cssthema-Version"] == "2"
    assert "#333" in response.text

    response = await c.post(
        f"{THEMES}/{theme['id']}/rollback",
        json={"version_number": 1},
        headers={"If-Match": f'"lv-{theme["lock_version"]}"'},
    )
    assert response.status_code == 201, response.text
    assert response.headers["ETag"] == f'"lv-{theme["lock_version"] + 1}"'  # één stap
    v3 = response.json()
    assert v3["version_number"] == 3
    assert v3["source"] == "rollback"
    assert v3["source_version_number"] == 1
    assert v3["message"] == "Rollback naar v1"
    assert v3["css_source"] == v1["css_source"]
    response = await c.get(f"/{slug}.css", headers={"If-None-Match": first_etag})
    assert response.status_code == 200
    assert response.headers["ETag"] not in (first_etag, f'"sha256-{v2["sha256"][:16]}"')
    assert response.headers["X-Cssthema-Version"] == "3"
    assert "#222" in response.text

    # na de rollback is de draft gelijk aan de live versie
    response = await c.get(f"{THEMES}/{theme['id']}")
    detail = response.json()
    assert detail["draft_dirty"] is False
    assert detail["latest_version_number"] == 3
    assert detail["published_version"]["version_number"] == 3
    assert detail["status"] == "published"
    assert response.headers["ETag"] == f'"lv-{detail["lock_version"]}"'

    # nginx is na elke publicatie ververst
    assert api.refresh_calls.count(f"/{slug}.css") == 3
    assert api.refresh_calls.count(f"/themes/{slug}.css") == 3

    actions = [action for action, _ in await audit_actions(engine, theme["id"])]
    assert actions == ["theme.create", "theme.publish", "theme.publish", "theme.rollback"]


# --- concurrency -------------------------------------------------------------------------------


async def test_draft_requires_if_match(api: Api) -> None:
    theme = await api.create_theme()
    response = await api.client.put(f"{THEMES}/{theme['id']}/draft", json={"css": "a{}"})
    assert response.status_code == 428
    assert response.json()["code"] == "precondition_required"
    response = await api.client.patch(f"{THEMES}/{theme['id']}", json={"name": "Nieuw"})
    assert response.status_code == 428
    response = await api.client.post(
        f"{THEMES}/{theme['id']}/draft/reset", json={"version_number": 1}
    )
    assert response.status_code == 428


async def test_stale_draft_is_precondition_failed(api: Api) -> None:
    theme = await api.create_theme(css="a{}")
    await api.save_draft(theme, "a { color: red }")  # lv-2
    response = await api.client.put(
        f"{THEMES}/{theme['id']}/draft",
        json={"css": "a{color:blue}"},
        headers={"If-Match": '"lv-1"'},
    )
    assert response.status_code == 412
    body = response.json()
    assert body["code"] == "precondition_failed"
    assert body["current"]["etag"] == '"lv-2"'
    assert body["current"]["lock_version"] == 2
    assert body["current"]["updated_by"]["display_name"] == "Beheerder"
    assert body["current"]["updated_at"]
    assert response.headers["ETag"] == '"lv-2"'
    # de draft is niet overschreven
    draft = (await api.client.get(f"{THEMES}/{theme['id']}/draft")).json()
    assert draft["css"] == "a { color: red }"


async def test_concurrent_draft_saves(api: Api) -> None:
    """Twee editors met dezelfde ETag: precies één wint, de ander krijgt 412."""
    theme = await api.create_theme()
    responses = await asyncio.gather(
        *(
            api.client.put(
                f"{THEMES}/{theme['id']}/draft",
                json={"css": f"a {{ order: {n} }}"},
                headers={"If-Match": '"lv-1"'},
            )
            for n in range(4)
        )
    )
    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200, 412, 412, 412]
    winner = next(r for r in responses if r.status_code == 200).json()
    draft = (await api.client.get(f"{THEMES}/{theme['id']}/draft")).json()
    assert draft == winner


async def test_concurrent_publishes(api: Api) -> None:
    theme = await api.create_theme(css="a { color: red }")
    responses = await asyncio.gather(
        *(
            api.client.post(f"{THEMES}/{theme['id']}/publish", json={"expected_lock_version": 1})
            for _ in range(3)
        )
    )
    assert sorted(r.status_code for r in responses) == [201, 412, 412]
    versions = (await api.client.get(f"{THEMES}/{theme['id']}/versions")).json()["items"]
    assert [v["version_number"] for v in versions] == [1]


async def test_if_match_star_and_weak_etags(api: Api) -> None:
    theme = await api.create_theme()
    response = await api.client.put(
        f"{THEMES}/{theme['id']}/draft", json={"css": "a{}"}, headers={"If-Match": 'W/"lv-1"'}
    )
    assert response.status_code == 200
    response = await api.client.put(
        f"{THEMES}/{theme['id']}/draft", json={"css": "b{}"}, headers={"If-Match": "*"}
    )
    assert response.status_code == 200
    assert response.json()["lock_version"] == 3


async def test_saving_the_same_draft_does_not_bump_the_lock(api: Api) -> None:
    theme = await api.create_theme(css="a{}")
    draft = await api.save_draft(theme, "a{}")
    assert draft["lock_version"] == 1


async def test_publish_with_stale_lock_version(api: Api) -> None:
    theme = await api.create_theme(css="a { color: red }")
    response = await api.client.post(
        f"{THEMES}/{theme['id']}/publish", json={"expected_lock_version": 99}
    )
    assert response.status_code == 412
    assert response.json()["current"]["lock_version"] == 1


async def test_publish_without_changes_is_conflict(api: Api) -> None:
    theme = await api.published_theme()
    response = await api.client.post(
        f"{THEMES}/{theme['id']}/publish", json={"expected_lock_version": theme["lock_version"]}
    )
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "state_conflict"
    assert body["title"] == "Geen wijzigingen t.o.v. v1"


async def test_publish_with_lint_errors(api: Api) -> None:
    theme = await api.create_theme(css="a {\n  background: url(https://evil.example/x.png);\n}")
    response = await api.client.post(
        f"{THEMES}/{theme['id']}/publish", json={"expected_lock_version": 1}
    )
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "theme_lint_failed"
    assert body["errors"] == [
        {
            "line": 2,
            "column": 15,
            "rule": "external-url",
            "severity": "error",
            "message": body["errors"][0]["message"],
        }
    ]
    detail = (await api.client.get(f"{THEMES}/{theme['id']}")).json()
    assert detail["latest_version_number"] == 0


async def test_publish_keeps_lint_warnings(api: Api) -> None:
    theme = await api.create_theme(css="a { colr: red }")
    version = await api.publish(theme)
    assert [w["rule"] for w in version["lint_warnings"]] == ["unknown-property"]


# --- aanmaken en metadata ------------------------------------------------------------------


async def test_create_derives_slug_from_name(api: Api) -> None:
    name = f"IT {uuid.uuid4().hex[:8]} Café"
    response = await api.client.post(THEMES, json={"name": name})
    assert response.status_code == 201
    assert response.json()["slug"] == f"it-{name[3:11]}-cafe"


async def test_create_slug_conflict(api: Api) -> None:
    theme = await api.create_theme()
    response = await api.client.post(THEMES, json={"name": "Dubbel", "slug": theme["slug"]})
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "slug_conflict"
    assert body["theme_id"] == theme["id"]


async def test_create_invalid_slug(api: Api) -> None:
    for slug, fragment in (("api", "gereserveerd"), ("Niet Geldig", "kleine letters")):
        response = await api.client.post(THEMES, json={"name": "x", "slug": slug})
        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "invalid_slug"
        assert fragment in body["detail"]
        assert body["errors"][0]["loc"] == ["body", "slug"]


async def test_create_with_unknown_palette_or_service(api: Api) -> None:
    response = await api.client.post(
        THEMES,
        json={"name": "x", "slug": unique_slug(), "palette_id": str(uuid.uuid4())},
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "palette_id"]
    response = await api.client.post(
        THEMES,
        json={"name": "x", "slug": unique_slug(), "service_id": str(uuid.uuid4())},
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "service_id"]


async def test_create_too_large(api: Api) -> None:
    response = await api.client.post(
        THEMES, json={"name": "x", "slug": unique_slug(), "css": "a" * (1024 * 1024 + 1)}
    )
    assert response.status_code == 413
    assert response.json()["code"] == "payload_too_large"


async def test_create_from_templates(api: Api) -> None:
    source = await api.published_theme(css="a { color: red }")
    await api.save_draft(source, "a { color: blue }")

    copy = await api.create_theme(template={"kind": "theme", "id": source["id"]})
    draft = (await api.client.get(f"{THEMES}/{copy['id']}/draft")).json()
    assert draft["css"] == "a { color: blue }"

    from_version = await api.create_theme(
        template={"kind": "version", "id": source["id"], "version_number": 1}
    )
    draft = (await api.client.get(f"{THEMES}/{from_version['id']}/draft")).json()
    assert draft["css"] == "a { color: red }"
    assert from_version["draft_dirty"] is True

    response = await api.client.post(
        THEMES,
        json={
            "name": "x",
            "slug": unique_slug(),
            "template": {"kind": "version", "id": source["id"], "version_number": 9},
        },
    )
    assert response.status_code == 422


async def test_update_metadata(api: Api, engine: AsyncEngine) -> None:
    theme = await api.create_theme(tags=["homelab"])
    palettes = (await api.client.get("/api/v1/palettes")).json()
    nord = next(p for p in palettes if p["slug"] == "nord")
    response = await api.client.patch(
        f"{THEMES}/{theme['id']}",
        json={
            "name": "Hernoemd",
            "description": "  Donker thema  ",
            "palette_id": nord["id"],
            "tags": ["Dark", "dark", "homelab"],
        },
        headers={"If-Match": '"lv-1"'},
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["name"] == "Hernoemd"
    assert updated["description"] == "Donker thema"
    assert updated["palette_id"] == nord["id"]
    assert updated["tags"] == ["dark", "homelab"]
    assert updated["lock_version"] == 2
    assert response.headers["ETag"] == '"lv-2"'

    # zonder wijzigingen: geen nieuwe lock_version en geen audit-rij
    response = await api.client.patch(
        f"{THEMES}/{theme['id']}", json={"name": "Hernoemd"}, headers={"If-Match": '"lv-2"'}
    )
    assert response.json()["lock_version"] == 2

    # null maakt een optioneel veld leeg; null voor de naam mag niet
    response = await api.client.patch(
        f"{THEMES}/{theme['id']}", json={"palette_id": None}, headers={"If-Match": '"lv-2"'}
    )
    assert response.json()["palette_id"] is None
    response = await api.client.patch(
        f"{THEMES}/{theme['id']}", json={"name": None}, headers={"If-Match": '"lv-3"'}
    )
    assert response.status_code == 422

    actions = await audit_actions(engine, theme["id"])
    assert [a for a, _ in actions] == ["theme.create", "theme.update", "theme.update"]
    assert actions[1][1]["name"] == ["Integratietest", "Hernoemd"]


async def test_palette_change_makes_the_draft_dirty(api: Api) -> None:
    theme = await api.published_theme(css=".x { color: var(--ct-fg) }")
    palettes = (await api.client.get("/api/v1/palettes")).json()
    terminal = next(p for p in palettes if p["slug"] == "terminal")
    response = await api.client.patch(
        f"{THEMES}/{theme['id']}",
        json={"palette_id": terminal["id"]},
        headers={"If-Match": f'"lv-{theme["lock_version"]}"'},
    )
    assert response.json()["draft_dirty"] is True
    theme["lock_version"] = response.json()["lock_version"]
    version = await api.publish(theme)
    assert ":root{--ct-bg:#141414;" in version["css_compiled"]
    assert version["css_compiled"].endswith(".x{color:var(--ct-fg)}")


async def test_slug_change_redirects(api: Api, engine: AsyncEngine) -> None:
    theme = await api.published_theme(css="a { color: red }")
    old = theme["slug"]
    new = unique_slug()
    api.refresh_calls.clear()
    response = await api.client.patch(
        f"{THEMES}/{theme['id']}",
        json={"slug": new},
        headers={"If-Match": f'"lv-{theme["lock_version"]}"'},
    )
    assert response.status_code == 200
    assert response.json()["public_url"] == f"https://css.example.be/{new}.css"

    for path, location in (
        (f"/{old}.css", f"/{new}.css"),
        (f"/themes/{old}.css", f"/themes/{new}.css"),
        (f"/themes/{old}@1.css", f"/themes/{new}@1.css"),
    ):
        response = await api.client.get(path)
        assert response.status_code == 301, path
        assert response.headers["Location"] == location
        assert response.headers["Cache-Control"] == "public, max-age=60"
    response = await api.client.get(f"/{new}.css")
    assert response.status_code == 200

    assert set(await api.refreshed()) == {
        f"/{old}.css",
        f"/themes/{old}.css",
        f"/themes/{old}@1.css",
        f"/{new}.css",
        f"/themes/{new}.css",
    }
    changes = (await audit_actions(engine, theme["id"]))[-1]
    assert changes == ("theme.update", {"slug": [old, new]})

    # een nieuw thema met de oude slug: de redirect verdwijnt
    reuse = await api.create_theme(slug=old)
    response = await api.client.get(f"/{old}.css")
    assert response.status_code == 404
    await api.publish(reuse)
    response = await api.client.get(f"/{old}.css")
    assert response.status_code == 200


async def test_slug_change_back_and_forth(api: Api) -> None:
    theme = await api.published_theme()
    first = theme["slug"]
    second = unique_slug()
    for target, lock in ((second, theme["lock_version"]), (first, theme["lock_version"] + 1)):
        response = await api.client.patch(
            f"{THEMES}/{theme['id']}", json={"slug": target}, headers={"If-Match": f'"lv-{lock}"'}
        )
        assert response.status_code == 200
    assert (await api.client.get(f"/{first}.css")).status_code == 200
    response = await api.client.get(f"/{second}.css")
    assert response.status_code == 301
    assert response.headers["Location"] == f"/{first}.css"


# --- verwijderen, herstellen, dupliceren -----------------------------------------------------


async def test_soft_delete_and_restore(api: Api, engine: AsyncEngine) -> None:
    theme = await api.published_theme()
    slug = theme["slug"]
    response = await api.client.delete(f"{THEMES}/{theme['id']}")
    assert response.status_code == 204
    assert (await api.client.get(f"/{slug}.css")).status_code == 404
    assert f"/themes/{slug}@1.css" in await api.refreshed()

    detail = (await api.client.get(f"{THEMES}/{theme['id']}")).json()
    assert detail["deleted_at"] is not None
    listed = (await api.client.get(THEMES, params={"q": slug})).json()["items"]
    assert listed == []
    listed = (await api.client.get(THEMES, params={"q": slug, "include_deleted": "true"})).json()[
        "items"
    ]
    assert [t["id"] for t in listed] == [theme["id"]]

    # een verwijderd thema is niet te wijzigen
    response = await api.client.put(
        f"{THEMES}/{theme['id']}/draft", json={"css": "x{}"}, headers={"If-Match": "*"}
    )
    assert response.status_code == 409

    # nog eens verwijderen is idempotent
    assert (await api.client.delete(f"{THEMES}/{theme['id']}")).status_code == 204

    response = await api.client.post(f"{THEMES}/{theme['id']}/restore")
    assert response.status_code == 200
    assert response.json()["deleted_at"] is None
    assert response.headers["ETag"].startswith('"lv-')
    assert (await api.client.get(f"/{slug}.css")).status_code == 200

    actions = [a for a, _ in await audit_actions(engine, theme["id"])]
    assert actions == ["theme.create", "theme.publish", "theme.delete", "theme.restore"]


async def test_restore_when_slug_is_taken(api: Api) -> None:
    theme = await api.create_theme()
    await api.client.delete(f"{THEMES}/{theme['id']}")
    await api.create_theme(slug=theme["slug"])
    response = await api.client.post(f"{THEMES}/{theme['id']}/restore")
    assert response.status_code == 409
    assert response.json()["code"] == "slug_conflict"


async def test_hard_delete(api: Api) -> None:
    theme = await api.published_theme()
    response = await api.client.delete(f"{THEMES}/{theme['id']}", params={"hard": "true"})
    assert response.status_code == 204
    assert (await api.client.get(f"{THEMES}/{theme['id']}")).status_code == 404
    assert (await api.client.get(f"/{theme['slug']}.css")).status_code == 404
    assert (await api.client.get(f"/themes/{theme['slug']}@1.css")).status_code == 404


async def test_delete_with_stale_if_match(api: Api) -> None:
    theme = await api.create_theme()
    response = await api.client.delete(f"{THEMES}/{theme['id']}", headers={"If-Match": '"lv-7"'})
    assert response.status_code == 412


async def test_duplicate(api: Api, engine: AsyncEngine) -> None:
    source = await api.published_theme(css="a { color: red }", tags=["homelab"])
    await api.save_draft(source, "a { color: blue }")
    slug = unique_slug()
    response = await api.client.post(
        f"{THEMES}/{source['id']}/duplicate", json={"name": "Kopie", "slug": slug}
    )
    assert response.status_code == 201
    copy = response.json()
    assert response.headers["Location"] == f"{THEMES}/{copy['id']}"
    assert copy["slug"] == slug
    assert copy["status"] == "draft"
    assert copy["tags"] == ["homelab"]
    assert copy["latest_version_number"] == 0
    assert copy["published_version"] is None
    draft = (await api.client.get(f"{THEMES}/{copy['id']}/draft")).json()
    assert draft["css"] == "a { color: blue }"
    versions = (await api.client.get(f"{THEMES}/{copy['id']}/versions")).json()
    assert versions["items"] == []
    assert (await audit_actions(engine, copy["id"]))[0][0] == "theme.duplicate"


# --- versies, diff, draft-reset en lint ---------------------------------------------------------


async def test_versions_diff_and_reset(api: Api, engine: AsyncEngine) -> None:
    theme = await api.published_theme(css="a {\n  color: red;\n}\n")
    for colour in ("green", "blue"):
        await api.save_draft(theme, f"a {{\n  color: {colour};\n}}\n")
        await api.publish(theme)
    await api.save_draft(theme, "a {\n  color: blue;\n}\nb {}\n")

    page = (await api.client.get(f"{THEMES}/{theme['id']}/versions", params={"limit": 2})).json()
    assert [v["version_number"] for v in page["items"]] == [3, 2]
    assert page["items"][0]["is_live"] is True
    assert "css_source" not in page["items"][0]
    page2 = (
        await api.client.get(
            f"{THEMES}/{theme['id']}/versions", params={"limit": 2, "cursor": page["next_cursor"]}
        )
    ).json()
    assert [v["version_number"] for v in page2["items"]] == [1]
    assert page2["next_cursor"] is None

    version = (await api.client.get(f"{THEMES}/{theme['id']}/versions/2")).json()
    assert version["css_source"] == "a {\n  color: green;\n}\n"
    assert version["is_live"] is False
    assert (await api.client.get(f"{THEMES}/{theme['id']}/versions/9")).status_code == 404

    diff = (
        await api.client.get(f"{THEMES}/{theme['id']}/diff", params={"from": 1, "to": 3})
    ).json()
    assert diff["from"] == 1
    assert diff["to"] == 3
    assert diff["stats"] == {"added": 1, "removed": 1}
    assert "-  color: red;" in diff["unified"]
    assert "+  color: blue;" in diff["unified"]
    diff = (await api.client.get(f"{THEMES}/{theme['id']}/diff", params={"from": 3})).json()
    assert diff["to"] == "draft"
    assert diff["stats"] == {"added": 1, "removed": 0}
    response = await api.client.get(f"{THEMES}/{theme['id']}/diff", params={"from": "v1"})
    assert response.status_code == 422

    response = await api.client.post(
        f"{THEMES}/{theme['id']}/draft/reset",
        json={"version_number": 1},
        headers={"If-Match": f'"lv-{theme["lock_version"]}"'},
    )
    assert response.status_code == 200, response.text
    assert response.json()["css"] == "a {\n  color: red;\n}\n"
    assert response.headers["ETag"] == f'"lv-{theme["lock_version"] + 1}"'
    detail = (await api.client.get(f"{THEMES}/{theme['id']}")).json()
    assert detail["latest_version_number"] == 3  # niets gepubliceerd
    assert detail["draft_dirty"] is True
    actions = [a for a, _ in await audit_actions(engine, theme["id"])]
    assert actions[-1] == "theme.draft_reset"
    assert "theme.draft_save" not in actions


async def test_rollback_to_the_live_version_is_conflict(api: Api) -> None:
    theme = await api.published_theme()
    url = f"{THEMES}/{theme['id']}/rollback"
    any_lock = {"If-Match": "*"}
    response = await api.client.post(url, json={"version_number": 1}, headers=any_lock)
    assert response.status_code == 409
    assert response.json()["code"] == "state_conflict"
    response = await api.client.post(url, json={"version_number": 5}, headers=any_lock)
    assert response.status_code == 404


async def test_rollback_requires_if_match(api: Api) -> None:
    # Een rollback vervangt de draft: net als draft/reset alleen met If-Match.
    theme = await api.published_theme()
    await api.save_draft(theme, "a { color: green }")
    await api.publish(theme)
    await api.save_draft(theme, "a { color: purple }  /* niet gepubliceerd */")
    url = f"{THEMES}/{theme['id']}/rollback"
    response = await api.client.post(url, json={"version_number": 1})
    assert response.status_code == 428
    assert response.json()["code"] == "precondition_required"
    response = await api.client.post(
        url, json={"version_number": 1}, headers={"If-Match": '"lv-1"'}
    )
    assert response.status_code == 412
    draft = (await api.client.get(f"{THEMES}/{theme['id']}/draft")).json()
    assert "purple" in draft["css"]


async def test_version_numbers_beyond_int4_are_422(api: Api) -> None:
    # Groter dan een PostgreSQL-integer: een nette 422 in plaats van een 500 uit asyncpg.
    theme = await api.published_theme()
    base = f"{THEMES}/{theme['id']}"
    huge = 99_999_999_999
    any_lock = {"If-Match": "*"}
    responses = [
        await api.client.get(f"{base}/versions/{huge}"),
        await api.client.get(f"{base}/export", params={"version": huge}),
        await api.client.post(f"{base}/rollback", json={"version_number": huge}, headers=any_lock),
        await api.client.post(
            f"{base}/draft/reset", json={"version_number": huge}, headers=any_lock
        ),
        await api.client.post(
            THEMES,
            json={
                "name": "Te groot",
                "template": {"kind": "version", "id": theme["id"], "version_number": huge},
            },
        ),
    ]
    assert [r.status_code for r in responses] == [422] * 5
    assert (await api.client.get(f"{base}/versions/2147483647")).status_code == 404


async def test_lint_endpoint(api: Api) -> None:
    theme = await api.create_theme(css="a { colr: red }")
    result = (await api.client.post(f"{THEMES}/{theme['id']}/lint")).json()
    assert result["ok"] is True
    assert [w["rule"] for w in result["warnings"]] == ["unknown-property"]
    assert result["unmatched_selectors"] == []
    result = (
        await api.client.post(
            f"{THEMES}/{theme['id']}/lint", json={"css": "@import url(//evil.example/x.css);"}
        )
    ).json()
    assert result["ok"] is False
    assert [e["rule"] for e in result["errors"]] == ["external-import"]
    assert result["size_bytes"] == len("@import url(//evil.example/x.css);")


async def test_unknown_theme_is_not_found(api: Api) -> None:
    response = await api.client.get(f"{THEMES}/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


# --- lijst en paginering -----------------------------------------------------------------------


async def test_list_filters_and_cursor(api: Api) -> None:
    marker = uuid.uuid4().hex[:8]
    created = []
    for index in range(5):
        created.append(
            await api.create_theme(
                name=f"Lijst {marker} {index}", tags=["even" if index % 2 == 0 else "oneven"]
            )
        )
    published = created[1]
    await api.save_draft(published, "a { color: red }")
    await api.publish(published)

    seen: list[str] = []
    cursor = None
    while True:
        params: dict[str, Any] = {"q": marker, "sort": "name", "limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = (await api.client.get(THEMES, params=params)).json()
        seen.extend(item["name"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen == [f"Lijst {marker} {i}" for i in range(5)]

    newest = (await api.client.get(THEMES, params={"q": marker, "limit": 10})).json()["items"]
    assert newest[0]["id"] == published["id"]  # laatst gewijzigd

    by_created = (
        await api.client.get(THEMES, params={"q": marker, "sort": "-created_at", "limit": 3})
    ).json()
    rest = (
        await api.client.get(
            THEMES,
            params={
                "q": marker,
                "sort": "-created_at",
                "limit": 3,
                "cursor": by_created["next_cursor"],
            },
        )
    ).json()
    ids = [t["id"] for t in by_created["items"] + rest["items"]]
    assert ids == [t["id"] for t in reversed(created)]

    status = (await api.client.get(THEMES, params={"q": marker, "status": "published"})).json()
    assert [t["id"] for t in status["items"]] == [published["id"]]
    tagged = (await api.client.get(THEMES, params={"q": marker, "tag": "Even"})).json()
    assert len(tagged["items"]) == 3

    # een cursor van een andere sortering, of onzin: 400
    for cursor in (by_created["next_cursor"], "x"):
        response = await api.client.get(
            THEMES, params={"q": marker, "sort": "-updated_at", "cursor": cursor}
        )
        assert response.status_code == 400
        assert response.json()["code"] == "bad_request"


async def test_list_search_escapes_like_wildcards(api: Api) -> None:
    marker = uuid.uuid4().hex[:8]
    percent = await api.create_theme(name=f"{marker} 100%")
    await api.create_theme(name=f"{marker} 1000")
    items = (await api.client.get(THEMES, params={"q": f"{marker} 100%"})).json()["items"]
    assert [t["id"] for t in items] == [percent["id"]]
    items = (await api.client.get(THEMES, params={"q": f"{marker}_"})).json()["items"]
    assert items == []
    # een NUL-teken in de zoektekst is geen 500
    response = await api.client.get(THEMES, params={"q": f"{marker}\0", "tag": "\0"})
    assert response.status_code == 200
