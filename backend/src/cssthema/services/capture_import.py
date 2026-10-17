"""Capture-zips van `vastleggen.py` importeren als diensten en snapshots (stappenplan D1).

Een zip (of een deel ervan) bevat `vastgelegd/_css/<sha16>.css` en per dienst
`vastgelegd/<host-met-streepjes>/<pagina>/` met `info.json`, `snapshot.html`, `css.json`,
`kleuren.json` en de screenshots `origineel.jpg`, `met-thema.jpg`, `mobiel.jpg`.

Per pagina komt er één snapshot; een nieuwe import van dezelfde pagina vervangt de vorige.
HTML, stylesheets en screenshots gaan naar storage (services/storage.py), de rest in de
database. De zip wordt nooit uitgepakt op schijf: alles wordt in het geheugen gelezen, met
limieten per bestand en in totaal. Imports lopen na elkaar (advisory lock in storage).
"""

import hashlib
import io
import json
import lzma
import re
import zipfile
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime, tzinfo
from pathlib import PurePosixPath
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, select

from cssthema.db.models import Asset, DomSnapshot, Service
from cssthema.db.models.enums import PageKind, ServiceSource, SnapshotOrigin
from cssthema.domain.hosts import HOSTNAME_RE
from cssthema.logging import get_logger
from cssthema.schemas import captures as schemas
from cssthema.services import audit, storage
from cssthema.services.context import ServiceContext
from cssthema.services.errors import InvalidInputError

log = get_logger(__name__)

MAX_ENTRIES = 20_000
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 400 * 1024 * 1024
SCREENSHOTS = {"origineel": "origineel.jpg", "met_thema": "met-thema.jpg", "mobiel": "mobiel.jpg"}

_CSS_NAME_RE = re.compile(r"^[0-9a-f]{16}\.css$")
_CSS_LINK_RE = re.compile(r"""href=["'](?:\.\./)*_css/([0-9a-f]{16}\.css)["']""")
_CLASS_ATTR_RE = re.compile(r"""\sclass=["']([^"']*)["']""")
_ID_ATTR_RE = re.compile(r"""\sid=["']([^"']+)["']""")
_SLUG_CLEAN_RE = re.compile(r"[^a-z0-9-]+")

# vastleggen.py schrijft de lokale tijd zonder zone; Jonas legt vast in België.
CAPTURE_TIMEZONE = "Europe/Brussels"


@dataclass(slots=True)
class _Page:
    service_dir: PurePosixPath  # vastgelegd/<dienst>
    page_dir: PurePosixPath  # vastgelegd/<dienst>/<pagina>
    css_dir: PurePosixPath  # vastgelegd/_css
    files: dict[str, zipfile.ZipInfo] = field(default_factory=dict)


def _invalid(message: str) -> InvalidInputError:
    return InvalidInputError("Geen geldige capture-zip", detail=message)


def _safe_name(name: str) -> PurePosixPath | None:
    if "\\" in name or name.startswith("/") or "\x00" in name:
        return None
    path = PurePosixPath(name)
    if any(part in ("", ".", "..") for part in path.parts):
        return None
    return path


def _scan(archive: zipfile.ZipFile) -> tuple[list[_Page], dict[str, zipfile.ZipInfo]]:
    infos = archive.infolist()
    if len(infos) > MAX_ENTRIES:
        raise _invalid(f"De zip heeft {len(infos)} bestanden; de limiet is {MAX_ENTRIES}.")
    if sum(i.file_size for i in infos) > MAX_TOTAL_BYTES:
        raise _invalid("De zip is uitgepakt groter dan 400 MB.")
    by_dir: dict[PurePosixPath, dict[str, zipfile.ZipInfo]] = {}
    css: dict[str, zipfile.ZipInfo] = {}
    for info in infos:
        if info.is_dir():
            continue
        path = _safe_name(info.filename)
        if path is None:
            continue
        if path.parent.name == "_css" and _CSS_NAME_RE.fullmatch(path.name):
            css[str(path.parent / path.name)] = info
            continue
        by_dir.setdefault(path.parent, {})[path.name] = info
    pages = []
    for directory, files in sorted(by_dir.items()):
        if "info.json" not in files or len(directory.parts) < 2:
            continue
        service_dir = directory.parent
        pages.append(_Page(service_dir, directory, service_dir.parent / "_css", files))
    return pages, css


