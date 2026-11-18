"""The `wants.bells_due` outbox handler: the matcher service stages a row of
`{pairs, expiring}` and the backend writes the bell rows. Only pairs still
stored as MATCH and still visible to the seeker get a bell; chunk rows of
one want add up; a failure leaves nothing behind but the attempt."""

from __future__ import annotations

import json
import uuid
from collections.abc import Collection, Sequence
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import ItemListingPreference, ItemVisibility
from app.notifications.models import Notification, NotificationKind
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry, OutboxStatus
from app.wants.application import bells_due
from app.wants.domain.status import WantStatus
from app.wants.models import Want
from tests.conftest import _Owner, _want, seed_want_matches
from tests.test_term_item_listings import _auth
from tests.test_term_item_listings import _register as _register_account
from tests.test_wants_visibility_parity import PRIVATE, _group, _member

Pair = tuple[uuid.UUID, uuid.UUID]


async def _stage(
    db: AsyncSession, pairs: Sequence[Pair], expiring: Collection[uuid.UUID] = ()
) -> uuid.UUID:
    """An outbox row inserted as the matcher service writes it: raw SQL,
    every NOT NULL column set, committed."""
    payload = {
        "pairs": [[str(want_id), str(item_id)] for want_id, item_id in pairs],
        "expiring": [str(want_id) for want_id in expiring],
    }
    entry_id = await db.scalar(
        text(
            "INSERT INTO outbox_entries "
            "(id, created_at, updated_at, event_type, payload, status, attempts) "
            "VALUES (gen_random_uuid(), timezone('UTC', clock_timestamp()), "
            "timezone('UTC', clock_timestamp()), :event_type, CAST(:payload AS jsonb), "
            "'PENDING', 0) RETURNING id"
        ),
        {"event_type": bells_due.EVENT_TYPE, "payload": json.dumps(payload)},
    )
    await db.commit()
    assert entry_id is not None
    return entry_id


async def _dispatch(db: AsyncSession) -> None:
    bells_due.register()
    await dispatch_pending(db, event_types=[bells_due.EVENT_TYPE])
    db.expire_all()


async def _run(
    db: AsyncSession, pairs: Sequence[Pair], expiring: Collection[uuid.UUID] = ()
) -> None:
    await _stage(db, pairs, expiring)
    await _dispatch(db)


async def _matched(db: AsyncSession, want_id: uuid.UUID, *item_ids: uuid.UUID) -> list[Pair]:
    """The pairs as the matcher's window run stores them: MATCH, unseen."""
    await seed_want_matches(db, want_id, item_ids, seen=False)
    return [(want_id, item_id) for item_id in item_ids]


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


async def _mark_read(db: AsyncSession, notification_id: uuid.UUID) -> None:
    await db.execute(
        update(Notification)
        .where(Notification.id == notification_id)
        .values(read_at=datetime.utcnow())
    )


async def _owner_party(db: AsyncSession, item_id: uuid.UUID) -> uuid.UUID:
    owner = await db.scalar(
        select(ItemListingPreference.owner_party_id).where(ItemListingPreference.item_id == item_id)
    )
    assert owner is not None
    return owner


