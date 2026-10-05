"""Versie 1 van de REST API (docs/05); één router per module."""

from fastapi import APIRouter

from cssthema.api.v1 import dashboard, meta, palettes, themes

router = APIRouter(prefix="/api/v1")
router.include_router(meta.router)
router.include_router(dashboard.router)
router.include_router(themes.router)
router.include_router(palettes.router)
