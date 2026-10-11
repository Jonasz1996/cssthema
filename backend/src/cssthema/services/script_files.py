"""Thema-scripts: gewone `.js`-bestanden in CSS_FILES_DIR, publiek op `/<naam>.js`.

Een script (bv. `algemeen.js`, de netwerkachtergrond die NPM met `sub_filter` in apps laadt)
is geen thema: geen database, geen versies en geen linter. nginx serveert de bestanden al
rechtstreeks uit de map (docker/nginx/conf.d/cssthema.conf); hier kan het dashboard ze
uploaden, bekijken, vervangen en verwijderen.

- Alleen platte namen die nginx ook serveert (`SLUG_PATTERN` + `.js`). `preview-bridge` is van
  het dashboard zelf: nginx handelt `/preview-bridge.js` met een exacte location af.
- Schrijven is atomisch (verborgen tijdelijk bestand in dezelfde map, fsync, `os.replace`) en
  altijd met modus 0644: de api schrijft als `cssthema` (native) of uid 10001 (Docker), nginx
  leest als een andere gebruiker (`www-data`, `nginx`).
- Vervangen en verwijderen bewaren de vorige inhoud in `.scripts-archief/`; nginx serveert
  verborgen paden nooit.
- Symlinks worden nergens gevolgd: niet in de lijst, niet bij lezen en niet bij schrijven.
"""

import contextlib
import errno
import hashlib
import itertools
import os
import re
import stat
import tempfile
import threading
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from starlette.concurrency import run_in_threadpool

from cssthema.config import Settings
from cssthema.domain.css.slugs import SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, SLUG_PATTERN
from cssthema.logging import get_logger
from cssthema.schemas.scripts import ScriptFile
from cssthema.services import audit
from cssthema.services.context import ServiceContext
from cssthema.services.errors import (
    InvalidInputError,
    InvalidScriptNameError,
    NotFoundError,
    PayloadTooLargeError,
    ScriptConflictError,
    StateConflictError,
    StorageError,
    StorageUnavailableError,
    UnsupportedMediaTypeError,
    field_error,
)

SCRIPT_SUFFIX = ".js"
MAX_SCRIPT_BYTES = 512 * 1024
ARCHIVE_DIR_NAME = ".scripts-archief"
# nginx handelt deze URL's zelf af: een bestand met die naam in css-files wordt nooit geserveerd.
RESERVED_SCRIPT_NAMES = frozenset({"preview-bridge"})
MAX_LISTED_SCRIPTS = 2000
# Met de hand gezette bestanden kunnen groter zijn dan de uploadlimiet; daarboven geen hash
# in de lijst en niet te bekijken in het dashboard.
MAX_READ_BYTES = 16 * 1024 * 1024
FILE_MODE = 0o644
# Het archief hoeft nginx niet te lezen (het serveert verborgen paden toch niet).
ARCHIVE_DIR_MODE = 0o750

_CHUNK = 64 * 1024
_NAME_RE = re.compile(SLUG_PATTERN)
_NON_NAME_CHARS = re.compile(r"[^a-z0-9]+")
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
# Eén api-proces (uvicorn zonder --workers): dit slot volstaat tegen gelijktijdige uploads.
_write_lock = threading.Lock()

log = get_logger(__name__)


# --- namen en inhoud ------------------------------------------------------------------------


def is_served_name(name: str) -> bool:
    """De naam (zonder `.js`) past in de location van nginx en is niet gereserveerd."""
    return _NAME_RE.fullmatch(name) is not None and name not in RESERVED_SCRIPT_NAMES


def _name_error(field: str, reason: str, name: str | None = None) -> InvalidScriptNameError:
    return InvalidScriptNameError(
        "Ongeldige scriptnaam",
        detail=reason,
        errors=[field_error(field, reason, kind="invalid_script_name")],
        extra={"name": name} if name else None,
    )


