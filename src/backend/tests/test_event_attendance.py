"""`/api/events/{id}/attendances`: idempotent sign-up for account holders
only (401 without a valid token, nothing created), 409 for the author and
ended events, and idempotent withdraw."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from tests.conftest import create_location

ATTENDANCE_KEYS = {"id", "event_id", "user_profile_id"}
NOW = datetime(2026, 11, 2, 10, 30)


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
    client: AsyncClient, event_id: str, token: str | None = None
) -> tuple[int, dict[str, object]]:
    response = await client.post(
        f"/api/events/{event_id}/attendances",
        headers=_auth(token) if token else {},
    )
    return response.status_code, dict(response.json())


async def test_signUp_loggedInTwice_returns201SameAttendance(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    author = await _register(client, "att.author1@example.com")
    attendee = await _register(client, "att.user1@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))

    first_status, first = await _sign_up(client, event_id, attendee)
    second_status, second = await _sign_up(client, event_id, attendee)

    assert (first_status, second_status) == (201, 201)
    assert set(first) == ATTENDANCE_KEYS
    assert first == second
    assert first["event_id"] == event_id
    active = (
        await db_session.execute(
            text("SELECT count(*) FROM event_attendances WHERE event_id = :id"),
            {"id": event_id},
        )
    ).scalar_one()
    assert active == 1


async def test_signUp_withoutOrInvalidToken_returns401AndCreatesNothing(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    author = await _register(client, "att.author2@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))
    profiles_before = (
        await db_session.execute(text("SELECT count(*) FROM user_profiles"))
    ).scalar_one()

    anonymous_status, _ = await _sign_up(client, event_id)
    invalid_status, _ = await _sign_up(client, event_id, "not-a-jwt")
    legacy = await client.post(
        f"/api/events/{event_id}/attendances", json={"guest_name": "Ania"}
    )

    assert (anonymous_status, invalid_status, legacy.status_code) == (401, 401, 401)
    counts = (
        await db_session.execute(
            text(
                "SELECT (SELECT count(*) FROM event_attendances WHERE event_id = :id), "
                "(SELECT count(*) FROM user_profiles)"
            ),
            {"id": event_id},
        )
    ).one()
    assert tuple(counts) == (0, profiles_before)


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

    assert logged_in_status == 409
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


async def test_signUp_unknownOrDeletedEvent_returns404(
    client: AsyncClient, frozen: datetime
) -> None:
    author = await _register(client, "att.author8@example.com")
    attendee = await _register(client, "att.user8@example.com")
    event_id = await _create_event(client, author, frozen + timedelta(days=3))
    deleted = await client.delete(f"/api/events/{event_id}", headers=_auth(author))
    assert deleted.status_code == 204, deleted.text

    unknown_status, _ = await _sign_up(client, "00000000-0000-0000-0000-000000000000", attendee)
    deleted_status, _ = await _sign_up(client, event_id, attendee)

    assert (unknown_status, deleted_status) == (404, 404)
