"""Schema's voor de editor-preview: de stapel van een host en welke hosts een thema krijgen."""

from pydantic import BaseModel, Field


class StackPart(BaseModel):
    name: str
    source: str = Field(
        description="`bestand`, `thema v<n>`, of leeg als het onderdeel niet gevonden is."
    )
    css: str | None = Field(
        description="De CSS zoals de bundel `/host/<host>.css` hem levert; null = niet gevonden."
    )


class PreviewStack(BaseModel):
    hostname: str
    binding: str | None = Field(
        description="De koppeling die voor de host geldt: de host zelf, `*`, of null (geen)."
    )
    enabled: bool = Field(description="false: de koppeling staat uit, de host krijgt niets.")
    contains_theme: bool = Field(
        description=(
            "Het bewerkte thema staat in de stapel. Zo niet, dan hoort de draft na `before` "
            "(`after` is dan leeg)."
        )
    )
    before: list[StackPart] = Field(description="Onderdelen vóór het bewerkte thema.")
    after: list[StackPart] = Field(
        description="Onderdelen na het bewerkte thema (bv. framework-modules, een variant)."
    )


class ThemeUsage(BaseModel):
    theme: str
    hostnames: list[str] = Field(
        description="Hosts met een eigen koppeling (aan) die het thema bevat, op naam."
    )
    default: bool = Field(
        description="De koppeling `*` (aan) bevat het thema: elke host zonder eigen koppeling."
    )
    bound: list[str] = Field(
        description="Alle hosts met een eigen koppeling; die vallen nooit terug op `*`."
    )
