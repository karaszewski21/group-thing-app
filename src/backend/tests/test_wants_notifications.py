"""Building blocks the wants module writes its bell rows with: the batch
insert writer and the delete-unread function of
`app.notifications.service`, the two want notification kinds, and the
classifier messages of the two want text fields. Then the bell rows of the
wants scan: their texts and links, the one unread match row per want, and
what a withdrawal or an edit removes."""

from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import settings
from app.core.errors import TextModerationRejected
from app.groups.models import ItemListingPreference
from app.moderation import text_guard
from app.moderation.text_guard import TextField, check_text
from app.notifications import service as notifications_service
from app.notifications.models import Notification, NotificationKind
from app.notifications.service import NotificationEntry
from app.wants.models import Want
from tests.conftest import count_queries
from tests.test_term_item_listings import _auth
from tests.test_term_item_listings import _register as _register_account
from tests.test_text_guard import FakeTextClassifier
from tests.test_wants_matcher import _Owner, _want
from tests.test_wants_scan import _bell_rows, _pointer, _scan


@pytest.fixture
def _text_moderation_on(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    yield
    text_guard.set_classifier(None)


async def _register(client: AsyncClient, email: str) -> uuid.UUID:
    response = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": "secret123"}
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(str(response.json()["party_id"]))


def _entry(party_id: uuid.UUID, message: str) -> NotificationEntry:
    return NotificationEntry(
        party_id=party_id,
        kind=NotificationKind.WANT_MATCH_FOUND,
        message=message,
        link_path="/wanted/1",
    )


async def _rows(db_session: AsyncSession, party_id: uuid.UUID) -> list[Notification]:
    result = await db_session.execute(
        select(Notification)
        .where(Notification.party_id == party_id)
        .order_by(Notification.message)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


async def _mark_read(db_session: AsyncSession, notification_id: uuid.UUID) -> None:
    await db_session.execute(
        update(Notification)
        .where(Notification.id == notification_id)
        .values(read_at=datetime.utcnow())
    )


async def test_createNotifications_severalEntries_distinctIdsInEntryOrderInOneStatement(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    first_party = await _register(client, "wants.notif.batch.a@example.com")
    second_party = await _register(client, "wants.notif.batch.b@example.com")

    with count_queries(engine) as statements:
        written = await notifications_service.create_notifications(
            db_session,
            [
                _entry(first_party, "2 nowe pasujące rzeczy"),
                _entry(second_party, "Ktoś oddaje: Kask"),
                NotificationEntry(
                    party_id=second_party,
                    kind=NotificationKind.WANT_EXPIRING,
                    message="Poszukiwanie wygasa",
                    link_path=None,
                ),
            ],
        )

    assert [statement.split()[0] for statement in statements] == ["INSERT"]
    assert len(set(written)) == 3

    first_rows = await _rows(db_session, first_party)
    second_rows = await _rows(db_session, second_party)
    assert [(row.id, row.message) for row in first_rows] == [(written[0], "2 nowe pasujące rzeczy")]
    assert [(row.id, row.kind, row.link_path) for row in second_rows] == [
        (written[1], NotificationKind.WANT_MATCH_FOUND, "/wanted/1"),
        (written[2], NotificationKind.WANT_EXPIRING, None),
    ]
    for row in first_rows + second_rows:
        assert row.read_at is None
        assert row.created_at is not None
        assert row.updated_at is not None


async def test_createNotifications_noEntries_runsNoStatement(
    db_session: AsyncSession, engine: AsyncEngine
) -> None:
    with count_queries(engine) as statements:
        written = await notifications_service.create_notifications(db_session, [])

    assert written == []
    assert statements == []


async def test_deleteUnreadNotifications_mixedRows_deletesUnreadOnlyInOneStatement(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    party_id = await _register(client, "wants.notif.delete@example.com")
    unread, read, kept = await notifications_service.create_notifications(
        db_session,
        [_entry(party_id, "a usuwane"), _entry(party_id, "b przeczytane"), _entry(party_id, "c")],
    )
    await _mark_read(db_session, read)

    with count_queries(engine) as statements:
        deleted = await notifications_service.delete_unread_notifications(
            db_session, [unread, read, uuid.uuid4()]
        )

    assert [statement.split()[0] for statement in statements] == ["DELETE"]
    assert deleted == {unread}
    assert [row.id for row in await _rows(db_session, party_id)] == [read, kept]


@pytest.mark.parametrize(
    ("field", "message"),
    [
        (
            TextField.WANT_NAME,
            "Nazwa poszukiwania narusza zasady społeczności. Zmień ją i spróbuj ponownie.",
        ),
        (
            TextField.WANT_NOTE,
            "Notatka narusza zasady społeczności. Zmień ją i spróbuj ponownie.",
        ),
    ],
)
async def test_checkText_wantFieldRejected_raisesFixedMessage(
    _text_moderation_on: None, field: TextField, message: str
) -> None:
    text_guard.set_classifier(FakeTextClassifier(sex=settings.moderation_text_reject_threshold))

    with pytest.raises(TextModerationRejected) as raised:
        await check_text(field, "coś niestosownego")

    assert str(raised.value) == message


async def test_scanWants_oneNewPair_namesTheItemAndLinksToItsPage_severalGiveTheCountAndTheWant(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wants.notif.texts.o@example.com")
    _, seeker = await _register_account(client, "GUEST", "wants.notif.texts.s@example.com")
    bike_want = await _want(db_session, seeker, "rower")
    sledge_want = await _want(db_session, seeker, "sanki")
    bike = await owner.lists("Rower miejski")
    await owner.lists("Sanki drewniane")
    await owner.lists("Sanki plastikowe")
    owner_party = await db_session.scalar(
        select(ItemListingPreference.owner_party_id).where(ItemListingPreference.item_id == bike)
    )

    await _scan(db_session, datetime.utcnow())

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
    await owner.lists("Rower miejski")
    await _scan(db_session, datetime.utcnow())
    (first_unread,) = await _bell_rows(db_session, unread_seeker)
    (first_read,) = await _bell_rows(db_session, read_seeker)
    await _mark_read(db_session, first_read.id)
    await db_session.commit()
    await owner.lists("Rower górski")

    await _scan(db_session, datetime.utcnow())

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

    await owner.lists("Rower szosowy")
    await owner.lists("Rower składany")
    await owner.lists("Rower dziecięcy")
    await _scan(db_session, datetime.utcnow())

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
    await owner.lists("Rower miejski")
    await owner.lists("Sanki drewniane")
    await owner.lists("Narty biegowe")
    await _scan(db_session, datetime.utcnow())
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
