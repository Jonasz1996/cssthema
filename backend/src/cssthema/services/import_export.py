"""Export (`.css`, bundel) en import (upload en handgemaakte bestanden op de server).

Lokale bestanden zijn Jonas' migratiepad: nginx serveert `css-files/<slug>.css` vóór de
api. Na de import verplaatsen we het bestand naar `css-files/.geimporteerd/`, zodat
nginx naar de api doorvalt en dezelfde URL meteen het thema serveert.
"""

import errno
import os
import re
import stat
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from cssthema.db.models import Palette, Theme
from cssthema.db.models.enums import VersionSource
from cssthema.domain.css.linter import LintResult
from cssthema.domain.css.slugs import InvalidSlug, slugify, validate_slug, with_suffix
from cssthema.domain.export.bundle import (
    BUNDLE_SUFFIX,
    MAX_BUNDLE_BYTES,
    Bundle,
    BundleError,
    BundleTheme,
    BundleVersion,
    build_bundle,
    decode_css,
    read_bundle,
)
from cssthema.repositories import palettes as palette_repo
from cssthema.repositories import themes as theme_repo
from cssthema.schemas import themes as schemas
from cssthema.services import audit
from cssthema.services.context import ServiceContext, utcnow
from cssthema.services.errors import (
    InvalidInputError,
    PayloadTooLargeError,
    SlugConflictError,
    StateConflictError,
    UnsupportedMediaTypeError,
)
from cssthema.services.publish_service import create_version, lint_failed, palette_tokens
from cssthema.services.theme_service import (
    checked_slug,
    ensure_active,
    flush_guarded,
    live_version,
    load_theme,
    new_theme,
    run_lint,
    slug_conflict,
    theme_view,
    version_not_found,
)

ARCHIVE_DIR_NAME = ".geimporteerd"
MAX_LISTED_FILES = 2000
LOCAL_FILE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]\.css$")
ZIP_MAGIC = b"PK\x03\x04"

REASON_SYMLINK = "Symbolische link; die wordt niet gevolgd."
REASON_BAD_NAME = (
    "De bestandsnaam is geen geldige slug (alleen kleine letters, cijfers en streepjes)."
)
REASON_EXISTS = "Er bestaat al een thema met deze slug."
REASON_NOT_REGULAR = "Geen gewoon bestand (bv. een map)."
REASON_NOT_ARCHIVED = (
    "Niet gearchiveerd: het thema is niet gepubliceerd, dus het bestand blijft de URL "
    "bedienen. Publiceer het thema en verplaats het bestand daarna zelf naar "
    f"{ARCHIVE_DIR_NAME}/."
)


# --- export ----------------------------------------------------------------------------


async def export_css(
    ctx: ServiceContext, theme_id: uuid.UUID, version_number: int | None
) -> tuple[str, str]:
    """Bestandsnaam en gecompileerde CSS van de live versie (of versie N)."""
    theme = await load_theme(ctx, theme_id)
    if version_number is not None:
        version = await theme_repo.get_version(ctx.session, theme.id, version_number)
        if version is None:
            raise version_not_found(version_number)
    else:
        version = await live_version(ctx, theme)
        if version is None:
            raise StateConflictError(
                "Thema is nog niet gepubliceerd",
                detail="Publiceer eerst, of exporteer een specifieke versie (?version=n).",
            )
    return f"{theme.slug}.css", version.css_compiled


