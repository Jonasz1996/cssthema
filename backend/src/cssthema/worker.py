"""arq-worker: asynchrone jobs (snapshots, crawls, screenshots, AI) vanaf fase 2.

Start met: `arq cssthema.worker.WorkerSettings`
"""

from typing import Any, ClassVar

from arq.connections import RedisSettings

from cssthema import __version__
from cssthema.config import get_settings
from cssthema.logging import configure_logging, get_logger

log = get_logger(__name__)


async def ping(ctx: dict[str, Any]) -> str:
    """Rooktest-job: bevestigt dat de worker jobs oppakt."""
    return "pong"


async def startup(ctx: dict[str, Any]) -> None:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.log_json)
    log.info("worker_startup", version=__version__)


async def shutdown(ctx: dict[str, Any]) -> None:
    log.info("worker_shutdown")


class WorkerSettings:
    functions: ClassVar[list[Any]] = [ping]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(str(get_settings().redis_url))
    max_jobs = 10
    job_timeout = 120
    health_check_interval = 30
