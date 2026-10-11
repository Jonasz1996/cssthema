"""Thema's: aanmaken, lezen, metadata, draft, lint, dupliceren, verwijderen en herstellen.

Concurrency (docs/05 § 1 en § 5.1): `themes.lock_version` is de `version_id_col` van het
model; elke UPDATE via de ORM verhoogt hem en controleert hem in de WHERE. Een client
stuurt `If-Match: "lv-<n>"`; een afwijking (vooraf of tijdens de flush) wordt 412 met de
huidige toestand.
"""

import uuid
from collections.abc import Sequence
from typing import Any, NoReturn

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError
from starlette.concurrency import run_in_threadpool

from cssthema.db.base import new_id
from cssthema.db.models import Service, Theme, ThemeVersion
from cssthema.db.models.enums import ThemeStatus
from cssthema.domain.css.diff import unified_diff
from cssthema.domain.css.linter import LintResult, lint
from cssthema.domain.css.slugs import InvalidSlug, slugify, validate_slug
from cssthema.repositories import palettes as palette_repo
from cssthema.repositories import themes as theme_repo
from cssthema.repositories.themes import ThemeFilters, ThemeSort
from cssthema.schemas import themes as schemas
from cssthema.schemas.common import LintIssueOut
from cssthema.services import audit
from cssthema.services.context import ServiceContext, utcnow
from cssthema.services.errors import (
    InvalidInputError,
    InvalidSlugError,
    NotFoundError,
    PayloadTooLargeError,
    PreconditionFailedError,
    SlugConflictError,
    StateConflictError,
    field_error,
)
from cssthema.services.locking import LockExpectation
from cssthema.services.views import draft_view, etag_state, theme_views, version_view, version_views

SLUG_INDEX = "uq_themes_slug_active"
VERSION_INDEX = "uq_theme_versions_theme_version"


# --- gedeelde hulpfuncties (ook gebruikt door publish_service en import_export) --------


async def load_theme(ctx: ServiceContext, theme_id: uuid.UUID) -> Theme:
    theme = await theme_repo.get_theme(ctx.session, theme_id)
    if theme is None:
        raise NotFoundError("Thema niet gevonden", detail=f"Er is geen thema met id {theme_id}.")
    return theme


def ensure_active(theme: Theme) -> None:
    if theme.deleted_at is not None:
        raise StateConflictError(
            "Thema is verwijderd", detail="Herstel het thema eerst voordat je het wijzigt."
        )


async def raise_precondition_failed(ctx: ServiceContext, theme_id: uuid.UUID) -> NoReturn:
    """412 met de actuele toestand (na een rollback van de mislukte transactie)."""
    await ctx.session.rollback()
    theme = await load_theme(ctx, theme_id)
    current = await etag_state(ctx, theme)
    raise PreconditionFailedError(
        "Het thema is intussen gewijzigd",
        detail="Iemand anders heeft het thema gewijzigd; herlaad of overschrijf bewust.",
        extra={"current": current.model_dump(mode="json")},
        headers={"ETag": current.etag},
    )


async def check_lock(
    ctx: ServiceContext, theme: Theme, expectation: LockExpectation | None
) -> None:
    if expectation is not None and not expectation.matches(theme.lock_version):
        await raise_precondition_failed(ctx, theme.id)


def constraint_name(exc: IntegrityError) -> str | None:
    for candidate in (getattr(exc.orig, "__cause__", None), exc.orig):
        name = getattr(candidate, "constraint_name", None)
        if isinstance(name, str):
            return name
    text = str(exc.orig)
    for known in (SLUG_INDEX, VERSION_INDEX):
        if known in text:
            return known
    return None


async def flush_guarded(ctx: ServiceContext, theme_id: uuid.UUID, *, slug: str | None) -> None:
    """Flush; een gelijktijdige wijziging wordt 412, een bezette slug 409."""
    try:
        await ctx.session.flush()
    except StaleDataError:
        await raise_precondition_failed(ctx, theme_id)
    except IntegrityError as exc:
        name = constraint_name(exc)
        if name == SLUG_INDEX:
            await ctx.session.rollback()
            raise slug_conflict(slug or "?") from exc
        if name == VERSION_INDEX:
            await raise_precondition_failed(ctx, theme_id)
        raise