async def export_bundle(ctx: ServiceContext, theme_id: uuid.UUID) -> tuple[str, bytes]:
    """`<slug>.cssthema.zip` met manifest, draft en de bron van alle versies."""
    theme = await load_theme(ctx, theme_id)
    versions = await theme_repo.all_versions(ctx.session, theme.id)
    palette = await ctx.session.get(Palette, theme.palette_id) if theme.palette_id else None
    live_number = next(
        (v.version_number for v in versions if v.id == theme.published_version_id), None
    )
    bundle = Bundle(
        theme=BundleTheme(
            slug=theme.slug,
            name=theme.name,
            description=theme.description,
            tags=tuple(theme.tags or ()),
            palette_slug=palette.slug if palette else None,
        ),
        draft=theme.draft_css,
        versions=tuple(
            BundleVersion(
                number=v.version_number,
                css=v.css_source,
                message=v.message,
                source=v.source.value,
                created_at=v.created_at,
            )
            for v in versions
        ),
        live_version=live_number,
        exported_at=utcnow(),
    )
    data = await run_in_threadpool(build_bundle, bundle)
    return f"{theme.slug}{BUNDLE_SUFFIX}", data


# --- import van een upload ---------------------------------------------------------------


def _file_error(title: str, message: str) -> InvalidInputError:
    return InvalidInputError(
        title,
        detail=message,
        errors=[{"loc": ["body", "file"], "msg": message, "type": "value_error"}],
    )


def _display_name(filename: str, limit: int = 120) -> str:
    """Bestandsnaam voor berichten en de audit-log (versieberichten: max. 500 tekens)."""
    if len(filename) <= limit:
        return filename
    return filename[: limit - 21] + "…" + filename[-20:]


def _clean_name(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.replace("\0", "").split())[:120]
    return cleaned or None


def _clean_message(value: str | None) -> str | None:
    if value is None:
        return None
    return value.replace("\0", "").strip()[:500] or None


def _lenient_tags(tags: tuple[str, ...]) -> list[str]:
    cleaned: list[str] = []
    for tag in tags:
        normalized = " ".join(tag.replace("\0", "").split()).lower()[:40]
        if normalized and normalized not in cleaned:
            cleaned.append(normalized)
    return cleaned[:20]


async def _free_slug(ctx: ServiceContext, base: str) -> str:
    """`base-2`, `base-3`, … : de eerste slug die geen thema of recente redirect heeft."""
    taken = set(
        (
            await ctx.session.scalars(
                select(Theme.slug).where(
                    Theme.deleted_at.is_(None),
                    Theme.slug.like(theme_repo.escape_like(base[:56]) + "%", escape="\\"),
                )
            )
        ).all()
    )
    taken |= await theme_repo.recent_redirect_slugs(ctx.session, theme_repo.redirect_cutoff())
    for number in range(2, 10_000):
        candidate = with_suffix(base, number)
        if candidate not in taken:
            return candidate
    raise slug_conflict(base)  # pragma: no cover - 10.000 varianten bezet


async def import_upload(
    ctx: ServiceContext,
    *,
    filename: str,
    data: bytes,
    on_conflict: str,
    publish: bool | None,
    name: str | None,
) -> tuple[schemas.Theme, bool]:
    """Importeert een `.css` of `.cssthema.zip`; geeft het thema en of het nieuw is."""
    # Alleen de bestandsnaam, zonder stuurtekens (NUL kan niet in PostgreSQL-tekst).
    base_name = PurePosixPath(filename.replace("\\", "/")).name
    base_name = "".join(char for char in base_name if char.isprintable()) or "upload"
    lower = base_name.lower()
    if lower.endswith(".zip") or data.startswith(ZIP_MAGIC):
        return await _import_bundle(
            ctx, filename=base_name, data=data, on_conflict=on_conflict, publish=publish, name=name
        )
    if lower.endswith(".css"):
        return await _import_css(
            ctx,
            filename=base_name,
            data=data,
            on_conflict=on_conflict,
            publish=bool(publish),
            name=name,
        )
    raise UnsupportedMediaTypeError(
        "Onbekend bestandstype", detail="Upload een .css-bestand of een .cssthema.zip-bundel."
    )


