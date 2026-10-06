import logging
from collections.abc import AsyncIterator

import pytest
from fastapi import APIRouter
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel

from cssthema.api.errors import ProblemError
from cssthema.config import Settings
from cssthema.main import create_app


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(settings)

    probe = APIRouter()

    @probe.get("/_probe/conflict")
    async def conflict() -> None:
        raise ProblemError(409, "slug_conflict", "Slug al in gebruik", detail="proxmox")

    @probe.get("/_probe/boom")
    async def boom() -> None:
        raise RuntimeError("kapot")

    @probe.get("/_probe/typed")
    async def typed(n: int) -> int:
        return n

    class Body(BaseModel):
        name: str

    @probe.post("/_probe/body")
    async def body(payload: Body) -> str:
        return payload.name

    app.include_router(probe)
    # Geen lifespan nodig voor deze tests: ze raken DB/Redis niet.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_healthz(client: AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {}}


async def test_request_id_is_generated_and_echoed(client: AsyncClient) -> None:
    generated = await client.get("/healthz")
    assert len(generated.headers["X-Request-ID"]) == 32

    echoed = await client.get("/healthz", headers={"X-Request-ID": "abc-123"})
    assert echoed.headers["X-Request-ID"] == "abc-123"


async def test_invalid_request_id_is_replaced(client: AsyncClient) -> None:
    response = await client.get("/healthz", headers={"X-Request-ID": "<script>"})
    assert response.headers["X-Request-ID"] != "<script>"


async def test_meta(client: AsyncClient) -> None:
    response = await client.get("/api/v1/meta")
    assert response.status_code == 200
    assert response.json()["name"] == "cssthema"
    assert response.json()["environment"] == "test"


async def test_domain_error_is_problem_details(client: AsyncClient) -> None:
    response = await client.get("/_probe/conflict", headers={"X-Request-ID": "req-1"})
    assert response.status_code == 409
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["code"] == "slug_conflict"
    assert body["type"] == "https://cssthema.dev/problems/slug-conflict"
    assert body["detail"] == "proxmox"
    assert body["instance"] == "/_probe/conflict"
    assert body["request_id"] == "req-1"


async def test_not_found_is_problem_details(client: AsyncClient) -> None:
    response = await client.get("/bestaat-niet")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


async def test_validation_error_is_problem_details(client: AsyncClient) -> None:
    response = await client.get("/_probe/typed", params={"n": "geen-getal"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert body["errors"][0]["loc"] == ["query", "n"]


async def test_unhandled_error_hides_details(client: AsyncClient) -> None:
    response = await client.get("/_probe/boom")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert "kapot" not in response.text


async def test_unhandled_error_keeps_request_id_and_is_logged(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="cssthema.access")
    response = await client.get("/_probe/boom", headers={"X-Request-ID": "req-500"})
    assert response.headers["X-Request-ID"] == "req-500"
    assert response.json()["request_id"] == "req-500"
    access = [
        r.msg
        for r in caplog.records
        if r.name == "cssthema.access"
        and isinstance(r.msg, dict)
        and r.msg["path"] == "/_probe/boom"
    ]
    assert len(access) == 1
    assert access[0]["status"] == 500


async def test_method_not_allowed_keeps_allow_header(client: AsyncClient) -> None:
    response = await client.get("/_probe/body")
    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"
    assert response.headers["Allow"] == "POST"


async def test_unreadable_body_is_bad_request(client: AsyncClient) -> None:
    response = await client.post(
        "/_probe/body", content=b"{geen json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "bad_request"
    assert "errors" not in body


async def test_body_field_error_is_validation_error(client: AsyncClient) -> None:
    response = await client.post("/_probe/body", json={"naam": "x"})
    assert response.status_code == 422
    assert response.json()["errors"][0]["loc"] == ["body", "name"]


async def test_openapi_is_served_under_api_v1(client: AsyncClient) -> None:
    response = await client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    operation_ids = {
        op["operationId"] for path in response.json()["paths"].values() for op in path.values()
    }
    assert {"health_live", "health_ready", "meta_get"} <= operation_ids
