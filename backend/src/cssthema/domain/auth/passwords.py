"""Wachtwoorden hashen met scrypt (stdlib) en tijdelijke wachtwoorden maken."""

import base64
import hashlib
import hmac
import secrets

_N, _R, _P = 2**14, 8, 1
_DKLEN = 32
MIN_LENGTH = 10
MAX_LENGTH = 256
# Zonder tekens die op elkaar lijken (0/O, 1/l/I): het wachtwoord wordt overgetypt.
_TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN, maxmem=64 * 1024 * 1024
    )
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str | None) -> bool:
    """Klopt het wachtwoord? Zonder hash rekent het toch (gelijke responstijd)."""
    if not encoded:
        hash_password(password)
        return False
    try:
        scheme, n, r, p, salt, digest = encoded.split("$")
        if scheme != "scrypt":
            return False
        expected = _unb64(digest)
        actual = hashlib.scrypt(
            password.encode(),
            salt=_unb64(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
            maxmem=64 * 1024 * 1024,
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def temporary_password() -> str:
    """Bv. `Kq7m-Xa3P-tR9z-Wd4e`: 16 tekens (~90 bits), in groepjes om over te typen."""
    chars = "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(16))
    return "-".join(chars[i : i + 4] for i in range(0, 16, 4))


def password_problem(password: str) -> str | None:
    """Waarom een nieuw wachtwoord niet mag, of `None`."""
    if len(password) < MIN_LENGTH:
        return f"Kies minstens {MIN_LENGTH} tekens."
    if len(password) > MAX_LENGTH:
        return f"Hoogstens {MAX_LENGTH} tekens."
    if len(set(password)) < 4:
        return "Dit wachtwoord is te eenvoudig."
    return None