async def _import_css(
    ctx: ServiceContext,
    *,
    filename: str,
    data: bytes,
    on_conflict: str,
    publish: bool,
    name: str | None,
) -> tuple[schemas.Theme, bool]:
    limit = ctx.settings.css_max_bytes
    if len(data) > limit:
        raise PayloadTooLargeError(
            "CSS is te groot",
            detail=f"Het bestand is {len(data)} bytes; de limiet is {limit} bytes.",
            extra={"size_bytes": len(data), "limit_bytes": limit},
        )
    try:
        css = decode_css(data, filename)
    except BundleError as exc:
        raise _file_error("Ongeldig bestand", str(exc)) from exc
    stem = filename[: -len(".css")] if filename.lower().endswith(".css") else filename
    theme_name = _clean_name(name) or _clean_name(stem) or "Geïmporteerd thema"
    slug = checked_slug(slugify(name or stem))

    existing = await theme_repo.active_theme_id_by_slug(ctx.session, slug)
    if existing is not None:
        if on_conflict == "fail":
            raise slug_conflict(slug, existing)
        if on_conflict == "new_version":
            return await _new_version_on(
                ctx, existing, draft=css, version_css=css, publish=publish, file=filename, fmt="css"
            )
        slug = await _free_slug(ctx, slug)

    result = await run_lint(ctx, css) if publish else None
    if result is not None and not result.ok:
        raise lint_failed(result)

    redirect_removed = await theme_repo.delete_redirect(ctx.session, slug)
    theme = new_theme(ctx, slug=slug, name=theme_name, css=css)
    ctx.session.add(theme)
    await flush_guarded(ctx, theme.id, slug=slug)
    changes: dict[str, object] = {
        "format": "css",
        "file": _display_name(filename),
        "slug": slug,
        "on_conflict": on_conflict,
        "publish": publish,
    }
    if result is not None:
        version = await create_version(
            ctx,
            theme,
            css_source=css,
            source=VersionSource.IMPORT,
            message=f"Geïmporteerd uit {_display_name(filename)}",
            palette_id=None,
            tokens=None,
            lint_warnings=result.warnings,
            make_live=True,
        )
        changes["version"] = version.version_number
    audit.record(ctx, "theme.import", entity_id=theme.id, changes=changes)
    await ctx.session.commit()
    if publish or redirect_removed:
        await ctx.delivery.invalidate([slug])
    return await theme_view(ctx, theme.id), True


async def _new_version_on(
    ctx: ServiceContext,
    theme_id: uuid.UUID,
    *,
    draft: str,
    version_css: str | None,
    publish: bool,
    file: str,
    fmt: str,
) -> tuple[schemas.Theme, bool]:
    """`on_conflict=new_version`: nieuwe draft + versie (bron `import`) op het bestaande thema."""
    theme = await load_theme(ctx, theme_id)
    ensure_active(theme)
    result = await run_lint(ctx, version_css) if version_css is not None else None
    if result is not None and not result.ok:
        raise lint_failed(result)
    draft_updates = {
        "draft_css": draft,
        "draft_updated_at": utcnow(),
        "draft_updated_by": ctx.actor.user_id,
    }
    changes: dict[str, object] = {
        "format": fmt,
        "file": _display_name(file),
        "mode": "new_version",
    }
    live = False
    if version_css is not None and result is not None:
        version = await create_version(
            ctx,
            theme,
            css_source=version_css,
            source=VersionSource.IMPORT,
            message=f"Geïmporteerd uit {_display_name(file)}",
            palette_id=theme.palette_id,
            tokens=await palette_tokens(ctx, theme.palette_id),
            lint_warnings=result.warnings,
            make_live=publish,
            theme_updates=draft_updates,
        )
        live = publish
        changes.update(version=version.version_number, publish=publish)
    else:
        for attribute, value in draft_updates.items():
            setattr(theme, attribute, value)
        await flush_guarded(ctx, theme.id, slug=theme.slug)
    audit.record(ctx, "theme.import", entity_id=theme.id, changes=changes)
    await ctx.session.commit()
    if live:
        await ctx.delivery.invalidate([theme.slug])
    return await theme_view(ctx, theme.id), False


