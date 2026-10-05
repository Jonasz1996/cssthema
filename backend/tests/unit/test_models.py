import re

from cssthema.db.base import Base
from cssthema.db.models.theme import SLUG_PATTERN


def test_all_mvp_tables_are_registered() -> None:
    import cssthema.db.models  # noqa: F401

    assert set(Base.metadata.tables) == {
        "users",
        "api_keys",
        "assets",
        "services",
        "dom_snapshots",
        "snapshot_selectors",
        "palettes",
        "themes",
        "theme_versions",
        "theme_slug_redirects",
        "jobs",
        "audit_logs",
        "settings",
    }


def test_slug_pattern() -> None:
    valid = ["proxmox", "proxmox-nord", "a1", "x" * 64]
    invalid = ["-proxmox", "proxmox-", "Proxmox", "pro_xmox", "a", "x" * 65, "pve.css"]
    assert all(re.fullmatch(SLUG_PATTERN, s) for s in valid)
    assert not any(re.fullmatch(SLUG_PATTERN, s) for s in invalid)
