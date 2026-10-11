"""Gezondheid per proxy host (stappenplan C3).

Drie bronnen, samen op de Hosts-pagina:

- **Laatst geladen**: `/host/<host>.css` noteert in Redis wanneer een browser hem ophaalde
  (via de nginx-cache hoogstens ± 1 keer per minuut). Zo zie je welke hosts de regel echt
  gebruiken, ook hosts zonder eigen koppeling (die `*` volgen).
- **Ontbrekende onderdelen**: thema's of scripts in een koppeling die niet (meer) bestaan.
- **Controle**: cssthema haalt `https://<host>/` op en kijkt of de regel in de HTML staat en
  of de CSP van de app het CSS-domein toelaat. Dagelijks via de worker en met de knop
  *Alles controleren*; alleen hosts met een eigen koppeling (nooit namen van buitenaf).
"""

import asyncio
import inspect
import json
import time
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from cssthema import __version__
from cssthema.config import Settings
from cssthema.domain import host_health as domain
from cssthema.domain.hosts import DEFAULT_HOST, HOSTNAME_RE
from cssthema.logging import get_logger
from cssthema.repositories import hosts as host_repo

log = get_logger(__name__)

SEEN_KEY = "hosts:seen"
MAX_SEEN = 2000
CHECK_KEY = "hosts:check"
CHECK_META_KEY = "hosts:check:meta"
CHECK_LOCK_KEY = "hosts:check:lock"
CHECK_LOCK_TTL_S = 600
CHECK_CONCURRENCY = 8
CHECK_TIMEOUT_S = 8.0
MAX_REDIRECTS = 4
MAX_HTML_BYTES = 1024 * 1024
REDIS_TIMEOUT_S = 0.5
# Een header die alleen de nginx-refresh van cssthema zelf meestuurt: die telt niet als geladen.
REFRESH_HEADER = "X-Cssthema-Refresh"


async def _r[T](value: Awaitable[T] | T) -> T:
    """redis-py typeert hash-commando's als `Awaitable[T] | T`; async is het altijd het eerste."""
    return await value if inspect.isawaitable(value) else value


# --- laatst geladen -------------------------------------------------------------------------


async def record_seen(redis: Redis, hostname: str) -> None:
    """Noteert dat een browser `/host/<hostname>.css` ophaalde; fouten negeren we."""
    if hostname == DEFAULT_HOST or not HOSTNAME_RE.fullmatch(hostname):
        return
    try:
        async with asyncio.timeout(REDIS_TIMEOUT_S):
            # Iedereen kan /host/<verzonnen naam>.css opvragen: nieuwe namen alleen tot MAX_SEEN.
            is_new = not await _r(redis.hexists(SEEN_KEY, hostname))
            if is_new and await _r(redis.hlen(SEEN_KEY)) >= MAX_SEEN:
                return
            await _r(redis.hset(SEEN_KEY, hostname, str(int(time.time()))))
    except Exception as exc:
        log.debug("host_seen_record_failed", hostname=hostname, error=repr(exc))


async def seen(redis: Redis) -> dict[str, datetime]:
    try:
        async with asyncio.timeout(REDIS_TIMEOUT_S * 4):
            raw = await _r(redis.hgetall(SEEN_KEY))
    except Exception as exc:
        log.warning("host_seen_read_failed", error=repr(exc))
        return {}
    result = {}
    for key, value in raw.items():
        try:
            name = key.decode() if isinstance(key, bytes) else str(key)
            result[name] = datetime.fromtimestamp(int(value), UTC)
        except (ValueError, UnicodeDecodeError):
            continue
    return result


async def forget_seen(redis: Redis, hostnames: Iterable[str]) -> None:
    names = list(hostnames)
    if names:
        await _r(redis.hdel(SEEN_KEY, *names))


# --- controle ---------------------------------------------------------------------------------


async def check_results(redis: Redis) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """(resultaat per host, meta met started_at/finished_at/running)."""
    try:
        async with asyncio.timeout(REDIS_TIMEOUT_S * 4):
            raw, meta_raw, running = await asyncio.gather(
                _r(redis.hgetall(CHECK_KEY)),
                redis.get(CHECK_META_KEY),
                redis.exists(CHECK_LOCK_KEY),
            )
    except Exception as exc:
        log.warning("host_check_read_failed", error=repr(exc))
        return {}, {"running": False}
    results: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        try:
            name = key.decode() if isinstance(key, bytes) else str(key)
            results[name] = json.loads(value)
        except (ValueError, UnicodeDecodeError):
            continue
    meta: dict[str, Any] = {}
    if meta_raw:
        try:
            meta = json.loads(meta_raw)
        except ValueError:
            meta = {}
    meta["running"] = bool(running)
    return results, meta


