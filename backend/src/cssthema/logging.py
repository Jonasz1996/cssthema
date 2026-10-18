"""Gestructureerde logging met structlog (JSON in productie, leesbaar in development)."""

import logging
import logging.config
import sys

import structlog

# Loggers die uvicorn en arq zelf configureren (eigen handlers, deels propagate=False).
# We nemen ze over zodat alles als één stroom via structlog naar stdout gaat.
_FOREIGN_LOGGERS = ("uvicorn", "uvicorn.error", "arq")


def configure_logging(level: str = "INFO", *, json: bool = True) -> None:
    level = level.upper()
    shared: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]
    renderer: structlog.types.Processor = (
        structlog.processors.JSONRenderer() if json else structlog.dev.ConsoleRenderer()
    )
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "structlog": {
                    "()": structlog.stdlib.ProcessorFormatter,
                    "processors": [
                        structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                        structlog.processors.format_exc_info,
                        renderer,
                    ],
                    "foreign_pre_chain": shared,
                }
            },
            "handlers": {
                "stdout": {
                    "class": "logging.StreamHandler",
                    "stream": sys.stdout,
                    "formatter": "structlog",
                }
            },
            "root": {"level": level, "handlers": ["stdout"]},
            "loggers": {
                **{
                    name: {"handlers": [], "propagate": True, "level": level}
                    for name in _FOREIGN_LOGGERS
                },
                # De access-log komt uit RequestContextMiddleware (met request_id). Zonder
                # handlers en zonder propagate slaat uvicorn zijn eigen access-log over.
                "uvicorn.access": {"handlers": [], "propagate": False},
            },
        }
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)  # type: ignore[no-any-return]