def normalize_name(raw: str, *, field: str = "name") -> str:
    """`Netwerk Achtergrond` → `netwerk-achtergrond`, zoals slugs elders; anders 422.

    Een pad (`../x`, `a/b`) of verborgen naam (`.x`) wordt geweigerd, niet stil omgezet. Het
    resultaat moet exact op de regex van nginx passen (2 tot 64 tekens), zonder inkorten.
    """
    value = raw.strip()
    if not value:
        raise _name_error(field, "De naam is leeg.")
    if "/" in value or "\\" in value or value.startswith("."):
        raise _name_error(
            field, "Alleen een naam: geen pad en geen verborgen bestand (begint met een punt)."
        )
    ascii_name = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    name = _NON_NAME_CHARS.sub("-", ascii_name.lower()).strip("-")
    if not SLUG_MIN_LENGTH <= len(name) <= SLUG_MAX_LENGTH:
        raise _name_error(
            field,
            f"Een scriptnaam heeft {SLUG_MIN_LENGTH} tot {SLUG_MAX_LENGTH} kleine letters, "
            "cijfers of streepjes.",
            name or None,
        )
    if _NAME_RE.fullmatch(name) is None:
        raise _name_error(
            field,
            "Alleen kleine letters, cijfers en streepjes; begin en eindig met een letter of "
            "cijfer.",
            name,
        )
    if name in RESERVED_SCRIPT_NAMES:
        raise _name_error(
            field, f"'{name}' is gereserveerd: /{name}.js is een script van het dashboard.", name
        )
    return name


def script_name(filename: str, name: str | None) -> str:
    """De naam uit het veld `name`, anders uit de bestandsnaam; 415 als die geen `.js` is."""
    base = PurePosixPath(filename.replace("\\", "/")).name
    if not base.lower().endswith(SCRIPT_SUFFIX):
        raise UnsupportedMediaTypeError(
            "Geen JavaScript-bestand", detail="Upload een bestand dat op .js eindigt."
        )
    if name is not None and name.strip():
        raw = name.strip()
        if raw.lower().endswith(SCRIPT_SUFFIX):
            raw = raw[: -len(SCRIPT_SUFFIX)]
        return normalize_name(raw, field="name")
    return normalize_name(base[: -len(SCRIPT_SUFFIX)], field="file")


def _content_error(message: str) -> InvalidInputError:
    return InvalidInputError(
        "Ongeldig script", detail=message, errors=[field_error("file", message)]
    )


def check_content(data: bytes) -> None:
    """Hoogstens 512 KB (413), niet leeg, geldige UTF-8 en geen NUL-tekens (422)."""
    if len(data) > MAX_SCRIPT_BYTES:
        raise PayloadTooLargeError(
            "Script is te groot",
            detail=f"De limiet is {MAX_SCRIPT_BYTES // 1024} KB.",
            extra={"limit_bytes": MAX_SCRIPT_BYTES},
        )
    if not data.strip():
        raise _content_error("Het bestand is leeg.")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise _content_error(
            f"Geen geldige UTF-8 (byte {exc.start}); sla het bestand op als UTF-8."
        ) from exc
    if b"\0" in data:
        raise _content_error(
            "Het bestand bevat NUL-tekens (bv. UTF-16 of binair); sla het op als UTF-8-tekst."
        )


def _display_name(filename: str, limit: int = 120) -> str:
    """Bestandsnaam voor de audit-log: zonder stuurtekens en ingekort."""
    cleaned = "".join(char for char in filename if char.isprintable())
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1] + "…"


# --- fouten van het bestandssysteem ---------------------------------------------------------


def _not_found(name: str) -> NotFoundError:
    return NotFoundError(
        "Script niet gevonden", detail=f"Er staat geen script {name}{SCRIPT_SUFFIX} in de map."
    )


def _not_writable(directory: Path, exc: OSError) -> StorageUnavailableError:
    return StorageUnavailableError(
        "CSS_FILES_DIR is niet schrijfbaar voor de api",
        detail=(
            f"De api kan niet schrijven in {directory} ({exc.strerror or exc}). Native maakt "
            "install.sh de map aan als cssthema:cssthema met modus 0775; in Docker moet uid "
            "10001 op de map van de host mogen schrijven (chown -R 10001:10001)."
        ),
    )


