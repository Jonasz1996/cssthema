"""Schema's voor paletten (alleen lezen in fase 1)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class Palette(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    tokens: dict[str, str] = Field(
        description="Design tokens; in gecompileerde CSS als `--ct-<naam>`.",
        examples=[{"bg": "#2e3440", "fg": "#eceff4", "radius": "6px"}],
    )
    is_builtin: bool
    theme_count: int = Field(description="Aantal (niet-verwijderde) thema's met dit palet.")
    created_at: datetime
