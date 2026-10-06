"""Schema's voor thema's, drafts, versies, lint, import/export (docs/05 § 3)."""

import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from cssthema.db.models.enums import ThemeStatus, VersionSource
from cssthema.schemas.common import MAX_INT4, LintIssueOut, Page, SafeText, UserRef

MAX_TAGS = 20


def _clean_name(value: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError("mag niet leeg zijn")
    if any(ord(char) < 0x20 for char in cleaned):
        raise ValueError("mag geen stuurtekens bevatten")
    return cleaned


def _clean_tags(tags: list[str]) -> list[str]:
    cleaned: list[str] = []
    for tag in tags:
        normalized = " ".join(tag.split()).lower()
        if not normalized:
            continue
        if len(normalized) > 40:
            raise ValueError("een tag heeft hoogstens 40 tekens")
        if "\0" in normalized:
            raise ValueError("een tag mag geen NUL-teken bevatten")
        if normalized not in cleaned:
            cleaned.append(normalized)
    if len(cleaned) > MAX_TAGS:
        raise ValueError(f"hoogstens {MAX_TAGS} tags")
    return cleaned


ThemeName = Annotated[str, StringConstraints(max_length=120), AfterValidator(_clean_name)]
SlugInput = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Description = Annotated[SafeText, StringConstraints(max_length=2000)]
Message = Annotated[SafeText, StringConstraints(strip_whitespace=True, max_length=500)]
Tags = Annotated[list[str], AfterValidator(_clean_tags)]


class VersionSummary(BaseModel):
    id: uuid.UUID
    version_number: int
    source: VersionSource
    message: str | None
    sha256: str = Field(description="SHA-256 (hex) van de gecompileerde CSS; basis van de ETag.")
    size_bytes: int = Field(description="Grootte van de gecompileerde CSS in bytes.")
    created_by: UserRef | None
    created_at: datetime
    is_live: bool
    source_version_number: int | None = Field(
        default=None, description="Bij een rollback: de versie waarvan gekopieerd is."
    )


class Version(VersionSummary):
    css_source: str
    css_compiled: str
    lint_warnings: list[LintIssueOut]


class Theme(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str | None
    service_id: uuid.UUID | None
    palette_id: uuid.UUID | None
    status: ThemeStatus
    tags: list[str]
    published_version: VersionSummary | None
    latest_version_number: int
    lock_version: int = Field(description='Voor `If-Match: "lv-<n>"` bij de volgende wijziging.')
    draft_dirty: bool = Field(
        description=(
            "De draft (of het gekoppelde palet) verschilt van de live versie; zonder live "
            "versie: de draft is niet leeg."
        )
    )
    draft_size_bytes: int
    draft_updated_at: datetime | None
    draft_updated_by: UserRef | None
    public_url: str = Field(examples=["https://cssthema.domain.be/proxmox.css"])
    shadowed_by_file: bool = Field(
        description=(
            "Er staat een handgemaakt bestand `<slug>.css` in de css-files-map; nginx "
            "serveert dat in plaats van dit thema."
        )
    )
    deleted_at: datetime | None
    created_by: UserRef | None
    created_at: datetime
    updated_at: datetime


class ThemePage(Page[Theme]):
    pass


class VersionPage(Page[VersionSummary]):
    pass


class ThemeTemplate(BaseModel):
    """Startinhoud: leeg, de draft van een ander thema, of een versie van een thema."""

    kind: Literal["empty", "theme", "version"] = "empty"
    id: uuid.UUID | None = Field(default=None, description="Thema-ID (bij `theme`/`version`).")
    version_number: int | None = Field(default=None, ge=1, le=MAX_INT4)

    @model_validator(mode="after")
    def _check_reference(self) -> Self:
        if self.kind in ("theme", "version") and self.id is None:
            raise ValueError("id is verplicht bij kind 'theme' en 'version'")
        if self.kind == "version" and self.version_number is None:
            raise ValueError("version_number is verplicht bij kind 'version'")
        return self


class ThemeCreate(BaseModel):
    name: ThemeName
    slug: SlugInput | None = Field(default=None, description="Standaard afgeleid van de naam.")
    description: Description | None = None
    service_id: uuid.UUID | None = None
    palette_id: uuid.UUID | None = None
    tags: Tags = Field(default_factory=list)
    css: SafeText | None = Field(default=None, description="Startinhoud van de draft.")
    template: ThemeTemplate | None = None

    @model_validator(mode="after")
    def _css_or_template(self) -> Self:
        if self.css is not None and self.template is not None and self.template.kind != "empty":
            raise ValueError("geef css of template, niet allebei")
        return self


class ThemeUpdate(BaseModel):
    """Alleen de meegestuurde velden veranderen; `null` maakt een optioneel veld leeg."""

    name: ThemeName | None = None
    slug: SlugInput | None = None
    description: Description | None = None
    service_id: uuid.UUID | None = None
    palette_id: uuid.UUID | None = None
    tags: Tags | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> Self:
        for field in ("name", "slug", "tags"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} mag niet null zijn")
        return self


class Draft(BaseModel):
    css: str
    lock_version: int
    size_bytes: int
    updated_at: datetime | None
    updated_by: UserRef | None


class DraftUpdate(BaseModel):
    css: SafeText


class DraftReset(BaseModel):
    version_number: int = Field(ge=1, le=MAX_INT4)


class LintRequest(BaseModel):
    css: SafeText | None = Field(default=None, description="Standaard: de opgeslagen draft.")


class LintResult(BaseModel):
    ok: bool
    errors: list[LintIssueOut]
    warnings: list[LintIssueOut]
    size_bytes: int
    unmatched_selectors: list[str] = Field(
        default_factory=list, description="Selectors zonder match in de snapshot (fase 2)."
    )


class PublishRequest(BaseModel):
    message: Message | None = None
    expected_lock_version: int = Field(description="lock_version van de draft die je publiceert.")


class RollbackRequest(BaseModel):
    version_number: int = Field(ge=1, le=MAX_INT4)
    message: Message | None = None


class DuplicateRequest(BaseModel):
    name: ThemeName
    slug: SlugInput | None = None
    service_id: uuid.UUID | None = None


class DiffStats(BaseModel):
    added: int
    removed: int


class VersionDiff(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    from_: int | Literal["draft"] = Field(alias="from")
    to: int | Literal["draft"]
    unified: str
    stats: DiffStats


class LocalCssFile(BaseModel):
    name: str = Field(examples=["proxmox.css"])
    slug: str | None = Field(description="De slug die het thema zou krijgen (als geldig).")
    size_bytes: int
    modified_at: datetime
    importable: bool
    reason: str | None = Field(default=None, description="Waarom niet importeerbaar.")
    theme_id: uuid.UUID | None = Field(
        default=None, description="Bestaand thema met dezelfde slug."
    )


class LocalImportRequest(BaseModel):
    names: list[Annotated[str, StringConstraints(max_length=255)]] = Field(
        min_length=1, max_length=500
    )
    publish: bool = True
    archive: bool = Field(
        default=True,
        description=(
            "Verplaats het bestand na de import naar `.geimporteerd/`, zodat nginx naar "
            "het thema doorvalt. Alleen als het thema live is (`publish`); anders blijft "
            "het bestand staan en staat de reden in `archive_error`."
        ),
    )

    @field_validator("names")
    @classmethod
    def _dedupe(cls, names: list[str]) -> list[str]:
        return list(dict.fromkeys(names))


class ImportedTheme(Theme):
    source_file: str
    archive_error: str | None = Field(
        default=None,
        description=(
            "Het bestand is niet gearchiveerd (mislukt, of het thema is niet live); het "
            "blijft voorgaan op het thema."
        ),
    )


class SkippedFile(BaseModel):
    name: str
    reason: str


class LocalImportResult(BaseModel):
    imported: list[ImportedTheme]
    skipped: list[SkippedFile]


ImportConflict = Literal["rename", "new_version", "fail"]
ExportFormat = Literal["css", "bundle"]
SortOrder = Literal["-updated_at", "name", "-created_at"]
