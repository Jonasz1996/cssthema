"""Diensten en hun snapshots lezen (D1/D2): lijst, document voor de preview, afbeeldingen."""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import delete, select
from starlette.concurrency import run_in_threadpool

from cssthema.db.models import Asset, DomSnapshot, Service
from cssthema.schemas import captures as schemas
from cssthema.services import audit, storage
from cssthema.services.context import ServiceContext, utcnow
from cssthema.services.errors import NotFoundError

# Te groot voor de preview wordt het nooit (vastleggen.py kapt af), maar begrens toch.
MAX_DOCUMENT_BYTES = 16 * 1024 * 1024
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")


def _hostname(base_url: str) -> str:
    return urlsplit(base_url).hostname or base_url


def asset_url(asset_id: str) -> str:
    return f"/api/v1/assets/{asset_id}"


def _summary(snapshot: DomSnapshot) -> schemas.SnapshotSummary:
    info: dict[str, Any] = snapshot.capture_info or {}
    captured = info.get("vastgelegd")
    return schemas.SnapshotSummary(
        id=snapshot.id,
        page=str(info.get("pagina") or snapshot.page_kind),
        page_kind=str(snapshot.page_kind),
        title=snapshot.title,
        url=snapshot.url,
        status=info.get("status"),
        has_document=snapshot.document_asset_id is not None,
        frameworks=[str(f) for f in snapshot.framework_hints],
        class_count=snapshot.class_count,
        has_shadow_dom=snapshot.has_shadow_dom,
        theme_links=[str(link) for link in info.get("thema_links") or []],
        csp_errors=int(info.get("csp_fouten") or 0),
        screenshots={k: asset_url(v) for k, v in (info.get("screenshots") or {}).items()},
        captured_at=datetime.fromisoformat(captured) if isinstance(captured, str) else None,
        imported_at=snapshot.created_at,
    )


async def list_services(ctx: ServiceContext) -> list[schemas.ServiceSummary]:
    services: Sequence[Service] = (
        await ctx.session.scalars(
            select(Service).where(Service.deleted_at.is_(None)).order_by(Service.base_url)
        )
    ).all()
    # Nieuwste eerst. Pagina's uit dezelfde import hebben dezelfde `created_at`: dan de
    # laatst vastgelegde, dan `start`, dan het id, zodat de volgorde (en de standaardpreview
    # in de editor) vast ligt.
    snapshots = (
        await ctx.session.scalars(
            select(DomSnapshot)
            .where(DomSnapshot.service_id.in_([s.id for s in services]))
            .order_by(
                DomSnapshot.created_at.desc(),
                DomSnapshot.capture_info["vastgelegd"].astext.desc().nulls_last(),
                (DomSnapshot.capture_info["pagina"].astext == "start").desc().nulls_last(),
                DomSnapshot.id,
            )
        )
    ).all()
    by_service: dict[uuid.UUID, list[schemas.SnapshotSummary]] = {}
    for snapshot in snapshots:
        by_service.setdefault(snapshot.service_id, []).append(_summary(snapshot))
    return [
        schemas.ServiceSummary(
            id=s.id,
            slug=s.slug,
            name=s.name,
            hostname=_hostname(s.base_url),
            base_url=s.base_url,
            snapshots=by_service.get(s.id, []),
        )
        for s in services
    ]


async def delete_service(ctx: ServiceContext, service_id: uuid.UUID) -> None:
    """Dienst weg uit de lijst, zijn snapshots echt weg, en daarmee hun assets in storage.

    De dienst zelf blijft als verwijderde rij (audit, thema's die ernaar verwezen); een nieuwe
    import van dezelfde host maakt een nieuwe dienst.
    """
    service = await ctx.session.get(Service, service_id)
    if service is None or service.deleted_at is not None:
        raise NotFoundError("Dienst niet gevonden")
    await storage.lock(ctx.session)
    service.deleted_at = utcnow()
    await ctx.session.execute(delete(DomSnapshot).where(DomSnapshot.service_id == service.id))
    removed = await storage.delete_unreferenced(ctx.session)
    audit.record(
        ctx,
        "service.delete",
        entity_type="service",
        entity_id=service.id,
        changes={"base_url": service.base_url},
    )
    await ctx.session.commit()
    await storage.remove_files(ctx.session, ctx.settings.storage_dir, removed)


async def snapshot_document(
    ctx: ServiceContext, snapshot_id: uuid.UUID
) -> schemas.SnapshotDocument:
    snapshot = await ctx.session.get(DomSnapshot, snapshot_id)
    service = await ctx.session.get(Service, snapshot.service_id) if snapshot else None
    if (
        snapshot is None
        or service is None
        or service.deleted_at is not None
        or snapshot.document_asset_id is None
    ):
        raise NotFoundError("Snapshot niet gevonden")
    ids = [snapshot.document_asset_id] + [
        uuid.UUID(str(sheet["asset_id"])) for sheet in snapshot.stylesheets if "asset_id" in sheet
    ]
    assets = {a.id: a for a in await ctx.session.scalars(select(Asset).where(Asset.id.in_(ids)))}
    directory = ctx.settings.storage_dir

    def load() -> tuple[str | None, list[str]]:
        document = assets.get(ids[0])
        raw = storage.read(directory, document) if document else None
        if raw is None or len(raw) > MAX_DOCUMENT_BYTES:
            return None, []
        sheets = []
        for asset_id in ids[1:]:
            asset = assets.get(asset_id)
            data = storage.read(directory, asset) if asset else None
            if data is not None:
                sheets.append(data.decode("utf-8", errors="replace"))
        return raw.decode("utf-8", errors="replace"), sheets

    html, sheets = await run_in_threadpool(load)
    if html is None:
        raise NotFoundError("Snapshot niet gevonden", detail="Het bestand ontbreekt in storage.")
    return schemas.SnapshotDocument(
        id=snapshot.id,
        service_id=service.id,
        hostname=_hostname(service.base_url),
        title=snapshot.title,
        url=snapshot.url,
        html=html,
        stylesheets=sheets,
    )


async def image(ctx: ServiceContext, asset_id: uuid.UUID) -> tuple[bytes, str]:
    asset = await ctx.session.get(Asset, asset_id)
    if asset is None or asset.content_type not in IMAGE_TYPES:
        raise NotFoundError("Afbeelding niet gevonden")
    data = await run_in_threadpool(storage.read, ctx.settings.storage_dir, asset)
    if data is None:
        raise NotFoundError("Afbeelding niet gevonden")
    return data, asset.content_type
