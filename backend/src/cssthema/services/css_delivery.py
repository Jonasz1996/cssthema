"""Publieke CSS: Redis-cache vóór de database, en verversen van de nginx-cache.

Leespad (docs/02 § 3.3): `css:<slug>` (TTL 5 min) of `css:<slug>@<n>` (TTL 24 u) in Redis,
anders de database. Een Redis-fout is nooit een 500: dan lezen we gewoon de database.

Race tussen lezen en invalideren: een lezer die net vóór een publicatie de oude versie
uit de database haalt, mag die niet ná de invalidatie in de cache zetten (anders blijft
de oude CSS een uur staan). Daarom houdt elke slug een generatieteller `css:gen:<slug>`
bij die `invalidate` verhoogt; de lezer schrijft alleen als de teller niet veranderd is
sinds hij de cache las (atomair in een Lua-script).

Na een wijziging (publiceren, rollback, verwijderen, herstellen, slug-wijziging, import
met publicatie) roept de servicelaag `invalidate(slugs)` aan, na de commit: Redis DEL en
een best-effort GET op de interne refresh-server van nginx (spike S3), die de
cache-entry overschrijft. Fouten worden alleen gelogd.

nginx bewaart een vaste versie (`/themes/<slug>@<n>.css`) zo lang als de api zegt
(`immutable`, een jaar); daarom ververst de api bij verwijderen en hernoemen ook elke
`@n`-URL, anders blijft een verwijderd thema via die URL's bereikbaar.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime

import httpx
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from cssthema.logging import get_logger
from cssthema.repositories import hosts as host_repo
from cssthema.repositories import themes as theme_repo
from cssthema.repositories.themes import PublicCssRow

log = get_logger(__name__)

# Kort, zodat een gemiste invalidatie (Redis even weg) hooguit 5 minuten oude CSS geeft.
LATEST_TTL_S = 300
FIXED_TTL_S = 24 * 3600
GENERATION_TTL_S = 7 * 24 * 3600
INVALIDATE_ATTEMPTS = 3
INVALIDATE_RETRY_S = 0.2
REDIS_TIMEOUT_S = 0.5
REFRESH_TIMEOUT_S = 1.0
# De refresh-server van nginx laat 10 r/s toe (burst 20) en antwoordt daarboven 429:
# dan even wachten en opnieuw. Vaste versies (`@n`, soms tientallen) gaan op de
# achtergrond met een paar tegelijk, zodat verwijderen of hernoemen niet blijft hangen.
REFRESH_ATTEMPTS = 4
REFRESH_RETRY_DELAY_S = 0.25
REFRESH_CONCURRENCY = 4

# KEYS[1] = cache-sleutel, KEYS[2] = generatieteller; ARGV = generatie bij het lezen
# ("" als er geen teller was), waarde, TTL.
_SET_IF_GENERATION = """
local current = redis.call('GET', KEYS[2])
if (current or '') == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
    return 1
