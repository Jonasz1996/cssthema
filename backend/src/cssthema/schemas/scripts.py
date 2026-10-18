"""Schema's voor thema-scripts: `.js`-bestanden in CSS_FILES_DIR (docs/05 § 4.6a)."""

from datetime import datetime

from pydantic import BaseModel, Field


class ScriptFile(BaseModel):
    name: str = Field(
        examples=["algemeen"],
        description="Naam zonder `.js`; ook het pad van de publieke URL (`/<name>.js`).",
    )
    filename: str = Field(examples=["algemeen.js"])
    size_bytes: int
    modified_at: datetime
    url: str = Field(
        examples=["https://css.jbogaert.be/algemeen.js"],
        description="Publieke URL (`PUBLIC_BASE_URL` + `/<name>.js`) voor de `<script>`-tag.",
    )
    sha256: str | None = Field(
        description="SHA-256 van de inhoud (hex); null als de api het bestand niet kan lezen."
    )
    world_readable: bool = Field(
        description=(
            "Leesbaar voor iedereen (modus o+r), dus ook voor nginx. Zo niet, dan geeft de "
            "publieke URL 403 (bv. een bestand dat met de hand met modus 0600 is gezet)."
        )
    )
