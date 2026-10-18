"""arq-worker: asynchrone jobs (snapshots, crawls, screenshots, AI) vanaf fase 2.

Start met: `arq cssthema.worker.WorkerSettings`
"""

from typing import Any, ClassVar

from arq import cron
from arq.connections import RedisSettings
from redis.asyncio import Redis

from cssthema import __version__
from cssthema.config import get_settings
from cssthema.db.session import create_engine, create_sessionmaker
from cssthema.logging import configure_logging, get_logger
from cssthema.services import host_health

log = get_logger(__name__)


async def ping(ctx: dict[str, Any]) -> str:
    """Rooktest-job: bevestigt dat de worker jobs oppakt."""
    return "pong"


async def check_hosts(ctx: dict[str, Any]) -> int:
    """Dagelijkse controle van alle hosts (stappenplan C3); ook via het dashboard te starten."""
    return await host_health.run_check(ctx["sessionmaker"], ctx["app_redis"], ctx["settings"])


async def startup(ctx: dict[str, Any]) -> None:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.log_json)
    ctx["settings"] = settings
    ctx["engine"] = create_engine(settings)
    ctx["sessionmaker"] = create_sessionmaker(ctx["engine"])
    ctx["app_redis"] = Redis.from_url(str(settings.redis_url), socket_connect_timeout=2)
    log.info("worker_startup", version=__version__)


async def shutdown(ctx: dict[str, Any]) -> None:
    await ctx["app_redis"].aclose()
    await ctx["engine"].dispose()
    log.info("worker_shutdown")


class WorkerSettings:
    functions: ClassVar[list[Any]] = [ping, check_hosts]
    cron_jobs: ClassVar[list[Any]] = [
        cron(check_hosts, hour={6}, minute={15}, run_at_startup=False)
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(str(get_settings().redis_url))
    max_jobs = 10
    job_timeout = 900
    health_check_interval = 30
