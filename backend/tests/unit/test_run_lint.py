"""`theme_service.run_lint`: één lint tegelijk, een cache op de inhoud, overslaan zonder client."""

import asyncio
import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any, cast

import pytest

from cssthema.config import Settings
from cssthema.domain.css import linter
from cssthema.services import theme_service
from cssthema.services.context import Actor, ServiceContext


@pytest.fixture
def ctx(settings: Settings) -> ServiceContext:
    actor = Actor(user_id=uuid.uuid4(), display_name="test")
    return ServiceContext(session=cast(Any, None), settings=settings, actor=actor, delivery=None)


@pytest.fixture(autouse=True)
def empty_cache() -> Iterator[None]:
    theme_service._lint_cache.clear()
    yield
    theme_service._lint_cache.clear()


class LintSpy:
    """Telt de echte lints en houdt bij hoeveel er hoogstens tegelijk liepen."""

    def __init__(self) -> None:
        self.texts: list[str] = []
        self.max_parallel = 0
        self._running = 0
        self._lock = threading.Lock()

    def __call__(self, css: str, **kwargs: Any) -> linter.LintResult:
        with self._lock:
            self._running += 1
            self.max_parallel = max(self.max_parallel, self._running)
        try:
            time.sleep(0.05)
            self.texts.append(css)
            return linter.lint(css, **kwargs)
        finally:
            with self._lock:
                self._running -= 1


@pytest.fixture
def spy(monkeypatch: pytest.MonkeyPatch) -> LintSpy:
    spy = LintSpy()
    monkeypatch.setattr(theme_service, "lint", spy)
    return spy


async def test_lints_run_one_at_a_time(ctx: ServiceContext, spy: LintSpy) -> None:
    texts = [f"a {{ color: #00{i}; }}" for i in range(4)]
    results = await asyncio.gather(*(theme_service.run_lint(ctx, css) for css in texts))
    assert sorted(spy.texts) == sorted(texts)
    assert spy.max_parallel == 1
    assert all(result.ok for result in results)


async def test_same_text_is_linted_once(ctx: ServiceContext, spy: LintSpy) -> None:
    css = "a { color: red; } b { colr: blue; }"
    first, second = await asyncio.gather(
        theme_service.run_lint(ctx, css), theme_service.run_lint(ctx, css)
    )
    third = await theme_service.run_lint(ctx, css)
    assert spy.texts == [css]
    assert first is second is third
    assert first.warnings  # onbekende eigenschap


async def test_cache_is_small(ctx: ServiceContext, spy: LintSpy) -> None:
    for i in range(theme_service.LINT_CACHE_SIZE + 5):
        await theme_service.run_lint(ctx, f"a {{ z-index: {i}; }}")
    assert len(theme_service._lint_cache) == theme_service.LINT_CACHE_SIZE
    await theme_service.run_lint(ctx, "a { z-index: 0; }")  # de oudste is eruit
    assert spy.texts.count("a { z-index: 0; }") == 2


async def test_skip_if_skips_before_linting(ctx: ServiceContext, spy: LintSpy) -> None:
    async def gone() -> bool:
        return True

    with pytest.raises(theme_service.LintSkippedError):
        await theme_service.run_lint(ctx, "a {}", skip_if=gone)
    assert spy.texts == []
    # Al gelint: dan gewoon het resultaat, ook zonder client.
    await theme_service.run_lint(ctx, "a {}")
    assert (await theme_service.run_lint(ctx, "a {}", skip_if=gone)).ok
