"""A matching edit racing a matcher run (H3): `update_want` locks the want
`FOR NO KEY UPDATE` before it deletes the stored pairs, so it waits for a
run in progress and also deletes the pair that run commits. The seed is
committed on the session engine, because the two transactions must see each
other's commits, and removed in `finally`."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import cast

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from app.core.auth_deps import Principal
from app.party.models import Party, PartyType
from app.wants.application import writes
from app.wants.infrastructure import moderation_acl, users_acl
from app.wants.schemas import UpdateWantRequest

INSERT_WANT = """
    INSERT INTO wants (id, created_at, updated_at, seeker_party_id, name, status, expires_at)
    VALUES (gen_random_uuid(), :now, :now, :seeker, 'rower', 'ACTIVE', :expires_at)
    RETURNING id
"""
# A pair as a matcher run stores it.
INSERT_PAIR = """
    INSERT INTO want_matches (id, created_at, updated_at, want_id, item_id, source, score, seen_at)
    VALUES (gen_random_uuid(), :now, :now, :want_id, gen_random_uuid(), 'FORWARD', 1.0, :now)
"""


async def _wait_until_blocked(engine: AsyncEngine, timeout: float = 5.0) -> None:
    """Until some backend of the database waits for a row lock."""
    deadline = asyncio.get_running_loop().time() + timeout
    async with engine.connect() as conn:
        while asyncio.get_running_loop().time() < deadline:
            waiting = await conn.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND wait_event_type = 'Lock'"
                )
            )
            await conn.rollback()
            if waiting:
                return
            await asyncio.sleep(0.05)
    raise AssertionError("the edit never waited for the want's lock")


async def _seed_want(engine: AsyncEngine, now: datetime) -> tuple[uuid.UUID, uuid.UUID]:
    async with AsyncSession(engine) as db:
        party = Party(party_type=PartyType.PERSON)
        db.add(party)
        await db.flush()
        seeker = cast(uuid.UUID, party.id)
        want_id = await db.scalar(
            text(INSERT_WANT),
            {"now": now, "seeker": seeker, "expires_at": now + timedelta(days=90)},
        )
        await db.commit()
    return seeker, want_id


async def _remove_want(engine: AsyncEngine, seeker: uuid.UUID, want_id: uuid.UUID) -> None:
    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM wants WHERE id = :id"), {"id": want_id})
        await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": seeker})


def _patch_caller(monkeypatch: pytest.MonkeyPatch, seeker: uuid.UUID) -> None:
    async def caller_profile(_db: AsyncSession, _principal: Principal) -> users_acl.CallerProfile:
        return users_acl.CallerProfile(party_id=seeker, account_user_id=uuid.uuid4())

    monkeypatch.setattr(users_acl, "get_caller_profile", caller_profile)


async def test_updateWant_classifierRuns_wantRowNotLocked(
    engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeker, want_id = await _seed_want(engine, datetime.utcnow())
    _patch_caller(monkeypatch, seeker)
    locked_by_other: list[bool] = []

    async def classifier(*_args: object) -> None:
        async with engine.connect() as matcher_run:
            await matcher_run.execute(
                text("SELECT id FROM wants WHERE id = :id FOR NO KEY UPDATE NOWAIT"),
                {"id": want_id},
            )
            locked_by_other.append(True)
            await matcher_run.rollback()

    monkeypatch.setattr(moderation_acl, "check_text", classifier)
    try:
        async with AsyncSession(engine) as db:
            response = await writes.update_want(
                db,
                cast(Principal, None),
                want_id,
                UpdateWantRequest(name="sanki"),
                now=datetime.utcnow(),
            )
        assert response.name == "sanki"
        assert locked_by_other == [True, True]
    finally:
        await _remove_want(engine, seeker, want_id)


async def test_updateWant_seekerWriteDuringClassifier_raisesStaleDataError(
    engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeker, want_id = await _seed_want(engine, datetime.utcnow())
    _patch_caller(monkeypatch, seeker)

    async def classifier(*_args: object) -> None:
        async with engine.begin() as other_write:
            await other_write.execute(
                text("UPDATE wants SET note = 'inna', updated_at = :at WHERE id = :id"),
                {"at": datetime.utcnow() + timedelta(seconds=1), "id": want_id},
            )

    monkeypatch.setattr(moderation_acl, "check_text", classifier)
    try:
        async with AsyncSession(engine) as db:
            with pytest.raises(StaleDataError):
                await writes.update_want(
                    db,
                    cast(Principal, None),
                    want_id,
                    UpdateWantRequest(name="sanki"),
                    now=datetime.utcnow(),
                )
        async with engine.connect() as conn:
            name = await conn.scalar(text("SELECT name FROM wants WHERE id = :id"), {"id": want_id})
        assert name == "rower"
    finally:
        await _remove_want(engine, seeker, want_id)


async def test_updateWant_matcherRunHoldsTheWant_waitsAndDeletesThePairTheRunCommits(
    engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime.utcnow()
    async with AsyncSession(engine) as db:
        party = Party(party_type=PartyType.PERSON)
        db.add(party)
        await db.flush()
        seeker = cast(uuid.UUID, party.id)
        want_id = await db.scalar(
            text(INSERT_WANT),
            {"now": now, "seeker": seeker, "expires_at": now + timedelta(days=90)},
        )
        await db.commit()

    async def caller_profile(_db: AsyncSession, _principal: Principal) -> users_acl.CallerProfile:
        return users_acl.CallerProfile(party_id=seeker, account_user_id=uuid.uuid4())

    monkeypatch.setattr(users_acl, "get_caller_profile", caller_profile)
    try:
        async with engine.connect() as matcher_run, AsyncSession(engine) as db:
            await matcher_run.execute(
                text("SELECT id FROM wants WHERE id = :id FOR NO KEY UPDATE"), {"id": want_id}
            )
            await matcher_run.execute(text(INSERT_PAIR), {"now": now, "want_id": want_id})

            edit = asyncio.create_task(
                writes.update_want(
                    db,
                    cast(Principal, None),
                    want_id,
                    UpdateWantRequest(name="sanki"),
                    now=datetime.utcnow(),
                )
            )
            await _wait_until_blocked(engine)
            assert not edit.done()
            await matcher_run.commit()
            response = await asyncio.wait_for(edit, 10)

        assert response.name == "sanki"
        assert response.matching is True
        async with engine.connect() as conn:
            pairs = await conn.scalar(
                text("SELECT count(*) FROM want_matches WHERE want_id = :id"), {"id": want_id}
            )
            requested_at = await conn.scalar(
                text("SELECT match_requested_at FROM wants WHERE id = :id"), {"id": want_id}
            )
        assert pairs == 0
        assert requested_at is not None
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM wants WHERE id = :id"), {"id": want_id})
            await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": seeker})
