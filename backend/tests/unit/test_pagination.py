import base64
import uuid
from datetime import UTC, datetime

import pytest

from cssthema.api.pagination import decode_cursor, encode_cursor
from cssthema.services.errors import BadRequestError

ITEM = uuid.UUID("01a10d34-e372-7270-9c65-801b7cea31b1")


@pytest.mark.parametrize(
    ("sort", "value", "kind"),
    [
        ("-updated_at", datetime(2026, 10, 5, 12, 4, 31, 123456, tzinfo=UTC), "datetime"),
        ("name", "Proxmox — donker", "str"),
        ("versions", 42, "int"),
    ],
)
def test_round_trip(sort: str, value: object, kind: str) -> None:
    cursor = encode_cursor(sort, value, ITEM)
    assert "=" not in cursor
    assert decode_cursor(cursor, sort=sort, kind=kind) == (value, ITEM)


def _raw(payload: str) -> str:
    return base64.urlsafe_b64encode(payload.encode()).rstrip(b"=").decode()


@pytest.mark.parametrize(
    ("cursor", "sort", "kind"),
    [
        ("!!!", "name", "str"),
        (_raw("geen json"), "name", "str"),
        (_raw('{"a": 1}'), "name", "str"),
        (_raw('["name", "x"]'), "name", "str"),
        (_raw('["name", "x", "geen-uuid"]'), "name", "str"),
        (_raw(f'["name", 1, "{ITEM}"]'), "name", "str"),
        (_raw(f'["-updated_at", "2026-10-05T12:00:00", "{ITEM}"]'), "-updated_at", "datetime"),
        (_raw(f'["versions", true, "{ITEM}"]'), "versions", "int"),
        (_raw(f'["versions", 99999999999, "{ITEM}"]'), "versions", "int"),
        (_raw(f'["versions", -1, "{ITEM}"]'), "versions", "int"),
        (encode_cursor("name", "x", ITEM), "-updated_at", "datetime"),
        ("a" * 2000, "name", "str"),
    ],
)
def test_invalid_cursor_is_bad_request(cursor: str, sort: str, kind: str) -> None:
    with pytest.raises(BadRequestError) as info:
        decode_cursor(cursor, sort=sort, kind=kind)
    assert info.value.status == 400