def slug_conflict(slug: str, theme_id: uuid.UUID | None = None) -> SlugConflictError:
    extra: dict[str, Any] = {"slug": slug}
    if theme_id is not None:
        extra["theme_id"] = str(theme_id)
    return SlugConflictError(
        "Slug al in gebruik",
        detail=f"Er bestaat al een thema met de slug '{slug}'.",
        extra=extra,
        errors=[field_error("slug", "Deze slug is al in gebruik.", kind="slug_conflict")],
    )


def checked_slug(slug: str, *, field: str = "slug") -> str:
    try:
        validate_slug(slug)
    except InvalidSlug as exc:
        raise InvalidSlugError(
            "Ongeldige slug",
            detail=exc.reason,
            errors=[field_error(field, exc.reason, kind="invalid_slug")],
            extra={"slug": slug},
        ) from exc
    return slug


async def ensure_slug_free(
    ctx: ServiceContext, slug: str, *, theme_id: uuid.UUID | None = None
) -> None:
    existing = await theme_repo.active_theme_id_by_slug(ctx.session, slug)
    if existing is not None and existing != theme_id:
        raise slug_conflict(slug, existing)


def check_size(ctx: ServiceContext, css: str) -> None:
    size = len(css.encode("utf-8"))
    limit = ctx.settings.css_max_bytes
    if size > limit:
        raise PayloadTooLargeError(
            "CSS is te groot",
            detail=f"De CSS is {size} bytes; de limiet is {limit} bytes.",
            extra={"size_bytes": size, "limit_bytes": limit},
        )


async def _service_exists(ctx: ServiceContext, service_id: uuid.UUID) -> bool:
    found = await ctx.session.scalar(
        select(Service.id).where(Service.id == service_id, Service.deleted_at.is_(None))
    )
    return found is not None


async def check_references(
    ctx: ServiceContext,
    *,
    service_id: uuid.UUID | None = None,
    palette_id: uuid.UUID | None = None,
) -> None:
    errors = []
    if service_id is not None and not await _service_exists(ctx, service_id):
        errors.append(field_error("service_id", "Deze service bestaat niet."))
    if (
        palette_id is not None
        and await palette_repo.get_active_palette(ctx.session, palette_id) is None
    ):
        errors.append(field_error("palette_id", "Dit palet bestaat niet."))
    if errors:
        raise InvalidInputError("Ongeldige invoer", errors=errors)


async def run_lint(ctx: ServiceContext, css: str) -> LintResult:
    """Lint in een thread: tinycss2 is CPU-werk en mag de event loop niet blokkeren."""
    return await run_in_threadpool(
        lint,
        css,
        allowed_hosts=ctx.settings.css_allowed_hosts,
        max_bytes=ctx.settings.css_max_bytes,
    )


def clean_description(description: str | None) -> str | None:
    if description is None:
        return None
    stripped = description.strip()
    return stripped or None


def new_theme(
    ctx: ServiceContext,
    *,
    slug: str,
    name: str,
    css: str,
    description: str | None = None,
    service_id: uuid.UUID | None = None,
    palette_id: uuid.UUID | None = None,
    tags: Sequence[str] = (),
) -> Theme:
    return Theme(
        id=new_id(),
        slug=slug,
        name=name,
        description=clean_description(description),
        service_id=service_id,
        palette_id=palette_id,
        status=ThemeStatus.DRAFT,
        draft_css=css,
        draft_updated_at=utcnow(),
        draft_updated_by=ctx.actor.user_id,
        latest_version_number=0,
        tags=list(tags),
        created_by=ctx.actor.user_id,
    )


async def theme_view(ctx: ServiceContext, theme_id: uuid.UUID) -> schemas.Theme:
    row = await theme_repo.get_theme_row(ctx.session, theme_id)
    if row is None:
        raise NotFoundError("Thema niet gevonden")
    (view,) = await theme_views(ctx, [row])
    return view


async def fixed_versions_of(
    ctx: ServiceContext, theme_id: uuid.UUID, slug: str
) -> dict[str, list[int]]:
    """Alle `@n`-URL's van een thema, om ze bij verwijderen/hernoemen te verversen."""
    return {slug: await theme_repo.version_numbers(ctx.session, theme_id)}


# --- lezen ----------------------------------------------------------------------------


