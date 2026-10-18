"""Migratie 0002 kopieert de ingebouwde paletten; ze moeten gelijk blijven aan de code."""

import importlib.util
import uuid
from pathlib import Path
from types import ModuleType

from cssthema.domain.palettes.builtin import BUILTIN_PALETTES
from cssthema.repositories.users import DEV_USER_ID

MIGRATION = Path(__file__).parents[2] / "migrations" / "versions" / "0002_fase1.py"


def load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_0002", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_seeded_palettes_match_builtin_palettes() -> None:
    migration = load_migration()
    seeded = [
        (uuid.UUID(palette_id), slug, name, tokens)
        for palette_id, slug, name, tokens in migration.PALETTES
    ]
    expected = [(p.id, p.slug, p.name, dict(p.tokens)) for p in BUILTIN_PALETTES]
    assert seeded == expected


def test_seeded_dev_user_is_the_current_user() -> None:
    assert uuid.UUID(load_migration().DEV_USER_ID) == DEV_USER_ID
