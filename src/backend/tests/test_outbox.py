"""`app.outbox` — the generic transactional-outbox producer + poller, in
isolation from any real consuming vertical (see `test_notifications.py` for
the end-to-end `groups` -> outbox -> `notifications` path)."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.outbox import registry, service
from app.outbox.dispatcher import MAX_ATTEMPTS, dispatch_pending
from app.outbox.models import OutboxEntry, OutboxStatus

_EVENT_TYPE = "test.something_happened"


@pytest.fixture(autouse=True)
def _clean_registry() -> Any:
    registry.clear()
    yield
    registry.clear()


async def test_append_stagesRow_visibleAfterCommit(db_session: AsyncSession) -> None:
    await service.append(db_session, event_type=_EVENT_TYPE, payload={"n": 1})
    await db_session.commit()

    rows = (await db_session.execute(select(OutboxEntry))).scalars().all()
    assert len(rows) == 1
    assert rows[0].event_type == _EVENT_TYPE
    assert rows[0].payload == {"n": 1}
    assert rows[0].status == OutboxStatus.PENDING
    assert rows[0].attempts == 0


async def test_dispatchPending_callsRegisteredHandler_marksProcessed(
    db_session: AsyncSession,
) -> None:
    received: list[dict[str, Any]] = []

    async def _handler(_db: AsyncSession, payload: dict[str, Any]) -> None:
        received.append(payload)

    registry.register_handler(_EVENT_TYPE, _handler)
    await service.append(db_session, event_type=_EVENT_TYPE, payload={"n": 2})
    await db_session.commit()

    processed = await dispatch_pending(db_session)

    assert processed == 1
    assert received == [{"n": 2}]
    entry = (await db_session.execute(select(OutboxEntry))).scalar_one()
    assert entry.status == OutboxStatus.PROCESSED
    assert entry.processed_at is not None


async def test_dispatchPending_noHandlerRegistered_stillMarksProcessed(
    db_session: AsyncSession,
) -> None:
    await service.append(db_session, event_type=_EVENT_TYPE, payload={})
    await db_session.commit()

    processed = await dispatch_pending(db_session)

    assert processed == 1
    entry = (await db_session.execute(select(OutboxEntry))).scalar_one()
    assert entry.status == OutboxStatus.PROCESSED


async def test_dispatchPending_handlerRaises_incrementsAttempts_staysPending(
    db_session: AsyncSession,
) -> None:
    async def _failing_handler(_db: AsyncSession, _payload: dict[str, Any]) -> None:
        raise RuntimeError("boom")

    registry.register_handler(_EVENT_TYPE, _failing_handler)
    await service.append(db_session, event_type=_EVENT_TYPE, payload={})
    await db_session.commit()

    await dispatch_pending(db_session)

    entry = (await db_session.execute(select(OutboxEntry))).scalar_one()
    assert entry.status == OutboxStatus.PENDING
    assert entry.attempts == 1
    assert entry.last_error is not None and "boom" in entry.last_error


async def test_dispatchPending_exceedsMaxAttempts_marksFailed(db_session: AsyncSession) -> None:
    async def _failing_handler(_db: AsyncSession, _payload: dict[str, Any]) -> None:
        raise RuntimeError("boom")

    registry.register_handler(_EVENT_TYPE, _failing_handler)
    await service.append(db_session, event_type=_EVENT_TYPE, payload={})
    await db_session.commit()

    for _ in range(MAX_ATTEMPTS):
        await dispatch_pending(db_session)

    entry = (await db_session.execute(select(OutboxEntry))).scalar_one()
    assert entry.status == OutboxStatus.FAILED
    assert entry.attempts == MAX_ATTEMPTS
