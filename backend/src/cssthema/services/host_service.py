"""Host-koppelingen beheren en `/host/<hostname>.css|.js` samenstellen (cssthema.domain.hosts).

Samenstellen leest per naam eerst `css-files/<naam>.css` (zoals nginx: een bestand gaat voor),
anders de gepubliceerde versie van het thema met die slug (via de Redis-cache van
CssDelivery). Scripts komen altijd uit `css-files/<naam>.js`.
"""

import os
import re
import stat
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from cssthema.config import Settings
from cssthema.db.models import HostBinding, Theme
from cssthema.domain import hosts as domain
from cssthema.domain.css.slugs import SLUG_PATTERN
from cssthema.logging import get_logger
from cssthema.repositories import hosts as host_repo
from cssthema.schemas import hosts as schemas
from cssthema.services import audit
from cssthema.services.context import ServiceContext
from cssthema.services.css_delivery import CssDelivery
from cssthema.services.errors import NotFoundError, ServiceError

log = get_logger(__name__)

# Met de hand gezette bestanden kunnen groot zijn; daarboven slaan we ze over.
MAX_PART_BYTES = 16 * 1024 * 1024
MAX_LISTED_FILES = 2000

_SLUG_RE = re.compile(SLUG_PATTERN)
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


class HostConflictError(ServiceError):
    status, code = 409, "host_conflict"


# --- beheren ----------------------------------------------------------------------------------


def _view(settings: Settings, binding: HostBinding) -> schemas.HostBinding:
    base = settings.public_base_url.rstrip("/")
    return schemas.HostBinding(
        id=binding.id,
        hostname=binding.hostname,
        styles=[str(name) for name in binding.styles],
        scripts=[str(name) for name in binding.scripts],
        enabled=binding.enabled,
        note=binding.note,
        css_url=f"{base}/host/{binding.hostname}.css",
        js_url=f"{base}/host/{binding.hostname}.js",
        created_at=binding.created_at,
        updated_at=binding.updated_at,
    )


async def list_bindings(ctx: ServiceContext) -> list[schemas.HostBinding]:
    return [_view(ctx.settings, b) for b in await host_repo.list_bindings(ctx.session)]


async def _load(ctx: ServiceContext, binding_id: uuid.UUID) -> HostBinding:
    binding = await host_repo.get_binding(ctx.session, binding_id)
    if binding is None:
        raise NotFoundError("Koppeling niet gevonden")
    return binding


def _conflict(hostname: str) -> HostConflictError:
    return HostConflictError(
        "Host bestaat al", detail=f"Er is al een koppeling voor {hostname}: pas die aan."
    )


async def create_binding(
    ctx: ServiceContext, data: schemas.HostBindingInput
) -> schemas.HostBinding:
    if await host_repo.get_by_hostname(ctx.session, data.hostname) is not None:
        raise _conflict(data.hostname)
    binding = HostBinding(
        hostname=data.hostname,
        styles=data.styles,
        scripts=data.scripts,
        enabled=data.enabled,
        note=data.note,
    )
    ctx.session.add(binding)
    await _flush(ctx, data.hostname)
    audit.record(
        ctx,
        "host.create",
        entity_type="host",
        entity_id=binding.id,
        changes={"hostname": binding.hostname, "styles": data.styles, "scripts": data.scripts},
    )
    await ctx.session.commit()
    await ctx.session.refresh(binding)
    await ctx.delivery.refresh_hosts([binding.hostname])
    return _view(ctx.settings, binding)


async def update_binding(
    ctx: ServiceContext, binding_id: uuid.UUID, data: schemas.HostBindingInput
) -> schemas.HostBinding:
    binding = await _load(ctx, binding_id)
    old_hostname = binding.hostname
    if (
        data.hostname != old_hostname
        and await host_repo.get_by_hostname(ctx.session, data.hostname) is not None
    ):
        raise _conflict(data.hostname)
    changes = {
        key: [old, new]
        for key, old, new in (
            ("hostname", binding.hostname, data.hostname),
            ("styles", list(binding.styles), data.styles),
            ("scripts", list(binding.scripts), data.scripts),
            ("enabled", binding.enabled, data.enabled),
        )
        if old != new
    }
    binding.hostname = data.hostname
    binding.styles = data.styles
    binding.scripts = data.scripts
    binding.enabled = data.enabled
    binding.note = data.note
    await _flush(ctx, data.hostname)
    audit.record(ctx, "host.update", entity_type="host", entity_id=binding.id, changes=changes)
    await ctx.session.commit()
    await ctx.session.refresh(binding)
    await ctx.delivery.refresh_hosts([old_hostname, binding.hostname])
    return _view(ctx.settings, binding)


async def delete_binding(ctx: ServiceContext, binding_id: uuid.UUID) -> None:
    binding = await _load(ctx, binding_id)
    hostname = binding.hostname
    audit.record(
        ctx, "host.delete", entity_type="host", entity_id=binding.id, changes={"hostname": hostname}
    )
    await ctx.session.delete(binding)
    await ctx.session.commit()
    await ctx.delivery.refresh_hosts([hostname])


