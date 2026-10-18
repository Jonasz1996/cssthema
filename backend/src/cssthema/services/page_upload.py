"""Een opgeslagen webpagina (HTML, of een zip met de HTML en zijn bestanden) als snapshot.

Naast de capture-zips van vastleggen.py (capture_import.py): wie een pagina in de browser
bewaart ("Webpagina, volledig" in Chrome/Edge/Firefox, of een SingleFile-HTML) kan die hier
uploaden en het thema in de editor-preview op precies die pagina zien, met dezelfde layout.

- Losse `.html`: alleen wat in het bestand zelf staat (inline `<style>`, `data:`-afbeeldingen).
  Gelinkte CSS van een server komt in `ontbrekende_css`: de preview laadt niets van het netwerk.
- `.zip` met de HTML en de map `<naam>_files/`: de gelinkte stylesheets worden snapshot-CSS
  (zoals `_css/<sha16>.css` in een capture), en afbeeldingen en fonts uit de zip worden
  `data:`-URL's in de HTML en de CSS, zodat ze ook in de preview (CSP `img-src data:`) staan.

Het resultaat is een gewone snapshot van een dienst (hostnaam), met als pagina de naam van
het bestand; dezelfde pagina opnieuw uploaden werkt die snapshot bij (zelfde id).
"""

import base64
import hashlib
import io
import mimetypes
import posixpath
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

from cssthema.db.models import Asset, DomSnapshot
from cssthema.db.models.enums import PageKind, SnapshotOrigin
from cssthema.domain.hosts import HOSTNAME_RE
from cssthema.logging import get_logger
from cssthema.schemas import captures as schemas
from cssthema.services import audit, storage
from cssthema.services.capture_import import (
    MAX_ENTRIES,
    MAX_FILE_BYTES,
    MAX_TOTAL_BYTES,
    _clean,
    _previous_snapshot,
    _safe_name,
    _text,
    _upsert_service,
)
from cssthema.services.context import ServiceContext
from cssthema.services.errors import InvalidInputError

log = get_logger(__name__)

# Samen onder de 16 MB van het preview-document (service_catalog.MAX_DOCUMENT_BYTES).
MAX_INLINE_FILE_BYTES = 3 * 1024 * 1024
MAX_INLINE_TOTAL_BYTES = 12 * 1024 * 1024
MAX_IMPORT_DEPTH = 4

INLINE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".bmp": "image/bmp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".eot": "application/vnd.ms-fontobject",
}
HTML_SUFFIXES = (".html", ".htm", ".xhtml")

_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.I | re.S)
_LINK_TAG_RE = re.compile(r"<link\b[^>]*>", re.I)
_STYLE_BLOCK_RE = re.compile(r"(<style\b[^>]*>)(.*?)(</style\s*>)", re.I | re.S)
_ATTR_RE = re.compile(r"""([^\s"'<>/=]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)""")
# Attributen buiten `<style>`; `href` alleen als het naar een afbeelding wijst (SVG `<image>`,
# `<use>`), niet naar een andere pagina.
_URL_ATTR_RE = re.compile(
    r"""(\s(?:src|poster|data-src|href|xlink:href|srcset|style)\s*=\s*)("[^"]*"|'[^']*')""",
    re.I,
)
_CSS_URL_RE = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)""", re.I)
_CSS_IMPORT_RE = re.compile(
    r"""@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);""", re.I
)
_CSS_VAR_RE = re.compile(r"(--[A-Za-z0-9_-]{1,200})\s*:\s*([^;{}]{1,500})")
_TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title\s*>", re.I | re.S)
_CHARSET_RE = re.compile(rb"""<meta\b[^>]*charset\s*=\s*["']?([A-Za-z0-9_-]+)""", re.I)
_SAVED_FROM_RE = re.compile(r"<!--\s*saved from url=\(\d+\)(\S+?)\s*-->", re.I)
_SINGLEFILE_RE = re.compile(r"<!--.{0,400}?\burl:\s*(https?://\S+)", re.I | re.S)
_CANONICAL_RE = re.compile(
    r"""<link\b(?=[^>]*\brel=["']?canonical)[^>]*\bhref=["']([^"']+)["']""", re.I
)
_OG_URL_RE = re.compile(
    r"""<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*\bcontent=["']([^"']+)["']""", re.I
)
_BASE_RE = re.compile(r"""<base\b[^>]*\bhref=["']([^"']+)["']""", re.I)
_CLASS_ATTR_RE = re.compile(r"""\sclass=["']([^"']*)["']""")
_ID_ATTR_RE = re.compile(r"""\sid=["']([^"']+)["']""")
_PAGE_CLEAN_RE = re.compile(r"[^a-z0-9-]+")


