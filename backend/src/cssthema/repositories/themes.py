"""Queries voor thema's, versies en slug-redirects."""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import (
    ColumnElement,
    Select,
    String,
    and_,
    case,
    delete,
    func,
    or_,
    select,
    tuple_,
    type_coerce,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, defer

from cssthema.db.models import Theme, ThemeSlugRedirect, ThemeVersion
from cssthema.db.models.enums import ThemeStatus

ThemeSort = Literal["-updated_at", "name", "-created_at"]

# Een oude slug geeft zo lang een 301 naar de nieuwe (docs/05 § 4.11); oudere rijen negeren.
REDIRECT_MAX_AGE = timedelta(days=90)

_published = aliased(ThemeVersion, name="published_version")
_published_source = aliased(ThemeVersion, name="published_source_version")


@dataclass(frozen=True, slots=True)
class ThemeRow:
    """Thema met de afgeleide velden voor de API (zonder de draft-tekst te laden)."""

    theme: Theme
    published: ThemeVersion | None
    published_source_number: int | None
    draft_dirty: bool
    draft_size_bytes: int


@dataclass(frozen=True, slots=True)
class VersionRow:
    version: ThemeVersion
    source_version_number: int | None


@dataclass(frozen=True, slots=True)
class ThemeFilters:
    q: str | None = None
    status: ThemeStatus | None = None
    palette_id: uuid.UUID | None = None
    service_id: uuid.UUID | None = None
    tag: str | None = None
    include_deleted: bool = False


@dataclass(frozen=True, slots=True)
class PublicCssRow:
    slug: str
    version_number: int
    css: str
    sha256: bytes
    published_at: datetime


def draft_dirty_expression() -> ColumnElement[bool]:
    """Draft (of palet) wijkt af van de live versie; zonder live versie: draft niet leeg.

    Verwacht een outer join met `_published` (zie `_theme_rows`).
    """
    return case(
        (Theme.published_version_id.is_(None), Theme.draft_css.regexp_match(r"\S")),
        else_=or_(
            Theme.draft_css != _published.css_source,
            Theme.palette_id.is_distinct_from(_published.palette_id),
        ),
    )


def _theme_rows() -> Select[Any]:
    return (
        select(
            Theme,
            _published,
            _published_source.version_number,
            draft_dirty_expression(),
            func.octet_length(Theme.draft_css),
        )
        .outerjoin(_published, _published.id == Theme.published_version_id)
        .outerjoin(_published_source, _published_source.id == _published.source_version_id)
        .options(
            defer(Theme.draft_css, raiseload=True),
            defer(_published.css_source, raiseload=True),
            defer(_published.css_compiled, raiseload=True),
        )
    )


def _to_row(row: Any) -> ThemeRow:
    theme, published, source_number, dirty, size = row
    return ThemeRow(
        theme=theme,
        published=published,
        published_source_number=source_number,
        draft_dirty=bool(dirty),
        draft_size_bytes=int(size or 0),
    )


async def get_theme(session: AsyncSession, theme_id: uuid.UUID) -> Theme | None:
    """Volledig thema (incl. draft); ook soft-deleted."""
    return await session.get(Theme, theme_id, populate_existing=True)


async def get_theme_row(session: AsyncSession, theme_id: uuid.UUID) -> ThemeRow | None:
    result = await session.execute(_theme_rows().where(Theme.id == theme_id))
    row = result.one_or_none()
    return _to_row(row) if row is not None else None


async def list_theme_rows(
    session: AsyncSession,
    filters: ThemeFilters,
    *,
    sort: ThemeSort,
    limit: int,
    after: tuple[Any, uuid.UUID] | None = None,
) -> list[ThemeRow]:
    stmt = _theme_rows()
    if not filters.include_deleted:
        stmt = stmt.where(Theme.deleted_at.is_(None))
    if filters.q:
        pattern = "%" + escape_like(filters.q.strip()) + "%"
        stmt = stmt.where(
            or_(
                Theme.name.ilike(pattern, escape="\\"),
                Theme.slug.ilike(pattern, escape="\\"),
                Theme.description.ilike(pattern, escape="\\"),
            )
        )
    if filters.status is not None:
        stmt = stmt.where(Theme.status == filters.status)
    if filters.palette_id is not None:
        stmt = stmt.where(Theme.palette_id == filters.palette_id)
    if filters.service_id is not None:
        stmt = stmt.where(Theme.service_id == filters.service_id)
    if filters.tag:
        # `@>` (kan een GIN-index gebruiken); het model gebruikt het generieke ARRAY-type.
        tags = type_coerce(Theme.tags, postgresql.ARRAY(String(40)))
        stmt = stmt.where(tags.contains([filters.tag.strip().lower()]))

    if sort == "name":
        if after is not None:
            stmt = stmt.where(tuple_(Theme.name, Theme.id) > tuple_(after[0], after[1]))
        stmt = stmt.order_by(Theme.name.asc(), Theme.id.asc())
    else:
        column = Theme.updated_at if sort == "-updated_at" else Theme.created_at
        if after is not None:
            stmt = stmt.where(tuple_(column, Theme.id) < tuple_(after[0], after[1]))
        stmt = stmt.order_by(column.desc(), Theme.id.desc())
    result = await session.execute(stmt.limit(limit))
    return [_to_row(row) for row in result.all()]


def escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def active_theme_id_by_slug(session: AsyncSession, slug: str) -> uuid.UUID | None:
    return await session.scalar(
        select(Theme.id).where(Theme.slug == slug, Theme.deleted_at.is_(None))
    )


async def active_theme_ids_by_slugs(
    session: AsyncSession, slugs: Sequence[str]
) -> dict[str, uuid.UUID]:
    if not slugs:
        return {}
    result = await session.execute(
        select(Theme.slug, Theme.id).where(Theme.slug.in_(slugs), Theme.deleted_at.is_(None))
    )
    return {slug: theme_id for slug, theme_id in result.all()}


async def get_version(
    session: AsyncSession, theme_id: uuid.UUID, number: int
) -> ThemeVersion | None:
    """Volledige versie (incl. CSS), ook als ze eerder zonder CSS geladen werd."""
    return await session.scalar(
        select(ThemeVersion)
        .where(ThemeVersion.theme_id == theme_id, ThemeVersion.version_number == number)
        .execution_options(populate_existing=True)
    )


async def get_version_by_id(session: AsyncSession, version_id: uuid.UUID) -> ThemeVersion | None:
    # populate_existing: een eerder (zonder CSS) geladen object krijgt alle kolommen.
    return await session.get(ThemeVersion, version_id, populate_existing=True)


async def get_version_row(
    session: AsyncSession, theme_id: uuid.UUID, number: int
) -> VersionRow | None:
    source = aliased(ThemeVersion, name="source_version")
    result = await session.execute(
        select(ThemeVersion, source.version_number)
        .outerjoin(source, source.id == ThemeVersion.source_version_id)
        .where(ThemeVersion.theme_id == theme_id, ThemeVersion.version_number == number)
    )
    row = result.one_or_none()
    return VersionRow(row[0], row[1]) if row is not None else None


async def list_version_rows(
    session: AsyncSession,
    theme_id: uuid.UUID,
    *,
    limit: int,
    after: tuple[int, uuid.UUID] | None = None,
) -> list[VersionRow]:
    source = aliased(ThemeVersion, name="source_version")
    stmt = (
        select(ThemeVersion, source.version_number)
        .outerjoin(source, source.id == ThemeVersion.source_version_id)
        .where(ThemeVersion.theme_id == theme_id)
        .options(
            defer(ThemeVersion.css_source, raiseload=True),
            defer(ThemeVersion.css_compiled, raiseload=True),
        )
        .order_by(ThemeVersion.version_number.desc(), ThemeVersion.id.desc())
        .limit(limit)
    )
    if after is not None:
        stmt = stmt.where(
            tuple_(ThemeVersion.version_number, ThemeVersion.id) < tuple_(after[0], after[1])
        )
    result = await session.execute(stmt)
    return [VersionRow(version, number) for version, number in result.all()]


async def all_versions(session: AsyncSession, theme_id: uuid.UUID) -> list[ThemeVersion]:
    result = await session.scalars(
        select(ThemeVersion)
        .where(ThemeVersion.theme_id == theme_id)
        .order_by(ThemeVersion.version_number.asc())
    )
    return list(result.all())


async def version_numbers(session: AsyncSession, theme_id: uuid.UUID) -> list[int]:
    result = await session.scalars(
        select(ThemeVersion.version_number).where(ThemeVersion.theme_id == theme_id)
    )
    return list(result.all())


# --- slug-redirects -------------------------------------------------------------------


def redirect_cutoff(now: datetime | None = None) -> datetime:
    """Redirects van vóór dit tijdstip tellen niet meer."""
    return (now or datetime.now(UTC)) - REDIRECT_MAX_AGE


async def delete_redirect(session: AsyncSession, slug: str) -> bool:
    """Verwijdert de redirect van `slug` (de slug wordt weer gebruikt)."""
    result = await session.execute(
        delete(ThemeSlugRedirect)
        .where(ThemeSlugRedirect.old_slug == slug)
        .returning(ThemeSlugRedirect.old_slug)
    )
    return result.first() is not None


async def upsert_redirect(session: AsyncSession, old_slug: str, theme_id: uuid.UUID) -> None:
    stmt = insert(ThemeSlugRedirect).values(old_slug=old_slug, theme_id=theme_id)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[ThemeSlugRedirect.old_slug],
            set_={"theme_id": theme_id, "created_at": func.now()},
        )
    )


