"""Bundelformaat `.cssthema.zip` (F-TM-04/05): manifest + draft + bron van elke versie.

```
manifest.json      {format: "cssthema-bundle", format_version: 1, exported_at,
                    theme: {slug, name, description, tags, palette_slug},
                    live_version: n | null, draft: "draft.css",
                    versions: [{number, file: "versions/v<n>.css", message, source,
                                created_at, sha256}]}
draft.css
versions/v<n>.css  (bron, niet gecompileerd)
```

`sha256` in het manifest is de hash van het versiebestand in de bundel, zodat een import
een beschadigde bundel herkent. Lezen is defensief: grootte, aantal entries, paden
(niets buiten de zip, alleen `manifest.json` en `.css`), versleuteling en UTF-8 worden
gecontroleerd; de gedeclareerde grootte in de zip wordt niet vertrouwd. Puur: werkt op
bytes in het geheugen.
"""

import hashlib
import io
import json
import re
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

BUNDLE_FORMAT = "cssthema-bundle"
BUNDLE_FORMAT_VERSION = 1
BUNDLE_SUFFIX = ".cssthema.zip"
MANIFEST_NAME = "manifest.json"
DRAFT_NAME = "draft.css"

MAX_BUNDLE_BYTES = 25 * 1024 * 1024
MAX_ENTRIES = 2000
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
MAX_MESSAGE_LENGTH = 500

_VERSION_FILE_RE = re.compile(r"^versions/v([1-9][0-9]{0,8})\.css$")
_ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)


class BundleError(ValueError):
    """Ongeldige of onveilige bundel; de melding is voor de gebruiker (Nederlands)."""


@dataclass(frozen=True, slots=True)
class BundleTheme:
    slug: str
    name: str
    description: str | None = None
    tags: tuple[str, ...] = ()
    palette_slug: str | None = None


@dataclass(frozen=True, slots=True)
class BundleVersion:
    number: int
    css: str
    message: str | None = None
    source: str = "manual"
    created_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class Bundle:
    theme: BundleTheme
    draft: str
    versions: tuple[BundleVersion, ...] = ()
    live_version: int | None = None
    exported_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def live(self) -> BundleVersion | None:
        return next((v for v in self.versions if v.number == self.live_version), None)


def version_file_name(number: int) -> str:
    return f"versions/v{number}.css"


