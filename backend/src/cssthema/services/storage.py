"""Assets op het bestandssysteem, content-addressed op SHA-256 (docs/07 taak 2.2).

`<storage_dir>/assets/<eerste 2 hex>/<sha256 hex>`; de rij in `assets` bewaart type en
grootte. Dezelfde inhoud wordt één keer opgeslagen, hoe vaak ze ook geïmporteerd wordt.
"""

import hashlib
import os
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from cssthema.db.models import Asset


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


async def put(
    session: AsyncSession,
    storage_dir: Path,
    data: bytes,
    content_type: str,
    cache: dict[bytes, Asset] | None = None,
) -> Asset:
    """Slaat `data` op (als het er nog niet is) en geeft de Asset-rij terug (nog niet gecommit).

    `cache` voorkomt dubbele queries binnen één import.
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
    if cache is not None:
        cache[sha] = asset
    return asset


def read(storage_dir: Path, asset: Asset) -> bytes | None:
    path = storage_dir / asset.storage_key
    try:
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(storage_dir.resolve()):
            return None
        return resolved.read_bytes()
    except OSError:
        return None
