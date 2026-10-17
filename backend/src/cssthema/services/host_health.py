"""Gezondheid per proxy host (stappenplan C3).

Drie bronnen, samen op de Hosts-pagina:

- **Laatst geladen**: `/host/<host>.css` noteert in Redis wanneer een browser hem ophaalde
  (via de nginx-cache hoogstens ± 1 keer per minuut). Zo zie je welke hosts de regel echt
  gebruiken, ook hosts zonder eigen koppeling (die `*` volgen).
- **Ontbrekende onderdelen**: thema's of scripts in een koppeling die niet (meer) bestaan.
- **Controle**: cssthema haalt `https://<host>/` op zoals een browser en kijkt of de regel in
  de HTML staat en of de CSP van de app het CSS-domein toelaat. Dagelijks via de worker en met
  de knop *Alles controleren*; hosts met een eigen koppeling en geïmporteerde diensten (nooit
  namen van buitenaf, zie `check_hostnames`).
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

# Sorted sets hostnaam → unix-tijd: alle geladen hosts, en apart die zonder eigen koppeling.
SEEN_KEY = "hosts:last-seen"
SEEN_UNKNOWN_KEY = "hosts:last-seen:unknown"
MAX_SEEN = 2000
SEEN_UNKNOWN_MAX_AGE_S = 30 * 24 * 3600
CHECK_KEY = "hosts:check"
CHECK_META_KEY = "hosts:check:meta"
CHECK_LOCK_KEY = "hosts:check:lock"
CHECK_LOCK_TTL_S = 600
CHECK_CONCURRENCY = 8
CHECK_TIMEOUT_S = 8.0
MAX_REDIRECTS = 4
MAX_HTML_BYTES = 1024 * 1024
# Zoals een browser die een pagina opent: de regel maakt Accept-Encoding alleen leeg bij een
# Accept met text/html, en een app die comprimeert, comprimeert dan ook voor de controle. Geen
# br of zstd: zonder extra pakketten pakt httpx alleen gzip en deflate uit.
CHECK_HEADERS = {
    "User-Agent": f"cssthema/{__version__} (gezondheidscheck)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
}
# Tweede vraag bij een gecomprimeerde pagina zonder thema: zonder compressie (zie check_host).
IDENTITY_HEADERS = {"Accept-Encoding": "identity"}
REDIS_TIMEOUT_S = 0.5
# Een header die alleen de nginx-refresh van cssthema zelf meestuurt: die telt niet als geladen.
REFRESH_HEADER = "X-Cssthema-Refresh"


async def _r[T](value: Awaitable[T] | T) -> T:
    """redis-py typeert hash-commando's als `Awaitable[T] | T`; async is het altijd het eerste."""
    return await value if inspect.isawaitable(value) else value


# --- laatst geladen -------------------------------------------------------------------------


async def record_seen(redis: Redis, hostname: str, *, known: bool = False) -> None:
    """Noteert dat een browser `/host/<hostname>.css` ophaalde; fouten negeren we.

    Iedereen kan /host/<verzonnen naam>.css opvragen. Namen zonder eigen koppeling (`known`
    False) staan daarom ook in een begrensde lijst: is die vol, dan vallen eerst namen ouder
    dan 30 dagen weg, daarna de oudste. Zo vult niemand de lijst blijvend (nieuwe hosts komen
    er altijd bij), en een host met een eigen koppeling valt er nooit uit.
    """
    if hostname == DEFAULT_HOST or not HOSTNAME_RE.fullmatch(hostname):
        return
    now = round(time.time(), 3)  # ms: zo is 'de oudste' ook binnen één seconde duidelijk
    try:
        async with asyncio.timeout(REDIS_TIMEOUT_S):
            pipe = redis.pipeline(transaction=True)
            pipe.zadd(SEEN_KEY, {hostname: now})
            if known:
                pipe.zrem(SEEN_UNKNOWN_KEY, hostname)
            else:
                pipe.zadd(SEEN_UNKNOWN_KEY, {hostname: now})
                pipe.zcard(SEEN_UNKNOWN_KEY)
            results = await pipe.execute()
            if not known and int(results[-1]) > MAX_SEEN:
                await _prune_unknown(redis, now, int(results[-1]))
    except Exception as exc:
        log.debug("host_seen_record_failed", hostname=hostname, error=repr(exc))


async def _prune_unknown(redis: Redis, now: float, count: int) -> None:
    oldest = await _r(redis.zrange(SEEN_UNKNOWN_KEY, 0, count - MAX_SEEN - 1))
    expired = await _r(redis.zrangebyscore(SEEN_UNKNOWN_KEY, "-inf", now - SEEN_UNKNOWN_MAX_AGE_S))
    victims = list(dict.fromkeys([*oldest, *expired]))
    if victims:
        pipe = redis.pipeline(transaction=True)
        pipe.zrem(SEEN_UNKNOWN_KEY, *victims)
        pipe.zrem(SEEN_KEY, *victims)
        await pipe.execute()