async def test_scanWants_oneNewPair_namesTheItemAndLinksToItsPage_severalGiveTheCountAndTheWant(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wants.notif.texts.o@example.com")
    _, seeker = await _register_account(client, "GUEST", "wants.notif.texts.s@example.com")
    bike_want = await _want(db_session, seeker, "rower")
    sledge_want = await _want(db_session, seeker, "sanki")
    bike = await owner.lists("Rower miejski")
    wooden = await owner.lists("Sanki drewniane")
    plastic = await owner.lists("Sanki plastikowe")
    owner_party = await _owner_party(db_session, bike)
    pairs = await _matched(db_session, bike_want, bike)
    pairs += await _matched(db_session, sledge_want, wooden, plastic)

    await _run(db_session, pairs)

    single, several = await _bell_rows(db_session, seeker)
    assert {single.kind, several.kind} == {NotificationKind.WANT_MATCH_FOUND}
    assert single.message == "Szukasz: «rower». Ktoś wystawił: «Rower miejski»."
    assert single.link_path == f"/{owner_party}/product/{bike}"
    assert several.message == "Szukasz: «sanki». 2 nowe pasujące rzeczy."
    assert several.link_path == f"/wanted/{sledge_want}"
    assert await _pointer(db_session, bike_want) == (single.id, 1)
    assert await _pointer(db_session, sledge_want) == (several.id, 2)


async def test_scanWants_unreadRow_replacedWithTheSummedCount_readRowLeftAndNewRowCountsTheRun(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wants.notif.sum.o@example.com")
    _, unread_seeker = await _register_account(client, "GUEST", "wants.notif.sum.s1@example.com")
    _, read_seeker = await _register_account(client, "GUEST", "wants.notif.sum.s2@example.com")
    unread_want = await _want(db_session, unread_seeker, "rower")
    read_want = await _want(db_session, read_seeker, "rower")
    city = await owner.lists("Rower miejski")
    await _run(
        db_session,
        await _matched(db_session, unread_want, city) + await _matched(db_session, read_want, city),
    )
    (first_unread,) = await _bell_rows(db_session, unread_seeker)
    (first_read,) = await _bell_rows(db_session, read_seeker)
    await _mark_read(db_session, first_read.id)
    await db_session.commit()
    mountain = await owner.lists("Rower górski")

    await _run(
        db_session,
        await _matched(db_session, unread_want, mountain)
        + await _matched(db_session, read_want, mountain),
    )

    (summed,) = await _bell_rows(db_session, unread_seeker)
    assert summed.id != first_unread.id
    assert summed.read_at is None
    assert summed.message == "Szukasz: «rower». 2 nowe pasujące rzeczy."
    assert summed.link_path == f"/wanted/{unread_want}"
    assert await _pointer(db_session, unread_want) == (summed.id, 2)
    left, started = sorted(
        await _bell_rows(db_session, read_seeker), key=lambda row: row.read_at is None
    )
    assert left.id == first_read.id
    assert started.message == "Szukasz: «rower». Ktoś wystawił: «Rower górski»."
    assert await _pointer(db_session, read_want) == (started.id, 1)

    more = [
        await owner.lists("Rower szosowy"),
        await owner.lists("Rower składany"),
        await owner.lists("Rower dziecięcy"),
    ]
    await _run(db_session, await _matched(db_session, unread_want, *more))

    (five,) = await _bell_rows(db_session, unread_seeker)
    assert five.message == "Szukasz: «rower». 5 nowych pasujących rzeczy."
    assert await _pointer(db_session, unread_want) == (five.id, 5)


async def test_closeWithdrawnOrMatchingEdit_afterAScan_deletesTheUnreadMatchRowOnly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wants.notif.drop.o@example.com")
    token, seeker = await _register_account(client, "GUEST", "wants.notif.drop.s@example.com")
    soon = timedelta(days=3)
    withdrawn = await _want(db_session, seeker, "rower", expires_in=soon)
    edited = await _want(db_session, seeker, "sanki", expires_in=soon)
    read = await _want(db_session, seeker, "narty", expires_in=soon)
    pairs = await _matched(db_session, withdrawn, await owner.lists("Rower miejski"))
    pairs += await _matched(db_session, edited, await owner.lists("Sanki drewniane"))
    pairs += await _matched(db_session, read, await owner.lists("Narty biegowe"))
    await _run(db_session, pairs, expiring=[withdrawn, edited, read])
    read_row_id, _ = await _pointer(db_session, read)
    assert read_row_id is not None
    await _mark_read(db_session, read_row_id)
    await db_session.commit()
    assert len(await _bell_rows(db_session, seeker)) == 6

    responses = [
        await client.post(
            f"/api/wants/{withdrawn}/close", json={"outcome": "WITHDRAWN"}, headers=_auth(token)
        ),
        await client.patch(f"/api/wants/{edited}", json={"name": "sanie"}, headers=_auth(token)),
        await client.post(
            f"/api/wants/{read}/close", json={"outcome": "WITHDRAWN"}, headers=_auth(token)
        ),
    ]

    assert [response.status_code for response in responses] == [200, 200, 200]
    remaining = await _bell_rows(db_session, seeker)
    assert sorted((row.kind.value, row.id == read_row_id) for row in remaining) == [
        ("WANT_EXPIRING", False),
        ("WANT_EXPIRING", False),
        ("WANT_EXPIRING", False),
        ("WANT_MATCH_FOUND", True),
    ]
    pointers = (
        await db_session.execute(
            select(Want.match_notification_id, Want.match_notification_count).where(
                Want.seeker_party_id == seeker
            )
        )
    ).all()
    assert [tuple(row) for row in pointers] == [(None, 0)] * 3


async def test_bellsDue_suggestionAndDeletedPairs_skippedOnlyTheMatchCounts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wants.bells.tier.o@example.com")
    _, seeker = await _register_account(client, "GUEST", "wants.bells.tier.s@example.com")
    want = await _want(db_session, seeker, "rower miejski")
    matched = await owner.lists("Rower miejski")
    suggested = await owner.lists("Rower górski")
    deleted = await owner.lists("Rower miejski składany")
    await seed_want_matches(db_session, want, [suggested], missing_words=["miejski"], seen=False)

    await _run(
        db_session,
        await _matched(db_session, want, matched) + [(want, suggested), (want, deleted)],
    )

    (row,) = await _bell_rows(db_session, seeker)
    assert row.message == "Szukasz: «rower miejski». Ktoś wystawił: «Rower miejski»."
    assert await _pointer(db_session, want) == (row.id, 1)


async def test_bellsDue_ownerLeftTheSharedPrivateGroup_pairSkippedAndNoProductNameWritten(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wants.bells.private.o@example.com")
    _, seeker = await _register_account(client, "GUEST", "wants.bells.private.s@example.com")
    hidden_want = await _want(db_session, seeker, "sanki")
    shown_want = await _want(db_session, seeker, "rower")
    hidden = await owner.lists("Sanki tajne")
    shown = await owner.lists("Rower miejski")
    await db_session.execute(
        update(ItemListingPreference)
        .where(ItemListingPreference.item_id == hidden)
        .values(visibility=ItemVisibility.PRIVATE)
    )
    group = await _group(db_session, PRIVATE)
    await _member(db_session, await _owner_party(db_session, hidden), group, ended=True)
    await _member(db_session, seeker, group)
    await db_session.commit()

    await _run(
        db_session,
        await _matched(db_session, hidden_want, hidden)
        + await _matched(db_session, shown_want, shown),
    )

    (row,) = await _bell_rows(db_session, seeker)
    assert row.message == "Szukasz: «rower». Ktoś wystawił: «Rower miejski»."
    assert "Sanki tajne" not in row.message
    assert await _pointer(db_session, hidden_want) == (None, 0)


async def test_bellsDue_twoChunkRowsOfOneWant_sumIntoOneUnreadRow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wants.bells.chunks.o@example.com")
    _, seeker = await _register_account(client, "GUEST", "wants.bells.chunks.s@example.com")
    want = await _want(db_session, seeker, "rower")
    first, second, third = (
        await owner.lists("Rower miejski"),
        await owner.lists("Rower górski"),
        await owner.lists("Rower szosowy"),
    )
    await _stage(db_session, await _matched(db_session, want, first, second))
    await _stage(db_session, await _matched(db_session, want, third))

    await _dispatch(db_session)

    (row,) = await _bell_rows(db_session, seeker)
    assert row.read_at is None
    assert row.message == "Szukasz: «rower». 3 nowe pasujące rzeczy."
    assert await _pointer(db_session, want) == (row.id, 3)


async def test_bellsDue_expiringWants_onlyTheStillActiveOnesReminded(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, seeker = await _register_account(client, "GUEST", "wants.bells.expiring.s@example.com")
    active = await _want(db_session, seeker, "rower", expires_in=timedelta(days=3))
    muted = await _want(
        db_session, seeker, "sanki", expires_in=timedelta(days=3), notifications_enabled=False
    )
    withdrawn = await _want(db_session, seeker, "narty", status=WantStatus.WITHDRAWN)

    await _run(db_session, [], expiring=[active, muted, withdrawn])

    rows = await _bell_rows(db_session, seeker)
    assert {(row.kind, row.link_path) for row in rows} == {
        (NotificationKind.WANT_EXPIRING, f"/wanted/{active}"),
        (NotificationKind.WANT_EXPIRING, f"/wanted/{muted}"),
    }


async def test_bellsDue_emptyPayloadOrPurgedWant_processedWithoutBellRows(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wants.bells.empty.o@example.com")
    item_id = await owner.lists("Rower miejski")
    bells_before = await db_session.scalar(select(func.count()).select_from(Notification))
    empty = await _stage(db_session, [])
    purged = await _stage(db_session, [(uuid.uuid4(), item_id)], expiring=[uuid.uuid4()])

    await _dispatch(db_session)

    statuses = await db_session.execute(
        select(OutboxEntry.id, OutboxEntry.status).where(OutboxEntry.id.in_([empty, purged]))
    )
    assert dict(statuses.tuples().all()) == {
        empty: OutboxStatus.PROCESSED,
        purged: OutboxStatus.PROCESSED,
    }
    assert await db_session.scalar(select(func.count()).select_from(Notification)) == bells_before


async def test_bellsDue_writerFails_noPartialRowsAndTheAttemptCounted(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await _Owner.create(client, "wants.bells.fail.o@example.com")
    _, seeker = await _register_account(client, "GUEST", "wants.bells.fail.s@example.com")
    want = await _want(db_session, seeker, "rower", expires_in=timedelta(days=3))
    pairs = await _matched(db_session, want, await owner.lists("Rower miejski"))
    write_bell_rows = bells_due.write_bell_rows

    async def _write_then_fail(db: AsyncSession, **kwargs: Any) -> int:
        await write_bell_rows(db, **kwargs)
        raise RuntimeError("bell writer failed")

    monkeypatch.setattr(bells_due, "write_bell_rows", _write_then_fail)
    entry_id = await _stage(db_session, pairs, expiring=[want])

    await _dispatch(db_session)

    assert await _bell_rows(db_session, seeker) == []
    assert await _pointer(db_session, want) == (None, 0)
    entry = (
        await db_session.execute(
            select(OutboxEntry.status, OutboxEntry.attempts, OutboxEntry.last_error).where(
                OutboxEntry.id == entry_id
            )
        )
    ).one()
    assert tuple(entry) == (OutboxStatus.PENDING, 1, "bell writer failed")
