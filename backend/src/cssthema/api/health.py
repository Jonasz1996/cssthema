"""Liveness en readiness (buiten /api/v1, zie docs/05 § 4.11)."""

import asyncio
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel
from sqlalchemy import text

router = APIRouter(tags=["health"])

# Een afhankelijkheid die de verbinding aanneemt maar niet antwoordt, telt als "error".
PROBE_TIMEOUT_S = 2.0


class HealthStatus(BaseModel):
    status: Literal["ok", "unavailable"]
    checks: dict[str, Literal["ok", "error"]] = {}


@router.get("/healthz", response_model=HealthStatus, operation_id="health_live")
async def healthz() -> HealthStatus:
    return HealthStatus(status="ok")


@router.get(
    "/readyz",
    response_model=HealthStatus,
    responses={503: {"model": HealthStatus}},
    operation_id="health_ready",
)
async def readyz(request: Request, response: Response) -> HealthStatus:
    checks: dict[str, Literal["ok", "error"]] = {}
    try:
        async with asyncio.timeout(PROBE_TIMEOUT_S):
            async with request.app.state.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:  # inclusief TimeoutError
        checks["database"] = "error"
    try:
        async with asyncio.timeout(PROBE_TIMEOUT_S):
            await request.app.state.redis.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "error"

    ok = all(v == "ok" for v in checks.values())
    if not ok:
        response.status_code = 503
    return HealthStatus(status="ok" if ok else "unavailable", checks=checks)
