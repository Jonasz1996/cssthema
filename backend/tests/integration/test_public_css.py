"""Publieke CSS (docs/05 § 4.11): `/{slug}.css`, `/themes/{slug}.css`, `/themes/{slug}@{n}.css`."""

import asyncio
from collections import Counter
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine

from cssthema.config import Settings
from cssthema.main import create_app
from cssthema.services import css_delivery
from cssthema.services.css_delivery import CachedCss, CssDelivery, generation_key, latest_key
from tests.integration.api_helpers import Api, unique_slug
from tests.integration.conftest import cleanup_test_themes

LATEST = "public, max-age=60, stale-while-revalidate=600, stale-if-error=86400"
IMMUTABLE = "public, max-age=31536000, immutable"


async def test_headers_of_the_published_css(api: Api) -> None:
    theme = await api.published_theme(css="body { color: red; }")
    for path in (f"/{theme['slug']}.css", f"/themes/{theme['slug']}.css"):
        response = await api.client.get(path, params={"v": "123"})
        assert response.status_code == 200
        headers = response.headers
        assert headers["Content-Type"] == "text/css; charset=utf-8"
        assert headers["Cache-Control"] == LATEST
        assert headers["Access-Control-Allow-Origin"] == "*"
        assert headers["X-Content-Type-Options"] == "nosniff"
        assert headers["X-Cssthema-Version"] == "1"
        assert headers["ETag"].startswith('"sha256-')
        assert "ETag" in headers["Access-Control-Expose-Headers"]
        assert headers["Last-Modified"].endswith(" GMT")
        assert response.text.endswith("body{color:red}")


async def test_fixed_version_is_immutable(api: Api) -> None:
    theme = await api.published_theme(css="a { color: red }")
    await api.save_draft(theme, "a { color: blue }")
    await api.publish(theme)
    response = await api.client.get(f"/themes/{theme['slug']}@1.css")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == IMMUTABLE
    assert response.headers["X-Cssthema-Version"] == "1"
    assert response.text.endswith("a{color:red}")
    latest = await api.client.get(f"/{theme['slug']}.css")
    assert latest.text.endswith("a{color:blue}")
    assert (await api.client.get(f"/themes/{theme['slug']}@3.css")).status_code == 404
    # `@n` bestaat alleen onder /themes/
    assert (await api.client.get(f"/{theme['slug']}@1.css")).status_code == 404


async def test_unpublished_imports_have_no_public_versions(api: Api) -> None:
    """Import met "alleen draft": niets live, ook `@n` niet (404) tot het thema live gaat."""
    source = await api.published_theme(css="a { color: red }")
    bundle = (
        await api.client.get(f"/api/v1/themes/{source['id']}/export", params={"format": "bundle"})
    ).content
    response = await api.client.post(
        "/api/v1/themes/import",
        files={"file": ("x.cssthema.zip", bundle, "application/zip")},
        data={"publish": "false"},
    )
    assert response.status_code == 201, response.text
    imported = response.json()
    assert imported["published_version"] is None
    assert imported["latest_version_number"] == 1
    fixed = f"/themes/{imported['slug']}@1.css"
    response = await api.client.get(fixed)
    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "public, max-age=10"

    # Handgemaakt bestand zonder "meteen publiceren": v1 bestaat, maar is niet publiek.
    slug = unique_slug()
    (api.css_dir / f"{slug}.css").write_text("a { color: blue }")
    response = await api.client.post(
        "/api/v1/themes/local-files/import",
        json={"names": [f"{slug}.css"], "publish": False, "archive": False},
    )
    (local,) = response.json()["imported"]
    assert local["published_version"] is None
    assert local["latest_version_number"] == 1
    assert (await api.client.get(f"/themes/{slug}@1.css")).status_code == 404

    # Eenmaal gepubliceerd is de geschiedenis wel publiek (en onveranderlijk).
    await api.publish(imported)
    response = await api.client.get(fixed)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == IMMUTABLE
    assert response.text.endswith("a{color:red}")


async def test_conditional_requests(api: Api) -> None:
    theme = await api.published_theme()
    path = f"/{theme['slug']}.css"
    first = await api.client.get(path)
    etag = first.headers["ETag"]
    for value in (etag, f"W/{etag}", f'"sha256-0000000000000000", {etag}', "*"):
        response = await api.client.get(path, headers={"If-None-Match": value})
        assert response.status_code == 304, value
        assert response.content == b""
        assert response.headers["ETag"] == etag
        assert response.headers["Cache-Control"] == LATEST
    response = await api.client.get(path, headers={"If-None-Match": '"sha256-0000000000000000"'})
    assert response.status_code == 200

    future = format_datetime(datetime.now(UTC) + timedelta(hours=1), usegmt=True)
    past = format_datetime(datetime.now(UTC) - timedelta(days=1), usegmt=True)
    response = await api.client.get(
        path, headers={"If-Modified-Since": first.headers["Last-Modified"]}
    )
    assert response.status_code == 304
    response = await api.client.get(path, headers={"If-Modified-Since": past})
    assert response.status_code == 200
    response = await api.client.get(path, headers={"If-Modified-Since": "geen datum"})
    assert response.status_code == 200
    # If-None-Match gaat voor op If-Modified-Since
    response = await api.client.get(
        path, headers={"If-None-Match": '"sha256-0000000000000000"', "If-Modified-Since": future}
    )
    assert response.status_code == 200


