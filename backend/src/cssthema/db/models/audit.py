import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Identity, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base


class AuditLog(Base):
    """Append-only: de applicatierol krijgt alleen INSERT/SELECT op deze tabel."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_at", text("at DESC")),
        Index("ix_audit_logs_entity", "entity_type", "entity_id", text("at DESC")),
        Index("ix_audit_logs_actor", "actor_user_id", text("at DESC")),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    at: Mapped[datetime] = mapped_column(server_default=func.now())
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    actor_api_key_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("api_keys.id"))
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[uuid.UUID | None]
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str | None] = mapped_column(String(64))
    changes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
