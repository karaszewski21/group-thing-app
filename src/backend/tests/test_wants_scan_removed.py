"""The in-process want matcher is gone: the matcher service (`src/matcher`)
matches and stages `wants.bells_due` outbox rows, the backend only writes
the bells. The old modules and the APScheduler want job must not come
back, and the backend refuses to start on a schema without the matcher
contract."""

from __future__ import annotations

import importlib
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import app.main as main
from app.outbox import registry
from app.wants.application import bells_due


@pytest.mark.parametrize("module", ["app.wants.application.matcher", "app.wants.application.scan"])
def test_inProcessMatcherModules_removed_notImportable(module: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(module)


class _RecordingScheduler:
    jobs: list[Callable[..., Any]] = []

    def __init__(self, **_: Any) -> None:
        _RecordingScheduler.jobs = []

    def add_job(self, func: Callable[..., Any], *_: Any, **__: Any) -> None:
        _RecordingScheduler.jobs.append(func)

    def start(self) -> None:
        pass

    def shutdown(self, *, wait: bool) -> None:
        pass


@pytest.fixture
def _lifespan_on_test_session(monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession) -> None:
    """The lifespan against the test session, with the outbox poller and the
    scheduler replaced so nothing runs in the background."""

    @asynccontextmanager
    async def _session() -> AsyncIterator[AsyncSession]:
        yield db_session

    async def _no_poller() -> None:
        return None

    _RecordingScheduler.jobs = []
    monkeypatch.setattr(main, "async_session_factory", _session)
    monkeypatch.setattr(main.outbox_scheduler, "run_forever", _no_poller)
    monkeypatch.setattr(main, "AsyncIOScheduler", _RecordingScheduler)


async def test_lifespan_schedulesNoWantJob_andRegistersTheBellsDueHandler(
    _lifespan_on_test_session: None,
) -> None:
    registry.clear()

    async with main.lifespan(main.app):
        assert bells_due.handle_bells_due in registry.get_handlers(bells_due.EVENT_TYPE)

    assert _RecordingScheduler.jobs == [main._run_term_end_scan, main._run_media_sweep]
    assert not hasattr(main, "_run_want_scan")


async def test_lifespan_matchableListingsMissing_refusesToStart(
    _lifespan_on_test_session: None, db_session: AsyncSession
) -> None:
    await db_session.execute(text("DROP VIEW public.matchable_listings"))

    with pytest.raises(RuntimeError, match="old 0099"):
        async with main.lifespan(main.app):
            pytest.fail("the lifespan must not yield")

    assert _RecordingScheduler.jobs == []
