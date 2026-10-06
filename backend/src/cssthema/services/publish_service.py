"""Publiceren en rollback: een nieuwe, onveranderlijke versie die live gaat (ADR-04/05).

Elke versie bevat de bron, de gecompileerde CSS (palet + minify + header) en de SHA-256.
Het versienummer komt uit `themes.latest_version_number`; de unieke index op
`(theme_id, version_number)` en de `lock_version` van het thema maken gelijktijdig
publiceren veilig (de tweede krijgt 412).
"""

import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from starlette.concurrency import run_in_threadpool

from cssthema.db.base import new_id
from cssthema.db.models import Theme, ThemeVersion
from cssthema.db.models.enums import ThemeStatus, VersionSource
from cssthema.domain.css.compiler import compile_css
from cssthema.domain.css.linter import LintIssue, LintResult, issues_to_dicts
from cssthema.domain.palettes.builtin import ordered_tokens
from cssthema.repositories import palettes as palette_repo
from cssthema.repositories import themes as theme_repo
from cssthema.schemas import themes as schemas
from cssthema.services import audit
from cssthema.services.context import ServiceContext, utcnow
from cssthema.services.errors import LintFailedError, StateConflictError
from cssthema.services.locking import LockExpectation
from cssthema.services.theme_service import (
    check_lock,
    ensure_active,
    flush_guarded,
    live_version,
    load_theme,
    run_lint,
    version_not_found,
)
from cssthema.services.views import version_view


async def palette_tokens(
    ctx: ServiceContext, palette_id: uuid.UUID | None
) -> dict[str, str] | None:
    """De tokens van het gekoppelde palet (None zonder palet)."""
    if palette_id is None:
        return None
    palette = await palette_repo.get_active_palette(ctx.session, palette_id)
    if palette is None or not palette.tokens:
        return None
    return ordered_tokens(palette.tokens)


def lint_failed(result: LintResult, *, prefix: str = "") -> LintFailedError:
    count = len(result.errors)
    noun = "fout" if count == 1 else "fouten"
    return LintFailedError(
        "CSS bevat fouten",
        detail=f"{prefix}Publiceren geweigerd: {count} {noun} gevonden.",
        errors=issues_to_dicts(result.errors),
    )


async def create_version(
    ctx: ServiceContext,
    theme: Theme,
    *,
    css_source: str,
    source: VersionSource,
    message: str | None,
    palette_id: uuid.UUID | None,
    tokens: Mapping[str, str] | None,
    lint_warnings: Sequence[LintIssue] | Sequence[dict[str, Any]] = (),
    make_live: bool,
    source_version_id: uuid.UUID | None = None,
    theme_updates: Mapping[str, Any] | None = None,
) -> ThemeVersion:
    """Compileert en bewaart versie `latest + 1`; met `make_live` wordt ze gepubliceerd.

    `theme_updates` (bv. de draft bij een rollback) gaan mee in dezelfde UPDATE van het
    thema, zodat lock_version maar één stap zet. Verwacht CSS die door de linter kwam.
    Flusht, maar commit niet.
    """
    number = theme.latest_version_number + 1
    published_at: datetime = utcnow()
    compiled = await run_in_threadpool(
        compile_css,
        css_source,
        slug=theme.slug,
        version_number=number,
        published_at=published_at,
        palette_tokens=tokens,
    )
    warnings = [w.to_dict() if isinstance(w, LintIssue) else dict(w) for w in lint_warnings]
    version = ThemeVersion(
        id=new_id(),
        theme_id=theme.id,
        version_number=number,
        css_source=css_source,
        css_compiled=compiled.css,
        sha256=compiled.sha256,
        size_bytes=compiled.size_bytes,
        source=source,
        source_version_id=source_version_id,
        palette_id=palette_id,
        palette_snapshot=dict(tokens) if tokens else None,
        message=message,
        lint_warnings=warnings,
        created_by=ctx.actor.user_id,
        created_at=published_at,
    )
    ctx.session.add(version)
    # Eerst de versie (FK van published_version_id), dan het thema in één UPDATE.
    await flush_guarded(ctx, theme.id, slug=theme.slug)
    for attribute, value in (theme_updates or {}).items():
        setattr(theme, attribute, value)
    theme.latest_version_number = number
    if make_live:
        theme.published_version_id = version.id
        theme.status = ThemeStatus.PUBLISHED
    await flush_guarded(ctx, theme.id, slug=theme.slug)
    return version