async def list_themes(
    ctx: ServiceContext,
    filters: ThemeFilters,
    *,
    sort: ThemeSort,
    limit: int,
    after: tuple[Any, uuid.UUID] | None,
) -> tuple[list[schemas.Theme], bool]:
    """Eén pagina thema's, en of er nog meer zijn."""
    rows = await theme_repo.list_theme_rows(
        ctx.session, filters, sort=sort, limit=limit + 1, after=after
    )
    views = await theme_views(ctx, rows[:limit])
    return views, len(rows) > limit


async def get_theme(ctx: ServiceContext, theme_id: uuid.UUID) -> schemas.Theme:
    return await theme_view(ctx, theme_id)


async def get_draft(ctx: ServiceContext, theme_id: uuid.UUID) -> schemas.Draft:
    return await draft_view(ctx, await load_theme(ctx, theme_id))


async def lint_theme(
    ctx: ServiceContext, theme_id: uuid.UUID, css: str | None
) -> schemas.LintResult:
    theme = await load_theme(ctx, theme_id)
    result = await run_lint(ctx, theme.draft_css if css is None else css)
    return lint_result_view(result)


def lint_result_view(result: LintResult) -> schemas.LintResult:
    return schemas.LintResult(
        ok=result.ok,
        errors=[LintIssueOut.model_validate(issue.to_dict()) for issue in result.errors],
        warnings=[LintIssueOut.model_validate(issue.to_dict()) for issue in result.warnings],
        size_bytes=result.size_bytes,
        unmatched_selectors=[],
    )


async def list_versions(
    ctx: ServiceContext,
    theme_id: uuid.UUID,
    *,
    limit: int,
    after: tuple[int, uuid.UUID] | None,
) -> tuple[list[schemas.VersionSummary], bool]:
    theme = await load_theme(ctx, theme_id)
    rows = await theme_repo.list_version_rows(ctx.session, theme.id, limit=limit + 1, after=after)
    views = await version_views(ctx, theme, rows[:limit])
    return views, len(rows) > limit


async def get_version(ctx: ServiceContext, theme_id: uuid.UUID, number: int) -> schemas.Version:
    theme = await load_theme(ctx, theme_id)
    row = await theme_repo.get_version_row(ctx.session, theme.id, number)
    if row is None:
        raise version_not_found(number)
    return await version_view(ctx, theme, row)


def version_not_found(number: int) -> NotFoundError:
    return NotFoundError("Versie niet gevonden", detail=f"Versie {number} bestaat niet.")


async def diff(
    ctx: ServiceContext, theme_id: uuid.UUID, from_ref: int | str, to_ref: int | str
) -> schemas.VersionDiff:
    theme = await load_theme(ctx, theme_id)

    async def text_of(ref: int | str) -> str:
        if ref == "draft":
            return theme.draft_css
        assert isinstance(ref, int)
        version = await theme_repo.get_version(ctx.session, theme.id, ref)
        if version is None:
            raise version_not_found(ref)
        return version.css_source

    def label(ref: int | str) -> str:
        return "draft" if ref == "draft" else f"v{ref}"

    result = unified_diff(
        await text_of(from_ref),
        await text_of(to_ref),
        from_label=label(from_ref),
        to_label=label(to_ref),
    )
    return schemas.VersionDiff.model_validate(
        {
            "from": from_ref,
            "to": to_ref,
            "unified": result.unified,
            "stats": {"added": result.added, "removed": result.removed},
        }
    )


# --- aanmaken en dupliceren ---------------------------------------------------------------


async def _template_css(ctx: ServiceContext, template: schemas.ThemeTemplate | None) -> str:
    if template is None or template.kind == "empty" or template.id is None:
        return ""
    if template.kind == "theme":
        source = await theme_repo.get_theme(ctx.session, template.id)
        if source is None:
            raise InvalidInputError(
                "Ongeldig sjabloon",
                errors=[field_error("template", "Het sjabloon-thema bestaat niet.")],
            )
        return source.draft_css
    version = await theme_repo.get_version(ctx.session, template.id, template.version_number or 0)
    if version is None:
        raise InvalidInputError(
            "Ongeldig sjabloon",
            errors=[field_error("template", "Die versie van het sjabloon-thema bestaat niet.")],
        )
    return version.css_source


