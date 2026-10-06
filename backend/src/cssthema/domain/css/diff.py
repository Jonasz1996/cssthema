"""Unified diff tussen twee CSS-teksten (versie ↔ versie of versie ↔ draft)."""

import difflib
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VersionDiffResult:
    unified: str
    added: int
    removed: int


def unified_diff(a: str, b: str, *, from_label: str, to_label: str) -> VersionDiffResult:
    """Unified diff met 3 regels context; `added`/`removed` tellen gewijzigde regels."""
    lines = list(
        difflib.unified_diff(
            a.splitlines(),
            b.splitlines(),
            fromfile=from_label,
            tofile=to_label,
            lineterm="",
        )
    )
    added = removed = 0
    for line in lines[2:]:  # de twee kopregels (---/+++) tellen niet mee
        if line.startswith("+"):
            added += 1
        elif line.startswith("-"):
            removed += 1
    unified = "\n".join(lines) + "\n" if lines else ""
    return VersionDiffResult(unified=unified, added=added, removed=removed)