async def _version_response(
    ctx: ServiceContext, theme_id: uuid.UUID, number: int
) -> tuple[schemas.Version, int]:
    theme = await load_theme(ctx, theme_id)
    row = await theme_repo.get_version_row(ctx.session, theme.id, number)
    if row is None:  # pragma: no cover - net aangemaakt
        raise version_not_found(number)
    return await version_view(ctx, theme, row), theme.lock_version


async def publish(
    ctx: ServiceContext,
    theme_id: uuid.UUID,
    *,
    message: str | None,
    expected_lock_version: int,
) -> tuple[schemas.Version, int]:
    """Publiceert de draft; geeft de nieuwe versie en de nieuwe lock_version terug."""
    theme = await load_theme(ctx, theme_id)
    ensure_active(theme)
    await check_lock(ctx, theme, LockExpectation.exactly(expected_lock_version))

    live = await live_version(ctx, theme)
    if (
        live is not None
        and live.css_source == theme.draft_css
        and live.palette_id == theme.palette_id
    ):
        raise StateConflictError(
            f"Geen wijzigingen t.o.v. v{live.version_number}",
            detail="De draft is gelijk aan de live versie; er valt niets te publiceren.",
        )
    result = await run_lint(ctx, theme.draft_css)
    if not result.ok:
        raise lint_failed(result)

    version = await create_version(
        ctx,
        theme,
        css_source=theme.draft_css,
        source=VersionSource.MANUAL,
        message=message,
        palette_id=theme.palette_id,
        tokens=await palette_tokens(ctx, theme.palette_id),
        lint_warnings=result.warnings,
        make_live=True,
    )
    audit.record(
        ctx, "theme.publish", entity_id=theme.id, changes={"version": version.version_number}
    )
    await ctx.session.commit()
    await ctx.delivery.invalidate([theme.slug])
    return await _version_response(ctx, theme.id, version.version_number)


async def rollback(
    ctx: ServiceContext,
    theme_id: uuid.UUID,
    *,
    version_number: int,
    message: str | None,
    expectation: LockExpectation,
) -> tuple[schemas.Version, int]:
    """Nieuwe versie met de inhoud van versie N (bron `rollback`), meteen live.

    De draft wordt die inhoud, en het palet van die versie wordt weer gekoppeld, zodat
    het thema na de rollback niets ongepubliceerds meer heeft. Omdat de draft vervangen
    wordt, is `If-Match` verplicht (zoals bij draft/reset).
    """
    theme = await load_theme(ctx, theme_id)
    ensure_active(theme)
    await check_lock(ctx, theme, expectation)
    target = await theme_repo.get_version(ctx.session, theme.id, version_number)
    if target is None:
        raise version_not_found(version_number)
    if theme.published_version_id == target.id:
        raise StateConflictError(
            f"v{version_number} is al live", detail="Kies een andere versie om naar terug te gaan."
        )
    result = await run_lint(ctx, target.css_source)
    if not result.ok:
        raise lint_failed(result, prefix=f"v{version_number}: ")

    palette_id = target.palette_id
    if (
        palette_id is not None
        and await palette_repo.get_active_palette(ctx.session, palette_id) is None
    ):
        palette_id = theme.palette_id
    # Dezelfde tokens als toen (snapshot), tenzij dat palet intussen verwijderd is.
    if target.palette_id == palette_id:
        snapshot = target.palette_snapshot
        tokens = ordered_tokens(snapshot) if snapshot else None
    else:
        tokens = await palette_tokens(ctx, palette_id)

    version = await create_version(
        ctx,
        theme,
        css_source=target.css_source,
        source=VersionSource.ROLLBACK,
        message=message or f"Rollback naar v{version_number}",
        palette_id=palette_id,
        tokens=tokens,
        lint_warnings=result.warnings,
        make_live=True,
        source_version_id=target.id,
        theme_updates={
            "draft_css": target.css_source,
            "draft_updated_at": utcnow(),
            "draft_updated_by": ctx.actor.user_id,
            "palette_id": palette_id,
        },
    )
    audit.record(
        ctx,
        "theme.rollback",
        entity_id=theme.id,
        changes={"version": version.version_number, "from_version": version_number},
    )
    await ctx.session.commit()
    await ctx.delivery.invalidate([theme.slug])
    return await _version_response(ctx, theme.id, version.version_number)
