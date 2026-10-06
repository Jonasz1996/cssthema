from datetime import datetime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from cssthema.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from cssthema.db.models._types import pg_enum
from cssthema.db.models.enums import UserRole


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Gebruiker; nooit verwijderd (audit-integriteit), alleen gedeactiveerd."""

    __tablename__ = "users"

    oidc_subject: Mapped[str] = mapped_column(String(255), unique=True)
    email: Mapped[str | None] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), default=UserRole.VIEWER)
    role_override: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)
    last_login_at: Mapped[datetime | None]
