import uuid

from cssthema.domain.auth import passwords, session_token, totp


def test_password_roundtrip() -> None:
    encoded = passwords.hash_password("geheim-wachtwoord")
    assert passwords.verify_password("geheim-wachtwoord", encoded)
    assert not passwords.verify_password("ander-wachtwoord", encoded)
    assert not passwords.verify_password("x", None)


def test_temporary_password_shape() -> None:
    temp = passwords.temporary_password()
    assert len(temp) == 19 and temp.count("-") == 3


def test_totp_rfc6238_vector() -> None:
    # RFC 6238 bijlage B, SHA-1: geheim "12345678901234567890", T=59 → 94287082 (8 cijfers).
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp.code_at(secret, now=59) == "287082"
    step = totp.verify(secret, "287082", last_step=None, now=59)
    assert step == 1
    assert totp.verify(secret, "287082", last_step=step, now=59) is None


def test_session_token() -> None:
    user_id = uuid.uuid4()
    token = session_token.issue("s", user_id, 3, 60)
    claims = session_token.read("s", token)
    assert claims is not None and claims.user_id == user_id and claims.version == 3
    assert session_token.read("andere-sleutel", token) is None
    assert session_token.read("s", token[:-2] + "xx") is None
    assert session_token.read("s", token, now=claims.expires_at + 1) is None
