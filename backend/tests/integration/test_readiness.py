from httpx import ASGITransport, AsyncClient

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
    assert response.json() == {"status": "ok", "checks": {"database": "ok", "redis": "ok"}}


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
    assert response.json()["checks"] == {"database": "ok", "redis": "error"}
