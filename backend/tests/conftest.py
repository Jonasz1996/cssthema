import os

import pytest

from cssthema.config import Settings


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(
        environment="test",
        log_json=False,
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql+asyncpg://cssthema:cssthema@localhost:5432/cssthema"
        ),
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    )
