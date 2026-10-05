import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from cssthema.config import Settings
from cssthema.db.session import create_engine

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
