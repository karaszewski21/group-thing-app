"""The periodic scan of wants (`app.wants.application.scan.scan_wants`) and
its job wrapper in `app.main`: the window and its marker, the pairs and bell
rows of a run, a muted want, the version bump seen by a concurrent write, a
lost marker race or deadlock, the statement count and the log line."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from sqlalchemy.orm.exc import StaleDataError

import app.main
from app.groups.models import ItemListingPreference
from app.notifications.models import Notification, NotificationKind
from app.wants.application import matcher
from app.wants.application.match_notifications import write_bell_rows
from app.wants.application.scan import SCAN_NAME, scan_wants
from app.wants.domain.limits import SCAN_INTERVAL, SCAN_OVERLAP
from app.wants.domain.status import WantMatchSource, WantStatus
from app.wants.models import Want, WantMatch, WantScanMarker
from tests.conftest import count_queries
from tests.test_organizer_page import _organization_slug
from tests.test_term_item_listings import _auth, _register
from tests.test_wants_matcher import _Owner, _product, _want

SCAN_LOGGER = "app.wants.application.scan"


class _PgError(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__("deadlock detected")
        self.sqlstate = sqlstate


async def _scan(db: AsyncSession, now: datetime) -> None:
    """One run. The test session then forgets what it had loaded, as the
    request that follows a run in production starts from an empty session."""
    await scan_wants(db, now=now)
    db.expire_all()


async def _date_listing(db: AsyncSession, item_id: uuid.UUID, created_at: datetime) -> None:
    await db.execute(
        update(ItemListingPreference)
        .where(ItemListingPreference.item_id == item_id)
        .values(created_at=created_at)
    )
    await db.commit()


async def _matched(db: AsyncSession, want_id: uuid.UUID) -> set[uuid.UUID]:
    result = await db.execute(select(WantMatch.item_id).where(WantMatch.want_id == want_id))
    return set(result.scalars().all())


async def _bell_rows(db: AsyncSession, party_id: uuid.UUID) -> list[Any]:
    result = await db.execute(
        select(
            Notification.id,
            Notification.kind,
            Notification.message,
            Notification.link_path,
            Notification.read_at,
        )
        .where(Notification.party_id == party_id)
        .order_by(Notification.message)
    )
    return list(result.all())


async def _pointer(db: AsyncSession, want_id: uuid.UUID) -> tuple[uuid.UUID | None, int]:
    row = (
        await db.execute(
            select(Want.match_notification_id, Want.match_notification_count).where(
                Want.id == want_id
            )
        )
    ).one()
    return row.match_notification_id, row.match_notification_count


async def _markers(db: AsyncSession) -> list[datetime]:
    result = await db.execute(
        select(WantScanMarker.scanned_through).where(WantScanMarker.scan_name == SCAN_NAME)
    )
    return list(result.scalars().all())


async def _new_match_count(client: AsyncClient, token: str) -> int:
    (want,) = (await client.get("/api/wants", headers=_auth(token))).json()
    return int(want["new_match_count"])


async def test_scanWants_newListing_storesOnePairAndOneBellRow_sameWindowAgainAddsNothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.new.o@example.com")
    token, seeker = await _register(client, "GUEST", "ws.new.s@example.com")
    want_id = await _want(db_session, seeker, "rower")
    bike = await owner.lists("Rower miejski")
    now = datetime.utcnow()

    await _scan(db_session, now)

    matches = (
        await db_session.execute(select(WantMatch.item_id, WantMatch.source, WantMatch.seen_at))
    ).all()
    assert [tuple(match) for match in matches] == [(bike, WantMatchSource.SCAN, None)]
    (row,) = await _bell_rows(db_session, seeker)
    assert row.kind == NotificationKind.WANT_MATCH_FOUND
    assert row.read_at is None
    assert await _pointer(db_session, want_id) == (row.id, 1)
    assert await _new_match_count(client, token) == 1

    await _scan(db_session, now)
    await _scan(db_session, now + timedelta(minutes=1))

    assert await _matched(db_session, want_id) == {bike}
    assert [again.id for again in await _bell_rows(db_session, seeker)] == [row.id]
    assert await _pointer(db_session, want_id) == (row.id, 1)


async def test_scanWants_noMarker_readsIntervalPlusOverlapAndCreatesIt_nextRunReadsTheOverlap(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.window.o@example.com")
    _, seeker = await _register(client, "GUEST", "ws.window.s@example.com")
    want_id = await _want(db_session, seeker, "rower")
    now = datetime.utcnow() + timedelta(hours=1)
    first_window = SCAN_INTERVAL + SCAN_OVERLAP
    inside = await owner.lists("Rower miejski")
    before = await owner.lists("Rower górski")
    await _date_listing(db_session, inside, now - first_window + timedelta(minutes=1))
    await _date_listing(db_session, before, now - first_window)
    assert await _markers(db_session) == []

    await _scan(db_session, now)

    assert first_window == timedelta(minutes=20)
    assert await _matched(db_session, want_id) == {inside}
    assert await _markers(db_session) == [now]

    in_overlap = await owner.lists("Rower szosowy")
    behind_overlap = await owner.lists("Rower składany")
    at_the_end = await owner.lists("Rower dziecięcy")
    after_the_end = await owner.lists("Rower trekkingowy")
    next_now = now + SCAN_INTERVAL
    await _date_listing(db_session, in_overlap, now - SCAN_OVERLAP + timedelta(seconds=1))
    await _date_listing(db_session, behind_overlap, now - SCAN_OVERLAP)
    await _date_listing(db_session, at_the_end, next_now)
    await _date_listing(db_session, after_the_end, next_now + timedelta(seconds=1))

    await _scan(db_session, next_now)

    assert await _matched(db_session, want_id) == {inside, in_overlap, at_the_end}
    assert await _markers(db_session) == [next_now]


async def test_scanWants_itemRegisteredWithAListingMode_isMatched(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.register.o@example.com")
    _, seeker = await _register(client, "GUEST", "ws.register.s@example.com")
    want_id = await _want(db_session, seeker, "hulajnoga")
    registered = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": owner._inventory_id,
            "product_id": await _product(client, owner.token, "Hulajnoga miejska"),
            "condition": "GOOD",
            "location_id": owner.place_id,
            "listing_mode": "GIFT",
        },
        headers=_auth(owner.token),
    )
    assert registered.status_code == 201, registered.text

    await _scan(db_session, datetime.utcnow())

    assert await _matched(db_session, want_id) == {uuid.UUID(registered.json()["id"])}
    assert len(await _bell_rows(db_session, seeker)) == 1


async def test_scanWants_singleMatchOfAnOrganizationsItem_bellRowLinksToTheSlugPage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.org.o@example.com")
    slug = await _organization_slug(client, owner.token, "Wypożyczalnia Rowerów Ws")
    _, seeker = await _register(client, "GUEST", "ws.org.s@example.com")
    await _want(db_session, seeker, "rower")
    bike = await owner.lists("Rower miejski")

    await _scan(db_session, datetime.utcnow())

    (row,) = await _bell_rows(db_session, seeker)
    assert row.kind == NotificationKind.WANT_MATCH_FOUND
    assert row.message == "Szukasz: «rower». Ktoś wystawił: «Rower miejski»."
    assert row.link_path == f"/{slug}/product/{bike}"


async def test_writeBellRows_singleMatchWhoseItemIsGone_noRowForIt_otherWantPointsAtItsOwnRow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.gone.o@example.com")
    _, seeker = await _register(client, "GUEST", "ws.gone.s@example.com")
    _, other_seeker = await _register(client, "GUEST", "ws.gone.s2@example.com")
    orphaned = await _want(db_session, seeker, "sanki")
    kept = await _want(db_session, other_seeker, "rower")
    bike = await owner.lists("Rower miejski")

    # The first pair's item has no listing row any more when the names are read.
    written = await write_bell_rows(
        db_session,
        pairs=[(orphaned, uuid.uuid4()), (kept, bike)],
        expiring=[],
        now=datetime.utcnow(),
    )
    await db_session.commit()
    db_session.expire_all()

    assert written == 1
    assert await _bell_rows(db_session, seeker) == []
    assert await _pointer(db_session, orphaned) == (None, 0)
    (row,) = await _bell_rows(db_session, other_seeker)
    assert row.message == "Szukasz: «rower». Ktoś wystawił: «Rower miejski»."
    assert await _pointer(db_session, kept) == (row.id, 1)


async def test_writeBellRows_wantWithdrawnAfterItsPairWasStored_noRowAndPointerUntouched(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.closed.o@example.com")
    _, seeker = await _register(client, "GUEST", "ws.closed.s@example.com")
    _, other_seeker = await _register(client, "GUEST", "ws.closed.s2@example.com")
    withdrawn = await _want(db_session, seeker, "rower")
    active = await _want(db_session, other_seeker, "rower")
    await owner.lists("Rower miejski")
    await _scan(db_session, datetime.utcnow())
    (first_row,) = await _bell_rows(db_session, seeker)
    mountain = await owner.lists("Rower górski")
    # The seeker withdraws between the run's match step and its bell rows.
    stamp = datetime.utcnow()
    await db_session.execute(
        update(Want)
        .where(Want.id == withdrawn)
        .values(status=WantStatus.WITHDRAWN, closed_at=stamp, updated_at=stamp)
    )

    written = await write_bell_rows(
        db_session,
        pairs=[(withdrawn, mountain), (active, mountain)],
        expiring=[],
        now=datetime.utcnow(),
    )
    await db_session.commit()
    db_session.expire_all()

    assert written == 1
    assert [row.id for row in await _bell_rows(db_session, seeker)] == [first_row.id]
    assert await _pointer(db_session, withdrawn) == (first_row.id, 1)
    (summed,) = await _bell_rows(db_session, other_seeker)
    assert summed.message == "Szukasz: «rower». 2 nowe pasujące rzeczy."
    assert await _pointer(db_session, active) == (summed.id, 2)


async def test_scanWants_notificationsOff_storesPairsOnly_firstRowAfterReEnablingCountsItsRun(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.muted.o@example.com")
    token, seeker = await _register(client, "GUEST", "ws.muted.s@example.com")
    want_id = await _want(db_session, seeker, "sanki", notifications_enabled=False)
    wooden = await owner.lists("Sanki drewniane")

    await _scan(db_session, datetime.utcnow())

    assert await _matched(db_session, want_id) == {wooden}
    assert await _bell_rows(db_session, seeker) == []
    assert await _pointer(db_session, want_id) == (None, 0)
    assert await _new_match_count(client, token) == 1

    enabled = await client.patch(
        f"/api/wants/{want_id}", json={"notifications_enabled": True}, headers=_auth(token)
    )
    assert enabled.status_code == 200, enabled.text
    plastic = await owner.lists("Sanki plastikowe")

    await _scan(db_session, datetime.utcnow())

    assert await _matched(db_session, want_id) == {wooden, plastic}
    (row,) = await _bell_rows(db_session, seeker)
    assert row.message == "Szukasz: «sanki». Ktoś wystawił: «Sanki plastikowe»."
    assert await _pointer(db_session, want_id) == (row.id, 1)
    assert await _new_match_count(client, token) == 2


async def test_scanWants_wantLoadedBeforeTheRun_itsWriteRaisesStaleDataError(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.race.o@example.com")
    _, seeker = await _register(client, "GUEST", "ws.race.s@example.com")
    expiring = await _want(db_session, seeker, "narty", expires_in=timedelta(days=3))
    ended = await _want(db_session, seeker, "łyżwy", expires_in=timedelta(seconds=0))
    matched = await _want(db_session, seeker, "rower")
    await owner.lists("Rower miejski")
    loaded = await db_session.get(Want, expiring)
    assert loaded is not None
    now = datetime.utcnow() + timedelta(seconds=1)

    await scan_wants(db_session, now=now)

    versions = dict(
        (
            await db_session.execute(
                select(Want.id, Want.updated_at).where(Want.seeker_party_id == seeker)
            )
        )
        .tuples()
        .all()
    )
    assert versions == {expiring: now, ended: now, matched: now}
    loaded.note = "dla syna"
    with pytest.raises(StaleDataError):
        await db_session.flush()
    await db_session.rollback()


async def test_runWantScan_lostMarkerRace_isSwallowedAndRolledBack_nextRunLeavesOneMarker(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _, seeker = await _register(client, "GUEST", "ws.wrapper.s@example.com")
    ended = await _want(db_session, seeker, "narty", expires_in=timedelta(seconds=0))
    match_new_listings = matcher.match_new_listings

    @asynccontextmanager
    async def test_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    async def rival_creates_the_marker(db: AsyncSession, **window: Any) -> Any:
        stamp = datetime.utcnow()
        await db.execute(
            insert(WantScanMarker).values(
                id=uuid.uuid4(),
                created_at=stamp,
                updated_at=stamp,
                scan_name=SCAN_NAME,
                scanned_through=stamp,
            )
        )
        return await match_new_listings(db, **window)

    async def rival_moves_the_marker(db: AsyncSession, **window: Any) -> Any:
        # The table, not the entity: the marker the run holds must stay as loaded.
        await db.execute(
            update(WantScanMarker.__table__).values(
                updated_at=datetime.utcnow() + timedelta(hours=1)
            )
        )
        return await match_new_listings(db, **window)

    async def status() -> WantStatus | None:
        return await db_session.scalar(select(Want.status).where(Want.id == ended))

    async def unrelated_failure(db: AsyncSession) -> None:
        raise IntegrityError("INSERT", {}, Exception("fk_wants_seeker_party_id_parties"))

    async def deadlock(db: AsyncSession) -> None:
        raise OperationalError("UPDATE", {}, _PgError("40P01"))

    monkeypatch.setattr(app.main, "async_session_factory", test_session)
    caplog.set_level(logging.WARNING, logger="app.main")

    monkeypatch.setattr(matcher, "match_new_listings", rival_creates_the_marker)
    await app.main._run_want_scan()

    assert await _markers(db_session) == []
    assert await status() == WantStatus.ACTIVE

    monkeypatch.setattr(matcher, "match_new_listings", match_new_listings)
    await app.main._run_want_scan()

    assert len(await _markers(db_session)) == 1
    assert await status() == WantStatus.EXPIRED
    (after_first_run,) = await _markers(db_session)

    monkeypatch.setattr(matcher, "match_new_listings", rival_moves_the_marker)
    await app.main._run_want_scan()

    assert await _markers(db_session) == [after_first_run]
    assert [record.levelname for record in caplog.records] == ["WARNING", "WARNING"]

    monkeypatch.setattr(matcher, "match_new_listings", match_new_listings)
    await app.main._run_want_scan()

    (after_last_run,) = await _markers(db_session)
    assert after_last_run > after_first_run

    monkeypatch.setattr(app.main, "scan_wants", deadlock)
    await app.main._run_want_scan()

    assert [record.levelname for record in caplog.records] == ["WARNING", "WARNING", "WARNING"]
    assert "deadlock detected" in caplog.records[-1].getMessage()
    assert await _markers(db_session) == [after_last_run]

    # Logged once here and not raised, so APScheduler does not log it again.
    monkeypatch.setattr(app.main, "scan_wants", unrelated_failure)
    await app.main._run_want_scan()

    assert len(caplog.records) == 4
    failure = caplog.records[-1]
    assert (failure.levelname, failure.getMessage()) == ("ERROR", "want scan failed")
    assert failure.exc_info is not None
    assert isinstance(failure.exc_info[1], IntegrityError)


async def test_scanWants_oneOrSeveralWantsAndListings_sameStatementCountAtMostSixteen(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    owner = await _Owner.create(client, "ws.count.o@example.com")
    other_owner = await _Owner.create(client, "ws.count.o2@example.com")
    _, seeker = await _register(client, "GUEST", "ws.count.s@example.com")
    _, other_seeker = await _register(client, "GUEST", "ws.count.s2@example.com")
    soon = timedelta(days=3)

    async def counted_run() -> int:
        with count_queries(engine) as statements:
            await _scan(db_session, datetime.utcnow())
        return len(statements)

    # Every optional statement of a run is issued: a bell row to replace, a
    # single match to name, a reminder, and a marker that already exists.
    await _scan(db_session, datetime.utcnow())
    bike_want = await _want(db_session, seeker, "rower", expires_in=soon)
    await db_session.execute(
        update(Want).where(Want.id == bike_want).values(match_notification_id=uuid.uuid4())
    )
    await db_session.commit()
    await owner.lists("Rower miejski")

    one = await counted_run()

    await _want(db_session, seeker, "sanki", expires_in=soon)
    await _want(db_session, other_seeker, "sanki", expires_in=soon)
    await _want(db_session, other_seeker, "narty", expires_in=soon)
    await _want(db_session, other_seeker, "łyżwy", expires_in=timedelta(seconds=0))
    await owner.lists("Rower górski")
    await owner.lists("Sanki drewniane")
    await other_owner.lists("Sanki plastikowe")
    await other_owner.lists("Narty biegowe")

    several = await counted_run()

    stored = await db_session.scalar(select(func.count()).select_from(WantMatch))
    bell_rows = await db_session.scalar(select(func.count()).select_from(Notification))
    assert stored == 7
    # Four match rows (the bike row replaced once) and four reminders.
    assert bell_rows == 8
    assert one == several
    assert several <= 16


async def test_scanWants_eachRun_logsOneLine_infoOnlyWhenTheRunDidWork(
    client: AsyncClient, db_session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    owner = await _Owner.create(client, "ws.log.o@example.com")
    _, seeker = await _register(client, "GUEST", "ws.log.s@example.com")
    await _want(db_session, seeker, "rower", expires_in=timedelta(days=3))
    await _want(db_session, seeker, "narty", expires_in=timedelta(seconds=0))
    await owner.lists("Rower miejski")
    now = datetime.utcnow()
    caplog.set_level(logging.DEBUG, logger=SCAN_LOGGER)

    await _scan(db_session, now)
    await _scan(db_session, now + SCAN_INTERVAL)

    work, idle = [record for record in caplog.records if record.name == SCAN_LOGGER]
    assert (work.levelname, idle.levelname) == ("INFO", "DEBUG")
    for field in (
        f"window_start={(now - SCAN_INTERVAL - SCAN_OVERLAP).isoformat()}",
        f"window_end={now.isoformat()}",
        "listings=1",
        "active_wants=1",
        "pairs=1",
        "notifications=2",
        "expired=1",
        "reminded=1",
        "purged=0",
        "duration_ms=",
    ):
        assert field in work.getMessage()
    for field in ("active_wants=1", "pairs=0", "notifications=0", "expired=0", "reminded=0"):
        assert field in idle.getMessage()
