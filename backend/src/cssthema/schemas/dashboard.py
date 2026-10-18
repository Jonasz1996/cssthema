"""Schema voor het dashboard (F-PL-02, basis)."""

from pydantic import BaseModel, Field

from cssthema.schemas.themes import Theme


class LocalFilesSummary(BaseModel):
    dir: str = Field(examples=["/var/lib/cssthema/css-files"])
    total: int = Field(description="Aantal handgemaakte .css-bestanden in de map.")
    importable: int = Field(description="Waarvan direct als thema te importeren.")


class Dashboard(BaseModel):
    themes_total: int = Field(description="Niet-verwijderde thema's.")
    themes_published: int
    themes_draft_dirty: int = Field(description="Thema's met niet-gepubliceerde wijzigingen.")
    themes_deleted: int
    palettes_total: int
    recent: list[Theme] = Field(description="De 5 laatst gewijzigde thema's.")
    local_files: LocalFilesSummary
