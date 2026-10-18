"""Optimistic locking op `themes.lock_version` (ETag `"lv-<n>"`, docs/05 § 5.1)."""

import re
from dataclasses import dataclass

_LOCK_ETAG_RE = re.compile(r'^(?:W/)?"lv-(\d{1,10})"$')


def lock_etag(lock_version: int) -> str:
    return f'"lv-{lock_version}"'


@dataclass(frozen=True, slots=True)
class LockExpectation:
    """Welke lock_version(s) de client verwacht; `versions=None` is `If-Match: *`."""

    versions: frozenset[int] | None

    @classmethod
    def exactly(cls, lock_version: int) -> "LockExpectation":
        return cls(frozenset({lock_version}))

    @classmethod
    def from_if_match(cls, header: str) -> "LockExpectation":
        """Leest een If-Match-header; onbekende ETags matchen nooit (→ 412).

        `W/"lv-12"` telt mee: nginx maakt een sterke ETag zwak als hij de response
        comprimeert, en de editor stuurt dan die waarde terug.
        """
        if header.strip() == "*":
            return cls(None)
        versions: set[int] = set()
        for part in header.split(","):
            match = _LOCK_ETAG_RE.match(part.strip())
            if match:
                versions.add(int(match.group(1)))
        return cls(frozenset(versions))

    def matches(self, lock_version: int) -> bool:
        return self.versions is None or lock_version in self.versions
