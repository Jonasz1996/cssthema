import uuid
from datetime import datetime

from sqlalchemy import ARRAY, ForeignKey, Index, LargeBinary, String, text
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin


class ApiKey(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """API-key `ct_<prefix>_<secret>`; alleen sha256(secret) wordt opgeslagen."""

    __tablename__ = "api_keys"
    __table_args__ = (
        Index("ix_api_keys_user_active", "user_id", postgresql_where=text("revoked_at IS NULL")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(16), unique=True)
    secret_hash: Mapped[bytes] = mapped_column(LargeBinary(32))
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    expires_at: Mapped[datetime | None]
    last_used_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]
