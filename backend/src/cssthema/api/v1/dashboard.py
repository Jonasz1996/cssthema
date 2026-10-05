"""Dashboard (F-PL-02, basis)."""

from fastapi import APIRouter

from cssthema.api.deps import Ctx
from cssthema.schemas.dashboard import Dashboard
from cssthema.services import dashboard as dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=Dashboard, operation_id="dashboard_get")
async def get_dashboard(ctx: Ctx) -> Dashboard:
    return await dashboard_service.get_dashboard(ctx)
