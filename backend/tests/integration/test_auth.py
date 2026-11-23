"""Lokale accounts: aanmelden, eerste aanmelding (wachtwoord + MFA), reset (AUTH_MODE=lokaal)."""

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from cssthema.config import Settings
from cssthema.db.models.enums import UserRole
from cssthema.domain.auth import totp
from cssthema.main import create_app
from cssthema.services import accounts


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(settings.model_copy(update={"auth_mode": "lokaal"}))
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield client


async def _new_account(engine: AsyncEngine, reset: bool = False) -> tuple[str, str]:
    email = f"it-{uuid.uuid4().hex[:8]}@example.be"
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        _, temp = await accounts.create_local(
            session, email, role=UserRole.EDITOR, display_name=None, hours=24
        )
        await session.commit()
        if reset:
            _, temp = await accounts.reset_local(session, email, hours=24)
            await session.commit()
    return email, temp


async def test_without_login_everything_is_closed(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/themes")).status_code == 401
    me = (await client.get("/api/v1/auth/me")).json()
    assert me == {
        "mode": "lokaal",
        "user": None,
        "must_change_password": False,
        "mfa_setup_required": False,
    }


async def test_unknown_email_and_wrong_password_look_the_same(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    email, _ = await _new_account(engine)
    unknown = await client.post(
        "/api/v1/auth/login", json={"email": "niemand@example.be", "password": "x" * 12}
    )
    wrong = await client.post("/api/v1/auth/login", json={"email": email, "password": "x" * 12})
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["code"] == wrong.json()["code"] == "invalid_credentials"


async def test_first_login_then_mfa_then_reset(client: AsyncClient, engine: AsyncEngine) -> None:
    email, temp = await _new_account(engine)
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": temp})
    assert response.status_code == 200, response.text
    assert response.json()["must_change_password"] is True
    # Nog niet klaar: de rest van de api blijft dicht.
    blocked = await client.get("/api/v1/themes")
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "account_setup_required"

    new_password = "Een-nieuw-wachtwoord-7"
    response = await client.post(
        "/api/v1/auth/password",
        json={"current_password": temp, "new_password": new_password},
    )
    assert response.status_code == 200, response.text
    assert response.json()["mfa_setup_required"] is True

    start = (await client.post("/api/v1/auth/mfa/start")).json()
    assert start["qr_svg"].startswith("<svg")
    bad = await client.post("/api/v1/auth/mfa/confirm", json={"code": "000000"})
    assert bad.status_code == 422
    code = totp.code_at(start["secret"])
    if code == "000000":  # pragma: no cover - 1 op een miljoen
        return
    done = await client.post("/api/v1/auth/mfa/confirm", json={"code": code})
    assert done.status_code == 200, done.text
    assert (await client.get("/api/v1/themes")).status_code == 200

    # Opnieuw aanmelden: eerst zonder code (mfa_required), met dezelfde code niet (replay).
    await client.post("/api/v1/auth/logout")
    assert (await client.get("/api/v1/themes")).status_code == 401
    login = {"email": email, "password": new_password}
    response = await client.post("/api/v1/auth/login", json=login)
    assert response.json()["code"] == "mfa_required"
    replay = await client.post("/api/v1/auth/login", json={**login, "code": code})
    assert replay.status_code == 401

    # Reset op de server: MFA weg, tijdelijk wachtwoord, oude cookie ongeldig.
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        _, temp2 = await accounts.reset_local(session, email, hours=24)
        await session.commit()
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": temp2})
    assert response.status_code == 200, response.text
    state = response.json()
    assert state["must_change_password"] is True
    assert state["mfa_setup_required"] is True


async def test_session_cookie_from_before_reset_stops_working(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    email, temp = await _new_account(engine)
    await client.post("/api/v1/auth/login", json={"email": email, "password": temp})
    assert (await client.get("/api/v1/auth/me")).json()["user"]["email"] == email
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        await accounts.reset_local(session, email, hours=24)
        await session.commit()
    assert (await client.get("/api/v1/auth/me")).json()["user"] is None