async def _import_bundle(
    ctx: ServiceContext,
    *,
    filename: str,
    data: bytes,
    on_conflict: str,
    publish: bool | None,
    name: str | None,
) -> tuple[schemas.Theme, bool]:
    if len(data) > MAX_BUNDLE_BYTES:
        raise PayloadTooLargeError("Bundel is te groot", detail="De limiet is 25 MB.")
    try:
        bundle = await run_in_threadpool(
            read_bundle, data, max_css_bytes=ctx.settings.css_max_bytes
        )
    except BundleError as exc:
        raise _file_error("Ongeldige bundel", str(exc)) from exc
    slug = checked_slug(bundle.theme.slug)

    # Elke versie is publiek bereikbaar via /themes/<slug>@<n>.css: allemaal linten.
    lint_results: dict[int, LintResult] = {}
    for version in bundle.versions:
        result = await run_lint(ctx, version.css)
        if not result.ok:
            raise lint_failed(result, prefix=f"v{version.number}: ")
        lint_results[version.number] = result

    live_number = bundle.live_version
    if publish is False:
        live_number = None
    elif publish and live_number is None and bundle.versions:
        live_number = bundle.versions[-1].number

    existing = await theme_repo.active_theme_id_by_slug(ctx.session, slug)
    if existing is not None:
        if on_conflict == "fail":
            raise slug_conflict(slug, existing)
        if on_conflict == "new_version":
            chosen = next((v for v in bundle.versions if v.number == live_number), bundle.live) or (
                bundle.versions[-1] if bundle.versions else None
            )
            return await _new_version_on(
                ctx,
                existing,
                draft=bundle.draft,
                version_css=chosen.css if chosen else None,
                publish=live_number is not None,
                file=filename,
                fmt="bundle",
            )
        slug = await _free_slug(ctx, slug)

    palette = (
        await palette_repo.get_palette_by_slug(ctx.session, bundle.theme.palette_slug)
        if bundle.theme.palette_slug
        else None
    )
    tokens = await palette_tokens(ctx, palette.id) if palette else None
    redirect_removed = await theme_repo.delete_redirect(ctx.session, slug)
    theme = new_theme(
        ctx,
        slug=slug,
        name=_clean_name(name) or _clean_name(bundle.theme.name) or slug,
        css=bundle.draft,
        description=(bundle.theme.description or "")[:2000].replace("\0", "") or None,
        palette_id=palette.id if palette else None,
        tags=_lenient_tags(bundle.theme.tags),
    )
    ctx.session.add(theme)
    await flush_guarded(ctx, theme.id, slug=slug)

    new_live: int | None = None
    for version in bundle.versions:
        created = await create_version(
            ctx,
            theme,
            css_source=version.css,
            source=VersionSource.IMPORT,
            message=_clean_message(version.message),
            palette_id=theme.palette_id,
            tokens=tokens,
            lint_warnings=lint_results[version.number].warnings,
            make_live=version.number == live_number,
        )
        if version.number == live_number:
            new_live = created.version_number
    audit.record(
        ctx,
        "theme.import",
        entity_id=theme.id,
        changes={
            "format": "bundle",
            "file": _display_name(filename),
            "slug": slug,
            "on_conflict": on_conflict,
            "versions": len(bundle.versions),
            "live_version": new_live,
        },
    )
    await ctx.session.commit()
    if new_live is not None or redirect_removed:
        await ctx.delivery.invalidate([slug])
    return await theme_view(ctx, theme.id), True


# --- handgemaakte bestanden op de server ----------------------------------------------------


@dataclass(frozen=True, slots=True)
class _LocalEntry:
    name: str
    size: int
    modified_at: datetime
    symlink: bool


