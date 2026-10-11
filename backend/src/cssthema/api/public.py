"""Publieke CSS zonder `/api/v1` (docs/05 § 4.11, F-CD-01…05/07/10).

`/{slug}.css` en `/themes/{slug}.css` geven de gepubliceerde versie, `/themes/{slug}@{n}.css`
een vaste versie. nginx cachet deze responses (spike S3) en serveert handgemaakte
bestanden uit css-files vóór deze routes.

`/host/{hostname}.css` en `.js` voegen samen wat de koppeling van die host (of `*`) noemt;
zo is de `sub_filter`-regel in NPM voor elke proxy host dezelfde (`$host`).
"""

import hashlib
import re
from datetime import UTC, datetime
from email.utils import format_datetime, parsedate_to_datetime
from typing import Any

from fastapi import APIRouter, Request, Response

from cssthema.domain.css.compiler import etag_for
from cssthema.domain.css.slugs import SLUG_PATTERN
from cssthema.domain.hosts import DEFAULT_HOST, HOSTNAME_RE
from cssthema.services import host_service
from cssthema.services.css_delivery import CachedCss, CssDelivery

router = APIRouter(tags=["public"])

CSS_MEDIA_TYPE = "text/css; charset=utf-8"
JS_MEDIA_TYPE = "text/javascript; charset=utf-8"
LATEST_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600, stale-if-error=86400"
FIXED_CACHE_CONTROL = "public, max-age=31536000, immutable"
NOT_FOUND_CACHE_CONTROL = "public, max-age=10"
# Een oude slug kan later weer een eigen thema worden: browsers niet eeuwig laten onthouden.
REDIRECT_CACHE_CONTROL = "public, max-age=60"

_SLUG_RE = re.compile(SLUG_PATTERN)
_FIXED_RE = re.compile(r"^(?P<slug>[a-z0-9][a-z0-9-]{0,62}[a-z0-9])@(?P<number>[1-9][0-9]{0,8})$")

_COMMON_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
}
_EXPOSE_HEADERS = "ETag, Last-Modified, X-Cssthema-Version"

_RESPONSES: dict[int | str, dict[str, Any]] = {
    200: {"content": {"text/css": {"schema": {"type": "string"}}}, "description": "De CSS"},
    301: {"description": "Oude slug (na hernoemen, < 90 dagen): naar de nieuwe slug"},
    304: {"description": "Niet gewijzigd (If-None-Match / If-Modified-Since)"},
    404: {"content": {"text/css": {"schema": {"type": "string"}}}, "description": "Onbekend"},
}


def _delivery(request: Request) -> CssDelivery:
    delivery: CssDelivery = request.app.state.css_delivery
    return delivery


@router.get(
    "/host/{hostname}.css",
    operation_id="public_host_css",
    summary="Samengevoegde CSS voor een proxy host (koppeling van de host, anders `*`)",
    response_class=Response,
    responses={200: _RESPONSES[200], 304: _RESPONSES[304]},
)
@router.head("/host/{hostname}.css", include_in_schema=False)
async def host_css(hostname: str, request: Request) -> Response:
    return await _serve_host(request, hostname, kind="css")


@router.get(
    "/host/{hostname}.js",
    operation_id="public_host_js",
    summary="Samengevoegde thema-scripts voor een proxy host",
    response_class=Response,
    responses={
        200: {"content": {"text/javascript": {"schema": {"type": "string"}}}, "description": "JS"},
        304: _RESPONSES[304],
    },
)
@router.head("/host/{hostname}.js", include_in_schema=False)
async def host_js(hostname: str, request: Request) -> Response:
    return await _serve_host(request, hostname, kind="js")


@router.get(
    "/{ref}.css",
    operation_id="public_css",
    summary="Gepubliceerde CSS van een thema",
    response_class=Response,
    responses=_RESPONSES,
)
@router.head("/{ref}.css", include_in_schema=False)
async def theme_css(ref: str, request: Request) -> Response:
    if not _SLUG_RE.fullmatch(ref):
        return _not_found(request, None)
    return await _serve(request, ref, None, prefix="")


@router.get(
    "/themes/{ref}.css",
    operation_id="public_theme_css",
    summary="Gepubliceerde CSS (`{slug}`) of een vaste versie (`{slug}@{n}`)",
    response_class=Response,
    responses=_RESPONSES,
)
@router.head("/themes/{ref}.css", include_in_schema=False)
async def theme_css_prefixed(ref: str, request: Request) -> Response:
    if _SLUG_RE.fullmatch(ref):
        return await _serve(request, ref, None, prefix="/themes")
    fixed = _FIXED_RE.fullmatch(ref)
    if fixed is None:
        return _not_found(request, None)
    return await _serve(request, fixed["slug"], int(fixed["number"]), prefix="/themes")


