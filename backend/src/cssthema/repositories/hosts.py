"""Queries voor host-koppelingen (`/host/<hostname>.css|.js`)."""

import uuid
from collections.abc import Sequence

from sqlalchemy import String, case, or_, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession

from cssthema.db.models import HostBinding
from cssthema.domain.hosts import DEFAULT_HOST


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
