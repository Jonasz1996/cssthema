import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from cssthema.api import health
from cssthema.config import Settings
from cssthema.main import create_app


async def test_readyz_checks_database_and_redis(settings: Settings) -> None:
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=transport, base_url="http://test") as c,
    ):
        response = await c.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "checks": {"database": "ok", "database_encoding": "ok", "redis": "ok"},
    }


async def test_readyz_reports_unavailable_redis(settings: Settings) -> None:
    broken = settings.model_copy(update={"redis_url": "redis://127.0.0.1:1/0"})
    app = create_app(broken)
    transport = ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=transport, base_url="http://test") as c,
    ):
        response = await c.get("/readyz")
    assert response.status_code == 503
    assert response.json()["checks"] == {
        "database": "ok",
        "database_encoding": "ok",
        "redis": "error",
    }


async def test_readyz_reports_hanging_redis(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Redis die de verbinding aanneemt maar nooit antwoordt: 503, geen hangende request."""

    async def never_answer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await asyncio.sleep(3600)

    server = await asyncio.start_server(never_answer, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    monkeypatch.setattr(health, "PROBE_TIMEOUT_S", 0.3)
    hanging = settings.model_copy(update={"redis_url": f"redis://127.0.0.1:{port}/0"})
    app = create_app(hanging)
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c,
        ):
            async with asyncio.timeout(5):
                response = await c.get("/readyz")
    finally:
        server.close()
    assert response.status_code == 503
    assert response.json()["checks"] == {
        "database": "ok",
        "database_encoding": "ok",
        "redis": "error",
    }
