"""Cursor-paginering (docs/05 § 1): de cursor is base64url van `(sortering, waarde, id)`.

De cursor is voor de client ondoorzichtig. Hij bevat de sortering waarvoor hij gemaakt
is: een cursor van `?sort=name` bij `?sort=-updated_at` gebruiken is een 400, geen stille
verkeerde pagina.
"""

import base64
import binascii
import json
import uuid
from datetime import datetime
from typing import Any, Literal

from cssthema.schemas.common import MAX_INT4
from cssthema.services.errors import BadRequestError

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
MAX_CURSOR_LENGTH = 1024

ValueKind = Literal["datetime", "str", "int"]


def encode_cursor(sort: str, value: datetime | str | int, item_id: uuid.UUID) -> str:
    raw: Any = value.isoformat() if isinstance(value, datetime) else value
    payload = json.dumps([sort, raw, str(item_id)], separators=(",", ":"), ensure_ascii=False)
    return base64.urlsafe_b64encode(payload.encode("utf-8")).rstrip(b"=").decode("ascii")


def decode_cursor(cursor: str, *, sort: str, kind: ValueKind) -> tuple[Any, uuid.UUID]:
    """`(waarde, id)` uit een cursor; elke afwijking is een 400 `bad_request`."""
    try:
        if len(cursor) > MAX_CURSOR_LENGTH:
            raise ValueError("te lang")
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        if not isinstance(data, list) or len(data) != 3:
            raise ValueError("onverwachte vorm")
        cursor_sort, raw, raw_id = data
        if cursor_sort != sort:
            raise ValueError("andere sortering")
        return _value(raw, kind), uuid.UUID(str(raw_id))
    except (ValueError, TypeError, UnicodeError, binascii.Error) as exc:
        raise BadRequestError(
            "Ongeldige cursor",
            detail=(
                "Gebruik de next_cursor van de vorige pagina, met dezelfde filters en sortering."
            ),
        ) from exc


def _value(raw: Any, kind: ValueKind) -> Any:
    if kind == "datetime":
        if not isinstance(raw, str):
            raise TypeError("datum verwacht")
        value = datetime.fromisoformat(raw)
        if value.tzinfo is None:
            raise ValueError("datum zonder tijdzone")
        return value
    if kind == "int":
        if not isinstance(raw, int) or isinstance(raw, bool):
            raise TypeError("getal verwacht")
        if not 0 <= raw <= MAX_INT4:
            raise ValueError("getal buiten bereik")  # anders een 500 uit asyncpg
        return raw
    if not isinstance(raw, str):
        raise TypeError("tekst verwacht")
    return raw