def build_bundle(bundle: Bundle) -> bytes:
    """Schrijft de bundel als zip (deterministische volgorde: manifest, draft, versies)."""
    versions = sorted(bundle.versions, key=lambda v: v.number)
    manifest: dict[str, Any] = {
        "format": BUNDLE_FORMAT,
        "format_version": BUNDLE_FORMAT_VERSION,
        "exported_at": _iso(bundle.exported_at),
        "theme": {
            "slug": bundle.theme.slug,
            "name": bundle.theme.name,
            "description": bundle.theme.description,
            "tags": list(bundle.theme.tags),
            "palette_slug": bundle.theme.palette_slug,
        },
        "live_version": bundle.live_version,
        "draft": DRAFT_NAME,
        "versions": [
            {
                "number": version.number,
                "file": version_file_name(version.number),
                "message": version.message,
                "source": version.source,
                "created_at": _iso(version.created_at) if version.created_at else None,
                "sha256": hashlib.sha256(version.css.encode("utf-8")).hexdigest(),
            }
            for version in versions
        ],
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        stamp = _zip_time(bundle.exported_at)
        _write(archive, MANIFEST_NAME, json.dumps(manifest, indent=2, ensure_ascii=False), stamp)
        _write(archive, DRAFT_NAME, bundle.draft, stamp)
        for version in versions:
            _write(
                archive,
                version_file_name(version.number),
                version.css,
                _zip_time(version.created_at or bundle.exported_at),
            )
    return buffer.getvalue()


def read_bundle(data: bytes, *, max_css_bytes: int) -> Bundle:
    """Leest en valideert een bundel; gooit `BundleError` bij elk probleem."""
    if len(data) > MAX_BUNDLE_BYTES:
        raise BundleError("De bundel is groter dan 25 MB.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError, OSError) as exc:
        raise BundleError("Dit is geen geldig zip-bestand.") from exc
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            raise BundleError(f"De bundel bevat meer dan {MAX_ENTRIES} bestanden.")
        files = {info.filename: info for info in infos if not info.is_dir()}
        # Eerst: is het wel een bundel? Een gewone zip met losse .css/.js-bestanden krijgt zo
        # een begrijpelijke melding in plaats van een fout over een van zijn bestanden.
        if MANIFEST_NAME not in files:
            raise BundleError(
                "manifest.json ontbreekt in de bundel: dit is geen cssthema-bundel. "
                "Pak een zip met losse .css-bestanden eerst uit en upload die bestanden."
            )
        for info in infos:
            _check_entry(info)
        reader = _Reader(archive)
        manifest = _parse_manifest(reader.read(files[MANIFEST_NAME], MAX_MANIFEST_BYTES))

        def css_file(name: object) -> str:
            if not isinstance(name, str) or name not in files:
                raise BundleError(f"Bestand uit het manifest ontbreekt: {name}")
            return reader.read_text(files[name], max_css_bytes)

        draft = css_file(manifest.get("draft", DRAFT_NAME))
        versions = _parse_versions(manifest.get("versions"), css_file)
        live_version = manifest.get("live_version")
        if live_version is not None and (
            not _is_int(live_version) or live_version not in {v.number for v in versions}
        ):
            raise BundleError("live_version verwijst naar een versie die niet in de bundel zit.")
        theme = _parse_theme(manifest.get("theme"))
        exported_at = _parse_datetime(manifest.get("exported_at")) or datetime.now(UTC)
        return Bundle(
            theme=theme,
            draft=draft,
            versions=tuple(versions),
            live_version=live_version,
            exported_at=exported_at,
        )


class _Reader:
    """Leest entries met een harde limiet per bestand en voor de hele bundel."""

    def __init__(self, archive: zipfile.ZipFile) -> None:
        self.archive = archive
        self.total = 0

    def read(self, info: zipfile.ZipInfo, limit: int) -> bytes:
        try:
            with self.archive.open(info) as handle:
                data = handle.read(limit + 1)
        except (zipfile.BadZipFile, NotImplementedError, RuntimeError, OSError) as exc:
            raise BundleError(f"{info.filename} kan niet gelezen worden.") from exc
        if len(data) > limit:
            raise BundleError(f"{info.filename} is te groot (limiet {limit // 1024} KB).")
        self.total += len(data)
        if self.total > MAX_TOTAL_UNCOMPRESSED_BYTES:
            raise BundleError("De uitgepakte bundel is te groot.")
        return data

    def read_text(self, info: zipfile.ZipInfo, limit: int) -> str:
        return decode_css(self.read(info, limit), info.filename)


def decode_css(data: bytes, name: str) -> str:
    """UTF-8 (met of zonder BOM); NUL-tekens zijn niet toegestaan."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise BundleError(f"{name} is geen geldige UTF-8.") from exc
    if "\0" in text:
        raise BundleError(f"{name} bevat NUL-tekens.")
    return text


def _check_entry(info: zipfile.ZipInfo) -> None:
    name = info.filename
    parts = name.rstrip("/").split("/")
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or ":" in name
        or "\0" in name
        or any(part in ("", ".", "..") for part in parts)
    ):
        raise BundleError(f"Ongeldig pad in de bundel: {name!r}")
    if info.flag_bits & 0x1:
        raise BundleError("Versleutelde bundels worden niet ondersteund.")
    if info.is_dir():
        return
    if name != MANIFEST_NAME and not name.endswith(".css"):
        raise BundleError(f"Alleen manifest.json en .css-bestanden zijn toegestaan: {name}")


def _parse_manifest(raw: bytes) -> dict[str, Any]:
    try:
        manifest = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BundleError("manifest.json is geen geldige JSON.") from exc
    if not isinstance(manifest, dict):
        raise BundleError("manifest.json moet een object zijn.")
    if manifest.get("format") != BUNDLE_FORMAT:
        raise BundleError("Dit is geen cssthema-bundel (format ontbreekt of klopt niet).")
    if manifest.get("format_version") != BUNDLE_FORMAT_VERSION:
        raise BundleError(
            f"Bundelversie {manifest.get('format_version')!r} wordt niet ondersteund."
        )
    return manifest


def _parse_theme(raw: object) -> BundleTheme:
    if not isinstance(raw, dict):
        raise BundleError("manifest.json: 'theme' ontbreekt.")
    slug, name = raw.get("slug"), raw.get("name")
    if not isinstance(slug, str) or not slug:
        raise BundleError("manifest.json: theme.slug ontbreekt.")
    if not isinstance(name, str) or not name.strip():
        name = slug
    description = raw.get("description")
    tags = raw.get("tags") or []
    palette_slug = raw.get("palette_slug")
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        raise BundleError("manifest.json: theme.tags moet een lijst van teksten zijn.")
    return BundleTheme(
        slug=slug,
        name=name.strip()[:120],
        description=description if isinstance(description, str) else None,
        tags=tuple(tags),
        palette_slug=palette_slug if isinstance(palette_slug, str) else None,
    )


def _parse_versions(raw: object, css_file: Callable[[object], str]) -> list[BundleVersion]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise BundleError("manifest.json: 'versions' moet een lijst zijn.")
    versions: list[BundleVersion] = []
    seen: set[int] = set()
    for item in raw:
        if not isinstance(item, dict) or not _is_int(item.get("number")):
            raise BundleError("manifest.json: elke versie heeft een nummer nodig.")
        number = item["number"]
        if number < 1 or number in seen:
            raise BundleError(f"manifest.json: ongeldig of dubbel versienummer {number}.")
        seen.add(number)
        file_name = item.get("file", version_file_name(number))
        if not isinstance(file_name, str) or not _VERSION_FILE_RE.fullmatch(file_name):
            raise BundleError(f"manifest.json: ongeldig bestand voor versie {number}.")
        css = css_file(file_name)
        expected = item.get("sha256")
        if isinstance(expected, str) and expected:
            actual = hashlib.sha256(css.encode("utf-8")).hexdigest()
            if actual != expected.lower():
                raise BundleError(f"{file_name} is beschadigd (sha256 klopt niet).")
        message = item.get("message")
        source = item.get("source")
        versions.append(
            BundleVersion(
                number=number,
                css=css,
                message=message[:MAX_MESSAGE_LENGTH] if isinstance(message, str) else None,
                source=source[:40] if isinstance(source, str) else "manual",
                created_at=_parse_datetime(item.get("created_at")),
            )
        )
    versions.sort(key=lambda v: v.number)
    return versions


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _zip_time(moment: datetime) -> tuple[int, int, int, int, int, int]:
    utc = moment.astimezone(UTC)
    if utc.year < 1980:
        return _ZIP_EPOCH
    return (utc.year, utc.month, utc.day, utc.hour, utc.minute, utc.second)


def _write(
    archive: zipfile.ZipFile, name: str, text: str, stamp: tuple[int, int, int, int, int, int]
) -> None:
    info = zipfile.ZipInfo(name, date_time=stamp)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, text.encode("utf-8"))
