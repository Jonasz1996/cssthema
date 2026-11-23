"""Aanmelden op het dashboard met een lokaal account (AUTH_MODE=lokaal).

Met AUTH_MODE=geen geeft `GET /auth/me` gewoon de beheerder terug en weigeren de andere
calls (er is dan niets om aan te melden).
"""

import io
from typing import Literal

import segno
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from cssthema.api.deps import AppSettings, DbSession, SessionUser, client_ip, get_session_user
from cssthema.api.errors import ProblemError
from cssthema.db.models import User
from cssthema.domain.auth import session_token
from cssthema.repositories import users as user_repo
from cssthema.services import accounts

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthUser(BaseModel):
    email: str | None
    display_name: str
    role: str


class AuthState(BaseModel):
    mode: Literal["geen", "lokaal"]
    user: AuthUser | None
    must_change_password: bool = False
    mfa_setup_required: bool = False


class LoginRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=256)
    code: str | None = Field(default=None, max_length=16)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class MfaStart(BaseModel):
    secret: str
    otpauth_uri: str
    qr_svg: str


class MfaConfirm(BaseModel):
    code: str = Field(max_length=16)


def _state(mode: Literal["geen", "lokaal"], user: User | None) -> AuthState:
    if user is None:
        return AuthState(mode=mode, user=None)
    local = mode == "lokaal"
    return AuthState(
        mode=mode,
        user=AuthUser(email=user.email, display_name=user.display_name, role=user.role.value),
        must_change_password=local and user.must_change_password,
        mfa_setup_required=local and accounts.needs_mfa_setup(user),
    )


def _require_local(settings: AppSettings) -> None:
    if settings.auth_mode != "lokaal":
        raise ProblemError(
            409, "auth_disabled", "Aanmelden staat uit", detail="AUTH_MODE is niet `lokaal`."
        )


def _set_cookie(request: Request, response: Response, settings: AppSettings, user: User) -> None:
    ttl = settings.session_hours * 3600
    token = session_token.issue(
        settings.secret_key.get_secret_value(), user.id, user.session_version, ttl
    )
    response.set_cookie(
        session_token.COOKIE_NAME,
        token,
        max_age=ttl,
        path="/",
        httponly=True,
        samesite="strict",
        # Op het LAN opent hij het dashboard over gewoon http; dan kan Secure niet.
        secure=request.url.scheme == "https",
    )


@router.get("/me", response_model=AuthState, operation_id="auth_me")
async def me(request: Request, session: DbSession, settings: AppSettings) -> AuthState:
    """Wie is aangemeld (`user: null` als niemand), en wat moet nog ingesteld worden."""
    if settings.auth_mode != "lokaal":
        return _state("geen", await user_repo.get_user(session, user_repo.DEV_USER_ID))
    try:
        user = await get_session_user(request, session, settings)
    except ProblemError:
        return _state("lokaal", None)
    return _state("lokaal", user)


@router.post("/login", response_model=AuthState, operation_id="auth_login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: DbSession,
    settings: AppSettings,
) -> AuthState:
    """Wachtwoord en, als MFA ingesteld is, de code. Zonder code: 401 `mfa_required`."""
    _require_local(settings)
    user = await accounts.authenticate(
        session, body.email, body.password, body.code, ip=client_ip(request)
    )
    _set_cookie(request, response, settings, user)
    return _state("lokaal", user)


@router.post("/logout", status_code=204, operation_id="auth_logout")
async def logout(response: Response) -> Response:
    response.delete_cookie(session_token.COOKIE_NAME, path="/")
    response.status_code = 204
    return response


@router.post("/password", response_model=AuthState, operation_id="auth_password")
async def change_password(
    body: PasswordChange,
    request: Request,
    response: Response,
    session: DbSession,
    settings: AppSettings,
    user: SessionUser,
) -> AuthState:
    """Nieuw wachtwoord; meldt andere sessies af en geeft deze een nieuwe cookie."""
    _require_local(settings)
    await accounts.change_password(
        session, user, body.current_password, body.new_password, ip=client_ip(request)
    )
    _set_cookie(request, response, settings, user)
    return _state("lokaal", user)


@router.post("/mfa/start", response_model=MfaStart, operation_id="auth_mfa_start")
async def mfa_start(session: DbSession, settings: AppSettings, user: SessionUser) -> MfaStart:
    """Nieuw TOTP-geheim met QR-code; geldt pas na `/auth/mfa/confirm` met een juiste code."""
    _require_local(settings)
    setup = await accounts.start_mfa(session, user)
    buffer = io.BytesIO()
    segno.make(setup.uri, error="m").save(
        buffer, kind="svg", scale=5, border=2, dark="#000", light="#fff", xmldecl=False
    )
    return MfaStart(
        secret=setup.secret, otpauth_uri=setup.uri, qr_svg=buffer.getvalue().decode("utf-8")
    )


@router.post("/mfa/confirm", response_model=AuthState, operation_id="auth_mfa_confirm")
async def mfa_confirm(
    body: MfaConfirm, request: Request, session: DbSession, settings: AppSettings, user: SessionUser
) -> AuthState:
    _require_local(settings)
    await accounts.confirm_mfa(session, user, body.code, ip=client_ip(request))
    return _state("lokaal", user)
