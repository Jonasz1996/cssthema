"""Thema-scripts: `.js`-bestanden in CSS_FILES_DIR, die nginx publiek op `/<naam>.js` serveert.

Geen database en geen versies: het werk (namen, atomisch schrijven, archief) zit in
`services/script_files.py`.
"""

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Path, Query, Response, UploadFile, status

from cssthema.api.deps import Ctx
from cssthema.api.errors import Problem
from cssthema.schemas.scripts import ScriptFile
from cssthema.services import script_files

router = APIRouter(prefix="/scripts", tags=["scripts"])

API_PREFIX = "/api/v1/scripts"

Responses = dict[int | str, dict[str, Any]]

_NOT_FOUND: Responses = {404: {"model": Problem, "description": "Script niet gevonden"}}
_STORAGE: Responses = {
    500: {"model": Problem, "description": "`storage_error`: onverwachte fout bij het schrijven"},
    503: {
        "model": Problem,
        "description": "`storage_unavailable`: CSS_FILES_DIR ontbreekt of is niet schrijfbaar",
    },
}


@router.get(
    "",
    response_model=list[ScriptFile],
    operation_id="scripts_list",
    summary="Scripts in CSS_FILES_DIR (publiek op /<naam>.js)",
    responses={503: _STORAGE[503]},
)
async def list_scripts(ctx: Ctx) -> list[ScriptFile]:
    return await script_files.list_scripts(ctx)


@router.post(
    "",
    response_model=ScriptFile,
    status_code=status.HTTP_201_CREATED,
    operation_id="scripts_upload",
    summary="Script uploaden of vervangen",
    responses={
        200: {"model": ScriptFile, "description": "Bestaand script vervangen (`replace`)"},
        409: {
            "model": Problem,
            "description": (
                "`script_conflict`: de naam bestaat al en `replace` staat niet aan; "
                "`state_conflict`: op die naam staat een map of symbolische link"
            ),
        },
        413: {"model": Problem, "description": "Groter dan 512 KB"},
        415: {"model": Problem, "description": "Geen `.js`-bestand"},
        422: {
            "model": Problem,
            "description": (
                "`invalid_script_name` (naam) of `validation_error` (leeg, geen UTF-8, NUL)"
            ),
        },
        **_STORAGE,
    },
)
async def upload_script(
    ctx: Ctx,
    response: Response,
    file: Annotated[UploadFile, File(description="`.js`, hoogstens 512 KB, UTF-8")],
    name: Annotated[
        str | None,
        Form(
            max_length=200,
            description=(
                "Naam (en URL `/<naam>.js`); standaard de bestandsnaam zonder `.js`. Wordt "
                "genormaliseerd zoals een slug: `Netwerk Achtergrond` → `netwerk-achtergrond`."
            ),
        ),
    ] = None,
    replace: Annotated[
        bool,
        Form(
            description=(
                "Een bestaand script vervangen (200); de vorige versie gaat naar "
                "`.scripts-archief/`. Zonder: 409 `script_conflict`."
            )
        ),
    ] = False,
) -> ScriptFile:
    data = await file.read(script_files.MAX_SCRIPT_BYTES + 1)
    script, created = await script_files.upload_script(
        ctx, filename=file.filename or "upload", data=data, name=name, replace=replace
    )
    response.headers["Location"] = f"{API_PREFIX}/{script.name}"
    if not created:
        response.status_code = status.HTTP_200_OK
    return script


@router.get(
    "/{name}",
    response_class=Response,
    operation_id="scripts_get",
    summary="Inhoud van een script",
    responses={
        200: {
            "description": "De inhoud; met `download` als bijlage",
            "content": {"text/javascript": {"schema": {"type": "string"}}},
        },
        **_NOT_FOUND,
        503: {"model": Problem, "description": "Bestand niet leesbaar voor de api"},
    },
)
async def get_script(
    name: Annotated[str, Path(max_length=200, description="Naam zonder `.js`")],
    ctx: Ctx,
    download: Annotated[
        bool, Query(description="Als download (`Content-Disposition: attachment`)")
    ] = False,
) -> Response:
    filename, data = await script_files.read_script(ctx, name)
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if download:
        # De naam is gevalideerd ([a-z0-9-] plus .js): veilig in de header.
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return Response(data, media_type="text/javascript; charset=utf-8", headers=headers)


@router.delete(
    "/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    operation_id="scripts_delete",
    summary="Script verwijderen (naar .scripts-archief/)",
    responses={**_NOT_FOUND, **_STORAGE},
)
async def delete_script(
    name: Annotated[str, Path(max_length=200, description="Naam zonder `.js`")], ctx: Ctx
) -> Response:
    await script_files.delete_script(ctx, name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
