import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base


class Setting(Base):
    """Runtime-instelling; geheimen alleen versleuteld in `encrypted_value`."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    encrypted_value: Mapped[bytes | None] = mapped_column(LargeBinary)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())