async def create_theme(ctx: ServiceContext, data: schemas.ThemeCreate) -> schemas.Theme:
    slug = checked_slug(data.slug if data.slug else slugify(data.name))
    await ensure_slug_free(ctx, slug)
    await check_references(ctx, service_id=data.service_id, palette_id=data.palette_id)
    css = data.css if data.css is not None else await _template_css(ctx, data.template)
    check_size(ctx, css)

    redirect_removed = await theme_repo.delete_redirect(ctx.session, slug)
    theme = new_theme(
        ctx,
        slug=slug,
        name=data.name,
        css=css,
        description=data.description,
        service_id=data.service_id,
        palette_id=data.palette_id,
        tags=data.tags,
    )
    ctx.session.add(theme)
    template = data.template.kind if data.template else "empty"
    audit.record(
        ctx,
        "theme.create",
        entity_id=theme.id,
        changes={"slug": slug, "name": theme.name, "template": template},
    )
    await flush_guarded(ctx, theme.id, slug=slug)
    await ctx.session.commit()
    if redirect_removed:
        # De oude slug gaf een 301; nu is het een (nog niet gepubliceerd) thema.
        await ctx.delivery.invalidate([slug])
    return await theme_view(ctx, theme.id)


async def duplicate_theme(
    ctx: ServiceContext, theme_id: uuid.UUID, data: schemas.DuplicateRequest
) -> schemas.Theme:
    source = await load_theme(ctx, theme_id)
    slug = checked_slug(data.slug if data.slug else slugify(data.name))
    await ensure_slug_free(ctx, slug)
    if "service_id" in data.model_fields_set:
        service_id = data.service_id
        await check_references(ctx, service_id=service_id)
    else:
        # De kopie neemt de service van het origineel over, maar niet als die intussen
        # verwijderd is.
        service_id = source.service_id
        if service_id is not None and not await _service_exists(ctx, service_id):
            service_id = None

    redirect_removed = await theme_repo.delete_redirect(ctx.session, slug)
    theme = new_theme(
        ctx,
        slug=slug,
        name=data.name,
        css=source.draft_css,
        description=source.description,
        service_id=service_id,
        palette_id=source.palette_id,
        tags=source.tags or [],
    )
    ctx.session.add(theme)
    audit.record(
        ctx,
        "theme.duplicate",
        entity_id=theme.id,
        changes={"source_theme_id": str(source.id), "slug": slug},
    )
    await flush_guarded(ctx, theme.id, slug=slug)
    await ctx.session.commit()
    if redirect_removed:
        await ctx.delivery.invalidate([slug])
    return await theme_view(ctx, theme.id)


# --- metadata --------------------------------------------------------------------------


async def update_theme(
    ctx: ServiceContext,
    theme_id: uuid.UUID,
    data: schemas.ThemeUpdate,
    expectation: LockExpectation,
) -> schemas.Theme:
    theme = await load_theme(ctx, theme_id)
    ensure_active(theme)
    await check_lock(ctx, theme, expectation)
    fields = data.model_fields_set
    changes: dict[str, Any] = {}
    updates: dict[str, Any] = {}

    if "name" in fields and data.name is not None and data.name != theme.name:
        changes["name"] = [theme.name, data.name]
        updates["name"] = data.name
    if "description" in fields:
        description = clean_description(data.description)
        if description != theme.description:
            changes["description"] = "gewijzigd"
            updates["description"] = description
    if "service_id" in fields and data.service_id != theme.service_id:
        await check_references(ctx, service_id=data.service_id)
        changes["service_id"] = [_str(theme.service_id), _str(data.service_id)]
        updates["service_id"] = data.service_id
    if "palette_id" in fields and data.palette_id != theme.palette_id:
        await check_references(ctx, palette_id=data.palette_id)
        changes["palette_id"] = [_str(theme.palette_id), _str(data.palette_id)]
        updates["palette_id"] = data.palette_id
    if "tags" in fields and data.tags is not None and data.tags != list(theme.tags or []):
        changes["tags"] = [list(theme.tags or []), data.tags]
        updates["tags"] = data.tags

    old_slug = theme.slug
    new_slug: str | None = None
    if "slug" in fields and data.slug is not None and data.slug != old_slug:
        new_slug = checked_slug(data.slug)
        await ensure_slug_free(ctx, new_slug, theme_id=theme.id)
        changes["slug"] = [old_slug, new_slug]
        updates["slug"] = new_slug

    if not changes:
        return await theme_view(ctx, theme.id)

    # Eerst alle queries, dan pas de wijzigingen op het object: een query flusht
    # (autoflush), en zo blijft het bij één UPDATE en één stap van lock_version.
    fixed: dict[str, list[int]] = {}
    if new_slug is not None:
        await theme_repo.delete_redirect(ctx.session, new_slug)
        await theme_repo.upsert_redirect(ctx.session, old_slug, theme.id)
        fixed = await fixed_versions_of(ctx, theme.id, old_slug)
    for attribute, value in updates.items():
        setattr(theme, attribute, value)
    audit.record(ctx, "theme.update", entity_id=theme.id, changes=changes)
    await flush_guarded(ctx, theme.id, slug=theme.slug)
    await ctx.session.commit()
    if new_slug is not None:
        await ctx.delivery.invalidate([old_slug, new_slug], fixed_versions=fixed)
    return await theme_view(ctx, theme.id)


