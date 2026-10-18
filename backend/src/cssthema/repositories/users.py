"""Queries voor gebruikers."""

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cssthema.db.models import User

# Geseed door migratie 0002; fase 1 heeft nog geen login (docs/07 § 4).
DEV_USER_ID = uuid.UUID("00000000-0000-7000-8000-000000000001")


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await session.get(User, user_id)


async def display_names(
    session: AsyncSession, user_ids: Iterable[uuid.UUID | None]
) -> dict[uuid.UUID, str]:
    """`{id: display_name}` voor de gegeven gebruikers (in één query)."""
    ids = {user_id for user_id in user_ids if user_id is not None}
    if not ids:
        return {}
    result = await session.execute(select(User.id, User.display_name).where(User.id.in_(ids)))
    return {user_id: name for user_id, name in result.all()}
