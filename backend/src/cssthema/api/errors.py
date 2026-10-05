"""Problem Details (RFC 9457) voor alle API-fouten."""

from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from cssthema.api.middleware import REQUEST_ID_HEADER
from cssthema.logging import get_logger

PROBLEM_BASE = "https://cssthema.dev/problems/"
PROBLEM_MEDIA_TYPE = "application/problem+json"

log = get_logger(__name__)


class Problem(BaseModel):
    type: str
    title: str
    status: int
    code: str
    detail: str | None = None
    instance: str | None = None
    request_id: str | None = None
    errors: list[dict[str, Any]] | None = None


class ProblemError(Exception):
    """Domeinfout die als Problem Details wordt teruggegeven."""

    def __init__(
        self,
        status: int,
        code: str,
        title: str,
        detail: str | None = None,
        errors: list[dict[str, Any]] | None = None,
        extra: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(title)
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail
        self.errors = errors
        self.extra = extra or {}
        self.headers = headers


_STATUS_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "state_conflict",
    412: "precondition_failed",
    413: "payload_too_large",
    415: "unsupported_media_type",
    428: "precondition_required",
    429: "rate_limited",
}


def problem_response(
    request: Request,
    *,
    status: int,
    code: str,
    title: str,
    detail: str | None = None,
    errors: list[dict[str, Any]] | None = None,
    extra: dict[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    response_headers = dict(headers or {})
    if request_id:
        # Ook voor responses die buiten de request-ID-middleware worden verstuurd (500).
        response_headers.setdefault(REQUEST_ID_HEADER, request_id)
    body = Problem(
        type=PROBLEM_BASE + code.replace("_", "-"),
        title=title,
        status=status,
        code=code,
        detail=detail,
        instance=request.url.path,
        request_id=request_id,
        errors=errors,
    ).model_dump(exclude_none=True)
    body.update(extra or {})
    return JSONResponse(
        body, status_code=status, media_type=PROBLEM_MEDIA_TYPE, headers=response_headers
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ProblemError)
    async def _problem(request: Request, exc: ProblemError) -> JSONResponse:
        return problem_response(
            request,
            status=exc.status,
            code=exc.code,
            title=exc.title,
            detail=exc.detail,
            errors=exc.errors,
            extra=exc.extra,
            headers=exc.headers,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "error")
        title = exc.detail if isinstance(exc.detail, str) else code.replace("_", " ").capitalize()
        # exc.headers doorgeven: Allow bij 405, later WWW-Authenticate (401) en Retry-After (429).
        return problem_response(
            request, status=exc.status_code, code=code, title=title, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        if any(err["type"] == "json_invalid" for err in exc.errors()):
            # Onleesbare body is 400 (docs/05 § 1), geen veldvalidatie.
            return problem_response(
                request, status=400, code="bad_request", title="Onleesbare body"
            )
        errors = [
            {"loc": list(err["loc"]), "msg": err["msg"], "type": err["type"]}
            for err in exc.errors()
        ]
        return problem_response(
            request,
            status=422,
            code="validation_error",
            title="Ongeldige invoer",
            errors=errors,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", path=request.url.path)
        return problem_response(request, status=500, code="internal_error", title="Interne fout")