async def test_not_found(api: Api) -> None:
    slug = unique_slug()
    response = await api.client.get(f"/{slug}.css")
    assert response.status_code == 404
    assert response.text == f'/* cssthema: theme "{slug}" not found */\n'
    assert response.headers["Content-Type"] == "text/css; charset=utf-8"
    assert response.headers["Cache-Control"] == "public, max-age=10"
    assert response.headers["Access-Control-Allow-Origin"] == "*"

    for path in ("/Bad_Slug.css", "/themes/a@0.css", "/themes/ab@x.css", "/-ab.css"):
        response = await api.client.get(path)
        assert response.status_code == 404, path
        assert response.text == "/* cssthema: not found */\n"

    # nooit gepubliceerd
    theme = await api.create_theme(css="a{}")
    assert (await api.client.get(f"/{theme['slug']}.css")).status_code == 404


async def test_head(api: Api) -> None:
    theme = await api.published_theme()
    get = await api.client.get(f"/{theme['slug']}.css")
    head = await api.client.head(f"/{theme['slug']}.css")
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["Content-Length"] == str(len(get.content))
    assert head.headers["ETag"] == get.headers["ETag"]
    head = await api.client.head(f"/themes/{theme['slug']}@1.css")
    assert head.status_code == 200
    head = await api.client.head(f"/{unique_slug()}.css")
    assert head.status_code == 404
    assert head.content == b""


async def test_redis_cache_is_used_and_invalidated(api: Api) -> None:
    theme = await api.published_theme(css="a { color: red }")
    slug = theme["slug"]
    redis = api.app.state.redis
    assert (await api.client.get(f"/{slug}.css")).status_code == 200
    cached = CachedCss.from_json(await redis.get(latest_key(slug)))
    assert cached.version_number == 1

    # Wat in de cache staat, wordt geserveerd (geen databasequery nodig).
    await redis.set(
        latest_key(slug), CachedCss(1, cached.sha256, cached.published_at, "x{}").to_json()
    )
    assert (await api.client.get(f"/{slug}.css")).text == "x{}"

    await api.save_draft(theme, "a { color: blue }")
    await api.publish(theme)
    assert await redis.get(latest_key(slug)) is None
    response = await api.client.get(f"/{slug}.css")
    assert response.text.endswith("a{color:blue}")
    assert response.headers["X-Cssthema-Version"] == "2"


async def test_unreadable_cache_entry_falls_back_to_the_database(api: Api) -> None:
    theme = await api.published_theme(css="a { color: red }")
    await api.app.state.redis.set(latest_key(theme["slug"]), b"{kapot")
    response = await api.client.get(f"/{theme['slug']}.css")
    assert response.status_code == 200
    assert response.text.endswith("a{color:red}")


async def test_stale_reader_does_not_overwrite_an_invalidation(api: Api) -> None:
    """Een lezer die vóór een publicatie las, mag na de invalidatie niets cachen."""
    theme = await api.published_theme()
    slug = theme["slug"]
    delivery: CssDelivery = api.app.state.css_delivery
    redis = api.app.state.redis
    generation = await redis.get(generation_key(slug))
    old = await delivery.latest(slug)
    assert old is not None
    await delivery.invalidate([slug])
    await delivery._store(latest_key(slug), slug, generation, old, 60)
    assert await redis.get(latest_key(slug)) is None


async def test_refresh_failures_do_not_break_publishing(api: Api) -> None:
    api.refresh_status = 502
    theme = await api.published_theme()
    assert (await api.client.get(f"/{theme['slug']}.css")).status_code == 200


async def test_rate_limited_refresh_is_retried(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(css_delivery, "REFRESH_RETRY_DELAY_S", 0)
    theme = await api.create_theme(css="a{}")
    api.refresh_calls.clear()
    api.refresh_statuses = [429, 429]
    await api.publish(theme)
    calls = await api.refreshed()
    # Elke URL kreeg eerst een 429 en lukte bij de tweede poging.
    assert Counter(calls) == {f"/{theme['slug']}.css": 2, f"/themes/{theme['slug']}.css": 2}


async def test_fixed_versions_are_refreshed_in_the_background(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(css_delivery, "REFRESH_RETRY_DELAY_S", 0)
    delivery: CssDelivery = api.app.state.css_delivery
    slug = unique_slug()
    api.refresh_statuses = [429] * 5
    await delivery.invalidate([slug], fixed_versions={slug: range(1, 31)})
    calls = await api.refreshed()
    fixed = {path for path in calls if "@" in path}
    assert fixed == {f"/themes/{slug}@{n}.css" for n in range(1, 31)}
    assert len(calls) == 32 + 5  # elke 429 één keer opnieuw


@pytest.fixture
async def broken_redis_client(
    settings: Settings, engine: AsyncEngine, tmp_path: Path
) -> AsyncIterator[AsyncClient]:
    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nginx is weg", request=request)

    app = create_app(
        settings.model_copy(
            update={"redis_url": "redis://127.0.0.1:1/0", "css_files_dir": tmp_path}
        ),
        css_refresh_transport=httpx.MockTransport(unreachable),
    )
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            yield client
    finally:
        await cleanup_test_themes(engine)


async def test_without_redis_and_nginx_everything_still_works(
    broken_redis_client: AsyncClient,
) -> None:
    client = broken_redis_client
    slug = unique_slug()
    theme = (
        await client.post("/api/v1/themes", json={"name": "x", "slug": slug, "css": "a{}"})
    ).json()
    async with asyncio.timeout(10):
        response = await client.post(
            f"/api/v1/themes/{theme['id']}/publish", json={"expected_lock_version": 1}
        )
        assert response.status_code == 201
        response = await client.get(f"/{slug}.css")
    assert response.status_code == 200
    assert response.text.endswith("a{}")
