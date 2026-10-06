from datetime import UTC, datetime

from cssthema.repositories.themes import PublicCssRow
from cssthema.services.css_delivery import (
    CachedCss,
    fixed_key,
    generation_key,
    latest_key,
    refresh_paths,
)


def test_cached_css_round_trip() -> None:
    row = PublicCssRow(
        slug="proxmox",
        version_number=8,
        css="/*! x */\na{content:'é'}",
        sha256=bytes(range(32)),
        published_at=datetime(2026, 10, 5, 12, 4, 31, 5, tzinfo=UTC),
    )
    item = CachedCss.from_row(row)
    assert CachedCss.from_json(item.to_json()) == item
    assert CachedCss.from_json(item.to_json().encode()) == item


def test_keys() -> None:
    assert latest_key("proxmox") == "css:proxmox"
    assert fixed_key("proxmox", 3) == "css:proxmox@3"
    assert generation_key("proxmox") == "css:gen:proxmox"


def test_refresh_paths() -> None:
    assert refresh_paths("proxmox") == ["/proxmox.css", "/themes/proxmox.css"]
    assert refresh_paths("proxmox", [2, 1, 2]) == [
        "/proxmox.css",
        "/themes/proxmox.css",
        "/themes/proxmox@1.css",
        "/themes/proxmox@2.css",
    ]
