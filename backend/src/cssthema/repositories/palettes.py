"""Queries voor paletten."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cssthema.db.models import Palette, Theme


async def list_palettes(session: AsyncSession) -> list[tuple[Palette, int]]:
    """Actieve paletten met het aantal (niet-verwijderde) thema's, ingebouwde eerst."""
    counts = (
        select(Theme.palette_id, func.count().label("theme_count"))
        .where(Theme.deleted_at.is_(None), Theme.palette_id.is_not(None))
        .group_by(Theme.palette_id)
        .subquery()
    )
    result = await session.execute(
        select(Palette, func.coalesce(counts.c.theme_count, 0))
        .outerjoin(counts, counts.c.palette_id == Palette.id)
        .where(Palette.deleted_at.is_(None))
        .order_by(Palette.is_builtin.desc(), Palette.name.asc(), Palette.id.asc())
    )
    return [(palette, int(count)) for palette, count in result.all()]


async def get_palette_with_count(
    session: AsyncSession, palette_id: uuid.UUID
) -> tuple[Palette, int] | None:
    palette = await get_active_palette(session, palette_id)
    if palette is None:
        return None
    count = await session.scalar(
        select(func.count())
        .select_from(Theme)
        .where(Theme.palette_id == palette_id, Theme.deleted_at.is_(None))
    )
    return palette, int(count or 0)


async def get_active_palette(session: AsyncSession, palette_id: uuid.UUID) -> Palette | None:
    return await session.scalar(
        select(Palette).where(Palette.id == palette_id, Palette.deleted_at.is_(None))
    )


async def get_palette_by_slug(session: AsyncSession, slug: str) -> Palette | None:
    return await session.scalar(
        select(Palette).where(Palette.slug == slug, Palette.deleted_at.is_(None))
    )


async def count_palettes(session: AsyncSession) -> int:
    count = await session.scalar(
        select(func.count()).select_from(Palette).where(Palette.deleted_at.is_(None))
    )
    return int(count or 0)
