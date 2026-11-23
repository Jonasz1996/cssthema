"""Versie 1 van de REST API (docs/05); één router per module."""

from fastapi import APIRouter, Depends

from cssthema.api.deps import require_login, require_same_origin
from cssthema.api.v1 import (
    auth,
    dashboard,
    hosts,
    meta,
    palettes,
    preview,
    scripts,
    services,
    themes,
)

# Elke muterende call (POST/PUT/PATCH/DELETE) alleen vanaf het dashboard zelf (CSRF).
router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_same_origin)])
# Aanmelden zelf kan zonder login; al de rest vraagt een login als AUTH_MODE=lokaal.
# /meta (naam, versie) ook: geen geheimen.
router.include_router(auth.router)
router.include_router(meta.router)
_protected = APIRouter(dependencies=[Depends(require_login)])
_protected.include_router(dashboard.router)
_protected.include_router(themes.router)
_protected.include_router(palettes.router)
_protected.include_router(scripts.router)
_protected.include_router(hosts.router)
_protected.include_router(services.router)
_protected.include_router(preview.router)
router.include_router(_protected)
