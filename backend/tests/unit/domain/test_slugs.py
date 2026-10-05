import re

import pytest

from cssthema.domain.css.slugs import (
    RESERVED_SLUGS,
    SLUG_PATTERN,
    InvalidSlug,
    is_valid_slug,
    slugify,
    validate_slug,
    with_suffix,
)


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Proxmox", "proxmox"),
        ("Proxmox (Nord)", "proxmox-nord"),
        ("  Home   Assistant!! ", "home-assistant"),
        ("Café Crème", "cafe-creme"),
        ("Ünïcödé", "unicode"),
        ("a", "thema"),
        ("€€€", "thema"),
        ("", "thema"),
        ("UPPER_case.name", "upper-case-name"),
        ("x" * 80, "x" * 64),
    ],
)
def test_slugify(name: str, expected: str) -> None:
    assert slugify(name) == expected


def test_slugify_never_ends_with_a_dash_after_truncation() -> None:
    slug = slugify("a" * 63 + " b")
    assert len(slug) <= 64
    assert not slug.endswith("-")
    assert re.fullmatch(SLUG_PATTERN, slug)


@pytest.mark.parametrize("slug", ["proxmox", "proxmox-nord", "a1", "x" * 64, "home-assistant-2"])
def test_valid_slugs(slug: str) -> None:
    validate_slug(slug)
    assert is_valid_slug(slug)


@pytest.mark.parametrize(
    ("slug", "fragment"),
    [
        ("a", "minstens"),
        ("x" * 65, "hoogstens"),
        ("-proxmox", "kleine letters"),
        ("proxmox-", "kleine letters"),
        ("Proxmox", "kleine letters"),
        ("pro_xmox", "kleine letters"),
        ("pve.css", "kleine letters"),
        ("api", "gereserveerd"),
        ("themes", "gereserveerd"),
        ("cssthema", "gereserveerd"),
    ],
)
def test_invalid_slugs(slug: str, fragment: str) -> None:
    with pytest.raises(InvalidSlug) as info:
        validate_slug(slug)
    assert fragment in info.value.reason
    assert info.value.slug == slug
    assert not is_valid_slug(slug)


def test_reserved_slugs_match_the_plan() -> None:
    assert {"api", "themes", "assets", "healthz", "readyz", "preview-bridge"} <= RESERVED_SLUGS
    assert all(re.fullmatch(SLUG_PATTERN, slug) for slug in RESERVED_SLUGS)


def test_with_suffix_stays_within_64_characters() -> None:
    assert with_suffix("proxmox", 2) == "proxmox-2"
    long = "x" * 64
    assert with_suffix(long, 12) == "x" * 61 + "-12"
    assert with_suffix("a" * 62 + "-b", 3) == "a" * 62 + "-3"
