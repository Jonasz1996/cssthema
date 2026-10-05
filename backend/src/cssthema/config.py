"""Applicatie-instellingen uit omgevingsvariabelen (12-factor)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "production"
    public_base_url: str = "http://localhost:8080"
    log_level: str = "INFO"
    log_json: bool = True

    database_url: PostgresDsn = Field(
        default=PostgresDsn("postgresql+asyncpg://cssthema:cssthema@localhost:5432/cssthema")
    )
    database_pool_size: int = 10
    redis_url: RedisDsn = Field(default=RedisDsn("redis://localhost:6379/0"))

    secret_key: SecretStr = SecretStr("change-me")
    encryption_key: SecretStr | None = None

    run_migrations_on_start: bool = True

    @property
    def is_development(self) -> bool:
        return self.environment == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
