"""Preview in de editor: de stapel van een host rond het bewerkte thema, en wie het thema krijgt.

Alleen lezen, achter dezelfde login als de rest van `/api/v1` (de publieke bundels staan in
`api/public.py`).
"""

from typing import Annotated

from fastapi import APIRouter, Query

from cssthema.api.deps import Ctx
from cssthema.domain.hosts import STYLE_NAME_RE, normalize_hostname
from cssthema.schemas.preview import PreviewStack, ThemeUsage
from cssthema.services import preview_stack
from cssthema.services.errors import InvalidInputError

router = APIRouter(prefix="/preview", tags=["preview"])

ThemeName = Annotated[
    str, Query(min_length=1, max_length=127, description="Slug van het bewerkte thema.")
]


def _query_error(field: str, message: str) -> InvalidInputError:
    return InvalidInputError(
        "Ongeldige invoer",
        detail=message,
        errors=[{"loc": ["query", field], "msg": message, "type": "value_error"}],
    )


def _theme(value: str) -> str:
    if not STYLE_NAME_RE.fullmatch(value):
        raise _query_error("theme", "Geen geldige naam van een thema.")
    return value


@router.get(
    "/stack",
    response_model=PreviewStack,
    operation_id="preview_stack",
    summary="De stapel van een host (eigen koppeling, anders `*`) vóór en na een thema",
)
async def get_stack(
    ctx: Ctx,
    hostname: Annotated[
        str, Query(min_length=1, max_length=253, description="Hostnaam van de snapshot.")
    ],
    theme: ThemeName,
) -> PreviewStack:
    try:
        host = normalize_hostname(hostname)
    except ValueError as exc:
        raise _query_error("hostname", str(exc)) from exc
    return await preview_stack.stack(ctx, host, _theme(theme))


@router.get(
    "/usage",
    response_model=ThemeUsage,
    operation_id="preview_usage",
    summary="Welke hosts een thema krijgen (eigen koppelingen en `*`)",
)
async def get_usage(ctx: Ctx, theme: ThemeName) -> ThemeUsage:
    return await preview_stack.usage(ctx, _theme(theme))
