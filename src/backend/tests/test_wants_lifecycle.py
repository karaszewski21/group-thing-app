"""Lifecycle of a want through the seeker's actions: extend, close as
fulfilled or withdrawn, and resume or reopen with its cap check, flagging
the want for the matcher service. The sweep (expiry, reminder, purge) is the
matcher service's and is tested there."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.models import Notification, NotificationKind
from app.wants.domain.limits import MAX_ACTIVE_WANTS, VALIDITY
from app.wants.domain.status import WantStatus
from app.wants.models import Want
from tests.conftest import _Owner, seed_want_matches
from tests.test_term_item_listings import _auth, _register
from tests.test_wants_api import (
    CAP_MESSAGE,
    _clear_match_request,
    _create_want,
    _match_requested_at,
    _matched_items,
    _seed_wants,
)


async def _stored(db: AsyncSession, want_id: str) -> Want:
    want = await db.get(Want, uuid.UUID(want_id))
    assert want is not None
    return want


async def _post(client: AsyncClient, token: str, want_id: str, action: str, **body: Any) -> Any:
    return await client.post(
        f"/api/wants/{want_id}/{action}", json=body or None, headers=_auth(token)
    )


async def _unread_match_row(db: AsyncSession, seeker: uuid.UUID, want_id: str) -> Notification:
    """An unread match bell row the want points at."""
    row = Notification(
        party_id=seeker,
        kind=NotificationKind.WANT_MATCH_FOUND,
        message="Szukasz: «rower». 2 nowe pasujące rzeczy.",
        link_path=f"/wanted/{want_id}",
    )
    db.add(row)
    want = await _stored(db, want_id)
    want.match_notification_id = row.id
    want.match_notification_count = 2
    await db.commit()
    return row


async def _bell_rows(db: AsyncSession, seeker: uuid.UUID) -> int:
    return int(
        await db.scalar(
            select(func.count()).select_from(Notification).where(Notification.party_id == seeker)
        )
        or 0
    )


def _is_new_period(expires_at: str | datetime, before: datetime) -> bool:
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    return before + VALIDITY <= expires_at <= datetime.utcnow() + VALIDITY


async def test_extendWant_active_startsNewPeriodAndKeepsMatches_closedWant409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wl.extend.o@example.com")
    token, _ = await _register(client, "GUEST", "wl.extend.s@example.com")
    bike = await owner.lists("Rower miejski")
    want = await _create_want(client, token, "rower")
    await seed_want_matches(db_session, want["id"], [bike])
    stored = await _stored(db_session, want["id"])
    stored.expires_at = datetime.utcnow() + timedelta(days=3)
    stored.reminded_at = datetime.utcnow()
    await db_session.commit()
    before = datetime.utcnow()

    extended = await _post(client, token, want["id"], "extend")

    assert extended.status_code == 200, extended.text
    assert extended.json()["status"] == "ACTIVE"
    assert extended.json()["match_count"] == 1
    assert _is_new_period(extended.json()["expires_at"], before)
    reminded_at = await db_session.scalar(
        select(Want.reminded_at).where(Want.id == uuid.UUID(want["id"]))
    )
    assert reminded_at is None
    assert await _matched_items(db_session, want["id"]) == {bike}

    await _post(client, token, want["id"], "close", outcome="FULFILLED")
    refused = await _post(client, token, want["id"], "extend")

    assert refused.status_code == 409, refused.text
    assert refused.json()["message"] == "Przedłużyć można tylko aktywne poszukiwanie."


async def test_closeWant_fulfilled_keepsBellRowsAndStaysListed_secondClose409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, seeker = await _register(client, "GUEST", "wl.fulfil.s@example.com")
    want = await _create_want(client, token, "rower")
    await _unread_match_row(db_session, seeker, want["id"])
    before = datetime.utcnow()

    closed = await _post(client, token, want["id"], "close", outcome="FULFILLED")

    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "FULFILLED"
    assert before <= datetime.fromisoformat(closed.json()["closed_at"]) <= datetime.utcnow()
    assert await _bell_rows(db_session, seeker) == 1
    listed = await client.get("/api/wants", headers=_auth(token))
    assert [row["id"] for row in listed.json()] == [want["id"]]

    again = await _post(client, token, want["id"], "close", outcome="WITHDRAWN")
    no_outcome = await _post(client, token, want["id"], "close")
    bad_outcome = await _post(client, token, want["id"], "close", outcome="EXPIRED")

    assert again.status_code == 409, again.text
    assert again.json()["message"] == "To poszukiwanie jest już zamknięte."
    for response in (no_outcome, bad_outcome):
        assert response.status_code == 400, response.text
        assert response.json()["message"] == "Validation failed"


async def test_closeWant_withdrawn_deletesUnreadMatchRowAndHidesTheWant(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, seeker = await _register(client, "GUEST", "wl.withdraw.s@example.com")
    read_first = await _create_want(client, token, "sanki")
    read_row = await _unread_match_row(db_session, seeker, read_first["id"])
    read_row.read_at = datetime.utcnow()
    want = await _create_want(client, token, "rower")
    await _unread_match_row(db_session, seeker, want["id"])

    withdrawn = await _post(client, token, want["id"], "close", outcome="WITHDRAWN")
    withdrawn_read = await _post(client, token, read_first["id"], "close", outcome="WITHDRAWN")

    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "WITHDRAWN"
    assert withdrawn.json()["closed_at"] is not None
    assert withdrawn_read.status_code == 200, withdrawn_read.text
    remaining = (
        await db_session.execute(select(Notification.id).where(Notification.party_id == seeker))
    ).scalars()
    assert list(remaining) == [read_row.id]
    pointers = (
        await db_session.execute(
            select(Want.match_notification_id, Want.match_notification_count).where(
                Want.seeker_party_id == seeker
            )
        )
    ).all()
    assert [tuple(row) for row in pointers] == [(None, 0), (None, 0)]
    assert (await client.get("/api/wants", headers=_auth(token))).json() == []
    assert (await client.get(f"/api/wants/{want['id']}", headers=_auth(token))).status_code == 404


async def test_resumeWant_expiredOrFulfilled_startsNewPeriodKeepsPairsAndFlagsTheWant_active409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wl.resume.o@example.com")
    token, _ = await _register(client, "GUEST", "wl.resume.s@example.com")
    bike = await owner.lists("Rower miejski")
    suggested = await owner.lists("Rower górski")
    expired = await _create_want(client, token, "rower miejski czerwony")
    fulfilled = await _create_want(client, token, "rower górski")
    await seed_want_matches(db_session, expired["id"], [bike])
    await seed_want_matches(db_session, expired["id"], [suggested], missing_words=["czerwony"])
    stored = await _stored(db_session, expired["id"])
    stored.status = WantStatus.EXPIRED
    stored.expires_at = datetime.utcnow() - timedelta(days=2)
    stored.closed_at = stored.expires_at
    stored.reminded_at = datetime.utcnow() - timedelta(days=9)
    await db_session.commit()
    await _post(client, token, fulfilled["id"], "close", outcome="FULFILLED")
    for want in (expired, fulfilled):
        await _clear_match_request(db_session, want["id"])
    closed = (await client.get("/api/wants", headers=_auth(token))).json()
    assert [want["matching"] for want in closed] == [False, False]
    before = datetime.utcnow()

    resumed = await _post(client, token, expired["id"], "resume")
    reopened = await _post(client, token, fulfilled["id"], "resume")

    for response in (resumed, reopened):
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "ACTIVE"
        assert response.json()["closed_at"] is None
        assert response.json()["matching"] is True
        assert _is_new_period(response.json()["expires_at"], before)
        assert response.json()["new_match_count"] == 0
        requested_at = await _match_requested_at(db_session, response.json()["id"])
        assert requested_at is not None and requested_at >= before
    assert (resumed.json()["match_count"], reopened.json()["match_count"]) == (1, 0)
    reminded_at = await db_session.scalar(
        select(Want.reminded_at).where(Want.id == uuid.UUID(expired["id"]))
    )
    assert reminded_at is None
    assert await _matched_items(db_session, expired["id"]) == {bike, suggested}

    already_active = await _post(client, token, expired["id"], "resume")

    assert already_active.status_code == 409, already_active.text
    assert already_active.json()["message"] == "To poszukiwanie jest już aktywne."


async def test_resumeWant_thirtyActiveWants_returns409AndLeavesTheWantClosed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, seeker = await _register(client, "GUEST", "wl.cap.s@example.com")
    (closed_id,) = await _seed_wants(db_session, seeker, 1, WantStatus.FULFILLED)
    await _seed_wants(db_session, seeker, MAX_ACTIVE_WANTS)

    refused = await _post(client, token, str(closed_id), "resume")

    assert refused.status_code == 409, refused.text
    assert refused.json()["message"] == CAP_MESSAGE
    status, closed_at = (
        await db_session.execute(select(Want.status, Want.closed_at).where(Want.id == closed_id))
    ).one()
    assert status == WantStatus.FULFILLED
    assert closed_at is not None
    assert await _match_requested_at(db_session, closed_id) is None
