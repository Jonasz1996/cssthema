"""Host-koppelingen beheren en `/host/<hostname>.css|.js` samenstellen (cssthema.domain.hosts).

Samenstellen leest per naam eerst `css-files/<naam>.css` (zoals nginx: een bestand gaat voor),
anders de gepubliceerde versie van het thema met die slug (via de Redis-cache van
CssDelivery). Scripts komen altijd uit `css-files/<naam>.js`.
"""

import os
import re
import stat
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

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
from cssthema.schemas.hosts import HealthLevel
from cssthema.services import audit, host_health
from cssthema.services.context import ServiceContext
from cssthema.services.css_delivery import CssDelivery, HostBindingView
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
    # Op de achtergrond: 2 paden per host aan 10 per seconde laat het verzoek anders ± 10 s
    # wachten. Ook nieuwe hosts: die hadden in nginx de gecachte redirect naar `*`.
    ctx.delivery.refresh_hosts_later([*created, *updated])
    return schemas.HostImportResult(
        created=created,
        updated=updated,
        unchanged=unchanged,
        skipped=[schemas.HostImportSkipped(line=s.line, reason=s.reason) for s in skipped],
    )


async def bulk_update(ctx: ServiceContext, data: schemas.HostBulkRequest) -> schemas.HostBulkResult:
    """Eén wijziging voor veel koppelingen (stappenplan FEAT-3): een naam toevoegen, weghalen of
    vervangen in de thema's of scripts, of aan/uit. Hosts die nooit iets krijgen, slaan we over.
    Daarna één refresh van de gewijzigde bundels, op de achtergrond."""
    bindings = {b.hostname: b for b in await host_repo.list_bindings(ctx.session)}
    excluded = ctx.settings.never_inject_hosts
    limit = domain.MAX_STYLES if data.kind == "styles" else domain.MAX_SCRIPTS
    changed: list[str] = []
    unchanged: list[str] = []
    skipped: list[schemas.HostBulkSkipped] = []
    for hostname in data.hostnames if data.hostnames is not None else list(bindings):
        binding = bindings.get(hostname)
        if binding is None or hostname in excluded:
            reason = (
                "Geen eigen koppeling."
                if binding is None
                else "Krijgt nooit iets (dashboard, CSS-domein of EXCLUDED_HOSTS)."
            )
            skipped.append(schemas.HostBulkSkipped(hostname=hostname, reason=reason))
            continue
        if data.action in ("enable", "disable"):
            enabled = data.action == "enable"
            if binding.enabled == enabled:
                unchanged.append(hostname)
            else:
                binding.enabled = enabled
                changed.append(hostname)
            continue
        current = [str(name) for name in getattr(binding, data.kind)]
        names = domain.edit_names(current, data.action, data.name or "", data.replacement)
        if names == current:
            unchanged.append(hostname)
        elif len(names) > limit:
            skipped.append(
                schemas.HostBulkSkipped(hostname=hostname, reason=f"Hoogstens {limit} namen.")
            )
        else:
            setattr(binding, data.kind, names)
            changed.append(hostname)
    if changed:
        audit.record(
            ctx,
            "host.bulk",
            entity_type="host",
            entity_id=None,
            changes={
                "action": data.action,
                "kind": data.kind,
                "name": data.name,
                "replacement": data.replacement,
                "hosts": len(changed),
            },
        )
    await ctx.session.commit()
    ctx.delivery.refresh_hosts_later(changed)
    return schemas.HostBulkResult(changed=changed, unchanged=unchanged, skipped=skipped)


