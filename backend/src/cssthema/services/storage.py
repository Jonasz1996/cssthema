"""Assets op het bestandssysteem, content-addressed op SHA-256 (docs/07 taak 2.2).

`<storage_dir>/assets/<eerste 2 hex>/<sha256 hex>`; de rij in `assets` bewaart type en
grootte. Dezelfde inhoud wordt één keer opgeslagen, hoe vaak ze ook geïmporteerd wordt.

Wat assets schrijft of opruimt, neemt eerst `lock()`: zo kan de opruiming nooit een asset
weghalen dat een lopende import net hergebruikt. Assets waar geen snapshot of dienst meer
naar verwijst, verdwijnen na elke import en na het verwijderen van een dienst.
"""

import contextlib
import hashlib
import os
import uuid
from collections.abc import Iterable
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from cssthema.db.models import Asset
from cssthema.logging import get_logger

log = get_logger(__name__)

# Sleutel van de advisory lock (`ct-asset` als getal); vrij bij commit of rollback.
LOCK_KEY = int.from_bytes(b"ct-asset", "big")

# Alles wat naar een asset verwijst: de kolommen met een foreign key en de asset-id's in
# JSONB (stylesheets en screenshots van een snapshot). `CASE` houdt rare JSON buiten de
# set-functies, die anders een fout geven.
_DELETE_UNREFERENCED = text(
    """
    WITH referenced AS MATERIALIZED (
        SELECT document_asset_id::text AS id FROM dom_snapshots
        WHERE document_asset_id IS NOT NULL
        UNION
        SELECT favicon_asset_id::text FROM services WHERE favicon_asset_id IS NOT NULL
        UNION
        SELECT sheet ->> 'asset_id'
        FROM dom_snapshots,
            jsonb_array_elements(
                CASE WHEN jsonb_typeof(stylesheets) = 'array' THEN stylesheets
                ELSE '[]'::jsonb END
            ) AS sheet
        UNION
        SELECT shot.value
        FROM dom_snapshots,
            jsonb_each_text(
                CASE WHEN jsonb_typeof(capture_info -> 'screenshots') = 'object'
                THEN capture_info -> 'screenshots' ELSE '{}'::jsonb END
            ) AS shot
    )
    DELETE FROM assets
    WHERE NOT EXISTS (SELECT 1 FROM referenced WHERE referenced.id = assets.id::text)
    RETURNING storage_key
    """
)


def asset_path(storage_dir: Path, sha256: bytes) -> Path:
    digest = sha256.hex()
    return storage_dir / "assets" / digest[:2] / digest


def _write(path: Path, data: bytes) -> None:
    if path.is_file() and path.stat().st_size == len(data):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    with open(tmp, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


async def lock(session: AsyncSession) -> None:
    """Wacht tot geen andere transactie assets schrijft of opruimt (tot commit of rollback)."""
    await session.execute(select(func.pg_advisory_xact_lock(LOCK_KEY)))


async def put(
    session: AsyncSession,
    storage_dir: Path,
    data: bytes,
    content_type: str,
    cache: dict[bytes, Asset] | None = None,
    created: list[Path] | None = None,
) -> Asset:
    """Slaat `data` op (als het er nog niet is) en geeft de Asset-rij terug (nog niet gecommit).

    `cache` voorkomt dubbele queries binnen één import. In `created` komen de bestanden van
    nieuwe rijen: mislukt de import, dan horen die weg (`discard`).
    """
    sha = hashlib.sha256(data).digest()
    if cache is not None and sha in cache:
        return cache[sha]
    asset = await session.scalar(select(Asset).where(Asset.sha256 == sha))
    path = asset_path(storage_dir, sha)
    await run_in_threadpool(_write, path, data)
    if asset is None:
        asset = Asset(
            storage_key=str(path.relative_to(storage_dir)),
            content_type=content_type,
            size_bytes=len(data),
            sha256=sha,
        )
        session.add(asset)
        await session.flush()
        if created is not None:
            created.append(path)
    if cache is not None:
        cache[sha] = asset
    return asset


def _unlink(paths: Iterable[Path]) -> int:
    removed = 0
    for path in paths:
        try:
            path.unlink()
        except FileNotFoundError:
            continue
        except OSError as exc:
            log.warning("asset_unlink_failed", path=str(path), error=repr(exc))
            continue
        removed += 1
    return removed


def _remove(storage_dir: Path, keys: list[str]) -> int:
    root = storage_dir.resolve()
    paths = (storage_dir / key for key in keys)
    return _unlink(path for path in paths if path.resolve().is_relative_to(root))


def discard(created: list[Path]) -> None:
    """Haalt de bestanden van een mislukte import weg; nog vóór de rollback, onder `lock()`.

    Ze horen alleen bij rijen uit die import, dus niets anders verwijst ernaar. Bewust zonder
    `await`: ook een geannuleerde request (verbinding weg) ruimt zo op.
    """
    _unlink(created)


async def delete_unreferenced(session: AsyncSession) -> list[str]:
    """Verwijdert de asset-rijen waar niets meer naar verwijst; geeft hun `storage_key` terug.

    In de transactie van de aanroeper, die `lock()` al heeft. De bestanden gaan pas na de
    commit weg, met `remove_files`.
    """
    await session.flush()
    rows = await session.execute(_DELETE_UNREFERENCED)
    return [str(key) for key in rows.scalars()]


async def remove_files(session: AsyncSession, storage_dir: Path, keys: list[str]) -> int:
    """Wist de bestanden van verwijderde assets, in een eigen korte transactie onder `lock()`.

    Een import kan intussen dezelfde inhoud opnieuw hebben opgeslagen (nieuwe rij, zelfde
    pad); die bestanden blijven staan. Een fout bij het wissen wordt gelogd, niet doorgegeven:
    de database is dan al opgeruimd.
    """
    if not keys:
        return 0
    try:
        await lock(session)
        query = select(Asset.storage_key).where(Asset.storage_key.in_(keys))
        again = set(await session.scalars(query))
        removed = await run_in_threadpool(
            _remove, storage_dir, [key for key in keys if key not in again]
        )
        await session.commit()
    except Exception as exc:
        with contextlib.suppress(Exception):
            await session.rollback()
        log.warning("asset_cleanup_failed", error=repr(exc))
        return 0
    if removed:
        log.info("assets_removed", files=removed)
    return removed


def read(storage_dir: Path, asset: Asset) -> bytes | None:
    path = storage_dir / asset.storage_key
    try:
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(storage_dir.resolve()):
            return None
        return resolved.read_bytes()
    except OSError:
        return None