def _str(value: uuid.UUID | None) -> str | None:
    return str(value) if value is not None else None


# --- draft -----------------------------------------------------------------------------


async def put_draft(
    ctx: ServiceContext, theme_id: uuid.UUID, css: str, expectation: LockExpectation
) -> schemas.Draft:
    theme = await load_theme(ctx, theme_id)
    ensure_active(theme)
    check_size(ctx, css)
    await check_lock(ctx, theme, expectation)
    if css != theme.draft_css:
        theme.draft_css = css
        theme.draft_updated_at = utcnow()
        theme.draft_updated_by = ctx.actor.user_id
        await flush_guarded(ctx, theme.id, slug=None)
        await ctx.session.commit()
    return await draft_view(ctx, theme)


async def reset_draft(
    ctx: ServiceContext, theme_id: uuid.UUID, number: int, expectation: LockExpectation
) -> schemas.Draft:
    theme = await load_theme(ctx, theme_id)
    ensure_active(theme)
    await check_lock(ctx, theme, expectation)
    version = await theme_repo.get_version(ctx.session, theme.id, number)
    if version is None:
        raise version_not_found(number)
    theme.draft_css = version.css_source
    theme.draft_updated_at = utcnow()
    theme.draft_updated_by = ctx.actor.user_id
    audit.record(ctx, "theme.draft_reset", entity_id=theme.id, changes={"version": number})
    await flush_guarded(ctx, theme.id, slug=None)
    await ctx.session.commit()
    return await draft_view(ctx, theme)


# --- verwijderen en herstellen ---------------------------------------------------------


async def delete_theme(
    ctx: ServiceContext,
    theme_id: uuid.UUID,
    *,
    hard: bool,
    expectation: LockExpectation | None = None,
) -> None:
    """Soft delete (idempotent) of, met `hard`, definitief inclusief alle versies."""
    theme = await load_theme(ctx, theme_id)
    await check_lock(ctx, theme, expectation)
    slug = theme.slug
    fixed = await fixed_versions_of(ctx, theme.id, slug)
    if hard:
        audit.record(
            ctx,
            "theme.delete",
            entity_id=theme.id,
            changes={"hard": True, "slug": slug, "versions": len(fixed[slug])},
        )
        await ctx.session.delete(theme)
    else:
        if theme.deleted_at is not None:
            return  # al verwijderd
        theme.deleted_at = utcnow()
        audit.record(ctx, "theme.delete", entity_id=theme.id, changes={"hard": False, "slug": slug})
    await flush_guarded(ctx, theme_id, slug=None)
    await ctx.session.commit()
    await ctx.delivery.invalidate([slug], fixed_versions=fixed)


async def restore_theme(ctx: ServiceContext, theme_id: uuid.UUID) -> schemas.Theme:
    theme = await load_theme(ctx, theme_id)
    if theme.deleted_at is None:
        return await theme_view(ctx, theme.id)
    await ensure_slug_free(ctx, theme.slug)
    await theme_repo.delete_redirect(ctx.session, theme.slug)
    theme.deleted_at = None
    audit.record(ctx, "theme.restore", entity_id=theme.id, changes={"slug": theme.slug})
    await flush_guarded(ctx, theme.id, slug=theme.slug)
    fixed = await fixed_versions_of(ctx, theme.id, theme.slug)
    await ctx.session.commit()
    await ctx.delivery.invalidate([theme.slug], fixed_versions=fixed)
    return await theme_view(ctx, theme.id)


async def live_version(ctx: ServiceContext, theme: Theme) -> ThemeVersion | None:
    if theme.published_version_id is None:
        return None
    return await theme_repo.get_version_by_id(ctx.session, theme.published_version_id)