def _require_dir(directory: Path) -> None:
    try:
        info = os.stat(directory)
    except FileNotFoundError as exc:
        raise StorageUnavailableError(
            "CSS_FILES_DIR bestaat niet",
            detail=(
                f"De map {directory} bestaat niet. Native maakt install.sh ze aan; in Docker "
                "mount compose ze in de api-container (CSS_FILES_HOST_DIR)."
            ),
        ) from exc
    except OSError as exc:
        raise StorageUnavailableError(
            "CSS_FILES_DIR is niet bereikbaar", detail=f"{directory}: {exc.strerror or exc}."
        ) from exc
    if not stat.S_ISDIR(info.st_mode):
        raise StorageUnavailableError(
            "CSS_FILES_DIR is geen map", detail=f"{directory} is geen map."
        )


async def _storage[**P, T](
    directory: Path, func: Callable[P, T], *args: P.args, **kwargs: P.kwargs
) -> T:
    """Bestandswerk in een thread; een OSError wordt een Problem zonder stacktrace."""
    try:
        return await run_in_threadpool(func, *args, **kwargs)
    except OSError as exc:
        if isinstance(exc, PermissionError) or exc.errno == errno.EROFS:
            raise _not_writable(directory, exc) from exc
        log.warning("script_storage_failed", directory=str(directory), error=repr(exc))
        raise StorageError(
            "Bewerking op het bestandssysteem mislukt",
            detail=f"{exc.strerror or exc} (in {directory}).",
        ) from exc


# --- bestanden lezen ------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Entry:
    name: str
    size: int
    modified_at: datetime
    world_readable: bool
    sha256: str | None


def _open_regular(path: Path) -> int:
    """fd van een gewoon bestand zonder symlinks te volgen; anders FileNotFoundError."""
    try:
        fd = os.open(path, os.O_RDONLY | _NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise FileNotFoundError(errno.ENOENT, "symbolische link", str(path)) from exc
        raise
    try:
        # os.open() lukt ook op een map of FIFO.
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise FileNotFoundError(errno.ENOENT, "geen gewoon bestand", str(path))
    except BaseException:
        os.close(fd)
        raise
    return fd


def _sha256(path: Path) -> str | None:
    try:
        fd = _open_regular(path)
    except OSError:
        return None
    digest = hashlib.sha256()
    total = 0
    try:
        while chunk := os.read(fd, _CHUNK):
            total += len(chunk)
            if total > MAX_READ_BYTES:
                return None
            digest.update(chunk)
    except OSError:
        return None
    finally:
        os.close(fd)
    return digest.hexdigest()


def _entry(directory: Path, name: str, info: os.stat_result) -> _Entry:
    return _Entry(
        name=name,
        size=info.st_size,
        modified_at=datetime.fromtimestamp(info.st_mtime, UTC),
        world_readable=bool(info.st_mode & stat.S_IROTH),
        sha256=_sha256(directory / f"{name}{SCRIPT_SUFFIX}"),
    )


def _scan(directory: Path) -> list[_Entry]:
    """`<naam>.js` direct in de map, alleen gewone bestanden met een naam die nginx serveert."""
    found: list[tuple[str, os.stat_result]] = []
    try:
        with os.scandir(directory) as iterator:
            for item in iterator:
                name = item.name.removesuffix(SCRIPT_SUFFIX)
                if name == item.name or not is_served_name(name):
                    continue  # ook verborgen bestanden, het archief en tijdelijke bestanden
                try:
                    if not item.is_file(follow_symlinks=False):
                        continue  # map of symlink
                    found.append((name, item.stat(follow_symlinks=False)))
                except OSError:
                    continue
    except FileNotFoundError:
        return []  # geen map: dan zijn er ook geen scripts (uploaden geeft 503 met uitleg)
    except NotADirectoryError as exc:
        raise StorageUnavailableError(
            "CSS_FILES_DIR is geen map", detail=f"{directory} is geen map."
        ) from exc
    except PermissionError as exc:
        raise StorageUnavailableError(
            "CSS_FILES_DIR is niet leesbaar voor de api",
            detail=f"De api kan {directory} niet lezen ({exc.strerror or exc}).",
        ) from exc
    found.sort(key=lambda item: item[0])
    return [_entry(directory, name, info) for name, info in found[:MAX_LISTED_SCRIPTS]]


def _load_entry(directory: Path, name: str) -> _Entry:
    return _entry(directory, name, os.lstat(directory / f"{name}{SCRIPT_SUFFIX}"))


def _read_script(directory: Path, name: str) -> bytes:
    path = directory / f"{name}{SCRIPT_SUFFIX}"
    try:
        fd = _open_regular(path)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise _not_found(name) from exc
    except PermissionError as exc:
        raise StorageUnavailableError(
            "Script niet leesbaar voor de api",
            detail=f"De api kan {path} niet lezen; zet de rechten op 0644 (chmod 0644).",
        ) from exc
    chunks: list[bytes] = []
    total = 0
    try:
        while chunk := os.read(fd, _CHUNK):
            total += len(chunk)
            if total > MAX_READ_BYTES:
                raise PayloadTooLargeError(
                    "Script is te groot om te tonen",
                    detail=f"Groter dan {MAX_READ_BYTES // (1024 * 1024)} MB.",
                )
            chunks.append(chunk)
    finally:
        os.close(fd)
    return b"".join(chunks)


# --- bestanden schrijven --------------------------------------------------------------------


def _lstat(path: Path) -> os.stat_result | None:
    try:
        return os.lstat(path)
    except (FileNotFoundError, NotADirectoryError):
        return None


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view) :]


