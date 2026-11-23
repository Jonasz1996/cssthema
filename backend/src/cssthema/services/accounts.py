"""Lokale accounts (AUTH_MODE=lokaal): aanmelden, wachtwoord, MFA en accountreset.

Gedeeld door de api (`api/v1/auth.py`) en de servercommando's (`cssthema-account`, cli.py).
Een reset kan alleen op de server: wie geen toegang meer heeft, vraagt het de beheerder.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from anyio import to_thread
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cssthema.db.models import AuditLog, User
from cssthema.db.models.enums import UserRole
from cssthema.domain.auth import passwords, totp
from cssthema.services.errors import (
    BadRequestError,
    InvalidInputError,
    NotFoundError,
    ServiceError,
    StateConflictError,
    field_error,
)

LOCAL_PREFIX = "lokaal:"
MAX_FAILED = 10
LOCK_MINUTES = 15


class LoginFailedError(ServiceError):
    status, code = 401, "invalid_credentials"


class MfaRequiredError(ServiceError):
    """Wachtwoord klopt; nu nog de code uit de authenticator-app."""

    status, code = 401, "mfa_required"


class TempPasswordExpiredError(ServiceError):
    status, code = 401, "temp_password_expired"


def normalize_email(raw: str) -> str:
    email = raw.strip().lower()
    local, _, domain = email.partition("@")
    if not local or not domain or len(email) > 320 or any(c.isspace() for c in email):
        raise InvalidInputError(
            "Ongeldig e-mailadres", errors=[field_error("email", "Geef een e-mailadres.")]
        )
    return email


def is_local(user: User) -> bool:
    return user.oidc_subject.startswith(LOCAL_PREFIX) and user.password_hash is not None


def needs_mfa_setup(user: User) -> bool:
    return user.totp_secret is None


def setup_pending(user: User) -> bool:
    """Moet de gebruiker eerst nog een wachtwoord kiezen of MFA instellen?"""
    return user.must_change_password or needs_mfa_setup(user)


def _now() -> datetime:
    return datetime.now(UTC)


def _audit(
    session: AsyncSession,
    action: str,
    user: User,
    actor: uuid.UUID | None,
    ip: str | None = None,
    changes: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_user_id=actor,
            action=action,
            entity_type="user",
            entity_id=user.id,
            ip=ip,
            changes=changes or {},
        )
    )


async def find_local(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(
        select(User).where(User.oidc_subject == LOCAL_PREFIX + email.strip().lower())
    )
    return result.scalar_one_or_none()


async def list_local(session: AsyncSession) -> list[User]:
    result = await session.execute(
        select(User).where(User.oidc_subject.startswith(LOCAL_PREFIX)).order_by(User.email)
    )
    return list(result.scalars())


async def count_local(session: AsyncSession) -> int:
    result = await session.execute(
        select(func.count()).select_from(User).where(User.oidc_subject.startswith(LOCAL_PREFIX))
    )
    return int(result.scalar_one())


async def _set_temporary_password(user: User, hours: int) -> str:
    temp = passwords.temporary_password()
    user.password_hash = await to_thread.run_sync(passwords.hash_password, temp)
    user.must_change_password = True
    user.password_expires_at = _now() + timedelta(hours=hours)
    user.totp_secret = None
    user.totp_pending_secret = None
    user.totp_last_step = None
    user.failed_logins = 0
    user.locked_until = None
    user.session_version = (user.session_version or 0) + 1
    return temp


async def create_local(
    session: AsyncSession, email: str, *, role: UserRole, display_name: str | None, hours: int
) -> tuple[User, str]:
    email = normalize_email(email)
    if await find_local(session, email) is not None:
        raise StateConflictError(f"Account {email} bestaat al", detail="Gebruik `reset`.")
    user = User(
        oidc_subject=LOCAL_PREFIX + email,
        email=email,
        display_name=(display_name or email.split("@")[0])[:120],
        role=role,
        role_override=True,
        is_active=True,
        session_version=0,
        failed_logins=0,
    )
    session.add(user)
    temp = await _set_temporary_password(user, hours)
    await session.flush()
    _audit(session, "account.create", user, None, changes={"role": role.value})
    return user, temp


async def reset_local(session: AsyncSession, email: str, *, hours: int) -> tuple[User, str]:
    """Nieuw tijdelijk wachtwoord, MFA gewist, alle sessies afgemeld."""
    email = normalize_email(email)
    user = await find_local(session, email)
    if user is None:
        raise NotFoundError(f"Geen account met e-mailadres {email}")
    temp = await _set_temporary_password(user, hours)
    user.is_active = True
    _audit(session, "account.reset", user, None)
    return user, temp


async def set_active(session: AsyncSession, email: str, active: bool) -> User:
    user = await find_local(session, normalize_email(email))
    if user is None:
        raise NotFoundError(f"Geen account met e-mailadres {email}")
    user.is_active = active
    user.session_version = (user.session_version or 0) + 1
    _audit(session, "account.enable" if active else "account.disable", user, None)
    return user


async def authenticate(
    session: AsyncSession, email: str, password: str, code: str | None, *, ip: str | None
) -> User:
    """Controleert wachtwoord en (als ingesteld) de MFA-code. Zegt niet of het account bestaat."""
    failed = LoginFailedError(
        "Aanmelden mislukt",
        detail=(
            "E-mailadres, wachtwoord of code klopt niet, of het account is tijdelijk geblokkeerd."
        ),
    )
    try:
        email = normalize_email(email)
    except InvalidInputError:
        raise failed from None
    user = await find_local(session, email)
    stored = user.password_hash if user is not None else None
    ok = await to_thread.run_sync(passwords.verify_password, password, stored)
    now = _now()
    if (
        user is None
        or not user.is_active
        or not ok
        or (user.locked_until is not None and user.locked_until > now)
    ):
        if user is not None and not ok:
            _register_failure(user, now)
            await session.commit()
        raise failed
    if user.must_change_password and user.password_expires_at and user.password_expires_at < now:
        raise TempPasswordExpiredError(
            "Tijdelijk wachtwoord verlopen",
            detail="Vraag de beheerder opnieuw `cssthema-account reset` uit te voeren.",
        )
    if user.totp_secret is not None:
        if not code or not code.strip():
            raise MfaRequiredError("Code nodig", detail="Geef de code uit je authenticator-app.")
        step = totp.verify(user.totp_secret, code, last_step=user.totp_last_step)
        if step is None:
            _register_failure(user, now)
            await session.commit()
            raise failed
        user.totp_last_step = step
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    _audit(session, "account.login", user, user.id, ip)
    await session.commit()
    return user


def _register_failure(user: User, now: datetime) -> None:
    user.failed_logins = (user.failed_logins or 0) + 1
    if user.failed_logins >= MAX_FAILED:
        user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
        user.failed_logins = 0


async def change_password(
    session: AsyncSession, user: User, current: str, new: str, *, ip: str | None
) -> None:
    if not await to_thread.run_sync(passwords.verify_password, current, user.password_hash):
        raise InvalidInputError(
            "Huidig wachtwoord klopt niet",
            errors=[field_error("current_password", "Het huidige wachtwoord klopt niet.")],
        )
    problem = passwords.password_problem(new)
    if problem is None and new == current:
        problem = "Kies een ander wachtwoord dan het huidige (tijdelijke)."
    if problem is not None:
        raise InvalidInputError(problem, errors=[field_error("new_password", problem)])
    user.password_hash = await to_thread.run_sync(passwords.hash_password, new)
    user.must_change_password = False
    user.password_expires_at = None
    user.session_version = (user.session_version or 0) + 1
    _audit(session, "account.password", user, user.id, ip)
    await session.commit()


@dataclass(frozen=True)
class MfaSetup:
    secret: str
    uri: str


async def start_mfa(session: AsyncSession, user: User) -> MfaSetup:
    if user.must_change_password:
        raise StateConflictError("Kies eerst een nieuw wachtwoord")
    if user.totp_secret is not None:
        raise StateConflictError(
            "MFA is al ingesteld", detail="Opnieuw instellen kan na `cssthema-account reset`."
        )
    secret = totp.new_secret()
    user.totp_pending_secret = secret
    await session.commit()
    return MfaSetup(secret, totp.provisioning_uri(secret, user.email or user.display_name))


async def confirm_mfa(session: AsyncSession, user: User, code: str, *, ip: str | None) -> None:
    if user.totp_pending_secret is None:
        raise BadRequestError("Start eerst het instellen van MFA")
    step = totp.verify(user.totp_pending_secret, code, last_step=None)
    if step is None:
        raise InvalidInputError(
            "Code klopt niet",
            errors=[
                field_error("code", "Deze code klopt niet; controleer de klok van je toestel.")
            ],
        )
    user.totp_secret = user.totp_pending_secret
    user.totp_pending_secret = None
    user.totp_last_step = step
    _audit(session, "account.mfa", user, user.id, ip)
    await session.commit()
