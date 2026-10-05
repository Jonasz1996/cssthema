"""Applicatie-instellingen uit omgevingsvariabelen (12-factor)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
