"""Schema's voor host-koppelingen: welke thema's en scripts een proxy host krijgt."""

import uuid
from datetime import datetime
from typing import Literal

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
    snippet: str = Field(
        description=(
            "Het blok voor Advanced (server-niveau) van elke proxy host in NPM, tussen "
            "`# cssthema…` en `# /cssthema`."
        )
    )
    snippet_own_domain: str = Field(
        description=(
            "Variant via `/alg-thema/` op het eigen domein, alleen CSS, voor apps waarvan de "
            "CSP het CSS-domein weigert (met de `location ^~ /alg-thema/` erin)."
        )
    )
    snippet_own_domain_script: str = Field(
        default_factory=str,
        description=(
            "Dezelfde variant met het script erbij, voor apps die alleen scripts van een ander "
            "domein weigeren. Nooit voor een wachtwoordkluis: het script draait daar "
            "same-origin."
        ),
    )
    excluded_hosts: list[str] = Field(
        default_factory=list,
        description=(
            "Hosts die nooit iets krijgen (DASHBOARD_HOST, de host van PUBLIC_BASE_URL en "
            "EXCLUDED_HOSTS): de regel hoort daar niet."
        ),
    )


HealthLevel = Literal["ok", "warn", "error", "unknown"]


class HostCheck(BaseModel):
    level: HealthLevel
    code: str = Field(
        description="rule_active, old_rule, no_rule, csp_blocked, login, not_html, http_error, "
        "unreachable"
    )
    detail: str
    http_status: int | None
    checked_at: datetime
    content_encoding: str | None = Field(
        default=None,
        description="Content-Encoding van het antwoord (bv. `gzip`), of null als het niet "
        "gecomprimeerd was.",
    )


class HostHealth(BaseModel):
    hostname: str
    bound: bool = Field(description="Heeft een eigen koppeling (anders volgt de host `*`).")
    enabled: bool
    level: HealthLevel = Field(description="Samenvatting van ontbrekende onderdelen en controle.")
    last_seen: datetime | None = Field(
        description="Wanneer een browser `/host/<host>.css` laatst ophaalde (± 1 minuut)."
    )
    missing_styles: list[str]
    missing_scripts: list[str]
    check: HostCheck | None
    stale: bool = Field(
        default_factory=bool,
        description="Eigen, ingeschakelde koppeling, maar nooit of al 14 dagen niet geladen "
        "(niveau minstens `warn`).",
    )
    service: bool = Field(
        default_factory=bool,
        description="Hostnaam van een geïmporteerde dienst: zonder eigen koppeling volgt hij `*` "
        "en wordt hij ook gecontroleerd.",
    )
    excluded: bool = Field(
        default_factory=bool,
        description="Krijgt nooit iets (DASHBOARD_HOST, het CSS-domein of EXCLUDED_HOSTS).",
    )


class HostHealthOverview(BaseModel):
    hosts: list[HostHealth] = Field(description="`*` eerst, dan eigen koppelingen, dan de rest.")
    check_running: bool
    check_started_at: datetime | None
    check_finished_at: datetime | None


class HostCheckStarted(BaseModel):
    started: bool = Field(description="False als er al een controle loopt.")