async def run_check(
    sessionmaker: async_sessionmaker[AsyncSession],
    redis: Redis,
    settings: Settings,
    *,
    fetch: Callable[[str], Awaitable[dict[str, Any]]] | None = None,
    lock_held: bool = False,
) -> int:
    """Controleert elke host met een eigen, ingeschakelde koppeling; geeft het aantal terug.

    `fetch` is voor tests (hostnaam → resultaat); standaard een echte HTTP-controle.
    """
    if not lock_held and not await redis.set(CHECK_LOCK_KEY, "1", nx=True, ex=CHECK_LOCK_TTL_S):
        return 0
    started = datetime.now(UTC)
    try:
        async with sessionmaker() as session:
            bindings = await host_repo.list_bindings(session)
        hostnames = [b.hostname for b in bindings if b.enabled and b.hostname != DEFAULT_HOST]
        await redis.set(
            CHECK_META_KEY, json.dumps({"started_at": started.isoformat(), "finished_at": None})
        )
        async with httpx.AsyncClient(
            verify=False,  # noqa: S501 (alleen HTML lezen; interne certificaten mogen)
            follow_redirects=False,
            timeout=CHECK_TIMEOUT_S,
            headers={
                "User-Agent": f"cssthema/{__version__} (gezondheidscheck)",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Encoding": "identity",
            },
        ) as http:
            check = fetch or (lambda name: check_host(http, name, settings.public_base_url))
            semaphore = asyncio.Semaphore(CHECK_CONCURRENCY)

            async def one(name: str) -> tuple[str, dict[str, Any]]:
                async with semaphore:
                    try:
                        return name, await check(name)
                    except Exception as exc:  # nooit de hele controle laten vallen
                        log.warning("host_check_failed", hostname=name, error=repr(exc))
                        verdict = domain.Verdict(
                            domain.Level.ERROR, domain.Code.UNREACHABLE, "Controle mislukt."
                        )
                        return name, _result(verdict, None)

            results = await asyncio.gather(*(one(name) for name in hostnames))
        pipe = redis.pipeline(transaction=True)
        pipe.delete(CHECK_KEY)
        if results:
            pipe.hset(CHECK_KEY, mapping={name: json.dumps(r) for name, r in results})
        pipe.set(
            CHECK_META_KEY,
            json.dumps(
                {"started_at": started.isoformat(), "finished_at": datetime.now(UTC).isoformat()}
            ),
        )
        await pipe.execute()
        log.info("host_check_done", hosts=len(results))
        return len(results)
    finally:
        await redis.delete(CHECK_LOCK_KEY)


async def start_check(
    sessionmaker: async_sessionmaker[AsyncSession],
    redis: Redis,
    settings: Settings,
    tasks: set[asyncio.Task[Any]],
) -> bool:
    """Start de controle op de achtergrond; False als er al een loopt."""
    if not await redis.set(CHECK_LOCK_KEY, "1", nx=True, ex=CHECK_LOCK_TTL_S):
        return False
    task = asyncio.create_task(run_check(sessionmaker, redis, settings, lock_held=True))
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return True


async def check_host(
    http: httpx.AsyncClient, hostname: str, public_base_url: str
) -> dict[str, Any]:
    url = f"https://{hostname}/"
    try:
        for _ in range(MAX_REDIRECTS + 1):
            async with http.stream("GET", url) as response:
                if response.is_redirect:
                    location = response.headers.get("location", "")
                    if not location or domain.is_login_redirect(hostname, urljoin(url, location)):
                        verdict = domain.Verdict(
                            domain.Level.UNKNOWN,
                            domain.Code.LOGIN,
                            "Doorgestuurd naar een login (Authentik): de pagina zelf is niet "
                            "te controleren. Kijk naar 'laatst geladen'.",
                        )
                        return _result(verdict, response.status_code)
                    url = urljoin(url, location)
                    if urlsplit(url).scheme not in ("http", "https"):
                        break
                    continue
                body = await _read_limited(response)
                verdict = domain.classify(
                    hostname,
                    public_base_url,
                    status=response.status_code,
                    content_type=response.headers.get("content-type", ""),
                    csp=response.headers.get("content-security-policy"),
                    html=body,
                )
                return _result(verdict, response.status_code)
        verdict = domain.Verdict(domain.Level.ERROR, domain.Code.HTTP_ERROR, "Te veel redirects.")
        return _result(verdict, None)
    except httpx.HTTPError as exc:
        verdict = domain.Verdict(
            domain.Level.ERROR,
            domain.Code.UNREACHABLE,
            f"Niet bereikbaar vanaf cssthema ({type(exc).__name__}).",
        )
        return _result(verdict, None)


async def _read_limited(response: httpx.Response) -> str:
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        chunks.append(chunk)
        size += len(chunk)
        if size >= MAX_HTML_BYTES:
            break
    return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")


def _result(verdict: domain.Verdict, status: int | None) -> dict[str, Any]:
    data: dict[str, Any] = {k: str(v) for k, v in asdict(verdict).items()}
    data["http_status"] = status
    data["checked_at"] = datetime.now(UTC).isoformat()
    return data
