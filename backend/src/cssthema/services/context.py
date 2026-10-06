"""Wat elke servicefunctie nodig heeft: sessie, instellingen, actor en CSS-levering."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from cssthema.config import Settings

if TYPE_CHECKING:
    from cssthema.services.css_delivery import CssDelivery


@dataclass(frozen=True, slots=True)
class Actor:
    """Wie de actie uitvoert, voor `created_by`/`updated_by` en de audit-log."""

    user_id: uuid.UUID
    display_name: str
    ip: str | None = None
    user_agent: str | None = None
    request_id: str | None = None


@dataclass(frozen=True, slots=True)
class ServiceContext:
    session: AsyncSession
    settings: Settings
    actor: Actor
    delivery: "CssDelivery"


def utcnow() -> datetime:
    return datetime.now(UTC)
