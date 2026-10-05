"""Domeinfouten van de servicelaag; de API zet ze om naar Problem Details (RFC 9457).

De servicelaag kent geen HTTP, maar elke fout draagt wel de status en `code` uit
docs/05 § 2, zodat de vertaling in `api/errors.py` één generieke handler is.
"""

from typing import Any


class ServiceError(Exception):
    status: int = 400
    code: str = "bad_request"

    def __init__(
        self,
        title: str,
        *,
        detail: str | None = None,
        errors: list[dict[str, Any]] | None = None,
        extra: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(title)
        self.title = title
        self.detail = detail
        self.errors = errors
        self.extra = extra or {}
        self.headers = headers


class BadRequestError(ServiceError):
    status, code = 400, "bad_request"


class NotFoundError(ServiceError):
    status, code = 404, "not_found"


class SlugConflictError(ServiceError):
    status, code = 409, "slug_conflict"


class StateConflictError(ServiceError):
    status, code = 409, "state_conflict"


class PreconditionFailedError(ServiceError):
    status, code = 412, "precondition_failed"


class PayloadTooLargeError(ServiceError):
    status, code = 413, "payload_too_large"


class UnsupportedMediaTypeError(ServiceError):
    status, code = 415, "unsupported_media_type"


class InvalidInputError(ServiceError):
    """Veldfout die pas in de servicelaag blijkt (bv. onbekend palet)."""

    status, code = 422, "validation_error"


class InvalidSlugError(ServiceError):
    status, code = 422, "invalid_slug"


class LintFailedError(ServiceError):
    status, code = 422, "theme_lint_failed"


class PreconditionRequiredError(ServiceError):
    status, code = 428, "precondition_required"


def field_error(field: str, message: str, *, kind: str = "value_error") -> dict[str, Any]:
    """Veldfout in hetzelfde formaat als de Pydantic-validatie (`loc`, `msg`, `type`)."""
    return {"loc": ["body", field], "msg": message, "type": kind}
