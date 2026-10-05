"""Applicatie-instellingen uit omgevingsvariabelen (12-factor)."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, PostgresDsn, RedisDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import URL

LogLevel = Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "production"
    public_base_url: str = "http://localhost:8080"
    log_level: LogLevel = "INFO"
    log_json: bool = True

    # Ofwel een volledige DATABASE_URL, ofwel de losse POSTGRES_*-delen (zoals docker
    # compose ze doorgeeft). Uit de delen bouwen we de URL zelf, met het wachtwoord
    # URL-gecodeerd, zodat tekens als / # ? % in POSTGRES_PASSWORD geen probleem zijn.
    database_url: PostgresDsn | None = None
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "cssthema"
    postgres_password: SecretStr = SecretStr("cssthema")
    postgres_db: str = "cssthema"
    database_pool_size: int = 10
    redis_url: RedisDsn = Field(default=RedisDsn("redis://localhost:6379/0"))

    secret_key: SecretStr = SecretStr("change-me")
    encryption_key: SecretStr | None = None

    # CSS-levering en -validatie (fase 1). De standaardwaarden werken zonder extra
    # configuratie voor de installatie zonder Docker (deploy/debian); docker compose
    # zet CSS_REFRESH_URL op de nginx-container.
    css_max_bytes: int = Field(default=512 * 1024, gt=0)
    # Hosts die url()/@import in thema's mogen gebruiken (security-lint). Via de
    # omgeving komma-gescheiden: CSS_URL_ALLOWLIST=fonts.googleapis.com,fonts.gstatic.com
    # De host van PUBLIC_BASE_URL is altijd toegestaan (zie css_allowed_hosts).
    css_url_allowlist: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["fonts.googleapis.com", "fonts.gstatic.com"]
    )
    # Interne refresh-server van nginx (spike S3). Leeg = geen refresh, alleen de
    # Redis-cache wordt dan geleegd (nginx is hooguit 60 s achter).
    css_refresh_url: str = "http://127.0.0.1:8081"
    # Handgemaakte CSS-bestanden die nginx vóór de api serveert (installatie zonder
    # Docker). Bestaat de map niet (Docker), dan zijn er gewoon geen lokale bestanden.
    css_files_dir: Path = Path("/var/lib/cssthema/css-files")

    @field_validator("css_url_allowlist", mode="before")
    @classmethod
    def _split_allowlist(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, list | tuple):
            hosts = (str(host).strip().lower().rstrip(".") for host in value)
            return list(dict.fromkeys(host for host in hosts if host))
        return value

    @field_validator("css_refresh_url")
    @classmethod
    def _strip_refresh_url(cls, value: str) -> str:
        return value.strip().rstrip("/")

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _assemble_database_url(self) -> "Settings":
        if self.database_url is None:
            url = URL.create(
                "postgresql+asyncpg",
                username=self.postgres_user,
                password=self.postgres_password.get_secret_value(),
                host=self.postgres_host,
                port=self.postgres_port,
                database=self.postgres_db,
            )
            self.database_url = PostgresDsn(url.render_as_string(hide_password=False))
        return self

    @property
    def is_development(self) -> bool:
        return self.environment == "development"

    @property
    def css_allowed_hosts(self) -> frozenset[str]:
        """Allowlist voor de security-lint, aangevuld met de eigen host."""
        hosts = set(self.css_url_allowlist)
        own_host = urlsplit(self.public_base_url).hostname
        if own_host:
            hosts.add(own_host.lower())
        return frozenset(hosts)

    @property
    def public_base(self) -> str:
        """PUBLIC_BASE_URL zonder afsluitende slash, voor absolute CSS-URL's."""
        return self.public_base_url.rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
