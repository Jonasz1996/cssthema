"""Versie 1 van de REST API; routers per module worden hier vanaf fase 1 toegevoegd."""

from fastapi import APIRouter

from cssthema.api.v1 import meta

router = APIRouter(prefix="/api/v1")
router.include_router(meta.router)
