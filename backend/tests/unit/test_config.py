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


def test_css_defaults_work_without_extra_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("CSS_MAX_BYTES", "CSS_URL_ALLOWLIST", "CSS_REFRESH_URL", "CSS_FILES_DIR"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.css_max_bytes == 1024 * 1024
    assert settings.css_url_allowlist == ["fonts.googleapis.com", "fonts.gstatic.com"]
    assert settings.css_refresh_url == "http://127.0.0.1:8081"
    assert str(settings.css_files_dir) == "/var/lib/cssthema/css-files"


def test_css_url_allowlist_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "CSS_URL_ALLOWLIST", " Fonts.Example.com , ,cdn.example.be.,fonts.example.com"
    )
    settings = Settings(_env_file=None, public_base_url="https://CSS.jbogaert.be/")
    assert settings.css_url_allowlist == ["fonts.example.com", "cdn.example.be"]
    assert settings.css_allowed_hosts == frozenset(
        {"fonts.example.com", "cdn.example.be", "css.jbogaert.be"}
    )
    assert settings.public_base == "https://CSS.jbogaert.be"


def test_empty_refresh_url_disables_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CSS_REFRESH_URL", " http://nginx:8081/ ")
    assert Settings(_env_file=None).css_refresh_url == "http://nginx:8081"
    monkeypatch.setenv("CSS_REFRESH_URL", "")
    assert Settings(_env_file=None).css_refresh_url == ""


def test_css_max_bytes_must_be_positive() -> None:
    with pytest.raises(ValidationError, match="css_max_bytes"):
        Settings(_env_file=None, css_max_bytes=0)
