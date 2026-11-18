"""Building blocks the wants module writes its bell rows with: the batch
insert writer and the delete-unread function of
`app.notifications.service`, the two want notification kinds, and the
classifier messages of the two want text fields. The bell rows themselves
are tested with their outbox handler in `test_wants_bells_due.py`."""

from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import settings
from app.core.errors import TextModerationRejected
from app.moderation import text_guard
from app.moderation.text_guard import TextField, check_text
from app.notifications import service as notifications_service
from app.notifications.models import Notification, NotificationKind
from app.notifications.service import NotificationEntry
from tests.conftest import count_queries
from tests.test_text_guard import FakeTextClassifier


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
