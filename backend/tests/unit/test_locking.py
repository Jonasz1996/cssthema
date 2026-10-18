import pytest

from cssthema.services.locking import LockExpectation, lock_etag


def test_lock_etag() -> None:
    assert lock_etag(12) == '"lv-12"'


@pytest.mark.parametrize(
    ("header", "matching", "not_matching"),
    [
        ('"lv-12"', [12], [11, 13]),
        ('W/"lv-12"', [12], [1]),
        ('"lv-3", "lv-5"', [3, 5], [4]),
        ("*", [1, 99], []),
        ('"sha256-abc"', [], [1, 12]),
        ("lv-12", [], [12]),
        ('"lv-12x"', [], [12]),
    ],
)
def test_if_match(header: str, matching: list[int], not_matching: list[int]) -> None:
    expectation = LockExpectation.from_if_match(header)
    assert all(expectation.matches(n) for n in matching)
    assert not any(expectation.matches(n) for n in not_matching)


def test_exactly() -> None:
    expectation = LockExpectation.exactly(7)
    assert expectation.matches(7)
    assert not expectation.matches(8)