async def options(ctx: ServiceContext) -> schemas.HostOptions:
    published = await ctx.session.scalars(
        select(Theme.slug)
        .where(Theme.deleted_at.is_(None), Theme.published_version_id.is_not(None))
        .order_by(Theme.slug)
    )
    css_files, scripts = await run_in_threadpool(_list_files, ctx.settings.css_files_dir)
    base = ctx.settings.public_base_url
    return schemas.HostOptions(
        styles=sorted({*published, *css_files}),
        scripts=scripts,
        snippet=domain.snippet(base),
        snippet_own_domain=domain.snippet_own_domain(base),
        snippet_own_domain_script=domain.snippet_own_domain(base, script=True),
        excluded_hosts=sorted(ctx.settings.never_inject_hosts),
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


_UNSET: Any = object()


async def render(
    delivery: CssDelivery,
    settings: Settings,
    hostname: str,
    *,
    kind: str,
    binding: HostBindingView | None = _UNSET,
) -> str:
    """De samengevoegde CSS (`kind="css"`) of JS van een host; nooit een fout."""
    if binding is _UNSET:
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
        # utf-8-sig: een BOM (Windows-editor) zou anders midden in de bundel staan.
        return b"".join(chunks).decode("utf-8-sig", errors="replace")
    except OSError as exc:
        log.warning("host_part_read_failed", path=str(path), error=repr(exc))
        return None
    finally:
        os.close(fd)


# --- gezondheid (C3) --------------------------------------------------------------------------

_LEVEL_ORDER: dict[HealthLevel, int] = {"unknown": 0, "ok": 1, "warn": 2, "error": 3}
# Een eigen koppeling die zo lang niet geladen is: staat de regel wel in die proxy host? Ook
# voor hosts achter Authentik, waar de controle zelf alleen "achter login" ziet.
STALE_AFTER = timedelta(days=14)


def _at_least(level: HealthLevel, minimum: HealthLevel) -> HealthLevel:
    return level if _LEVEL_ORDER[level] >= _LEVEL_ORDER[minimum] else minimum


async def health(ctx: ServiceContext) -> schemas.HostHealthOverview:
    redis = ctx.delivery.redis
    bindings = await host_repo.list_bindings(ctx.session)
    services = set(await host_repo.service_hostnames(ctx.session))
    seen_at = await host_health.seen(redis)
    checks, meta = await host_health.check_results(redis)
    directory = ctx.settings.css_files_dir
    excluded = ctx.settings.never_inject_hosts
    stale_before = datetime.now(UTC) - STALE_AFTER
    hosts: list[schemas.HostHealth] = []
    for binding in bindings:
        missing_styles = [
            name
            for name in binding.styles
            if not await _style_exists(ctx.delivery, directory, str(name))
        ]
        missing_scripts = [
            str(name)
            for name in binding.scripts
            if not await run_in_threadpool(_is_file, directory / f"{name}.js")
        ]
        is_excluded = binding.hostname in excluded
        active = binding.enabled and not is_excluded
        check = _check_view(checks.get(binding.hostname)) if active else None
        level: HealthLevel = check.level if check else "unknown"
        if missing_styles or missing_scripts:
            level = _at_least(level, "warn")
        last_seen = seen_at.get(binding.hostname)
        stale = (
            active
            and binding.hostname != domain.DEFAULT_HOST
            and (last_seen is None or last_seen < stale_before)
        )
        if stale:
            level = _at_least(level, "warn")
        if not active:
            level = "unknown"
        hosts.append(
            schemas.HostHealth(
                hostname=binding.hostname,
                bound=True,
                enabled=binding.enabled,
                level=level,
                last_seen=last_seen,
                missing_styles=[str(n) for n in missing_styles],
                missing_scripts=missing_scripts,
                check=check,
                stale=stale,
                service=binding.hostname in services,
                excluded=is_excluded,
            )
        )
    # Zonder eigen koppeling: wat de regel laadde, en de diensten die `*` volgen (die worden
    # ook gecontroleerd, zie host_health.check_hostnames).
    bound = {b.hostname: b for b in bindings}
    default = bound.get(domain.DEFAULT_HOST)
    followers = services if default is not None and default.enabled else set()
    unbound = (seen_at.keys() | followers) - bound.keys() - excluded
    for name in sorted(unbound, key=lambda n: (n not in seen_at, -_timestamp(seen_at.get(n)), n)):
        check = _check_view(checks.get(name)) if name in followers else None
        hosts.append(
            schemas.HostHealth(
                hostname=name,
                bound=False,
                enabled=True,
                level=check.level if check else "unknown",
                last_seen=seen_at.get(name),
                missing_styles=[],
                missing_scripts=[],
                check=check,
                service=name in services,
            )
        )
    return schemas.HostHealthOverview(
        hosts=hosts,
        check_running=bool(meta.get("running")),
        check_started_at=meta.get("started_at"),
        check_finished_at=meta.get("finished_at"),
    )


def _timestamp(moment: datetime | None) -> float:
    return moment.timestamp() if moment else 0.0


def _check_view(raw: dict[str, Any] | None) -> schemas.HostCheck | None:
    if raw is None:
        return None
    try:
        return schemas.HostCheck.model_validate(raw)
    except ValueError:
        return None


async def _style_exists(delivery: CssDelivery, directory: Path, name: str) -> bool:
    if await run_in_threadpool(_is_file, directory / f"{name}.css"):
        return True
    if not _SLUG_RE.fullmatch(name):
        return False
    if await delivery.latest(name) is not None:
        return True
    target = await delivery.redirect_target(name)
    return target is not None and await delivery.latest(target) is not None


def _is_file(path: Path) -> bool:
    try:
        return stat.S_ISREG(os.lstat(path).st_mode)
    except OSError:
        return False


async def forget_unbound(ctx: ServiceContext, hostnames: list[str] | None = None) -> None:
    """Haalt hosts uit 'laatst geladen' (bv. een oude naam die niet meer bestaat); None: elke
    host zonder eigen koppeling (ook verzonnen namen van buitenaf)."""
    redis = ctx.delivery.redis
    if hostnames is None:
        bound = {b.hostname for b in await host_repo.list_bindings(ctx.session)}
        hostnames = sorted((await host_health.seen(redis)).keys() - bound)
    await host_health.forget_seen(redis, hostnames)
