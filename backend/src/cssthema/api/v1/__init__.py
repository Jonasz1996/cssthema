"""Versie 1 van de REST API (docs/05); één router per module."""

from fastapi import APIRouter, Depends

from cssthema.api.deps import require_same_origin
from cssthema.api.v1 import dashboard, hosts, meta, palettes, preview, scripts, services, themes

# Elke muterende call (POST/PUT/PATCH/DELETE) alleen vanaf het dashboard zelf (CSRF).
router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_same_origin)])
router.include_router(meta.router)
router.include_router(dashboard.router)
router.include_router(themes.router)
router.include_router(palettes.router)
router.include_router(scripts.router)
router.include_router(hosts.router)
router.include_router(services.router)
router.include_router(preview.router)
