"""Paletten: alleen lezen in fase 1 (de ingebouwde paletten komen uit migratie 0002)."""

import uuid

from cssthema.db.models import Palette as PaletteModel
from cssthema.domain.palettes.builtin import ordered_tokens
from cssthema.repositories import palettes as palette_repo
from cssthema.schemas.palettes import Palette
from cssthema.services.context import ServiceContext
from cssthema.services.errors import NotFoundError


def _view(palette: PaletteModel, theme_count: int) -> Palette:
    return Palette(
        id=palette.id,
        slug=palette.slug,
        name=palette.name,
        tokens=ordered_tokens(palette.tokens or {}),
        is_builtin=palette.is_builtin,
        theme_count=theme_count,
        created_at=palette.created_at,
    )


async def list_palettes(ctx: ServiceContext) -> list[Palette]:
    return [_view(p, count) for p, count in await palette_repo.list_palettes(ctx.session)]


async def get_palette(ctx: ServiceContext, palette_id: uuid.UUID) -> Palette:
    found = await palette_repo.get_palette_with_count(ctx.session, palette_id)
    if found is None:
        raise NotFoundError("Palet niet gevonden", detail=f"Er is geen palet met id {palette_id}.")
    return _view(*found)