async def seen(redis: Redis) -> dict[str, datetime]:
    try:
        async with asyncio.timeout(REDIS_TIMEOUT_S * 4):
            raw = await _r(redis.zrange(SEEN_KEY, 0, -1, withscores=True))
    except Exception as exc:
        log.warning("host_seen_read_failed", error=repr(exc))
        return {}
    result = {}
    for key, value in raw:
        try:
            name = key.decode() if isinstance(key, bytes) else str(key)
            result[name] = datetime.fromtimestamp(int(value), UTC)
        except (ValueError, UnicodeDecodeError):
            continue
    return result


async def forget_seen(redis: Redis, hostnames: Iterable[str]) -> None:
    names = list(hostnames)
    if names:
        pipe = redis.pipeline(transaction=True)
        pipe.zrem(SEEN_KEY, *names)
        pipe.zrem(SEEN_UNKNOWN_KEY, *names)
        await pipe.execute()


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


def check_hostnames(
    bindings: Iterable[tuple[str, bool]], service_hosts: Iterable[str], excluded: Iterable[str]
) -> list[str]:
    """Welke hosts de controle opent: elke eigen, ingeschakelde koppeling, en de hostnamen van
    geïmporteerde diensten zonder eigen koppeling als `*` aan staat (die volgen `*`).

    Nooit namen die alleen uit 'laatst geladen' komen: die kan iedereen verzinnen. Ook nooit
    de hosts die niets krijgen (dashboard, CSS-domein, EXCLUDED_HOSTS).
    """
    enabled = dict(bindings)
    skip = set(excluded)
    names = [name for name, on in enabled.items() if on and name != DEFAULT_HOST]
    if enabled.get(DEFAULT_HOST):
        names += [name for name in service_hosts if name not in enabled]
    return [name for name in dict.fromkeys(names) if name not in skip]


def check_client(*, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """HTTP-client van de controle; `transport` is voor tests."""
    return httpx.AsyncClient(
        verify=False,  # noqa: S501 (alleen HTML lezen; interne certificaten mogen)
        follow_redirects=False,
        timeout=CHECK_TIMEOUT_S,
        headers=CHECK_HEADERS,
        transport=transport,
    )


async def run_check(
    sessionmaker: async_sessionmaker[AsyncSession],
    redis: Redis,
    settings: Settings,
    *,
    fetch: Callable[[str], Awaitable[dict[str, Any]]] | None = None,
    lock_held: bool = False,
) -> int:
    """Controleert de hosts van `check_hostnames`; geeft het aantal terug.

    `fetch` is voor tests (hostnaam → resultaat); standaard een echte HTTP-controle.
    """
    if not lock_held and not await redis.set(CHECK_LOCK_KEY, "1", nx=True, ex=CHECK_LOCK_TTL_S):
        return 0
    started = datetime.now(UTC)
    try:
        async with sessionmaker() as session:
            bindings = await host_repo.list_bindings(session)
            services = await host_repo.service_hostnames(session)
        hostnames = check_hostnames(
            [(b.hostname, b.enabled) for b in bindings], services, settings.never_inject_hosts
        )
        await redis.set(
            CHECK_META_KEY, json.dumps({"started_at": started.isoformat(), "finished_at": None})
        )
        async with check_client() as http:
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
                body = await _read_limited(response)  # httpx pakt gzip/deflate al uit
                encoding = response.headers.get("content-encoding")
                status = response.status_code
                verdict = domain.classify(
                    hostname,
                    public_base_url,
                    status=status,
                    content_type=response.headers.get("content-type", ""),
                    csp=response.headers.get("content-security-policy"),
                    html=body,
                )
            # NPM comprimeert met `gzip on` ook zelf, dus gzip zegt niet wie comprimeerde. Staat
            # het thema er zonder compressie wél, dan was het de app (en de oude regel).
            if (
                verdict.code is domain.Code.NO_RULE
                and domain.is_compressed(encoding)
                and await _theme_without_compression(http, url, hostname, public_base_url)
            ):
                verdict = domain.no_rule_compressed(str(encoding))
                return _result(verdict, status, content_encoding=encoding)
            return _result(verdict, status)
        verdict = domain.Verdict(domain.Level.ERROR, domain.Code.HTTP_ERROR, "Te veel redirects.")
        return _result(verdict, None)
    except httpx.HTTPError as exc:
        verdict = domain.Verdict(
            domain.Level.ERROR,
            domain.Code.UNREACHABLE,
            f"Niet bereikbaar vanaf cssthema ({type(exc).__name__}).",
        )
        return _result(verdict, None)


async def _theme_without_compression(
    http: httpx.AsyncClient, url: str, hostname: str, public_base_url: str
) -> bool:
    try:
        async with http.stream("GET", url, headers=IDENTITY_HEADERS) as response:
            content_type = response.headers.get("content-type", "").lower()
            if response.is_redirect or "html" not in content_type:
                return False
            return domain.has_theme(hostname, public_base_url, await _read_limited(response))
    except httpx.HTTPError:
        return False


async def _read_limited(response: httpx.Response) -> str:
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        chunks.append(chunk)
        size += len(chunk)
        if size >= MAX_HTML_BYTES:
            break
    return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")


def _result(
    verdict: domain.Verdict, status: int | None, *, content_encoding: str | None = None
) -> dict[str, Any]:
    data: dict[str, Any] = {k: str(v) for k, v in asdict(verdict).items()}
    data["http_status"] = status
    data["checked_at"] = datetime.now(UTC).isoformat()
    data["content_encoding"] = content_encoding or None
    return data
