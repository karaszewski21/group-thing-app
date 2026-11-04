"""`/api/events/{id}/attendances`: idempotent sign-up for logged-in callers
and guests (name only, moderated), 409 for the author and ended events, and
idempotent logged-in-only withdraw."""

from __future__ import annotations

from collections.abc import Callable, Generator
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import settings
from app.core import clock
from app.events import service as event_service
from app.moderation import text_guard
from tests.conftest import count_queries, create_location

ATTENDANCE_KEYS = {"id", "event_id", "user_profile_id", "attached_to_account"}
NOW = datetime(2026, 11, 2, 10, 30)


class _RejectingClassifier:
    model_id = "fake/bielik-guard"

    def scores(self, text: str) -> dict[str, float]:
        return {"SEX": 1.0}


@pytest.fixture
def _restore_classifier() -> Generator[None, None, None]:
    yield
    text_guard.set_classifier(None)


@pytest.fixture
def frozen(freeze_local_now: Callable[[datetime], None]) -> datetime:
    freeze_local_now(NOW)
    return clock.local_now()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return str(response.json()["token"])


async def _create_event(client: AsyncClient, token: str, starts_at: datetime) -> str:
    response = await client.post(
        "/api/events",
        json={
            "location_id": await create_location(client, _auth(token)),
            "name": "Wymiana ubranek",
            "starts_at": starts_at.isoformat(),
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _sign_up(
    client: AsyncClient, event_id: str, token: str | None = None, guest_name: str | None = None
) -> tuple[int, dict[str, object]]:
    body = {} if guest_name is None else {"guest_name": guest_name}
    response = await client.post(
        f"/api/events/{event_id}/attendances",
        json=body,
        headers=_auth(token) if token else {},
    )
    return response.status_code, dict(response.json())


async def test_signUp_loggedInTwice_returns201SameAttendance(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    author = await _register(client, "att.author1@example.com")
    attendee = await _register(client, "att.user1@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))

    first_status, first = await _sign_up(client, event_id, attendee, guest_name="ignored")
    second_status, second = await _sign_up(client, event_id, attendee)

    assert (first_status, second_status) == (201, 201)
    assert set(first) == ATTENDANCE_KEYS
    assert first == second
    assert first["event_id"] == event_id
    assert first["attached_to_account"] is True
    active = (
        await db_session.execute(
            text("SELECT count(*) FROM event_attendances WHERE event_id = :id"),
            {"id": event_id},
        )
    ).scalar_one()
    assert active == 1


async def test_signUp_guestName_createsUnattachedProfile_blankNameReturns400(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    author = await _register(client, "att.author2@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))

    blank_status, blank = await _sign_up(client, event_id, guest_name="   ")
    missing_status, _ = await _sign_up(client, event_id)
    long_status, long = await _sign_up(client, event_id, guest_name="a" * 256)
    status, body = await _sign_up(client, event_id, guest_name="  Ania  ")

    assert (blank_status, missing_status, long_status) == (400, 400, 400)
    assert "Podaj swoje imię." in str(blank)
    assert "Imię może mieć najwyżej 255 znaków." in str(long)
    assert status == 201
    assert set(body) == ATTENDANCE_KEYS
    assert body["attached_to_account"] is False
    profile = (
        await db_session.execute(
            text(
                "SELECT p.display_name, p.account_user_id, "
                "(SELECT count(*) FROM event_attendances a "
                " WHERE a.party_id = p.party_id AND a.withdrawn_at IS NULL) "
                "FROM user_profiles p WHERE p.id = :id"
            ),
            {"id": body["user_profile_id"]},
        )
    ).one()
    assert tuple(profile) == ("Ania", None, 1)


async def test_signUp_afterEventEnded_returns409(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    freeze_local_now(NOW)
    author = await _register(client, "att.author3@example.com")
    attendee = await _register(client, "att.user3@example.com")
    starts_at = NOW + timedelta(days=1)
    event_id = await _create_event(client, author, starts_at)

    freeze_local_now(starts_at)
    logged_in_status, logged_in = await _sign_up(client, event_id, attendee)
    guest_status, _ = await _sign_up(client, event_id, guest_name="Ania")

    assert (logged_in_status, guest_status) == (409, 409)
    assert "Wydarzenie się zakończyło." in str(logged_in)


async def test_signUp_asAuthor_returns409(client: AsyncClient, frozen: datetime) -> None:
    author = await _register(client, "att.author4@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))

    status, body = await _sign_up(client, event_id, author)

    assert status == 409
    assert "Organizator nie zapisuje się na własne wydarzenie." in str(body)


async def test_withdraw_twice_returns204_thenSignUpAgainSucceeds(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    author = await _register(client, "att.author5@example.com")
    attendee = await _register(client, "att.user5@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))
    _, first = await _sign_up(client, event_id, attendee)

    url = f"/api/events/{event_id}/attendances/withdraw"
    withdrawn = await client.post(url, headers=_auth(attendee))
    again = await client.post(url, headers=_auth(attendee))
    unknown = await client.post(
        "/api/events/00000000-0000-0000-0000-000000000000/attendances/withdraw",
        headers=_auth(attendee),
    )
    status, second = await _sign_up(client, event_id, attendee)

    assert (withdrawn.status_code, again.status_code, unknown.status_code) == (204, 204, 404)
    assert status == 201
    assert second["id"] != first["id"]
    rows = (
        await db_session.execute(
            text(
                "SELECT count(*) FILTER (WHERE withdrawn_at IS NULL), "
                "count(*) FILTER (WHERE withdrawn_at IS NOT NULL) "
                "FROM event_attendances WHERE event_id = :id"
            ),
            {"id": event_id},
        )
    ).one()
    assert tuple(rows) == (1, 1)


async def test_withdraw_withoutToken_returns401(client: AsyncClient, frozen: datetime) -> None:
    author = await _register(client, "att.author6@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))

    response = await client.post(f"/api/events/{event_id}/attendances/withdraw")

    assert response.status_code == 401


@pytest.mark.usefixtures("_restore_classifier")
async def test_signUp_guestNameRejectedByModeration_returns400NoGuestCreated(
    client: AsyncClient,
    db_session: AsyncSession,
    frozen: datetime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    author = await _register(client, "att.author7@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    text_guard.set_classifier(_RejectingClassifier())

    status, body = await _sign_up(client, event_id, guest_name="Brzydkie imię")

    assert status == 400
    assert body["message"] == text_guard.MESSAGES[text_guard.TextField.PROFILE_NAME]
    counts = (
        await db_session.execute(
            text(
                "SELECT (SELECT count(*) FROM event_attendances WHERE event_id = :id), "
                "(SELECT count(*) FROM user_profiles WHERE display_name = 'Brzydkie imię')"
            ),
            {"id": event_id},
        )
    ).one()
    assert tuple(counts) == (0, 0)


async def test_signUp_unknownOrDeletedEvent_returns404(
    client: AsyncClient, frozen: datetime
) -> None:
    author = await _register(client, "att.author8@example.com")
    attendee = await _register(client, "att.user8@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))
    deleted = await client.delete(f"/api/events/{event_id}", headers=_auth(author))
    assert deleted.status_code == 204, deleted.text

    unknown_status, _ = await _sign_up(
        client, "00000000-0000-0000-0000-000000000000", guest_name="Ania"
    )
    logged_in_status, _ = await _sign_up(client, event_id, attendee)
    guest_status, _ = await _sign_up(client, event_id, guest_name="Ania")

    assert (unknown_status, logged_in_status, guest_status) == (404, 404, 404)


async def test_signUp_invalidToken_takesGuestBranchWithout401(
    client: AsyncClient, frozen: datetime
) -> None:
    author = await _register(client, "att.author9@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))

    nameless_status, nameless = await _sign_up(client, event_id, "not-a-jwt")
    status, body = await _sign_up(client, event_id, "not-a-jwt", guest_name="Ola")

    assert nameless_status == 400
    assert "Podaj swoje imię." in str(nameless)
    assert status == 201
    assert body["attached_to_account"] is False


async def test_signUp_guest_moderatesNameBeforeLockingEvent(
    client: AsyncClient,
    engine: AsyncEngine,
    frozen: datetime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    author = await _register(client, "att.author10@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))

    with count_queries(engine) as statements:

        async def _record_check(field: text_guard.TextField, value: str | None) -> None:
            statements.append("CHECK_TEXT")

        monkeypatch.setattr(event_service, "check_text", _record_check)
        status, _ = await _sign_up(client, event_id, guest_name="Ania")

    assert status == 201
    lock = next(i for i, sql in enumerate(statements) if "FOR SHARE" in sql.upper())
    assert statements.index("CHECK_TEXT") < lock
