"""Schema's voor diensten en snapshots uit de capture-zips van vastleggen.py (D1/D2)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CaptureSkipped(BaseModel):
    path: str
    reason: str


class CaptureImportResult(BaseModel):
    services_created: list[str] = Field(description="Hostnamen van nieuwe diensten.")
    services_updated: list[str] = Field(description="Hostnamen van bestaande diensten.")
    snapshots: int = Field(description="Aantal pagina's met een snapshot.")
    without_snapshot: list[str] = Field(
        description="Hostnamen zonder snapshot.html (bv. de app antwoordde niet): alleen "
        "status en screenshots."
    )
    skipped: list[CaptureSkipped]


class SnapshotSummary(BaseModel):
    id: uuid.UUID
    page: str = Field(description="Map in de zip: `start`, of de naam van een handmatige opname.")
    page_kind: str
    title: str | None
    url: str
    status: str | None = Field(description="Uit vastleggen.py: ok, inlogpagina, http-502, …")
    has_document: bool = Field(description="Er is een snapshot.html om tegen te previewen.")
    frameworks: list[str]
    class_count: int
    has_shadow_dom: bool
    theme_links: list[str] = Field(description="Thema-bestanden die de app toen laadde.")
    csp_errors: int
    screenshots: dict[str, str] = Field(
        description="`origineel`, `met_thema`, `mobiel` → URL van de afbeelding."
    )
    captured_at: datetime | None
    imported_at: datetime


class ServiceSummary(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    hostname: str
    base_url: str
    snapshots: list[SnapshotSummary] = Field(description="Nieuwste eerst.")


class SnapshotDocument(BaseModel):
    id: uuid.UUID
    service_id: uuid.UUID
    hostname: str
    title: str | None
    url: str
    html: str = Field(description="snapshot.html zoals vastgelegd (zonder scripts).")
    stylesheets: list[str] = Field(description="De CSS van de app, in de volgorde van de pagina.")