async def recent_redirect_slugs(session: AsyncSession, since: datetime) -> set[str]:
    result = await session.scalars(
        select(ThemeSlugRedirect.old_slug).where(ThemeSlugRedirect.created_at >= since)
    )
    return set(result.all())


async def redirect_target_slug(session: AsyncSession, old_slug: str, since: datetime) -> str | None:
    """Huidige slug van het thema waarnaar `old_slug` doorverwijst (als dat nog bestaat)."""
    return await session.scalar(
        select(Theme.slug)
        .join(ThemeSlugRedirect, ThemeSlugRedirect.theme_id == Theme.id)
        .where(
            ThemeSlugRedirect.old_slug == old_slug,
            ThemeSlugRedirect.created_at >= since,
            Theme.deleted_at.is_(None),
            Theme.slug != old_slug,
        )
    )


# --- publieke CSS (hot path) ------------------------------------------------------------


async def published_css(session: AsyncSession, slug: str) -> PublicCssRow | None:
    result = await session.execute(
        select(
            ThemeVersion.version_number,
            ThemeVersion.css_compiled,
            ThemeVersion.sha256,
            ThemeVersion.created_at,
        )
        .join(Theme, Theme.published_version_id == ThemeVersion.id)
        .where(Theme.slug == slug, Theme.deleted_at.is_(None))
    )
    row = result.one_or_none()
    if row is None:
        return None
    return PublicCssRow(slug, row[0], row[1], row[2], row[3])


