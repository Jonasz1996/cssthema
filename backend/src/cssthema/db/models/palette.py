import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class Palette(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Design tokens, gecompileerd als `--ct-<naam>`-variabelen."""

    __tablename__ = "palettes"
    __table_args__ = (
        Index(
            "uq_palettes_slug_active",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    slug: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    tokens: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    is_builtin: Mapped[bool] = mapped_column(default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
