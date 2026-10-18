from typing import Any

from sqlalchemy import CheckConstraint, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class HostBinding(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Welke thema's en scripts een proxy host krijgt via `/host/<hostname>.css|.js`.

    `styles` en `scripts` zijn namen (thema-slug of bestand in css-files), geen foreign keys:
    een handgemaakt bestand kan net zo goed als een thema. `*` geldt voor elke host zonder
    eigen koppeling (cssthema.domain.hosts).
    """

    __tablename__ = "host_bindings"
    __table_args__ = (CheckConstraint("hostname = lower(hostname)", name="hostname_lowercase"),)

    hostname: Mapped[str] = mapped_column(String(253), unique=True)
    styles: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    scripts: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    enabled: Mapped[bool] = mapped_column(default=True)
    note: Mapped[str | None] = mapped_column(Text)