def _remove_quietly(path: Path) -> None:
    with contextlib.suppress(OSError):
        os.unlink(path)


def _fsync_dir(directory: Path) -> None:
    """Maakt de nieuwe naam duurzaam (na `os.replace`/`os.rename`); best effort."""
    with contextlib.suppress(OSError):
        fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _write_temp(directory: Path, name: str, data: bytes) -> Path:
    """Verborgen tijdelijk bestand in dezelfde map (nginx serveert het nooit), modus 0644."""
    fd, raw_path = tempfile.mkstemp(prefix=f".{name}.", suffix=".tmp", dir=directory)
    path = Path(raw_path)
    try:
        try:
            # mkstemp maakt 0600 en os.fchmod negeert de umask: nginx moet kunnen lezen.
            os.fchmod(fd, FILE_MODE)
            _write_all(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
    except BaseException:
        _remove_quietly(path)
        raise
    return path


def _archive_dir(directory: Path) -> Path:
    path = directory / ARCHIVE_DIR_NAME
    with contextlib.suppress(FileExistsError):
        os.mkdir(path, ARCHIVE_DIR_MODE)
    if not stat.S_ISDIR(os.lstat(path).st_mode):
        raise StorageUnavailableError(
            f"{ARCHIVE_DIR_NAME} is geen map",
            detail=(
                f"{path} is een bestand of symbolische link; verwijder of hernoem het, dan maakt "
                "de api de map opnieuw aan."
            ),
        )
    return path


def _copy(source: Path, target: Path) -> None:
    src = _open_regular(source)
    try:
        dst = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW, FILE_MODE)
        try:
            try:
                while chunk := os.read(src, _CHUNK):
                    _write_all(dst, chunk)
                os.fsync(dst)
            finally:
                os.close(dst)
        except BaseException:
            _remove_quietly(target)
            raise
    finally:
        os.close(src)


def _archive(directory: Path, name: str, *, keep: bool) -> str:
    """Bewaart `<naam>.js` als `.scripts-archief/<naam>.<tijd>.js`; geeft dat relatieve pad.

    `keep` (vervangen): kopiëren, zodat de publieke URL geen moment 404 geeft. Kan de api het
    bestand niet lezen (bv. met de hand gezet als root met modus 0600), dan wordt het toch
    verplaatst; daarvoor volstaan schrijfrechten op de map.
    """
    archive_dir = _archive_dir(directory)
    source = directory / f"{name}{SCRIPT_SUFFIX}"
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = archive_dir / f"{name}.{stamp}{SCRIPT_SUFFIX}"
    for counter in itertools.count(2):
        if not os.path.lexists(target):
            break
        target = archive_dir / f"{name}.{stamp}-{counter}{SCRIPT_SUFFIX}"
    relative = f"{ARCHIVE_DIR_NAME}/{target.name}"
    if keep:
        try:
            _copy(source, target)
        except PermissionError:
            pass  # niet leesbaar voor de api: verplaatsen
        else:
            return relative
    os.rename(source, target)
    return relative


