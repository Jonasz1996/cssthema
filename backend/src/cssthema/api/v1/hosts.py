"""Host-koppelingen: welke thema's en scripts elke proxy host krijgt via `/host/<host>.css|.js`.

In NPM staat in elke proxy host dezelfde `sub_filter`-regel met `$host`; wat een host krijgt,
regel je hier (zie `services/host_service.py`).
"""

import uuid
from typing import Any

from fastapi import APIRouter, Response, status

from cssthema.api.deps import Ctx
from cssthema.api.errors import Problem
from cssthema.schemas.hosts import (
    HostBinding,
    HostBindingInput,
    HostImportRequest,
    HostImportResult,
    HostOptions,
)
from cssthema.services import host_service

router = APIRouter(prefix="/hosts", tags=["hosts"])

Responses = dict[int | str, dict[str, Any]]

_NOT_FOUND: Responses = {404: {"model": Problem, "description": "Koppeling niet gevonden"}}
_CONFLICT: Responses = {
    409: {"model": Problem, "description": "`host_conflict`: die hostnaam heeft al een koppeling"}
}


@router.get(
    "",
    response_model=list[HostBinding],
    operation_id="hosts_list",
    summary="Alle host-koppelingen (`*` eerst)",
)
async def list_hosts(ctx: Ctx) -> list[HostBinding]:
    return await host_service.list_bindings(ctx)


@router.get(
    "/options",
    response_model=HostOptions,
    operation_id="hosts_options",
    summary="Te kiezen thema's en scripts, en de sub_filter-regel voor NPM",
)
async def host_options(ctx: Ctx) -> HostOptions:
    return await host_service.options(ctx)


@router.post(
    "",
    response_model=HostBinding,
    status_code=status.HTTP_201_CREATED,
    operation_id="hosts_create",
    summary="Koppeling aanmaken",
    responses=_CONFLICT,
)
async def create_host(data: HostBindingInput, ctx: Ctx) -> HostBinding:
    return await host_service.create_binding(ctx, data)


@router.post(
    "/import",
    response_model=HostImportResult,
    operation_id="hosts_import",
    summary="Koppelingen overnemen uit een NPM-config (`# <host>` boven elke sub_filter)",
)
async def import_hosts(data: HostImportRequest, ctx: Ctx) -> HostImportResult:
    return await host_service.import_config(ctx, data)


@router.put(
    "/{binding_id}",
    response_model=HostBinding,
    operation_id="hosts_update",
    summary="Koppeling aanpassen",
    responses={**_NOT_FOUND, **_CONFLICT},
)
async def update_host(binding_id: uuid.UUID, data: HostBindingInput, ctx: Ctx) -> HostBinding:
    return await host_service.update_binding(ctx, binding_id, data)


@router.delete(
    "/{binding_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    operation_id="hosts_delete",
    summary="Koppeling verwijderen (de host volgt dan `*`)",
    responses=_NOT_FOUND,
)
async def delete_host(binding_id: uuid.UUID, ctx: Ctx) -> Response:
    await host_service.delete_binding(ctx, binding_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
