import json
import logging
import logging.config

import pytest
from uvicorn.config import LOGGING_CONFIG

from cssthema.logging import configure_logging, get_logger


def _json_lines(out: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def test_uvicorn_logs_go_through_structlog_once(capsys: pytest.CaptureFixture[str]) -> None:
    # Uvicorn configureert zijn loggers vóór de app geïmporteerd wordt; wij nemen ze daarna over.
    logging.config.dictConfig(LOGGING_CONFIG)
    configure_logging("info", json=True)

    logging.getLogger("uvicorn.error").info("Started server process")
    logging.getLogger("uvicorn.access").info("dubbele access-regel")
    logging.getLogger("arq.worker").info("Starting worker")
    get_logger("cssthema.test").info("eigen_event", sleutel="waarde")

    captured = capsys.readouterr()
    lines = _json_lines(captured.out)
    assert [line["event"] for line in lines] == [
        "Started server process",
        "Starting worker",
        "eigen_event",
    ]
    assert lines[0]["logger"] == "uvicorn.error"
    assert lines[2]["sleutel"] == "waarde"
    assert captured.err == ""
    # Uvicorn logt alleen access-regels als deze logger (via propagate) een handler heeft.
    assert not logging.getLogger("uvicorn.access").hasHandlers()


def test_debug_is_filtered_at_info(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO", json=True)
    get_logger("cssthema.test").debug("onzichtbaar")
    assert capsys.readouterr().out == ""