def _write_script(directory: Path, name: str, data: bytes, *, replace: bool) -> str | None:
    """Schrijft `<naam>.js` atomisch; geeft het archiefpad van de vorige versie (of None)."""
    _require_dir(directory)
    target = directory / f"{name}{SCRIPT_SUFFIX}"
    with _write_lock:
        current = _lstat(target)
        if current is not None:
            if not stat.S_ISREG(current.st_mode):
                raise StateConflictError(
                    "Naam is bezet door een map of symbolische link",
                    detail=(
                        f"{target.name} op de server is geen gewoon bestand en wordt niet "
                        "overschreven. Verwijder of hernoem het op de server."
                    ),
                    extra={"name": name},
                )
            if not replace:
                raise ScriptConflictError(
                    "Script bestaat al",
                    detail=(
                        f"Er staat al een script {target.name}. Vervang het (replace=true); de "
                        f"huidige versie gaat dan naar {ARCHIVE_DIR_NAME}/."
                    ),
                    extra={"name": name},
                    errors=[
                        field_error(
                            "name",
                            "Er bestaat al een script met deze naam.",
                            kind="script_conflict",
                        )
                    ],
                )
        temporary = _write_temp(directory, name, data)
        try:
            archived = _archive(directory, name, keep=True) if current is not None else None
            os.replace(temporary, target)
        except BaseException:
            _remove_quietly(temporary)
            raise
        _fsync_dir(directory)
    return archived


def _delete_script(directory: Path, name: str) -> str:
    """Verplaatst `<naam>.js` naar het archief (niet echt wissen); geeft het archiefpad."""
    with _write_lock:
        current = _lstat(directory / f"{name}{SCRIPT_SUFFIX}")
        if current is None or not stat.S_ISREG(current.st_mode):
            raise _not_found(name)
        archived = _archive(directory, name, keep=False)
        _fsync_dir(directory)
    return archived


# --- servicefuncties ------------------------------------------------------------------------


def _view(settings: Settings, entry: _Entry) -> ScriptFile:
    filename = f"{entry.name}{SCRIPT_SUFFIX}"
    return ScriptFile(
        name=entry.name,
        filename=filename,
        size_bytes=entry.size,
        modified_at=entry.modified_at,
        url=f"{settings.public_base}/{filename}",
        sha256=entry.sha256,
        world_readable=entry.world_readable,
    )


async def list_scripts(ctx: ServiceContext) -> list[ScriptFile]:
    directory = ctx.settings.css_files_dir
    entries = await _storage(directory, _scan, directory)
    return [_view(ctx.settings, entry) for entry in entries]


async def upload_script(
    ctx: ServiceContext, *, filename: str, data: bytes, name: str | None, replace: bool
) -> tuple[ScriptFile, bool]:
    """Nieuw of (met `replace`) vervangen script; geeft het script en of het nieuw is."""
    script = script_name(filename, name)
    check_content(data)
    directory = ctx.settings.css_files_dir
    archived = await _storage(directory, _write_script, directory, script, data, replace=replace)
    entry = await _storage(directory, _load_entry, directory, script)
    audit.record(
        ctx,
        "script.upload",
        entity_type="script",
        entity_id=None,
        changes={
            "name": script,
            "file": _display_name(filename),
            "size_bytes": len(data),
            "sha256": entry.sha256,
            "replaced": archived is not None,
            "archived_as": archived,
        },
    )
    await ctx.session.commit()
    await ctx.delivery.refresh_hosts_using(scripts=[script])
    return _view(ctx.settings, entry), archived is None


async def read_script(ctx: ServiceContext, name: str) -> tuple[str, bytes]:
    """Bestandsnaam en inhoud; 404 voor een onbekende naam, symlink of map."""
    if not is_served_name(name):
        raise _not_found(name)
    directory = ctx.settings.css_files_dir
    data = await _storage(directory, _read_script, directory, name)
    return f"{name}{SCRIPT_SUFFIX}", data


async def delete_script(ctx: ServiceContext, name: str) -> str:
    """Verplaatst het script naar `.scripts-archief/`; geeft het archiefpad."""
    if not is_served_name(name):
        raise _not_found(name)
    directory = ctx.settings.css_files_dir
    archived = await _storage(directory, _delete_script, directory, name)
    audit.record(
        ctx,
        "script.delete",
        entity_type="script",
        entity_id=None,
        changes={"name": name, "archived_as": archived},
    )
    await ctx.session.commit()
    await ctx.delivery.refresh_hosts_using(scripts=[name])
    return archived