async def _flush(ctx: ServiceContext, hostname: str) -> None:
    try:
        await ctx.session.flush()
    except IntegrityError as exc:  # gelijktijdig aangemaakt
        await ctx.session.rollback()
        raise _conflict(hostname) from exc


async def import_config(
    ctx: ServiceContext, data: schemas.HostImportRequest
) -> schemas.HostImportResult:
    imported, skipped = domain.parse_npm_config(data.text)
    created: list[str] = []
    updated: list[str] = []
    unchanged: list[str] = []
    for host in imported:
        binding = await host_repo.get_by_hostname(ctx.session, host.hostname)
        if binding is None:
            ctx.session.add(
                HostBinding(hostname=host.hostname, styles=host.styles, scripts=host.scripts)
            )
            created.append(host.hostname)
        elif list(binding.styles) == host.styles and list(binding.scripts) == host.scripts:
            unchanged.append(host.hostname)
        elif data.replace:
            binding.styles = host.styles
            binding.scripts = host.scripts
            updated.append(host.hostname)
        else:
            unchanged.append(host.hostname)
    if created or updated:
        audit.record(
            ctx,
            "host.import",
            entity_type="host",
            entity_id=None,
            changes={"created": len(created), "updated": len(updated)},
        )
    await ctx.session.commit()
    await ctx.delivery.refresh_hosts([*created, *updated])
    return schemas.HostImportResult(
        created=created,
        updated=updated,
        unchanged=unchanged,
        skipped=[schemas.HostImportSkipped(line=s.line, reason=s.reason) for s in skipped],
    )


async def options(ctx: ServiceContext) -> schemas.HostOptions:
    published = await ctx.session.scalars(
        select(Theme.slug)
        .where(Theme.deleted_at.is_(None), Theme.published_version_id.is_not(None))
        .order_by(Theme.slug)
    )
    css_files, scripts = await run_in_threadpool(_list_files, ctx.settings.css_files_dir)
    return schemas.HostOptions(
        styles=sorted({*published, *css_files}),
        scripts=scripts,
        snippet=domain.snippet(ctx.settings.public_base_url),
        snippet_own_domain=domain.snippet(ctx.settings.public_base_url, via_own_domain=True),
    )


def _list_files(directory: Path) -> tuple[list[str], list[str]]:
    styles: list[str] = []
    scripts: list[str] = []
    try:
        with os.scandir(directory) as iterator:
            for item in iterator:
                if len(styles) + len(scripts) >= MAX_LISTED_FILES:
                    break
                try:
                    if not item.is_file(follow_symlinks=False):
                        continue
                except OSError:
                    continue
                if item.name.endswith(".css"):
                    name = item.name.removesuffix(".css")
                    if domain.STYLE_NAME_RE.fullmatch(name):
                        styles.append(name)
                elif item.name.endswith(".js"):
                    name = item.name.removesuffix(".js")
                    if domain.SCRIPT_NAME_RE.fullmatch(name) and name != "preview-bridge":
                        scripts.append(name)
    except OSError:
        return [], []
    return sorted(styles), sorted(scripts)


# --- samenstellen (publiek) -------------------------------------------------------------------


async def render(delivery: CssDelivery, settings: Settings, hostname: str, *, kind: str) -> str:
    """De samengevoegde CSS (`kind="css"`) of JS van een host; nooit een fout."""
    binding = await delivery.host_binding(hostname)
    build = domain.build_css if kind == "css" else domain.build_js
    if binding is None:
        return build(hostname, None, [], enabled=True)
    if not binding.enabled:
        return build(hostname, binding.hostname, [], enabled=False)
    directory = settings.css_files_dir
    parts: list[domain.Part] = []
    if kind == "css":
        for name in binding.styles:
            parts.append(await _style_part(delivery, directory, name))
    else:
        for name in binding.scripts:
            content = await run_in_threadpool(_read_file, directory / f"{name}.js")
            parts.append(domain.Part(name, content, "bestand" if content is not None else ""))
    return build(hostname, binding.hostname, parts, enabled=True)


async def _style_part(delivery: CssDelivery, directory: Path, name: str) -> domain.Part:
    content = await run_in_threadpool(_read_file, directory / f"{name}.css")
    if content is not None:
        return domain.Part(name, content, "bestand")
    if _SLUG_RE.fullmatch(name):
        item = await delivery.latest(name)
        if item is None:
            target = await delivery.redirect_target(name)
            if target is not None:
                item = await delivery.latest(target)
        if item is not None:
            return domain.Part(name, item.css, f"thema v{item.version_number}")
    return domain.Part(name, None)


def _read_file(path: Path) -> str | None:
    """Inhoud van een gewoon bestand (geen symlink, geen map), of None."""
    try:
        fd = os.open(path, os.O_RDONLY | _NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_PART_BYTES:
            return None
        chunks = []
        while chunk := os.read(fd, 1024 * 1024):
            chunks.append(chunk)
        return b"".join(chunks).decode("utf-8", errors="replace")
    except OSError as exc:
        log.warning("host_part_read_failed", path=str(path), error=repr(exc))
        return None
    finally:
        os.close(fd)
