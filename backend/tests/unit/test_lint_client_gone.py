"""`client_gone` van de lint-route tegen een echte uvicorn.

Na een grote body pauzeert uvicorn het lezen van de socket; `request.is_disconnected()` alleen
zag een afgebroken editor daardoor niet, en een oude lint liep toch (review PERF-2).
"""

import asyncio
import socket
import time

import uvicorn
from fastapi import FastAPI, Request
from pydantic import BaseModel

from cssthema.api.v1.themes import client_gone

# Zoals algemeen.css (470 KB): ruim boven de 64 KB waarboven uvicorn het lezen pauzeert.
CSS_BYTES = 480_000
TAIL = 200 * 1024


class LintBody(BaseModel):
    css: str


def send_lint(port: int) -> socket.socket:
    """Verstuur een lint-request; het laatste stuk (> 64 KB) komt apart, zoals over een netwerk.

    Dat laatste stuk laat uvicorn het lezen pauzeren terwijl de body al compleet is: precies de
    toestand waarin een gesloten verbinding onopgemerkt bleef.
    """
    body = b'{"css":"' + b"a" * CSS_BYTES + b'"}'
    head = (
        b"POST /lint HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n"
        b"Content-Length: %d\r\n\r\n" % len(body)
    )
    sock = socket.create_connection(("127.0.0.1", port))
    sock.sendall(head)
    sock.sendall(body[:-TAIL])
    time.sleep(0.05)
    sock.sendall(body[-TAIL:])
    return sock


async def test_client_gone_sees_an_aborted_editor_under_uvicorn() -> None:
    app = FastAPI()
    arrived = asyncio.Event()
    closed = asyncio.Event()
    checked = asyncio.Event()
    seen: list[bool] = []

    @app.post("/lint")
    async def lint(request: Request, data: LintBody) -> dict[str, int]:
        arrived.set()
        await closed.wait()  # zoals het wachten op de lint-semaphore
        seen.append(await client_gone(request))
        checked.set()
        return {"bytes": len(data.css)}

    config = uvicorn.Config(
        app,
        loop="none",
        http="httptools",
        lifespan="off",
        log_config=None,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    # Zelf luisteren: verbindingen wachten dan in de backlog tot uvicorn klaar is.
    listener = socket.create_server(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        for _ in range(3):
            for event in (arrived, closed, checked):
                event.clear()
            sock = await asyncio.to_thread(send_lint, port)
            await asyncio.wait_for(arrived.wait(), 5)
            sock.close()  # de editor brak af: er kwam nieuwere tekst
            await asyncio.sleep(0.05)
            closed.set()
            await asyncio.wait_for(checked.wait(), 5)
    finally:
        server.should_exit = True
        await asyncio.wait_for(serving, 5)
    assert seen == [True, True, True]
