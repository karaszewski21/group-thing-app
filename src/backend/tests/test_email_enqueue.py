"""The bell hook of the email module: `create_notification` and
`create_notifications` stage one `email_messages` row per mailed bell in the
caller's transaction, with at most one extra statement per call."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import settings
from app.email.models import (
    EmailCategory,
    EmailMessage,
    EmailStatus,
    EmailStream,
    EmailTemplate,
)
from app.notifications import service as notifications_service
from app.notifications.models import Notification, NotificationKind
from app.notifications.service import NotificationEntry
from app.wants.application import match_notifications
from tests.conftest import _Owner, _want, count_queries, seed_want_matches
from tests.test_term_item_listings import _register as _register_account


@pytest.fixture
def _email_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "email_enabled", True)
    monkeypatch.setattr(settings, "email_notifications_enabled", True)


async def _register(client: AsyncClient, email: str) -> uuid.UUID:
    response = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": "secret123"}
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(str(response.json()["party_id"]))


async def _mails(db: AsyncSession, party_id: uuid.UUID) -> list[EmailMessage]:
    """Notification rows only: registration also queues a transactional verify-email row."""
    result = await db.execute(
        select(EmailMessage)
        .where(
            EmailMessage.party_id == party_id,
            EmailMessage.stream == EmailStream.NOTIFICATION,
        )
        .order_by(EmailMessage.idempotency_key)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


def _match_entry(party_id: uuid.UUID, want_id: uuid.UUID, message: str) -> NotificationEntry:
    return NotificationEntry(
        party_id=party_id,
        kind=NotificationKind.WANT_MATCH_FOUND,
        message=message,
        link_path=f"/wanted/{want_id}",
        topic_id=want_id,
    )


@pytest.mark.usefixtures("_email_on")
async def test_createNotification_mvpKind_onePendingRow_otherKindNone(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    party_id = await _register(client, "email.enqueue.single@example.com")

    await notifications_service.create_notification(
        db_session,
        party_id=party_id,
        kind=NotificationKind.SWAP_ACCEPTED,
        message="Twoja propozycja została przyjęta",
        link_path="/swaps/1",
    )
    await notifications_service.create_notification(
        db_session,
        party_id=party_id,
        kind=NotificationKind.PLEDGE_CREATED,
        message="Nowa deklaracja",
    )
    await db_session.commit()

    bell = await db_session.scalar(
        select(Notification).where(
            Notification.party_id == party_id,
            Notification.kind == NotificationKind.SWAP_ACCEPTED,
        )
    )
    assert bell is not None
    (mail,) = await _mails(db_session, party_id)
    assert mail.idempotency_key == f"notification:{bell.id}"
    assert mail.notification_id == bell.id
    assert mail.notification_kind == "SWAP_ACCEPTED"
    assert mail.stream == EmailStream.NOTIFICATION
    assert mail.category == EmailCategory.RESERVATIONS
    assert mail.template == EmailTemplate.NOTIFICATION
    assert mail.status == EmailStatus.PENDING
    assert mail.payload == {"message": "Twoja propozycja została przyjęta", "link_path": "/swaps/1"}
    assert mail.attempts == 0
    assert mail.expires_at - mail.send_after == timedelta(hours=24)


@pytest.mark.parametrize("flag", ["email_enabled", "email_notifications_enabled"])
@pytest.mark.usefixtures("_email_on")
async def test_enqueue_eitherFlagOff_noRowAndNoStatement(
    client: AsyncClient,
    db_session: AsyncSession,
    engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    flag: str,
) -> None:
    party_id = await _register(client, f"email.enqueue.flag.{flag}@example.com")
    monkeypatch.setattr(settings, flag, False)

    with count_queries(engine) as statements:
        await notifications_service.create_notifications(
            db_session, [_match_entry(party_id, uuid.uuid4(), "1 nowa rzecz")]
        )
    await notifications_service.create_notification(
        db_session,
        party_id=party_id,
        kind=NotificationKind.TERM_CONFIRMATION_NEEDED,
        message="Potwierdź",
        reservation_id=uuid.uuid4(),
    )
    await db_session.commit()

    assert [statement.split()[0] for statement in statements] == ["INSERT"]
    assert await _mails(db_session, party_id) == []


@pytest.mark.usefixtures("_email_on")
async def test_createNotifications_sameWantSameDay_oneRow_from22hTheNextDay(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    party_id = await _register(client, "email.enqueue.match@example.com")
    want_id = uuid.uuid4()

    freeze_local_now(datetime(2026, 11, 27, 9, 0))
    for count in range(3):
        await notifications_service.create_notifications(
            db_session, [_match_entry(party_id, want_id, f"{count + 1} nowe rzeczy")]
        )
        await db_session.commit()
    freeze_local_now(datetime(2026, 11, 27, 23, 0))
    await notifications_service.create_notifications(
        db_session, [_match_entry(party_id, want_id, "4 nowe rzeczy")]
    )
    await db_session.commit()

    mails = await _mails(db_session, party_id)
    assert [mail.idempotency_key for mail in mails] == [
        f"want_match:{want_id}:2026-11-27",
        f"want_match:{want_id}:2026-11-28",
    ]
    assert mails[0].payload["message"] == "1 nowe rzeczy"
    assert {mail.category for mail in mails} == {EmailCategory.WANTS}


@pytest.mark.usefixtures("_email_on")
async def test_createNotification_retriedTermConfirmation_noSecondRowAndNoError(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    party_id = await _register(client, "email.enqueue.confirm@example.com")
    reservation_id = uuid.uuid4()
    proposal_id = uuid.uuid4()

    for _ in range(2):
        await notifications_service.create_notification(
            db_session,
            party_id=party_id,
            kind=NotificationKind.TERM_CONFIRMATION_NEEDED,
            message="Potwierdź przekazanie",
            reservation_id=reservation_id,
        )
        await db_session.commit()
    await notifications_service.create_notification(
        db_session,
        party_id=party_id,
        kind=NotificationKind.TERM_CONFIRMATION_NEEDED,
        message="Potwierdź wymianę",
        proposal_id=proposal_id,
        reservation_id=reservation_id,
    )
    await db_session.commit()

    keys = sorted(mail.idempotency_key for mail in await _mails(db_session, party_id))
    assert keys == sorted(
        [
            f"term_confirmation:{reservation_id}:{party_id}",
            f"term_confirmation:{proposal_id}:{party_id}",
        ]
    )


@pytest.mark.usefixtures("_email_on")
async def test_createNotifications_batch_oneExtraInsert_emptyOrUnmailedInputNone(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    party_id = await _register(client, "email.enqueue.budget@example.com")
    expiring = NotificationEntry(
        party_id=party_id,
        kind=NotificationKind.WANT_EXPIRING,
        message="Poszukiwanie wygasa",
        link_path=None,
    )

    with count_queries(engine) as mailed:
        await notifications_service.create_notifications(
            db_session,
            [
                _match_entry(party_id, uuid.uuid4(), "a"),
                _match_entry(party_id, uuid.uuid4(), "b"),
                expiring,
            ],
        )
    with count_queries(engine) as unmailed:
        await notifications_service.create_notifications(db_session, [expiring])
    with count_queries(engine) as empty:
        await notifications_service.create_notifications(db_session, [])

    assert [statement.split()[0] for statement in mailed] == ["INSERT", "INSERT"]
    assert [statement.split()[0] for statement in unmailed] == ["INSERT"]
    assert empty == []
    assert len(await _mails(db_session, party_id)) == 2


@pytest.mark.usefixtures("_email_on")
async def test_createNotification_rolledBack_dropsTheBellAndTheMail(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    party_id = await _register(client, "email.enqueue.rollback@example.com")

    await notifications_service.create_notification(
        db_session,
        party_id=party_id,
        kind=NotificationKind.SWAP_PROPOSED,
        message="Ktoś proponuje wymianę",
    )
    await notifications_service.create_notification(
        db_session,
        party_id=party_id,
        kind=NotificationKind.TERM_CONFIRMATION_NEEDED,
        message="Potwierdź",
        reservation_id=uuid.uuid4(),
    )
    await db_session.rollback()

    bells = await db_session.scalars(select(Notification).where(Notification.party_id == party_id))
    assert list(bells) == []
    assert await _mails(db_session, party_id) == []


@pytest.mark.usefixtures("_email_on")
async def test_writeBellRows_matchMailKeyedByTheWant_expiringNotMailed(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    owner = await _Owner.create(client, "email.enqueue.bells.o@example.com")
    _, seeker = await _register_account(client, "GUEST", "email.enqueue.bells.s@example.com")
    seeker_id = seeker
    want_id = await _want(db_session, seeker_id, "rower")
    expiring_want = await _want(db_session, seeker_id, "sanki")
    item_id = await owner.lists("Rower miejski")
    await seed_want_matches(db_session, want_id, [item_id], seen=False)
    freeze_local_now(datetime(2026, 11, 27, 12, 0))

    written = await match_notifications.write_bell_rows(
        db_session,
        pairs=[(want_id, item_id)],
        expiring=[match_notifications.ExpiringWant(expiring_want, seeker_id, "sanki")],
        now=datetime.utcnow(),
    )
    await db_session.commit()

    assert written == 2
    (mail,) = await _mails(db_session, seeker_id)
    assert mail.idempotency_key == f"want_match:{want_id}:2026-11-27"
    assert mail.notification_kind == "WANT_MATCH_FOUND"