async def fixed_version_css(session: AsyncSession, slug: str, number: int) -> PublicCssRow | None:
    result = await session.execute(
        select(
            ThemeVersion.version_number,
            ThemeVersion.css_compiled,
            ThemeVersion.sha256,
            ThemeVersion.created_at,
        )
        .join(Theme, Theme.id == ThemeVersion.theme_id)
        .where(
            Theme.slug == slug,
            Theme.deleted_at.is_(None),
            ThemeVersion.version_number == number,
        )
    )
    row = result.one_or_none()
    if row is None:
        return None
    return PublicCssRow(slug, row[0], row[1], row[2], row[3])


# --- dashboard ----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ThemeCounts:
    total: int
    published: int
    draft_dirty: int
    deleted: int


async def theme_counts(session: AsyncSession) -> ThemeCounts:
    active = Theme.deleted_at.is_(None)
    result = await session.execute(
        select(
            func.count().filter(active),
            func.count().filter(and_(active, Theme.published_version_id.is_not(None))),
            func.count().filter(and_(active, draft_dirty_expression())),
            func.count().filter(Theme.deleted_at.is_not(None)),
        )
        .select_from(Theme)
        .outerjoin(_published, _published.id == Theme.published_version_id)
    )
    total, published, dirty, deleted = result.one()
    return ThemeCounts(int(total), int(published), int(dirty), int(deleted))