def _read(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    if info.file_size > MAX_FILE_BYTES:
        raise _invalid(f"{info.filename} is groter dan 32 MB.")
    try:
        with archive.open(info) as handle:
            data = handle.read(MAX_FILE_BYTES + 1)
    except NotImplementedError as exc:  # vóór RuntimeError: daar is het een subklasse van
        raise _invalid(
            f"{info.filename} gebruikt een compressiemethode die niet ondersteund wordt."
        ) from exc
    except RuntimeError as exc:  # versleuteld: zipfile vraagt een wachtwoord
        raise _invalid(f"{info.filename} is versleuteld; maak de zip zonder wachtwoord.") from exc
    except (zipfile.BadZipFile, zlib.error, lzma.LZMAError, EOFError, OSError) as exc:
        # Verkeerde CRC of kapotte deflate-stroom: een deel dat slecht gekopieerd is.
        raise _invalid(
            f"{info.filename} is beschadigd (CRC- of uitpakfout). Maak of kopieer de zip opnieuw."
        ) from exc
    if len(data) > MAX_FILE_BYTES:
        raise _invalid(f"{info.filename} is groter dan 32 MB.")
    return data


def _json(archive: zipfile.ZipFile, info: zipfile.ZipInfo | None) -> Any:
    if info is None:
        return None
    try:
        return json.loads(_read(archive, info).decode("utf-8", errors="replace"))
    except (ValueError, RecursionError):
        return None


def _clean(value: Any) -> Any:
    """JSON zonder NUL-tekens: PostgreSQL weigert `\\x00` in tekst en `\\u0000` in jsonb."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, dict):
        return {_clean(str(k)): _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def service_slug(hostname: str) -> str:
    """`portainer.jbogaert.be` → `portainer-jbogaert-be` (zoals de mappen in de zip)."""
    return _SLUG_CLEAN_RE.sub("-", hostname.lower()).strip("-")[:64].rstrip("-")


def _hostname(info: dict[str, Any], page: _Page) -> str | None:
    for candidate in (info.get("dienst"), info.get("start_url"), info.get("url")):
        if not isinstance(candidate, str):
            continue
        value = candidate.strip().lower()
        if "://" in value:
            value = value.split("://", 1)[1]
        value = value.split("/", 1)[0].split(":", 1)[0].rstrip(".")
        if HOSTNAME_RE.fullmatch(value):
            return value
    return None


def _capture_zone() -> tzinfo:
    try:
        return ZoneInfo(CAPTURE_TIMEZONE)
    except ZoneInfoNotFoundError:  # geen tzdata op het systeem: dan maar UTC, zoals vroeger
        return UTC


def _captured_at(info: dict[str, Any]) -> str | None:
    """Tijd van de opname als ISO 8601 in UTC (sorteerbaar als tekst).

    Mét zone (`2026-10-06T13:38:07+02:00`) wordt overgenomen; zonder zone (zoals
    vastleggen.py tot nu toe schrijft: `2026-10-06 13:38:07`) is het Belgische tijd.
    """
    value = info.get("vastgelegd")
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.strip())
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=_capture_zone())
        return moment.astimezone(UTC).isoformat()
    except (ValueError, OverflowError):  # onzin, of een jaar 1 dat in UTC jaar 0 wordt
        return None


def _str(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    return value.replace("\x00", "")[:limit] or None


def _http_status(value: Any) -> int | None:
    # `bool` is ook een int; en een getal buiten int4 past niet in de kolom.
    if isinstance(value, int) and not isinstance(value, bool) and 100 <= value <= 599:
        return value
    return None


async def import_zip(
    ctx: ServiceContext, filename: str, data: bytes
) -> schemas.CaptureImportResult:
    if len(data) > ctx.settings.capture_max_bytes:
        raise _invalid("De zip is groter dan 25 MB; upload de delen van vastleggen.py apart.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise _invalid("Dit is geen zip-bestand.") from exc
    filename = filename.replace("\x00", "")[:200]
    with archive:
        pages, css_files = _scan(archive)
        if not pages:
            raise _invalid(
                "Geen vastgelegde pagina's gevonden (mappen met info.json). Is dit een zip "
                "van vastleggen.py?"
            )
        # Twee imports tegelijk (tweede tabblad, een retry) wachten op elkaar in plaats van
        # te botsen op de unieke sha256/slug.
        await storage.lock(ctx.session)
        return await _import_pages(ctx, archive, pages, css_files, filename)


async def _import_pages(
    ctx: ServiceContext,
    archive: zipfile.ZipFile,
    pages: list[_Page],
    css_files: dict[str, zipfile.ZipInfo],
    filename: str,
) -> schemas.CaptureImportResult:
    storage_dir = ctx.settings.storage_dir
    cache: dict[bytes, Asset] = {}
    css_assets: dict[str, Asset] = {}
    result = schemas.CaptureImportResult(
        services_created=[], services_updated=[], snapshots=0, without_snapshot=[], skipped=[]
    )
    services: dict[str, Service] = {}

    async def css_asset(page: _Page, name: str) -> Asset | None:
        key = str(page.css_dir / name)
        if key in css_assets:
            return css_assets[key]
        info = css_files.get(key)
        if info is None:
            return None
        asset = await storage.put(
            ctx.session, storage_dir, _read(archive, info), "text/css; charset=utf-8", cache
        )
        css_assets[key] = asset
        return asset

    for page in pages:
        info = _json(archive, page.files.get("info.json"))
        label = str(page.page_dir)
        if not isinstance(info, dict):
            result.skipped.append(schemas.CaptureSkipped(path=label, reason="info.json onleesbaar"))
            continue
        hostname = _hostname(info, page)
        if hostname is None:
            result.skipped.append(schemas.CaptureSkipped(path=label, reason="geen hostnaam"))
            continue

        service = services.get(hostname) or await _upsert_service(ctx, hostname, info, result)
        services[hostname] = service

        document: Asset | None = None
        stylesheets: list[dict[str, Any]] = []
        missing_css: list[str] = []
        html = ""
        snapshot_info = page.files.get("snapshot.html")
        if snapshot_info is not None:
            raw = _read(archive, snapshot_info)
            html = raw.decode("utf-8", errors="replace")
            document = await storage.put(
                ctx.session, storage_dir, raw, "text/html; charset=utf-8", cache
            )
            for name in dict.fromkeys(_CSS_LINK_RE.findall(html)):
                asset = await css_asset(page, name)
                if asset is None:
                    missing_css.append(name)
                    continue
                stylesheets.append({"name": name, "asset_id": str(asset.id)})
        else:
            result.without_snapshot.append(hostname)

        screenshots: dict[str, str] = {}
        for key, name in SCREENSHOTS.items():
            shot = page.files.get(name)
            if shot is not None:
                asset = await storage.put(
                    ctx.session, storage_dir, _read(archive, shot), "image/jpeg", cache
                )
                screenshots[key] = str(asset.id)

        colors = _json(archive, page.files.get("kleuren.json"))
        raw_thema = info.get("thema")
        thema: dict[str, Any] = raw_thema if isinstance(raw_thema, dict) else {}
        url = _str(info.get("start_url"), 2048) or f"https://{hostname}/"
        page_name = page.page_dir.name
        kind = (
            PageKind.LOGIN
            if info.get("inlogpagina")
            else PageKind.HOME
            if page_name == "start"
            else PageKind.CUSTOM
        )
        # Dezelfde pagina opnieuw geïmporteerd: de vorige snapshot vervalt.
        await ctx.session.execute(
            delete(DomSnapshot).where(
                DomSnapshot.service_id == service.id,
                DomSnapshot.capture_info["pagina"].astext == page_name,
            )
        )
        raw_vars = info.get("variabelen")
        variables: dict[str, Any] = raw_vars if isinstance(raw_vars, dict) else {}
        frameworks = [_clean(f)[:40] for f in _list(info.get("frameworks")) if isinstance(f, str)]
        ctx.session.add(
            DomSnapshot(
                service_id=service.id,
                page_kind=kind,
                url=url,
                final_url=_str(info.get("url"), 2048),
                http_status=_http_status(info.get("http_status")),
                origin=SnapshotOrigin.UPLOAD,
                document_asset_id=document.id if document else None,
                html_sha256=document.sha256 if document else None,
                title=_str(info.get("titel"), 500),
                css_variables={
                    _clean(str(k))[:200]: _clean(str(v))[:500]
                    for k, v in list(variables.items())[:2000]
                },
                components=[],
                framework_hints=frameworks[:20],
                stylesheets=stylesheets,
                colors=_clean(colors) if isinstance(colors, dict) else {},
                class_count=len({c for m in _CLASS_ATTR_RE.findall(html) for c in m.split()}),
                id_count=len(set(_ID_ATTR_RE.findall(html))),
                has_shadow_dom="shadowrootmode" in html,
                capture_info={
                    "pagina": page_name,
                    "status": _str(info.get("status"), 60),
                    "vastgelegd": _captured_at(info),
                    "screenshots": screenshots,
                    "thema_links": [
                        _clean(str(link.get("href")))[:500]
                        for link in _list(thema.get("links"))
                        if isinstance(link, dict)
                    ][:20],
                    "csp_fouten": len(_list(thema.get("csp_fouten"))),
                    "ontbrekende_css": missing_css,
                    "bestand": filename,
                },
            )
        )
        if document is not None:
            result.snapshots += 1
        service.last_crawled_at = datetime.now(UTC)

    audit.record(
        ctx,
        "capture.import",
        entity_type="service",
        entity_id=None,
        changes={
            "file": filename,
            "services_created": len(result.services_created),
            "snapshots": result.snapshots,
        },
    )
    await ctx.session.commit()
    log.info("capture_imported", file=filename, snapshots=result.snapshots)
    return result


async def _upsert_service(
    ctx: ServiceContext, hostname: str, info: dict[str, Any], result: schemas.CaptureImportResult
) -> Service:
    base_url = f"https://{hostname}/"
    service = await ctx.session.scalar(
        select(Service).where(Service.base_url == base_url, Service.deleted_at.is_(None))
    )
    title = _str(info.get("titel"), 120)
    if service is None:
        slug = service_slug(hostname)
        taken = await ctx.session.scalar(
            select(Service.id).where(Service.slug == slug, Service.deleted_at.is_(None))
        )
        if taken is not None:
            slug = f"{slug[:55]}-{hashlib.sha256(hostname.encode()).hexdigest()[:6]}"
        service = Service(
            slug=slug,
            name=title or hostname,
            base_url=base_url,
            source=ServiceSource.IMPORT,
            tags=[],
        )
        ctx.session.add(service)
        await ctx.session.flush()
        result.services_created.append(hostname)
    else:
        if title and service.name == hostname:
            service.name = title
        if hostname not in result.services_updated:
            result.services_updated.append(hostname)
    return service
