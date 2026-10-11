"""Schema's voor host-koppelingen: welke thema's en scripts een proxy host krijgt."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from cssthema.domain import hosts as domain


class HostBindingInput(BaseModel):
    hostname: str = Field(
        max_length=300,
        examples=["proxmox100.jbogaert.be"],
        description="Hostnaam van de proxy host, of `*` voor elke host zonder eigen koppeling.",
    )
    styles: list[str] = Field(
        default_factory=list,
        max_length=domain.MAX_STYLES,
        examples=[["algemeen", "alg-proxmox"]],
        description=(
            "Thema-slugs of namen van bestanden in css-files (zonder `.css`), in laadvolgorde. "
            "Een bestand in css-files gaat voor op een thema met dezelfde naam, zoals in nginx."
        ),
    )
    scripts: list[str] = Field(
        default_factory=list,
        max_length=domain.MAX_SCRIPTS,
        examples=[["algemeen"]],
        description="Thema-scripts (zonder `.js`), bv. leeg voor een wachtwoordkluis.",
    )
    enabled: bool = Field(default=True, description="Uit: de host krijgt niets, ook niet `*`.")
    note: str | None = Field(default=None, max_length=500)

    @field_validator("hostname")
    @classmethod
    def _hostname(cls, value: str) -> str:
        return domain.normalize_hostname(value)

    @field_validator("styles")
    @classmethod
    def _styles(cls, value: list[str]) -> list[str]:
        return domain.normalize_names(value, kind="styles")

    @field_validator("scripts")
    @classmethod
    def _scripts(cls, value: list[str]) -> list[str]:
        return domain.normalize_names(value, kind="scripts")


class HostBinding(HostBindingInput):
    id: uuid.UUID
    css_url: str = Field(
        examples=["https://css.jbogaert.be/host/proxmox100.jbogaert.be.css"],
        description="Publieke URL van de samengevoegde CSS van deze host.",
    )
    js_url: str
    created_at: datetime
    updated_at: datetime


class HostImportRequest(BaseModel):
    text: str = Field(
        max_length=domain.MAX_IMPORT_CHARS,
        description=(
            "NPM-config met `# <hostnaam>` boven elke `sub_filter`-regel, bv. de inhoud van "
            "npm-sub_filter-per-dienst.conf."
        ),
    )
    replace: bool = Field(
        default=True,
        description="Bestaande koppelingen overschrijven (thema's en scripts); anders overslaan.",
    )


class HostImportSkipped(BaseModel):
    line: int
    reason: str


class HostImportResult(BaseModel):
    created: list[str]
    updated: list[str]
    unchanged: list[str]
    skipped: list[HostImportSkipped]


class HostOptions(BaseModel):
    styles: list[str] = Field(
        description="Gepubliceerde thema's en CSS-bestanden in css-files (zonder `.css`)."
    )
    scripts: list[str] = Field(description="Scripts in css-files (zonder `.js`).")
    snippet: str = Field(description="De `sub_filter`-regel voor elke proxy host in NPM.")
    snippet_own_domain: str = Field(
        description=(
            "Dezelfde regel via `/alg-thema/` op het eigen domein, voor apps met een strikte "
            "CSP (met een `location ^~ /alg-thema/` die naar cssthema doorstuurt)."
        )
    )