class _LocalFileError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _scan_css_dir(directory: Path) -> list[_LocalEntry]:
    """`*.css` direct in de map (niet recursief, symlinks niet gevolgd)."""
    entries: list[_LocalEntry] = []
    try:
        with os.scandir(directory) as iterator:
            for entry in iterator:
                if entry.name.startswith(".") or not entry.name.endswith(".css"):
                    continue
                try:
                    symlink = entry.is_symlink()
                    if not symlink and not entry.is_file(follow_symlinks=False):
                        continue
                    info = entry.stat(follow_symlinks=False)
                except OSError:
                    continue
                entries.append(
                    _LocalEntry(
                        name=entry.name,
                        size=info.st_size,
                        modified_at=datetime.fromtimestamp(info.st_mtime, UTC),
                        symlink=symlink,
                    )
                )
    except OSError:
        return []  # map bestaat niet (Docker) of is niet leesbaar
    entries.sort(key=lambda e: e.name)
    return entries[:MAX_LISTED_FILES]


def _local_slug(name: str) -> tuple[str | None, str | None]:
    """De slug van een bestandsnaam, of de reden waarom die niet bruikbaar is."""
    if not LOCAL_FILE_RE.fullmatch(name):
        return None, REASON_BAD_NAME
    slug = name[: -len(".css")]
    try:
        validate_slug(slug)
    except InvalidSlug as exc:
        return None, exc.reason
    return slug, None


async def list_local_files(ctx: ServiceContext) -> list[schemas.LocalCssFile]:
    entries = await run_in_threadpool(_scan_css_dir, ctx.settings.css_files_dir)
    slugs = {entry.name: _local_slug(entry.name) for entry in entries}
    existing = await theme_repo.active_theme_ids_by_slugs(
        ctx.session, [slug for slug, _ in slugs.values() if slug]
    )
    limit = ctx.settings.css_max_bytes
    files: list[schemas.LocalCssFile] = []
    for entry in entries:
        slug, reason = slugs[entry.name]
        theme_id = existing.get(slug) if slug else None
        if entry.symlink:
            reason = REASON_SYMLINK
        elif reason is None and entry.size > limit:
            reason = f"Groter dan {limit // 1024} KB."
        elif reason is None and theme_id is not None:
            reason = REASON_EXISTS
        files.append(
            schemas.LocalCssFile(
                name=entry.name,
                slug=slug,
                size_bytes=entry.size,
                modified_at=entry.modified_at,
                importable=reason is None,
                reason=reason,
                theme_id=theme_id,
            )
        )
    return files


def _read_local_file(path: Path, max_bytes: int) -> str:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError as exc:
        raise _LocalFileError("Bestand niet gevonden.") from exc
    except PermissionError as exc:
        raise _LocalFileError("Geen leesrechten op het bestand.") from exc
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise _LocalFileError(REASON_SYMLINK) from exc
        raise _LocalFileError(f"Het bestand kan niet geopend worden ({exc.strerror}).") from exc
    try:
        # Eerst controleren: os.open() lukt ook op een map (of FIFO), os.fdopen() niet.
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise _LocalFileError(REASON_NOT_REGULAR)
        data = b""
        while len(data) <= max_bytes:
            chunk = os.read(fd, max_bytes + 1 - len(data))
            if not chunk:
                break
            data += chunk
    except OSError as exc:
        raise _LocalFileError(f"Het bestand kan niet gelezen worden ({exc.strerror}).") from exc
    finally:
        os.close(fd)
    if len(data) > max_bytes:
        raise _LocalFileError(f"Groter dan {max_bytes // 1024} KB.")
    try:
        return decode_css(data, path.name)
    except BundleError as exc:
        raise _LocalFileError(str(exc)) from exc


def _archive_local_file(directory: Path, name: str) -> str | None:
    """Verplaatst het bestand naar `.geimporteerd/`; geeft een foutmelding of None."""
    archive_dir = directory / ARCHIVE_DIR_NAME
    try:
        archive_dir.mkdir(mode=0o755, exist_ok=True)
        target = archive_dir / name
        if os.path.lexists(target):
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            stem = name[: -len(".css")]
            target = archive_dir / f"{stem}.{stamp}.css"
            counter = 2
            while os.path.lexists(target):
                target = archive_dir / f"{stem}.{stamp}-{counter}.css"
                counter += 1
        os.rename(directory / name, target)
    except OSError as exc:
        return (
            f"Archiveren naar {ARCHIVE_DIR_NAME}/ is mislukt ({exc.strerror or exc}); het "
            "bestand gaat nog voor op het thema. Verplaats of verwijder het zelf."
        )
    return None


