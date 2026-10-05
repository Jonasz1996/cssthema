import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from cssthema.config import Settings


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("DATABASE_URL", "POSTGRES_HOST", "POSTGRES_PASSWORD", "LOG_LEVEL"):
        monkeypatch.delenv(name, raising=False)


def test_database_url_is_built_from_postgres_parts() -> None:
    password = "ab/cd+ef=#?%x"  # o.a. uitvoer van `openssl rand -base64`
    settings = Settings(_env_file=None, postgres_host="postgres", postgres_password=password)
    url = make_url(str(settings.database_url))
    assert url.drivername == "postgresql+asyncpg"
    assert url.host == "postgres"
    assert url.password == password


def test_explicit_database_url_wins() -> None:
    settings = Settings(
        _env_file=None,
        database_url="postgresql+asyncpg://u:p@db:5433/x",
        postgres_host="genegeerd",
    )
    assert str(settings.database_url) == "postgresql+asyncpg://u:p@db:5433/x"


def test_log_level_is_case_insensitive() -> None:
    assert Settings(_env_file=None, log_level="debug").log_level == "DEBUG"


def test_unknown_log_level_is_rejected() -> None:
    with pytest.raises(ValidationError, match="log_level"):
        Settings(_env_file=None, log_level="verbose")
