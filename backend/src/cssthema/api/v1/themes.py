"""Thema's: CRUD, draft, lint, publiceren, versies, diff, rollback, import en export.

Routers blijven dun (docs/02 § 3.1): validatie via de schema's, het werk in de services.
Statische paden (`/import`, `/local-files`) staan vóór `/{theme_id}`.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Path, Query, Response, UploadFile, status

from cssthema.api.deps import Ctx, IfMatch, OptionalIfMatch
from cssthema.api.errors import Problem
from cssthema.api.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    ValueKind,
    decode_cursor,
    encode_cursor,
)
from cssthema.db.models.enums import ThemeStatus
from cssthema.domain.export.bundle import MAX_BUNDLE_BYTES
from cssthema.repositories.themes import ThemeFilters
from cssthema.schemas.common import MAX_INT4, LintFailedProblem, PreconditionFailedProblem
from cssthema.schemas.themes import (
    Draft,
    DraftReset,
    DraftUpdate,
    DuplicateRequest,
    ExportFormat,
    ImportConflict,
    LintRequest,
    LintResult,
    LocalCssFile,
    LocalImportRequest,
    LocalImportResult,
    PublishRequest,
    RollbackRequest,
    SortOrder,
    Theme,
    ThemeCreate,
    ThemePage,
    ThemeUpdate,
    Version,
    VersionDiff,
    VersionPage,
)
from cssthema.services import import_export, publish_service, theme_service
from cssthema.services.errors import PayloadTooLargeError
from cssthema.services.locking import lock_etag

router = APIRouter(prefix="/themes", tags=["themes"])

API_PREFIX = "/api/v1/themes"
VERSIONS_SORT = "versions"
DIFF_REF_PATTERN = r"^(draft|[1-9][0-9]{0,8})$"

Responses = dict[int | str, dict[str, Any]]

_NOT_FOUND: Responses = {404: {"model": Problem, "description": "Thema niet gevonden"}}
_CONFLICT: Responses = {409: {"model": Problem, "description": "Conflict (slug of status)"}}
_PRECONDITION: Responses = {
    412: {"model": PreconditionFailedProblem, "description": "If-Match komt niet overeen"},
    428: {"model": Problem, "description": "If-Match ontbreekt"},
}
_TOO_LARGE: Responses = {413: {"model": Problem, "description": "CSS groter dan CSS_MAX_BYTES"}}
_LINT_FAILED: Responses = {
    422: {"model": LintFailedProblem, "description": "Lint-fouten of ongeldige invoer"}
}


def _search_text(value: str | None) -> str | None:
    # PostgreSQL-tekst kan geen NUL bevatten; leeg = geen filter.
    cleaned = (value or "").replace("\0", "").strip()
    return cleaned or None


def _set_etag(response: Response, lock_version: int) -> None:
    response.headers["ETag"] = lock_etag(lock_version)


def _theme_location(theme_id: uuid.UUID) -> str:
    return f"{API_PREFIX}/{theme_id}"


# --- lijst en aanmaken ---------------------------------------------------------------------


@router.get("", response_model=ThemePage, operation_id="themes_list")
async def list_themes(
    ctx: Ctx,
    q: Annotated[
        str | None, Query(max_length=200, description="Zoekt in naam, slug en beschrijving.")
    ] = None,
    status_: Annotated[ThemeStatus | None, Query(alias="status")] = None,
    palette_id: uuid.UUID | None = None,
    service_id: uuid.UUID | None = None,
    tag: Annotated[str | None, Query(max_length=40)] = None,
    include_deleted: bool = False,
    sort: SortOrder = "-updated_at",
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
) -> ThemePage:
    kind: ValueKind = "str" if sort == "name" else "datetime"
    after = decode_cursor(cursor, sort=sort, kind=kind) if cursor else None
    filters = ThemeFilters(
        q=_search_text(q),
        status=status_,
        palette_id=palette_id,
        service_id=service_id,
        tag=_search_text(tag),
        include_deleted=include_deleted,
    )
    items, has_more = await theme_service.list_themes(
        ctx, filters, sort=sort, limit=limit, after=after
    )
    next_cursor = None
    if has_more and items:
        last = items[-1]
        value: Any = {"name": last.name, "-created_at": last.created_at}.get(sort, last.updated_at)
        next_cursor = encode_cursor(sort, value, last.id)
    return ThemePage(items=items, next_cursor=next_cursor)


@router.post(
    "",
    response_model=Theme,
    status_code=status.HTTP_201_CREATED,
    operation_id="themes_create",
    responses={**_CONFLICT, **_TOO_LARGE, 422: {"model": Problem, "description": "Ongeldig"}},
)
async def create_theme(data: ThemeCreate, ctx: Ctx, response: Response) -> Theme:
    theme = await theme_service.create_theme(ctx, data)
    response.headers["Location"] = _theme_location(theme.id)
    _set_etag(response, theme.lock_version)
    return theme


# --- import (statische paden vóór /{theme_id}) ----------------------------------------------


@router.post(
    "/import",
    response_model=Theme,
    status_code=status.HTTP_201_CREATED,
    operation_id="themes_import",
    responses={
        200: {"model": Theme, "description": "Nieuwe versie op een bestaand thema"},
        **_CONFLICT,
        **_TOO_LARGE,
        415: {"model": Problem, "description": "Geen .css of .cssthema.zip"},
        **_LINT_FAILED,
    },
)
async def import_theme(
    ctx: Ctx,
    response: Response,
    file: Annotated[UploadFile, File(description="`.css` of `.cssthema.zip`")],
    on_conflict: Annotated[
        ImportConflict,
        Form(
            description=(
                "Slug bestaat al: `rename` (`-2`, `-3`, …), `new_version` (nieuwe draft en "
                "versie op het bestaande thema) of `fail` (409)."
            )
        ),
    ] = "rename",
    publish: Annotated[
        bool | None,
        Form(
            description=(
                "`.css`: v1 meteen live (standaard niet). Bundel: standaard de live versie "
                "uit het manifest; `false` publiceert niets, `true` desnoods de laatste versie."
            )
        ),
    ] = None,
    name: Annotated[str | None, Form(max_length=120, description="Naam (en slug).")] = None,
) -> Theme:
    data = await file.read(MAX_BUNDLE_BYTES + 1)
    if len(data) > MAX_BUNDLE_BYTES:
        raise PayloadTooLargeError(
            "Bestand is te groot", detail=f"De limiet is {MAX_BUNDLE_BYTES // (1024 * 1024)} MB."
        )
    theme, created = await import_export.import_upload(
        ctx,
        filename=file.filename or "upload",
        data=data,
        on_conflict=on_conflict,
        publish=publish,
        name=name,
    )
    if created:
        response.headers["Location"] = _theme_location(theme.id)
    else:
        response.status_code = status.HTTP_200_OK
    _set_etag(response, theme.lock_version)
    return theme


@router.get(
    "/local-files",
    response_model=list[LocalCssFile],
    operation_id="themes_list_local_files",
    summary="Handgemaakte CSS-bestanden in CSS_FILES_DIR",
)
async def list_local_files(ctx: Ctx) -> list[LocalCssFile]:
    return await import_export.list_local_files(ctx)


@router.post(
    "/local-files/import",
    response_model=LocalImportResult,
    operation_id="themes_import_local_files",
    summary="Handgemaakte CSS-bestanden als thema importeren (en archiveren)",
)
async def import_local_files(data: LocalImportRequest, ctx: Ctx) -> LocalImportResult:
    return await import_export.import_local_files(ctx, data)


# --- één thema ----------------------------------------------------------------------------


@router.get("/{theme_id}", response_model=Theme, operation_id="themes_get", responses=_NOT_FOUND)
async def get_theme(theme_id: uuid.UUID, ctx: Ctx, response: Response) -> Theme:
    theme = await theme_service.get_theme(ctx, theme_id)
    _set_etag(response, theme.lock_version)
    return theme


@router.patch(
    "/{theme_id}",
    response_model=Theme,
    operation_id="themes_update",
    responses={**_NOT_FOUND, **_CONFLICT, **_PRECONDITION},
)
async def update_theme(
    theme_id: uuid.UUID, data: ThemeUpdate, ctx: Ctx, expectation: IfMatch, response: Response
) -> Theme:
    theme = await theme_service.update_theme(ctx, theme_id, data, expectation)
    _set_etag(response, theme.lock_version)
    return theme


@router.delete(
    "/{theme_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    operation_id="themes_delete",
    responses={**_NOT_FOUND, 412: _PRECONDITION[412]},
)
async def delete_theme(
    theme_id: uuid.UUID,
    ctx: Ctx,
    expectation: OptionalIfMatch,
    hard: Annotated[
        bool, Query(description="Definitief verwijderen, inclusief alle versies.")
    ] = False,
) -> Response:
    await theme_service.delete_theme(ctx, theme_id, hard=hard, expectation=expectation)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{theme_id}/restore",
    response_model=Theme,
    operation_id="themes_restore",
    responses={**_NOT_FOUND, 409: {"model": Problem, "description": "Slug intussen bezet"}},
)
async def restore_theme(theme_id: uuid.UUID, ctx: Ctx, response: Response) -> Theme:
    theme = await theme_service.restore_theme(ctx, theme_id)
    _set_etag(response, theme.lock_version)
    return theme


@router.post(
    "/{theme_id}/duplicate",
    response_model=Theme,
    status_code=status.HTTP_201_CREATED,
    operation_id="themes_duplicate",
    responses={**_NOT_FOUND, **_CONFLICT},
)
async def duplicate_theme(
    theme_id: uuid.UUID, data: DuplicateRequest, ctx: Ctx, response: Response
) -> Theme:
    theme = await theme_service.duplicate_theme(ctx, theme_id, data)
    response.headers["Location"] = _theme_location(theme.id)
    _set_etag(response, theme.lock_version)
    return theme


# --- draft en lint ------------------------------------------------------------------------


@router.get(
    "/{theme_id}/draft",
    response_model=Draft,
    operation_id="themes_get_draft",
    responses=_NOT_FOUND,
)
async def get_draft(theme_id: uuid.UUID, ctx: Ctx, response: Response) -> Draft:
    draft = await theme_service.get_draft(ctx, theme_id)
    _set_etag(response, draft.lock_version)
    return draft


@router.put(
    "/{theme_id}/draft",
    response_model=Draft,
    operation_id="themes_update_draft",
    summary="Draft opslaan (autosave)",
    responses={**_NOT_FOUND, 409: _CONFLICT[409], **_PRECONDITION, **_TOO_LARGE},
)
async def update_draft(
    theme_id: uuid.UUID, data: DraftUpdate, ctx: Ctx, expectation: IfMatch, response: Response
) -> Draft:
    draft = await theme_service.put_draft(ctx, theme_id, data.css, expectation)
    _set_etag(response, draft.lock_version)
    return draft


@router.post(
    "/{theme_id}/draft/reset",
    response_model=Draft,
    operation_id="themes_reset_draft",
    summary="Draft terugzetten naar een versie (zonder publiceren)",
    responses={**_NOT_FOUND, 409: _CONFLICT[409], **_PRECONDITION},
)
async def reset_draft(
    theme_id: uuid.UUID, data: DraftReset, ctx: Ctx, expectation: IfMatch, response: Response
) -> Draft:
    draft = await theme_service.reset_draft(ctx, theme_id, data.version_number, expectation)
    _set_etag(response, draft.lock_version)
    return draft


@router.post(
    "/{theme_id}/lint",
    response_model=LintResult,
    operation_id="themes_lint",
    responses=_NOT_FOUND,
)
async def lint_theme(theme_id: uuid.UUID, ctx: Ctx, data: LintRequest | None = None) -> LintResult:
    return await theme_service.lint_theme(ctx, theme_id, data.css if data else None)


# --- publiceren, versies, diff en rollback --------------------------------------------------


@router.post(
    "/{theme_id}/publish",
    response_model=Version,
    status_code=status.HTTP_201_CREATED,
    operation_id="themes_publish",
    responses={
        **_NOT_FOUND,
        409: {"model": Problem, "description": "Geen wijzigingen of thema verwijderd"},
        412: _PRECONDITION[412],
        **_LINT_FAILED,
    },
)
async def publish_theme(
    theme_id: uuid.UUID, data: PublishRequest, ctx: Ctx, response: Response
) -> Version:
    version, lock_version = await publish_service.publish(
        ctx, theme_id, message=data.message, expected_lock_version=data.expected_lock_version
    )
    response.headers["Location"] = f"{API_PREFIX}/{theme_id}/versions/{version.version_number}"
    _set_etag(response, lock_version)
    return version


@router.post(
    "/{theme_id}/rollback",
    response_model=Version,
    status_code=status.HTTP_201_CREATED,
    operation_id="themes_rollback",
    responses={
        **_NOT_FOUND,
        409: {"model": Problem, "description": "Die versie is al live"},
        **_PRECONDITION,
        **_LINT_FAILED,
    },
)
async def rollback_theme(
    theme_id: uuid.UUID,
    data: RollbackRequest,
    ctx: Ctx,
    expectation: IfMatch,
    response: Response,
) -> Version:
    """Nieuwe live versie met de inhoud van versie N; vervangt ook de draft (`If-Match`)."""
    version, lock_version = await publish_service.rollback(
        ctx,
        theme_id,
        version_number=data.version_number,
        message=data.message,
        expectation=expectation,
    )
    response.headers["Location"] = f"{API_PREFIX}/{theme_id}/versions/{version.version_number}"
    _set_etag(response, lock_version)
    return version


@router.get(
    "/{theme_id}/versions",
    response_model=VersionPage,
    operation_id="themes_list_versions",
    responses=_NOT_FOUND,
)
async def list_versions(
    theme_id: uuid.UUID,
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
) -> VersionPage:
    after = decode_cursor(cursor, sort=VERSIONS_SORT, kind="int") if cursor else None
    items, has_more = await theme_service.list_versions(ctx, theme_id, limit=limit, after=after)
    next_cursor = None
    if has_more and items:
        last = items[-1]
        next_cursor = encode_cursor(VERSIONS_SORT, last.version_number, last.id)
    return VersionPage(items=items, next_cursor=next_cursor)


@router.get(
    "/{theme_id}/versions/{version_number}",
    response_model=Version,
    operation_id="themes_get_version",
    responses=_NOT_FOUND,
)
async def get_version(
    theme_id: uuid.UUID, version_number: Annotated[int, Path(ge=1, le=MAX_INT4)], ctx: Ctx
) -> Version:
    return await theme_service.get_version(ctx, theme_id, version_number)


@router.get(
    "/{theme_id}/diff",
    response_model=VersionDiff,
    operation_id="themes_diff",
    responses=_NOT_FOUND,
)
async def diff_theme(
    theme_id: uuid.UUID,
    ctx: Ctx,
    from_: Annotated[
        str, Query(alias="from", pattern=DIFF_REF_PATTERN, description="Versienummer of `draft`.")
    ],
    to: Annotated[
        str, Query(pattern=DIFF_REF_PATTERN, description="Versienummer of `draft`.")
    ] = "draft",
) -> VersionDiff:
    return await theme_service.diff(ctx, theme_id, _diff_ref(from_), _diff_ref(to))


def _diff_ref(value: str) -> int | str:
    return value if value == "draft" else int(value)


# --- export -------------------------------------------------------------------------------


@router.get(
    "/{theme_id}/export",
    response_class=Response,
    operation_id="themes_export",
    responses={
        200: {
            "description": "Download (`Content-Disposition: attachment`)",
            "content": {
                "text/css": {"schema": {"type": "string"}},
                "application/zip": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        **_NOT_FOUND,
        409: {"model": Problem, "description": "Nog niet gepubliceerd (format=css)"},
    },
)
async def export_theme(
    theme_id: uuid.UUID,
    ctx: Ctx,
    format_: Annotated[ExportFormat, Query(alias="format")] = "css",
    version: Annotated[
        int | None,
        Query(ge=1, le=MAX_INT4, description="Alleen bij `format=css`; standaard de live versie."),
    ] = None,
) -> Response:
    if format_ == "bundle":
        filename, data = await import_export.export_bundle(ctx, theme_id)
        return _download(data, filename, "application/zip")
    filename, css = await import_export.export_css(ctx, theme_id, version)
    return _download(css.encode("utf-8"), filename, "text/css; charset=utf-8")


def _download(data: bytes, filename: str, media_type: str) -> Response:
    # De bestandsnaam is een slug ([a-z0-9-]) plus extensie: veilig in de header.
    return Response(
        data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