def _theme_name_from_slug(slug: str) -> str:
    return " ".join(part.capitalize() for part in slug.split("-"))


async def import_local_files(
    ctx: ServiceContext, request: schemas.LocalImportRequest
) -> schemas.LocalImportResult:
    imported: list[schemas.ImportedTheme] = []
    skipped: list[schemas.SkippedFile] = []
    for name in request.names:
        try:
            imported.append(
                await _import_local_file(
                    ctx, name, publish=request.publish, archive=request.archive
                )
            )
        except _LocalFileError as exc:
            skipped.append(schemas.SkippedFile(name=name, reason=exc.reason))
        except OSError as exc:
            # Eerdere bestanden zijn al geïmporteerd (en verplaatst): één onverwacht
            # bestand mag de hele response niet kapotmaken.
            await ctx.session.rollback()
            skipped.append(
                schemas.SkippedFile(
                    name=name, reason=f"Het bestand kan niet gelezen worden ({exc.strerror})."
                )
            )
    return schemas.LocalImportResult(imported=imported, skipped=skipped)


async def _import_local_file(
    ctx: ServiceContext, name: str, *, publish: bool, archive: bool
) -> schemas.ImportedTheme:
    slug, reason = _local_slug(name)
    if slug is None:
        raise _LocalFileError(reason or REASON_BAD_NAME)
    directory = ctx.settings.css_files_dir
    css = await run_in_threadpool(_read_local_file, directory / name, ctx.settings.css_max_bytes)
    if await theme_repo.active_theme_id_by_slug(ctx.session, slug) is not None:
        raise _LocalFileError(REASON_EXISTS)

    result = await run_lint(ctx, css)
    if publish and not result.ok:
        first = result.errors[0]
        count = len(result.errors)
        raise _LocalFileError(
            f"Publiceren geweigerd: {count} {'fout' if count == 1 else 'fouten'}; eerste op "
            f"regel {first.line}, kolom {first.column}: {first.message}"
        )

    live = False
    try:
        redirect_removed = await theme_repo.delete_redirect(ctx.session, slug)
        theme = new_theme(ctx, slug=slug, name=_theme_name_from_slug(slug), css=css)
        ctx.session.add(theme)
        await flush_guarded(ctx, theme.id, slug=slug)
        changes: dict[str, object] = {"format": "local-file", "file": name, "slug": slug}
        if result.ok:
            version = await create_version(
                ctx,
                theme,
                css_source=css,
                source=VersionSource.IMPORT,
                message=f"Geïmporteerd uit {directory.name}/{name}",
                palette_id=None,
                tokens=None,
                lint_warnings=result.warnings,
                make_live=publish,
            )
            live = publish
            changes["version"] = version.version_number
        changes["publish"] = live
        audit.record(ctx, "theme.import", entity_id=theme.id, changes=changes)
        await ctx.session.commit()
    except SlugConflictError as exc:
        raise _LocalFileError(REASON_EXISTS) from exc

    archive_error: str | None = None
    if archive and live:
        archive_error = await run_in_threadpool(_archive_local_file, directory, name)
    elif archive:
        # Zonder live versie zou de URL na het archiveren 404 geven: het bestand blijft.
        archive_error = REASON_NOT_ARCHIVED
    if live or redirect_removed:
        await ctx.delivery.invalidate([slug])
    view = await theme_view(ctx, theme.id)
    return schemas.ImportedTheme(**view.model_dump(), source_file=name, archive_error=archive_error)


async def local_files_summary(ctx: ServiceContext) -> tuple[int, int]:
    files = await list_local_files(ctx)
    return len(files), sum(1 for f in files if f.importable)
