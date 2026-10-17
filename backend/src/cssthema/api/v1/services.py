"""Diensten en snapshots uit de capture-zips van vastleggen.py (stappenplan D1/D2)."""

import hashlib
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, File, Request, Response, UploadFile, status

from cssthema.api.deps import Ctx
from cssthema.api.errors import Problem
from cssthema.schemas.captures import CaptureImportResult, ServiceSummary, SnapshotDocument
from cssthema.services import capture_import, service_catalog

router = APIRouter(tags=["services"])

Responses = dict[int | str, dict[str, Any]]
_NOT_FOUND: Responses = {404: {"model": Problem, "description": "Niet gevonden"}}


@router.post(
    "/captures",
    response_model=CaptureImportResult,
    operation_id="captures_import",
    summary="Een zip van vastleggen.py importeren als diensten en snapshots",
    responses={422: {"model": Problem, "description": "Geen geldige capture-zip"}},
)
async def import_capture(
    ctx: Ctx,
    file: Annotated[UploadFile, File(description="Zip (of een deel) van vastleggen.py")],
) -> CaptureImportResult:
    data = await file.read(ctx.settings.capture_max_bytes + 1)
    return await capture_import.import_zip(ctx, file.filename or "capture.zip", data)


@router.get(
    "/services",
    response_model=list[ServiceSummary],
    operation_id="services_list",
    summary="Diensten met hun snapshots (nieuwste eerst)",
)
async def list_services(ctx: Ctx) -> list[ServiceSummary]:
    return await service_catalog.list_services(ctx)


@router.delete(
    "/services/{service_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    operation_id="services_delete",
    summary="Dienst verwijderen (met zijn snapshots en hun bestanden)",
    responses=_NOT_FOUND,
)
async def delete_service(service_id: uuid.UUID, ctx: Ctx) -> Response:
    await service_catalog.delete_service(ctx, service_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/snapshots/{snapshot_id}/document",
    response_model=SnapshotDocument,
    operation_id="snapshots_document",
    summary="HTML en stylesheets van een snapshot, voor de preview in de editor",
    responses={304: {"description": "Niet gewijzigd (If-None-Match)"}, **_NOT_FOUND},
)
async def snapshot_document(snapshot_id: uuid.UUID, request: Request, ctx: Ctx) -> Response:
    # Tot 1,6 MB per document. Het id blijft bij een nieuwe import van dezelfde pagina, de
    # inhoud niet: dus geen `immutable`, wel een ETag op de inhoud zodat de browser bij elke
    # editor-load alleen een 304 krijgt.
    document = await service_catalog.snapshot_document(ctx, snapshot_id)
    body = document.model_dump_json().encode("utf-8")
    etag = f'"sha256-{hashlib.sha256(body).hexdigest()[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if_none_match = request.headers.get("if-none-match")
    # nginx maakt de ETag zwak (`W/`) als hij de response comprimeert.
    if if_none_match is not None and any(
        part.strip().removeprefix("W/") in (etag, "*") for part in if_none_match.split(",")
    ):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(body, media_type="application/json", headers=headers)


@router.get(
    "/assets/{asset_id}",
    response_class=Response,
    operation_id="assets_image",
    summary="Een screenshot uit een capture",
    responses={
        200: {"content": {"image/jpeg": {}}, "description": "De afbeelding"},
        **_NOT_FOUND,
    },
)
async def asset_image(asset_id: uuid.UUID, ctx: Ctx) -> Response:
    data, content_type = await service_catalog.image(ctx, asset_id)
    return Response(
        data,
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=86400, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
