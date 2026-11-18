"""The in-process want matcher is gone: the matcher service (`src/matcher`)
matches and stages `wants.bells_due` outbox rows, the backend only writes
the bells. The old modules and the APScheduler want scan job must not come
back (the embedding reconcile job is a different one), and the backend
refuses to start on a schema without the matcher contract."""

from __future__ import annotations

import importlib
import sys
import types
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import app.main as main
from app.config import settings
from app.embeddings import service as embeddings_service
from app.outbox import registry
from app.outbox import scheduler as outbox_scheduler
from app.product import embeddings as product_embeddings
from app.wants.application import bells_due
from app.wants.application import embeddings as want_embeddings
from tests.conftest import FakeEmbedder


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
    monkeypatch.setattr(outbox_scheduler, "run_forever", _no_poller)
    monkeypatch.setattr(main, "AsyncIOScheduler", _RecordingScheduler)


@pytest.mark.parametrize("enabled", [False, True])
async def test_lifespan_schedulesNoWantScanJob_andRegistersTheHandlers(
    _lifespan_on_test_session: None, monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    """The job list is the same with embeddings on and off; with them on the
    lifespan sets the embedder (a stand-in for the ONNX module) and clears it
    at shutdown."""
    monkeypatch.setattr(settings, "embeddings_enabled", enabled)
    onnx_module = types.ModuleType("app.embeddings.onnx_embedder")
    onnx_module.OnnxEmbedder = lambda _model_dir: FakeEmbedder()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "app.embeddings.onnx_embedder", onnx_module)
    registry.clear()

    async with main.lifespan(main.app):
        assert bells_due.handle_bells_due in registry.get_handlers(bells_due.EVENT_TYPE)
        handlers = registry.get_handlers(product_embeddings.EMBEDDINGS_REQUESTED)
        assert product_embeddings.handle_embeddings_requested in handlers
        assert want_embeddings.handle_embeddings_requested in handlers
        assert embeddings_service.is_enabled() is enabled

    assert embeddings_service.is_enabled() is False
    assert _RecordingScheduler.jobs == [
        main._run_term_end_scan,
        main._run_media_sweep,
        main._run_embedding_reconcile,
    ]
    assert not hasattr(main, "_run_want_scan")


async def test_lifespan_matchableListingsMissing_refusesToStart(
    _lifespan_on_test_session: None, db_session: AsyncSession
) -> None:
    await db_session.execute(text("DROP VIEW public.matchable_listings"))

    with pytest.raises(RuntimeError, match="old 0099"):
        async with main.lifespan(main.app):
            pytest.fail("the lifespan must not yield")

    assert _RecordingScheduler.jobs == []
