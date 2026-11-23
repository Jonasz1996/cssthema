from datetime import datetime

from sqlalchemy import Integer, String, false, text
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

    # Lokale accounts (AUTH_MODE=lokaal); leeg bij de ontwikkelgebruiker en OIDC-gebruikers.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    must_change_password: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Alleen bij een tijdelijk wachtwoord (cssthema-account reset/nieuw).
    password_expires_at: Mapped[datetime | None]
    totp_secret: Mapped[str | None] = mapped_column(String(64))
    # Geheim dat tijdens het instellen van MFA wacht op de eerste geldige code.
    totp_pending_secret: Mapped[str | None] = mapped_column(String(64))
    # Laatst gebruikte tijdstap: dezelfde code werkt geen tweede keer.
    totp_last_step: Mapped[int | None] = mapped_column(Integer)
    # Hoger zetten maakt elke bestaande sessiecookie ongeldig (reset, nieuw wachtwoord).
    session_version: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    locked_until: Mapped[datetime | None]