def _invalid(message: str) -> InvalidInputError:
    return InvalidInputError("Geen bruikbare webpagina", detail=message)


def _decode(raw: bytes) -> str:
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", errors="replace")
    match = _CHARSET_RE.search(raw[:4096])
    encoding = match.group(1).decode("ascii").lower() if match else "utf-8"
    try:
        return raw.decode(encoding, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def _unquote(value: str) -> str:
    return value.replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'")


def _hostname_from(url: str | None) -> str | None:
    if not url:
        return None
    try:
        host = (urlsplit(_unquote(url).strip()).hostname or "").rstrip(".").lower()
    except ValueError:
        return None
    return host if HOSTNAME_RE.fullmatch(host) else None


def _page_url(html: str) -> str | None:
    """Waar de pagina vandaan kwam: Chrome/Edge, SingleFile, canonical, og:url of `<base>`."""
    head = html[:200_000]
    for pattern in (_SAVED_FROM_RE, _SINGLEFILE_RE, _CANONICAL_RE, _OG_URL_RE, _BASE_RE):
        match = pattern.search(head)
        if match and _hostname_from(match.group(1)):
            return _unquote(match.group(1)).strip()
    return None


def normalise_hostname(value: str) -> str | None:
    """`https://portainer.jbogaert.be/#/home` of `Portainer.jbogaert.be` → hostnaam."""
    value = value.strip()
    if not value:
        return None
    return _hostname_from(value if "://" in value else f"https://{value}")


def page_name(value: str) -> str:
    """Paginanaam (map in een capture): kleine letters, cijfers en streepjes."""
    stem = PurePosixPath(value.replace("\\", "/")).name
    for suffix in (*HTML_SUFFIXES, ".zip"):
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    cleaned = _PAGE_CLEAN_RE.sub("-", stem.lower()).strip("-")[:60].rstrip("-")
    return cleaned or "pagina"


class _Files:
    """De bestanden van de pagina (uit de zip), met het budget voor `data:`-URL's."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files
        self.inlined: set[str] = set()
        self.missing: list[str] = []
        self.budget = MAX_INLINE_TOTAL_BYTES
        self._cache: dict[str, str] = {}

    def resolve(self, base_dir: str, ref: str) -> str | None:
        """Pad in de zip van een relatieve URL, of None (extern, `data:`, buiten de zip)."""
        ref = _unquote(ref).strip()
        if not ref or ref.startswith(("#", "data:", "blob:", "about:", "javascript:")):
            return None
        parts = urlsplit(ref)
        if parts.scheme or parts.netloc or ref.startswith("//"):
            return None
        path = unquote(parts.path)
        if not path:
            return None
        joined = posixpath.normpath(posixpath.join(base_dir, path.lstrip("/")))
        if joined.startswith("../") or joined == "..":
            return None
        return joined if joined in self.files else None

    def data_url(self, base_dir: str, ref: str) -> str | None:
        """`data:`-URL voor een afbeelding of font uit de zip (binnen het budget)."""
        path = self.resolve(base_dir, ref)
        if path is None:
            return None
        if path in self._cache:
            return self._cache[path]
        suffix = PurePosixPath(path).suffix.lower()
        content_type = INLINE_TYPES.get(suffix) or mimetypes.guess_type(path)[0] or ""
        if not content_type.startswith(("image/", "font/", "application/vnd.ms-font")):
            return None
        data = self.files[path]
        if len(data) > MAX_INLINE_FILE_BYTES or len(data) > self.budget:
            return None
        self.budget -= len(data)
        url = f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"
        self._cache[path] = url
        self.inlined.add(path)
        return url

    def css(self, path: str) -> str:
        return _decode(self.files[path])


def _css_urls(css: str, base_dir: str, files: _Files) -> str:
    def replace(match: re.Match[str]) -> str:
        ref = match.group(1) or match.group(2) or match.group(3) or ""
        url = files.data_url(base_dir, ref)
        return f'url("{url}")' if url else match.group(0)

    return _CSS_URL_RE.sub(replace, css)


def _expand_css(css: str, base_dir: str, files: _Files, depth: int = 0) -> str:
    """`@import` uit de zip invoegen en `url(…)` naar `data:` omzetten (paden t.o.v. `base_dir`)."""

    def replace_import(match: re.Match[str]) -> str:
        path = files.resolve(base_dir, match.group(1))
        if path is None or depth >= MAX_IMPORT_DEPTH:
            return match.group(0)
        inner = _expand_css(files.css(path), posixpath.dirname(path), files, depth + 1)
        media = match.group(2).strip()
        return f"@media {media} {{\n{inner}\n}}" if media else inner

    return _css_urls(_CSS_IMPORT_RE.sub(replace_import, css), base_dir, files)


def _attributes(tag: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for name, value in _ATTR_RE.findall(tag):
        if value[:1] in "\"'":
            value = value[1:-1]
        out.setdefault(name.lower(), _unquote(value))
    return out


def _srcset(value: str, base_dir: str, files: _Files) -> str:
    candidates = []
    for candidate in value.split(","):
        bits = candidate.strip().split(None, 1)
        if not bits:
            continue
        url = files.data_url(base_dir, bits[0])
        candidates.append(" ".join([url or bits[0], *bits[1:]]))
    return ", ".join(candidates)


def _rewrite_html(
    html: str, base_dir: str, files: _Files
) -> tuple[str, list[tuple[str, str]], list[str]]:
    """HTML zonder scripts, met de gelinkte CSS als `_css/<sha16>.css` en `data:`-afbeeldingen.

    Geeft de HTML, de stylesheets (naam, CSS) in paginavolgorde en de CSS-links die niet in de
    upload zaten.
    """
    html = _SCRIPT_RE.sub("", html)
    sheets: dict[str, str] = {}
    missing: list[str] = []

    def replace_link(match: re.Match[str]) -> str:
        tag = match.group(0)
        attrs = _attributes(tag)
        if "stylesheet" not in attrs.get("rel", "").lower().split():
            return tag
        href = attrs.get("href", "")
        path = files.resolve(base_dir, href)
        if path is None:
            if href and not href.startswith("data:"):
                missing.append(href[:500])
            return ""
        css = _expand_css(files.css(path), posixpath.dirname(path), files)
        name = f"{hashlib.sha256(css.encode('utf-8')).hexdigest()[:16]}.css"
        sheets.setdefault(name, css)
        media = attrs.get("media")
        media_attr = f' media="{media}"' if media and '"' not in media else ""
        return f'<link rel="stylesheet" href="_css/{name}"{media_attr}>'

    html = _LINK_TAG_RE.sub(replace_link, html)

    def replace_style(match: re.Match[str]) -> str:
        return match.group(1) + _expand_css(match.group(2), base_dir, files) + match.group(3)

    # Eerst de `<style>`-blokken apart, zodat de attribuut-regex er niet in zoekt.
    blocks: list[str] = []

    def stash(match: re.Match[str]) -> str:
        blocks.append(replace_style(match))
        return f"\x00ct-style-{len(blocks) - 1}\x00"

    html = _STYLE_BLOCK_RE.sub(stash, html)

    def replace_attr(match: re.Match[str]) -> str:
        prefix, quoted = match.group(1), match.group(2)
        quote, value = quoted[0], quoted[1:-1]
        name = prefix.strip().rstrip("=").strip().lower()
        if name == "srcset":
            new = _srcset(_unquote(value), base_dir, files)
        elif name == "style":
            new = _css_urls(_unquote(value), base_dir, files)
            if new == _unquote(value):
                return match.group(0)
        else:
            url = files.data_url(base_dir, value)
            if url is None:
                return match.group(0)
            new = url
        new = new.replace("&", "&amp;").replace(quote, "&quot;" if quote == '"' else "&#39;")
        return f"{prefix}{quote}{new}{quote}"

    html = _URL_ATTR_RE.sub(replace_attr, html)
    html = re.sub(r"\x00ct-style-(\d+)\x00", lambda m: blocks[int(m.group(1))], html)
    return html, list(sheets.items()), missing


def _read_zip(data: bytes) -> tuple[str, bytes, dict[str, bytes]]:
    """(pad van de HTML, HTML, alle bestanden) uit een zip met een opgeslagen pagina."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise _invalid("Dit is geen geldig zip-bestand.") from exc
    with archive:
        infos = [i for i in archive.infolist() if not i.is_dir()]
        if len(infos) > MAX_ENTRIES:
            raise _invalid(f"De zip heeft {len(infos)} bestanden; de limiet is {MAX_ENTRIES}.")
        if sum(i.file_size for i in infos) > MAX_TOTAL_BYTES:
            raise _invalid("De zip is uitgepakt groter dan 400 MB.")
        files: dict[str, bytes] = {}
        for info in infos:
            path = _safe_name(info.filename)
            if path is None or info.file_size > MAX_FILE_BYTES:
                continue
            if any(part.startswith("__MACOSX") for part in path.parts):
                continue
            try:
                with archive.open(info) as handle:
                    files[str(path)] = handle.read(MAX_FILE_BYTES + 1)
            except (NotImplementedError, RuntimeError, zipfile.BadZipFile, OSError, EOFError):
                continue
    pages = [p for p in files if p.lower().endswith(HTML_SUFFIXES)]
    if not pages:
        raise _invalid("Geen .html-bestand in de zip.")
    if any(p.endswith("info.json") for p in files):
        raise _invalid("Dit lijkt een zip van vastleggen.py; upload die bij 'Zips uploaden'.")
    # De pagina zelf staat het hoogst; `_files/` bevat soms nog frames (ook .html).
    page = min(pages, key=lambda p: (p.count("/"), "_files/" in p, -len(files[p])))
    return page, files[page], files


async def import_page(
    ctx: ServiceContext,
    filename: str,
    data: bytes,
    hostname: str | None,
    page: str | None,
) -> schemas.PageUploadResult:
    if len(data) > ctx.settings.capture_max_bytes:
        raise _invalid("Het bestand is groter dan 25 MB.")
    filename = _text(filename)[:200] or "pagina.html"
    if data[:4] == b"PK\x03\x04":
        html_path, raw, files = _read_zip(data)
    elif filename.lower().endswith(HTML_SUFFIXES) or b"<" in data[:2048]:
        html_path, raw, files = PurePosixPath(filename).name, data, {}
    else:
        raise _invalid("Kies een .html-bestand of een .zip met de pagina en zijn bestanden.")
    html = _text(_decode(raw))
    if "<" not in html:
        raise _invalid("Het bestand bevat geen HTML.")

    source_url = _page_url(html)
    host = normalise_hostname(hostname or "") if hostname else None
    if hostname and host is None:
        raise _invalid(f"'{hostname[:100]}' is geen geldige hostnaam (bv. portainer.jbogaert.be).")
    host = host or _hostname_from(source_url)
    if host is None:
        raise _invalid(
            "Niet gevonden van welke app deze pagina is. Vul de hostnaam in "
            "(bv. portainer.jbogaert.be)."
        )
    name = page_name(page) if page and page.strip() else page_name(html_path)

    found = _Files(files)
    html, sheets, missing = _rewrite_html(html, posixpath.dirname(html_path), found)
    html = _text(html)
    encoded = html.encode("utf-8")
    title_match = _TITLE_RE.search(html)
    title = _text(re.sub(r"\s+", " ", title_match.group(1))).strip()[:500] if title_match else None

    variables: dict[str, str] = {}
    for css in [css for _, css in sheets] + [m.group(2) for m in _STYLE_BLOCK_RE.finditer(html)]:
        for var, value in _CSS_VAR_RE.findall(css):
            if len(variables) >= 2000:
                break
            if not value.lstrip().startswith('url("data:'):
                variables.setdefault(var, _text(value.strip())[:500])

    await storage.lock(ctx.session)
    created: list[Path] = []
    cache: dict[bytes, Asset] = {}
    storage_dir = ctx.settings.storage_dir
    imported_at = datetime.now(UTC)
    try:
        dummy = schemas.CaptureImportResult(
            services_created=[], services_updated=[], snapshots=0, without_snapshot=[], skipped=[]
        )
        service = await _upsert_service(ctx, host, {"titel": title}, dummy)
        document = await storage.put(
            ctx.session, storage_dir, encoded, "text/html; charset=utf-8", cache, created
        )
        stylesheets = []
        for sheet_name, css in sheets:
            asset = await storage.put(
                ctx.session,
                storage_dir,
                css.encode("utf-8"),
                "text/css; charset=utf-8",
                cache,
                created,
            )
            stylesheets.append({"name": sheet_name, "asset_id": str(asset.id)})

        snapshot = await _previous_snapshot(ctx, service, name)
        if snapshot is None:
            snapshot = DomSnapshot(service_id=service.id)
            ctx.session.add(snapshot)
        url = source_url if source_url and _hostname_from(source_url) == host else None
        snapshot.page_kind = PageKind.HOME if name == "start" else PageKind.CUSTOM
        snapshot.url = (url or f"https://{host}/")[:2048]
        snapshot.final_url = url[:2048] if url else None
        snapshot.http_status = None
        snapshot.origin = SnapshotOrigin.UPLOAD
        snapshot.document_asset_id = document.id
        snapshot.html_sha256 = document.sha256
        snapshot.title = title or None
        snapshot.css_variables = _clean(variables)
        snapshot.components = []
        snapshot.framework_hints = []
        snapshot.stylesheets = stylesheets
        snapshot.colors = {}
        snapshot.class_count = len({c for m in _CLASS_ATTR_RE.findall(html) for c in m.split()})
        snapshot.id_count = len(set(_ID_ATTR_RE.findall(html)))
        snapshot.has_shadow_dom = "shadowrootmode" in html
        snapshot.capture_info = {
            "pagina": name,
            "status": "ok",
            "vastgelegd": imported_at.isoformat(timespec="seconds"),
            "screenshots": {},
            "thema_links": [],
            "csp_fouten": 0,
            "ontbrekende_css": _clean(missing[:50]),
            "bestand": filename,
            "bron": "html-upload",
        }
        snapshot.created_at = imported_at
        service.last_crawled_at = imported_at
        await ctx.session.flush()
        audit.record(
            ctx,
            "page.upload",
            entity_type="service",
            entity_id=service.id,
            changes={"file": filename, "page": name, "stylesheets": len(stylesheets)},
        )
        removed = await storage.delete_unreferenced(ctx.session)
    except BaseException:
        storage.discard(created)
        raise
    await ctx.session.commit()
    log.info("page_uploaded", file=filename, host=host, page=name, sheets=len(stylesheets))
    await storage.remove_files(ctx.session, storage_dir, removed)
    return schemas.PageUploadResult(
        snapshot_id=snapshot.id,
        service_id=service.id,
        hostname=host,
        page=name,
        service_created=bool(dummy.services_created),
        stylesheets=len(stylesheets),
        inlined_files=len(found.inlined),
        missing_stylesheets=missing[:50],
        detected_url=source_url,
    )
