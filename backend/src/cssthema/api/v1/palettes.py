"""Paletten (alleen lezen in fase 1)."""

import uuid

from fastapi import APIRouter

from cssthema.api.deps import Ctx
from cssthema.api.errors import Problem
from cssthema.schemas.palettes import Palette
from cssthema.services import palette_service

router = APIRouter(prefix="/palettes", tags=["palettes"])


@router.get("", response_model=list[Palette], operation_id="palettes_list")
async def list_palettes(ctx: Ctx) -> list[Palette]:
    """Alle paletten; de ingebouwde eerst, daarna op naam."""
    return await palette_service.list_palettes(ctx)


@router.get(
    "/{palette_id}",
    response_model=Palette,
    operation_id="palettes_get",
    responses={404: {"model": Problem, "description": "Palet niet gevonden"}},
)
async def get_palette(palette_id: uuid.UUID, ctx: Ctx) -> Palette:
    return await palette_service.get_palette(ctx, palette_id)
