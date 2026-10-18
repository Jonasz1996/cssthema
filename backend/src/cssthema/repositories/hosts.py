"""Queries voor host-koppelingen (`/host/<hostname>.css|.js`)."""

import uuid
from collections.abc import Sequence

from sqlalchemy import String, case, or_, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession

from cssthema.db.models import HostBinding, Service
from cssthema.domain.hosts import DEFAULT_HOST, normalize_hostname


async def list_bindings(session: AsyncSession) -> list[HostBinding]:
    """Alle koppelingen, `*` eerst, daarna op hostnaam."""
    result = await session.scalars(
        select(HostBinding).order_by(
            case((HostBinding.hostname == DEFAULT_HOST, 0), else_=1), HostBinding.hostname
        )
    )
    return list(result)


async def get_binding(session: AsyncSession, binding_id: uuid.UUID) -> HostBinding | None:
    return await session.get(HostBinding, binding_id)


async def get_by_hostname(session: AsyncSession, hostname: str) -> HostBinding | None:
    return await session.scalar(select(HostBinding).where(HostBinding.hostname == hostname))


async def resolve(session: AsyncSession, hostname: str) -> HostBinding | None:
    """De koppeling van de host zelf, anders `*`, anders None."""
    return await session.scalar(
        select(HostBinding)
        .where(HostBinding.hostname.in_([hostname, DEFAULT_HOST]))
        .order_by(case((HostBinding.hostname == DEFAULT_HOST, 1), else_=0))
        .limit(1)
    )


async def hostnames_using(
    session: AsyncSession, *, styles: Sequence[str] = (), scripts: Sequence[str] = ()
) -> list[str]:
    """Hostnamen waarvan de koppeling een van deze thema's of scripts bevat."""
    conditions = []
    if styles:
        conditions.append(HostBinding.styles.has_any(array(list(styles), type_=String)))
    if scripts:
        conditions.append(HostBinding.scripts.has_any(array(list(scripts), type_=String)))
    if not conditions:
        return []
    result = await session.scalars(select(HostBinding.hostname).where(or_(*conditions)))
    return list(result)


async def service_hostnames(session: AsyncSession) -> list[str]:
    """De hostnamen van de (niet-verwijderde) diensten, uit hun `base_url`, gesorteerd."""
    urls = await session.scalars(select(Service.base_url).where(Service.deleted_at.is_(None)))
    names = set()
    for url in urls:
        try:
            names.add(normalize_hostname(url if "://" in url else f"https://{url}"))
        except ValueError:
            continue
    names.discard(DEFAULT_HOST)
    return sorted(names)


async def rename_style(session: AsyncSession, old: str, new: str) -> list[str]:
    """Vervangt thema `old` door `new` in elke koppeling; geeft de hostnamen terug."""
    bindings = await session.scalars(
        select(HostBinding).where(HostBinding.styles.has_any(array([old], type_=String)))
    )
    changed = []
    for binding in bindings:
        binding.styles = list(dict.fromkeys(new if s == old else s for s in binding.styles))
        changed.append(binding.hostname)
    return changed
