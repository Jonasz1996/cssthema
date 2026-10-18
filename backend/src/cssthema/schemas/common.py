"""Gedeelde schema's: paginering, gebruikersverwijzing en Problem-varianten."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from cssthema.api.errors import Problem


def _no_nul(value: str) -> str:
    # PostgreSQL kan geen NUL-teken in tekst opslaan; liever een nette 422 dan een 500.
    if "\0" in value:
        raise ValueError("mag geen NUL-teken bevatten")
    return value


# Tekst die in de database belandt.
SafeText = Annotated[str, AfterValidator(_no_nul)]

# Grootste PostgreSQL-`integer` (versienummers): een groter getal geeft anders een 500
# uit asyncpg in plaats van een 422.
MAX_INT4 = 2_147_483_647


class Page[ItemT](BaseModel):
    """Cursor-paginering (docs/05 § 1): `next_cursor` is null op de laatste pagina."""

    items: list[ItemT]
    next_cursor: str | None = None


class UserRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str


class EtagState(BaseModel):
    """Huidige toestand van een thema, meegestuurd bij 412 (docs/05 § 5.1)."""

    etag: str = Field(examples=['"lv-14"'])
    lock_version: int
    updated_by: UserRef | None = None
    updated_at: datetime


class PreconditionFailedProblem(Problem):
    current: EtagState


class LintIssueOut(BaseModel):
    line: int = Field(ge=1)
    column: int = Field(ge=1)
    rule: str = Field(examples=["external-url"])
    severity: str = Field(examples=["error"])
    message: str


class LintFailedProblem(Problem):
    """422 `theme_lint_failed`: `errors[]` bevat de lint-fouten (docs/05 § 2)."""
