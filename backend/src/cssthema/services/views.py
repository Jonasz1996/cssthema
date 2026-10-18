"""Van databaserijen naar API-schema's (Theme, Version, Draft)."""

import os
import uuid
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from starlette.concurrency import run_in_threadpool

from cssthema.config import Settings
from cssthema.db.models import Theme as ThemeModel
from cssthema.db.models import ThemeVersion
from cssthema.repositories import users as user_repo
from cssthema.repositories.themes import ThemeRow, VersionRow
from cssthema.schemas.common import EtagState, LintIssueOut, UserRef
from cssthema.schemas.themes import Draft, Theme, Version, VersionSummary
from cssthema.services.context import ServiceContext
from cssthema.services.locking import lock_etag

Names = Mapping[uuid.UUID, str]


def public_url(settings: Settings, slug: str) -> str:
    return f"{settings.public_base}/{slug}.css"


def shadowing_files(css_files_dir: Path, slugs: Iterable[str]) -> set[str]:
    """Slugs waarvoor nginx een handgemaakt bestand serveert (volgt symlinks, zoals nginx)."""
    return {slug for slug in set(slugs) if os.path.isfile(css_files_dir / f"{slug}.css")}


def user_ref(names: Names, user_id: uuid.UUID | None) -> UserRef | None:
    if user_id is None or user_id not in names:
        return None
    return UserRef(id=user_id, display_name=names[user_id])


def version_summary(
    version: ThemeVersion, *, source_number: int | None, is_live: bool, names: Names
) -> VersionSummary:
    return VersionSummary(
        id=version.id,
        version_number=version.version_number,
        source=version.source,
        message=version.message,
        sha256=version.sha256.hex(),
        size_bytes=version.size_bytes,
        created_by=user_ref(names, version.created_by),
        created_at=version.created_at,
        is_live=is_live,
        source_version_number=source_number,
    )


async def theme_views(ctx: ServiceContext, rows: Sequence[ThemeRow]) -> list[Theme]:
    names = await user_repo.display_names(
        ctx.session,
        [
            user_id
            for row in rows
            for user_id in (
                row.theme.created_by,
                row.theme.draft_updated_by,
                row.published.created_by if row.published else None,
            )
        ],
    )
    shadowed = await run_in_threadpool(
        shadowing_files, ctx.settings.css_files_dir, [row.theme.slug for row in rows]
    )
    return [_theme_view(ctx.settings, row, names, row.theme.slug in shadowed) for row in rows]


def _theme_view(settings: Settings, row: ThemeRow, names: Names, shadowed: bool) -> Theme:
    theme = row.theme
    published = (
        version_summary(
            row.published, source_number=row.published_source_number, is_live=True, names=names
        )
        if row.published is not None
        else None
    )
    return Theme(
        id=theme.id,
        slug=theme.slug,
        name=theme.name,
        description=theme.description,
        service_id=theme.service_id,
        palette_id=theme.palette_id,
        status=theme.status,
        tags=list(theme.tags or []),
        published_version=published,
        latest_version_number=theme.latest_version_number,
        lock_version=theme.lock_version,
        draft_dirty=row.draft_dirty,
        draft_size_bytes=row.draft_size_bytes,
        draft_updated_at=theme.draft_updated_at,
        draft_updated_by=user_ref(names, theme.draft_updated_by),
        public_url=public_url(settings, theme.slug),
        shadowed_by_file=shadowed,
        deleted_at=theme.deleted_at,
        created_by=user_ref(names, theme.created_by),
        created_at=theme.created_at,
        updated_at=theme.updated_at,
    )


async def version_views(
    ctx: ServiceContext, theme: ThemeModel, rows: Sequence[VersionRow]
) -> list[VersionSummary]:
    names = await user_repo.display_names(ctx.session, [r.version.created_by for r in rows])
    return [
        version_summary(
            row.version,
            source_number=row.source_version_number,
            is_live=row.version.id == theme.published_version_id,
            names=names,
        )
        for row in rows
    ]


async def version_view(ctx: ServiceContext, theme: ThemeModel, row: VersionRow) -> Version:
    version = row.version
    names = await user_repo.display_names(ctx.session, [version.created_by])
    summary = version_summary(
        version,
        source_number=row.source_version_number,
        is_live=version.id == theme.published_version_id,
        names=names,
    )
    return Version(
        **summary.model_dump(),
        css_source=version.css_source,
        css_compiled=version.css_compiled,
        lint_warnings=[LintIssueOut.model_validate(item) for item in _issues(version)],
    )


def _issues(version: ThemeVersion) -> list[dict[str, Any]]:
    return [item for item in (version.lint_warnings or []) if isinstance(item, dict)]


async def draft_view(ctx: ServiceContext, theme: ThemeModel) -> Draft:
    names = await user_repo.display_names(ctx.session, [theme.draft_updated_by])
    return Draft(
        css=theme.draft_css,
        lock_version=theme.lock_version,
        size_bytes=len(theme.draft_css.encode("utf-8")),
        updated_at=theme.draft_updated_at,
        updated_by=user_ref(names, theme.draft_updated_by),
    )


async def etag_state(ctx: ServiceContext, theme: ThemeModel) -> EtagState:
    names = await user_repo.display_names(ctx.session, [theme.draft_updated_by])
    return EtagState(
        etag=lock_etag(theme.lock_version),
        lock_version=theme.lock_version,
        updated_by=user_ref(names, theme.draft_updated_by),
        updated_at=theme.updated_at,
    )
