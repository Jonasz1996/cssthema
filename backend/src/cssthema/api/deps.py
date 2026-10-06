"""Gedeelde FastAPI-dependencies: databasesessie, gebruiker, servicecontext en If-Match."""

import ipaddress
from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import urlsplit

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


SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
# `none`: door de gebruiker zelf gestart (adresbalk, bladwijzer), geen andere pagina.
_OWN_SITES = frozenset({"same-origin", "none"})


def _netloc(url: str) -> str | None:
    """`https://css.example.be` → `css.example.be`; `null` of onzin → `None`."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    return parts.netloc.lower() if parts.scheme and parts.netloc else None


def require_same_origin(request: Request, settings: AppSettings) -> None:
    """Muterende requests alleen vanaf het dashboard zelf: CSRF-bescherming (docs/05 § 1).

    Fase 1 heeft geen login en dus geen CSRF-token: elke request is de admin. Een multipart-
    POST is voor de browser een *simple request* (geen preflight), dus zonder deze controle
    kan elke pagina die de beheerder opent, ook een andere app op hetzelfde domein (`same-site`, met
    de Authentik-cookie), een script vervangen dat daarna in elke app draait. Browsers sturen
    `Sec-Fetch-Site` (alleen naar https en localhost) en bij een POST altijd `Origin`; curl en
    scripts sturen geen van beide en mogen door (nginx laat schrijven alleen via de proxy toe).
    """
    if request.method in SAFE_METHODS:
        return
    site = request.headers.get("sec-fetch-site")
    if site is not None:
        if site.strip().lower() in _OWN_SITES:
            return
        raise _csrf_failed()
    origin = request.headers.get("origin")
    if origin is None:
        return
    # Zonder Fetch Metadata (gewone http naar een IP): de Origin moet de eigen host zijn, zoals
    # de browser hem aansprak (Host) of zoals hij in PUBLIC_BASE_URL staat.
    own = {_netloc(settings.public_base_url), request.headers.get("host", "").strip().lower()}
    origin_netloc = _netloc(origin)
    if origin_netloc is None or origin_netloc not in own:
        raise _csrf_failed()


def _csrf_failed() -> ProblemError:
    return ProblemError(
        403,
        "csrf_failed",
        "Verzoek van een andere site geweigerd",
        detail=(
            "Wijzigingen kunnen alleen vanuit het dashboard zelf: dit verzoek kwam van een "
            "andere pagina (Origin of Sec-Fetch-Site)."
        ),
    )


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
