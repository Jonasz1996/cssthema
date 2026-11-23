"""Sessiecookie: `v1.<user-id>.<sessieversie>.<verloopt>.<handtekening>` (HMAC-SHA256).

Geen tabel nodig: een reset of nieuw wachtwoord verhoogt `users.session_version`, en dan
klopt geen enkele oude cookie meer.
"""

import base64
import hashlib
import hmac
import time
import uuid
from dataclasses import dataclass

COOKIE_NAME = "cssthema_sessie"
_PURPOSE = b"cssthema-sessie|"


@dataclass(frozen=True)
class SessionClaims:
    user_id: uuid.UUID
    version: int
    expires_at: int


def _sign(secret: str, payload: str) -> str:
    mac = hmac.new(secret.encode(), _PURPOSE + payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


def issue(secret: str, user_id: uuid.UUID, version: int, ttl_seconds: int) -> str:
    payload = f"v1.{user_id.hex}.{version}.{int(time.time()) + ttl_seconds}"
    return f"{payload}.{_sign(secret, payload)}"


def read(secret: str, token: str | None, now: float | None = None) -> SessionClaims | None:
    if not token or len(token) > 512:
        return None
    payload, _, signature = token.rpartition(".")
    if not hmac.compare_digest(_sign(secret, payload), signature):
        return None
    try:
        tag, user_hex, version, expires = payload.split(".")
        claims = SessionClaims(uuid.UUID(hex=user_hex), int(version), int(expires))
    except ValueError:
        return None
    if tag != "v1" or claims.expires_at < (time.time() if now is None else now):
        return None
    return claims
