import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from cssthema.config import Settings
from cssthema.db.session import create_engine
from cssthema.main import create_app
from tests.integration.api_helpers import Api

if not os.environ.get("DATABASE_URL"):
    pytest.skip("DATABASE_URL niet gezet (integratietests)", allow_module_level=True)

_HERE = Path(__file__).parent


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    # `pytestmark` werkt niet in een conftest; markeer alles onder deze map expliciet.
    for item in items:
        if item.path.is_relative_to(_HERE):
            item.add_marker(pytest.mark.integration)


@pytest.fixture(scope="session")
async def engine(settings: Settings) -> AsyncIterator[AsyncEngine]:
    engine = create_engine(settings)
    yield engine
    await engine.dispose()


@pytest.fixture
async def session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Sessie binnen een transactie die na de test wordt teruggedraaid.

    Verwacht een database waarop `alembic upgrade head` al gedraaid heeft.
    """
    async with engine.connect() as conn:
        trans = await conn.begin()
        maker = async_sessionmaker(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        async with maker() as s:
            yield s
        await trans.rollback()


# --- API-tests ------------------------------------------------------------------------------


@pytest.fixture
async def api(settings: Settings, engine: AsyncEngine, tmp_path: Path) -> AsyncIterator[Api]:
    css_dir = tmp_path / "css-files"
    css_dir.mkdir()
    state = Api(client=None, app=None, css_dir=css_dir)  # type: ignore[arg-type]

    def refresh(request: httpx.Request) -> httpx.Response:
        state.refresh_calls.append(request.url.path)
        if state.refresh_statuses:
            return httpx.Response(state.refresh_statuses.pop(0))
        return httpx.Response(state.refresh_status)

    app = create_app(
        settings.model_copy(
            update={"css_files_dir": css_dir, "public_base_url": "https://css.example.be"}
        ),
        css_refresh_transport=httpx.MockTransport(refresh),
    )
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            state.client = client
            state.app = app
            yield state
    finally:
        await cleanup_test_themes(engine)


async def cleanup_test_themes(engine: AsyncEngine) -> None:
    # Versies en redirects verdwijnen mee (ON DELETE CASCADE); audit-rijen blijven
    # (append-only) en verwijzen niet naar thema's.
    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM themes WHERE slug LIKE 'it-%'"))