async def _serve_host(request: Request, hostname: str, *, kind: str) -> Response:
    media_type = CSS_MEDIA_TYPE if kind == "css" else JS_MEDIA_TYPE
    name = hostname.lower()
    if name != DEFAULT_HOST and not HOSTNAME_RE.fullmatch(name):
        body = b"/* cssthema: ongeldige hostnaam */\n"
        headers = {**_COMMON_HEADERS, "Cache-Control": NOT_FOUND_CACHE_CONTROL}
        return Response(body, status_code=404, media_type=media_type, headers=headers)
    text = await host_service.render(
        _delivery(request), request.app.state.settings, name, kind=kind
    )
    body = text.encode("utf-8")
    etag = f'"sha256-{hashlib.sha256(body).hexdigest()[:16]}"'
    headers = {
        **_COMMON_HEADERS,
        "Access-Control-Expose-Headers": "ETag",
        "Cache-Control": LATEST_CACHE_CONTROL,
        "ETag": etag,
    }
    if_none_match = request.headers.get("if-none-match")
    if if_none_match is not None and any(
        part.strip().removeprefix("W/") in (etag, "*") for part in if_none_match.split(",")
    ):
        return Response(status_code=304, headers=headers)
    if request.method == "HEAD":
        headers["Content-Length"] = str(len(body))
        body = b""
    return Response(body, media_type=media_type, headers=headers)


async def _serve(request: Request, slug: str, number: int | None, *, prefix: str) -> Response:
    delivery = _delivery(request)
    item = await (delivery.latest(slug) if number is None else delivery.fixed(slug, number))
    if item is None:
        target = await delivery.redirect_target(slug)
        if target is not None:
            suffix = "" if number is None else f"@{number}"
            return _redirect(f"{prefix}/{target}{suffix}.css")
        return _not_found(request, slug)

    cache_control = LATEST_CACHE_CONTROL if number is None else FIXED_CACHE_CONTROL
    headers = {
        **_COMMON_HEADERS,
        "Access-Control-Expose-Headers": _EXPOSE_HEADERS,
        "Cache-Control": cache_control,
        "ETag": etag_for(item.sha256),
        "Last-Modified": _http_date(item.published_at),
        "X-Cssthema-Version": str(item.version_number),
    }
    if _not_modified(request, item):
        return Response(status_code=304, headers=headers)
    body = item.css.encode("utf-8")
    if request.method == "HEAD":
        headers["Content-Length"] = str(len(body))
        body = b""
    return Response(body, media_type=CSS_MEDIA_TYPE, headers=headers)


def _not_found(request: Request, slug: str | None) -> Response:
    # De slug is al gecontroleerd ([a-z0-9-]): kan de comment niet breken.
    text = f'/* cssthema: theme "{slug}" not found */\n' if slug else "/* cssthema: not found */\n"
    body = text.encode("utf-8")
    headers = {**_COMMON_HEADERS, "Cache-Control": NOT_FOUND_CACHE_CONTROL}
    if request.method == "HEAD":
        headers["Content-Length"] = str(len(body))
        body = b""
    return Response(body, status_code=404, media_type=CSS_MEDIA_TYPE, headers=headers)


def _redirect(location: str) -> Response:
    return Response(
        status_code=301,
        headers={
            **_COMMON_HEADERS,
            "Location": location,
            "Cache-Control": REDIRECT_CACHE_CONTROL,
        },
    )


def _http_date(moment: datetime) -> str:
    return format_datetime(moment.astimezone(UTC), usegmt=True)


def _not_modified(request: Request, item: CachedCss) -> bool:
    """If-None-Match (ook lijsten en `W/`) gaat voor; anders If-Modified-Since (RFC 9110)."""
    if_none_match = request.headers.get("if-none-match")
    if if_none_match is not None:
        if if_none_match.strip() == "*":
            return True
        etag = etag_for(item.sha256)
        candidates = (part.strip() for part in if_none_match.split(","))
        return any(c.removeprefix("W/") == etag for c in candidates)
    if_modified_since = request.headers.get("if-modified-since")
    if if_modified_since:
        try:
            since = parsedate_to_datetime(if_modified_since)
        except (TypeError, ValueError, IndexError):
            return False
        if since.tzinfo is None:
            since = since.replace(tzinfo=UTC)
        return item.published_at.replace(microsecond=0) <= since
    return False