end
return 0
"""


@dataclass(frozen=True, slots=True)
class CachedCss:
    version_number: int
    sha256: bytes
    published_at: datetime
    css: str

    def to_json(self) -> str:
        return json.dumps(
            {
                "version_number": self.version_number,
                "sha256": self.sha256.hex(),
                "published_at": self.published_at.isoformat(),
                "css": self.css,
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_json(cls, raw: bytes | str) -> "CachedCss":
        data = json.loads(raw)
        return cls(
            version_number=int(data["version_number"]),
            sha256=bytes.fromhex(data["sha256"]),
            published_at=datetime.fromisoformat(data["published_at"]),
            css=str(data["css"]),
        )

    @classmethod
    def from_row(cls, row: PublicCssRow) -> "CachedCss":
        return cls(row.version_number, bytes(row.sha256), row.published_at, row.css)


@dataclass(frozen=True, slots=True)
class HostBindingView:
    hostname: str
    styles: list[str]
    scripts: list[str]
    enabled: bool


def latest_key(slug: str) -> str:
    return f"css:{slug}"


def fixed_key(slug: str, number: int) -> str:
    return f"css:{slug}@{number}"


def generation_key(slug: str) -> str:
    return f"css:gen:{slug}"


def refresh_paths(slug: str, fixed_versions: Iterable[int] = ()) -> list[str]:
    """De publieke paden van een slug die nginx cachet."""
    return [f"/{slug}.css", f"/themes/{slug}.css", *fixed_refresh_paths(slug, fixed_versions)]


def host_refresh_paths(hostname: str) -> list[str]:
    return [f"/host/{hostname}.css", f"/host/{hostname}.js"]


def fixed_refresh_paths(slug: str, fixed_versions: Iterable[int]) -> list[str]:
    return [f"/themes/{slug}@{number}.css" for number in sorted(set(fixed_versions))]


class CssDelivery:
    def __init__(
        self,
        redis: Redis,
        http: httpx.AsyncClient | None,
        refresh_url: str,
        sessionmaker: async_sessionmaker[AsyncSession],
    ) -> None:
        self._redis = redis
        self._http = http
        self._refresh_url = refresh_url.rstrip("/")
        self._sessionmaker = sessionmaker
        self._set_if_generation = redis.register_script(_SET_IF_GENERATION)
        self._background: set[asyncio.Task[None]] = set()

    # --- lezen ------------------------------------------------------------------------

    async def latest(self, slug: str) -> CachedCss | None:
        """Gepubliceerde versie van een actief thema, of None."""
        return await self._cached(
            latest_key(slug), slug, LATEST_TTL_S, lambda s: theme_repo.published_css(s, slug)
        )

    async def fixed(self, slug: str, number: int) -> CachedCss | None:
        """Vaste versie `@n` van een actief thema, of None."""
        return await self._cached(
            fixed_key(slug, number),
            slug,
            FIXED_TTL_S,
            lambda s: theme_repo.fixed_version_css(s, slug, number),
        )

    async def redirect_target(self, slug: str) -> str | None:
        """Nieuwe slug als `slug` een oude slug is (< 90 dagen); niet gecachet in Redis.

        Alleen opgevraagd als er geen gepubliceerd thema met die slug is; nginx cachet de 301.
        """
        async with self._sessionmaker() as session:
            return await theme_repo.redirect_target_slug(
                session, slug, theme_repo.redirect_cutoff()
            )

    async def _cached(
        self,
        key: str,
        slug: str,
        ttl: int,
        load: Callable[[AsyncSession], Awaitable[PublicCssRow | None]],
    ) -> CachedCss | None:
        generation: bytes | None = None
        cache_ok = True
        try:
            async with asyncio.timeout(REDIS_TIMEOUT_S):
                raw, generation = await self._redis.mget(key, generation_key(slug))
            if raw is not None:
                return CachedCss.from_json(raw)
        except Exception as exc:  # Redis weg, time-out of onleesbare waarde
            cache_ok = False
            log.warning("css_cache_read_failed", key=key, error=repr(exc))

        async with self._sessionmaker() as session:
            row = await load(session)
        if row is None:
            return None
        item = CachedCss.from_row(row)
        if cache_ok:
            await self._store(key, slug, generation, item, ttl)
        return item

    async def _store(
        self, key: str, slug: str, generation: bytes | None, item: CachedCss, ttl: int
    ) -> None:
        try:
            async with asyncio.timeout(REDIS_TIMEOUT_S):
                await self._set_if_generation(
                    keys=[key, generation_key(slug)],
                    args=[(generation or b"").decode(), item.to_json(), ttl],
                )
        except Exception as exc:
            log.warning("css_cache_write_failed", key=key, error=repr(exc))

    # --- invalideren ------------------------------------------------------------------

    async def invalidate(
        self,
        slugs: Iterable[str],
        *,
        fixed_versions: Mapping[str, Iterable[int]] | None = None,
    ) -> None:
        """Leegt de Redis-cache en ververst nginx voor deze slugs (na de commit)."""
        fixed = {slug: sorted(set(numbers)) for slug, numbers in (fixed_versions or {}).items()}
        unique = list(dict.fromkeys(slug for slug in [*slugs, *fixed] if slug))
        if not unique:
            return
        await self._clear_redis(unique, fixed)
        await self._refresh_nginx(unique, fixed)
        await self.refresh_hosts_using(styles=unique)

    async def refresh_hosts_using(
        self, *, styles: Iterable[str] = (), scripts: Iterable[str] = ()
    ) -> None:
        """Ververst `/host/<h>.css|.js` van elke host die een van deze namen gebruikt."""
        if not self._refresh_url or self._http is None:
            return
        try:
            async with self._sessionmaker() as session:
                hostnames = await host_repo.hostnames_using(
                    session, styles=list(styles), scripts=list(scripts)
                )
        except Exception as exc:
            log.warning("host_refresh_lookup_failed", error=repr(exc))
            return
        await self.refresh_hosts(hostnames)

    async def refresh_hosts(self, hostnames: Iterable[str]) -> None:
        """Ververst de nginx-cache van deze hosts (na een gewijzigde koppeling).

        Hosts zonder eigen koppeling (die `*` volgen) kent cssthema niet: die krijgen een
        wijziging pas als hun cache-entry verloopt (60 s).
        """
        http = self._http
        if not self._refresh_url or http is None:
            return
        paths = [path for name in dict.fromkeys(hostnames) for path in host_refresh_paths(name)]
        if paths:
            await self._refresh_many(http, paths)

    async def host_binding(self, hostname: str) -> HostBindingView | None:
        """De koppeling voor een host (of `*`), voor de publieke `/host/`-routes."""
        async with self._sessionmaker() as session:
            binding = await host_repo.resolve(session, hostname)
            if binding is None:
                return None
            return HostBindingView(
                hostname=binding.hostname,
                styles=[str(name) for name in binding.styles],
                scripts=[str(name) for name in binding.scripts],
                enabled=binding.enabled,
            )

    async def _clear_redis(self, slugs: list[str], fixed: Mapping[str, list[int]]) -> None:
        for attempt in range(1, INVALIDATE_ATTEMPTS + 1):
            try:
                async with asyncio.timeout(REDIS_TIMEOUT_S * 2):
                    pipe = self._redis.pipeline(transaction=True)
                    for slug in slugs:
                        pipe.incr(generation_key(slug))
                        pipe.expire(generation_key(slug), GENERATION_TTL_S)
                        keys = [
                            latest_key(slug),
                            *(fixed_key(slug, n) for n in fixed.get(slug, [])),
                        ]
                        pipe.delete(*keys)
                    await pipe.execute()
                return
            except Exception as exc:
                log.warning(
                    "css_cache_invalidate_failed", slugs=slugs, attempt=attempt, error=repr(exc)
                )
                if attempt < INVALIDATE_ATTEMPTS:
                    await asyncio.sleep(INVALIDATE_RETRY_S * attempt)

    async def _refresh_nginx(self, slugs: list[str], fixed: Mapping[str, list[int]]) -> None:
        http = self._http
        if not self._refresh_url or http is None:
            return
        await asyncio.gather(
            *(self._refresh(http, path) for slug in slugs for path in refresh_paths(slug))
        )
        fixed_paths = [
            path for slug in slugs for path in fixed_refresh_paths(slug, fixed.get(slug, []))
        ]
        if fixed_paths:
            task = asyncio.create_task(self._refresh_many(http, fixed_paths))
            self._background.add(task)
            task.add_done_callback(self._background.discard)

    async def _refresh_many(self, http: httpx.AsyncClient, paths: list[str]) -> None:
        pending = iter(paths)  # gedeeld door de workers (één event loop: geen race)

        async def worker() -> None:
            for path in pending:
                await self._refresh(http, path)

        await asyncio.gather(*(worker() for _ in range(min(REFRESH_CONCURRENCY, len(paths)))))

    async def _refresh(self, http: httpx.AsyncClient, path: str) -> None:
        url = self._refresh_url + path
        for attempt in range(1, REFRESH_ATTEMPTS + 1):
            try:
                response = await http.get(url, timeout=REFRESH_TIMEOUT_S)
                await response.aclose()
            except httpx.HTTPError as exc:
                log.warning("css_refresh_failed", url=url, error=repr(exc))
                return
            if response.status_code == 429 and attempt < REFRESH_ATTEMPTS:
                await asyncio.sleep(REFRESH_RETRY_DELAY_S * attempt)
                continue
            if response.status_code not in (200, 301, 404):
                log.warning("css_refresh_unexpected_status", url=url, status=response.status_code)
            return

    async def drain(self) -> None:
        """Wacht tot de achtergrond-refreshes klaar zijn (tests, afsluiten)."""
        while self._background:
            await asyncio.gather(*self._background, return_exceptions=True)

    async def aclose(self) -> None:
        """Bij het afsluiten: lopende refreshes nog even laten afronden, daarna stoppen."""
        try:
            async with asyncio.timeout(REFRESH_TIMEOUT_S * 2):
                await self.drain()
        except TimeoutError:
            for task in self._background:
                task.cancel()
            await asyncio.gather(*self._background, return_exceptions=True)
