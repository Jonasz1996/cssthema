"""FastAPI app factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis

from cssthema import __version__
from cssthema.api import health, public
from cssthema.api import v1 as api_v1
from cssthema.api.errors import Problem, install_error_handlers
from cssthema.api.middleware import RequestContextMiddleware
from cssthema.config import Settings, get_settings
from cssthema.db.session import create_engine, create_sessionmaker
from cssthema.logging import configure_logging, get_logger
from cssthema.services.css_delivery import REFRESH_TIMEOUT_S, CssDelivery

log = get_logger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    css_refresh_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Bouwt de app; `css_refresh_transport` vervangt in tests de nginx-refresh-calls."""
    settings = settings or get_settings()
    configure_logging(settings.log_level, json=settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings)
        app.state.engine = engine
        app.state.sessionmaker = create_sessionmaker(engine)
        # Alleen een connect-timeout: een socket_timeout zou later ook blokkerende
        # reads (SSE voor job-events) afbreken. Health-probes hebben hun eigen timeout.
        app.state.redis = Redis.from_url(str(settings.redis_url), socket_connect_timeout=2)
        # Refresh-client voor de nginx-cache (spike S3); trust_env=False: nooit via een
        # HTTP(S)_PROXY uit de omgeving naar de interne refresh-server.
        refresh_http = httpx.AsyncClient(
            timeout=REFRESH_TIMEOUT_S, trust_env=False, transport=css_refresh_transport
        )
        app.state.css_delivery = CssDelivery(
            app.state.redis, refresh_http, settings.css_refresh_url, app.state.sessionmaker
        )
        log.info("startup", version=__version__, environment=settings.environment)
        try:
            yield
        finally:
            await app.state.css_delivery.aclose()
            await refresh_http.aclose()
            await app.state.redis.aclose()
            await engine.dispose()

    app = FastAPI(
        title="cssthema API",
        version=__version__,
        description="Central CSS Theme Builder — zie docs/05-api-specificatie.md",
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        lifespan=lifespan,
        responses={500: {"model": Problem, "description": "Interne fout"}},
    )
    app.state.settings = settings
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(api_v1.router)
    # Als laatste: `/{slug}.css` mag geen andere route overschaduwen.
    app.include_router(public.router)
    return app


app = create_app()
