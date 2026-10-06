"""Gedeelde kolomtype-helpers."""

import enum

from sqlalchemy import Enum


def pg_enum(enum_cls: type[enum.StrEnum], name: str) -> Enum:
    """Native PostgreSQL-enum die de *waarden* (niet de namen) van de StrEnum opslaat."""
    return Enum(
        enum_cls,
        name=name,
        values_callable=lambda cls: [member.value for member in cls],
        validate_strings=True,
    )
