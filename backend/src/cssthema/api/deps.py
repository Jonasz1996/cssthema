"""Gedeelde FastAPI-dependencies: databasesessie, gebruiker, servicecontext en If-Match."""

import ipaddress
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from cssthema.api.errors import ProblemError
from cssthema.config import Settings
from cssthema.db.models import User
from cssthema.repositories import users as user_repo
from cssthema.services.context import Actor, ServiceContext
from cssthema.services.errors import PreconditionRequiredError
from cssthema.services.locking import LockExpectation

MAX_USER_AGENT = 512


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


AppSettings = Annotated[Settings, Depends(get_app_settings)]


async def get_current_user(session: DbSession) -> User:
    """Fase 1 heeft nog geen login: elke request is de geseede ontwikkelgebruiker (admin).

    Fase 3 vervangt dit door de OIDC-sessie (docs/02 § 4.1).
    """
    user = await user_repo.get_user(session, user_repo.DEV_USER_ID)
    if user is None or not user.is_active:
        raise ProblemError(
            401,
            "unauthenticated",
            "Niet aangemeld",
            detail="De ontwikkelgebruiker ontbreekt; draai eerst `alembic upgrade head`.",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def client_ip(request: Request) -> str | None:
    """IP van de client (uvicorn --proxy-headers zet het echte adres achter nginx)."""
    host = request.client.host if request.client else None
    if not host:
        return None
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return None  # bv. "testclient": geen geldige waarde voor de INET-kolom


def get_service_context(
    request: Request, session: DbSession, user: CurrentUser, settings: AppSettings
) -> ServiceContext:
    user_agent = request.headers.get("user-agent")
    return ServiceContext(
        session=session,
        settings=settings,
        actor=Actor(
            user_id=user.id,
            display_name=user.display_name,
            ip=client_ip(request),
            user_agent=user_agent[:MAX_USER_AGENT] if user_agent else None,
            request_id=getattr(request.state, "request_id", None),
        ),
        delivery=request.app.state.css_delivery,
    )


Ctx = Annotated[ServiceContext, Depends(get_service_context)]

_IF_MATCH_DESCRIPTION = 'ETag van de laatst gelezen toestand, bv. `"lv-12"` (docs/05 § 5.1).'


def require_if_match(
    if_match: Annotated[
        str | None,
        Header(
            alias="If-Match",
            description=_IF_MATCH_DESCRIPTION + " Verplicht; zonder: 428.",
        ),
    ] = None,
) -> LockExpectation:
    if if_match is None or not if_match.strip():
        raise PreconditionRequiredError(
            "If-Match ontbreekt",
            detail='Stuur de ETag van de laatst gelezen versie mee, bv. If-Match: "lv-12".',
        )
    return LockExpectation.from_if_match(if_match)


def optional_if_match(
    if_match: Annotated[
        str | None,
        Header(alias="If-Match", description=_IF_MATCH_DESCRIPTION + " Optioneel."),
    ] = None,
) -> LockExpectation | None:
    if if_match is None or not if_match.strip():
        return None
    return LockExpectation.from_if_match(if_match)


IfMatch = Annotated[LockExpectation, Depends(require_if_match)]
OptionalIfMatch = Annotated[LockExpectation | None, Depends(optional_if_match)]
