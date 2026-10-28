"""`POST /api/events`: one-off event creation with service-level Polish
validation, owned-location check and text moderation."""

from __future__ import annotations

from collections.abc import Callable, Generator
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import clock
from app.events.models import Event
from app.moderation import text_guard

EVENT_KEYS = {
    "id",
    "name",
    "description",
    "starts_at",
    "ends_at",
    "location",
    "created_at",
    "updated_at",
}
NOW = datetime(2026, 11, 2, 10, 30, 45)


class _RejectingClassifier:
    model_id = "fake/bielik-guard"

    def scores(self, text: str) -> dict[str, float]:
        return {"SEX": 1.0}


class _FailingClassifier:
    model_id = "fake/bielik-guard"

    def scores(self, text: str) -> dict[str, float]:
        raise RuntimeError("model crashed")


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


async def _create_location(client: AsyncClient, token: str) -> dict[str, Any]:
    response = await client.post(
        "/api/locations",
        json={
            "name": "Park Skaryszewski",
            "formatted_address": "al. Zieleniecka, 03-901 Warszawa",
            "source": "MANUAL",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _create_event(client: AsyncClient, token: str, **body: Any) -> Response:
    return await client.post("/api/events", json=body, headers=_auth(token))


def _iso(value: datetime) -> str:
    return value.isoformat()


async def _count_events(db_session: AsyncSession) -> int:
    return (await db_session.execute(select(func.count()).select_from(Event))).scalar_one()


async def test_createEvent_validWithOwnLocation_returns201ExactKeys(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    token = await _register(client, "ev.valid@example.com")
    location = await _create_location(client, token)
    starts_at = (frozen + timedelta(days=13)).replace(hour=14, minute=0, second=37)

    response = await _create_event(
        client,
        token,
        name="  Piknik w parku  ",
        description="   ",
        starts_at=_iso(starts_at),
        ends_at=_iso(starts_at.replace(hour=18, second=59)),
        location_id=location["id"],
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == EVENT_KEYS
    assert body["name"] == "Piknik w parku"
    assert body["description"] is None
    assert body["starts_at"] == _iso(starts_at.replace(second=0))
    assert body["ends_at"] == _iso(starts_at.replace(hour=18, second=0))
    assert body["location"]["id"] == location["id"]
    assert body["location"]["name"] == "Park Skaryszewski"
    assert await _count_events(db_session) == 1


@pytest.mark.parametrize(
    ("starts_at", "message"),
    [
        (None, "Podaj datę i godzinę początku."),
        ("2026-11-20T14:00:00+01:00", "Podaj datę i godzinę bez strefy czasowej."),
    ],
)
async def test_createEvent_missingOrAwareStart_returns400(
    client: AsyncClient,
    db_session: AsyncSession,
    frozen: datetime,
    starts_at: str | None,
    message: str,
) -> None:
    token = await _register(client, "ev.start@example.com")
    body: dict[str, Any] = {"name": "Piknik"}
    if starts_at is not None:
        body["starts_at"] = starts_at

    response = await _create_event(client, token, **body)

    assert response.status_code == 400, response.text
    assert response.json()["message"] == message
    assert await _count_events(db_session) == 0


async def test_createEvent_startPastOrTooFar_returns400(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    token = await _register(client, "ev.range@example.com")
    current_minute = frozen.replace(second=0, microsecond=0)

    past = await _create_event(
        client, token, name="Piknik", starts_at=_iso(current_minute - timedelta(minutes=1))
    )
    too_far = await _create_event(
        client,
        token,
        name="Piknik",
        starts_at=_iso(frozen + timedelta(days=730, minutes=1)),
    )
    this_minute = await _create_event(client, token, name="Piknik", starts_at=_iso(current_minute))

    assert past.status_code == 400, past.text
    assert past.json()["message"] == "Początek nie może być w przeszłości."
    assert too_far.status_code == 400, too_far.text
    assert too_far.json()["message"] == "Początek może być najwyżej 2 lata od dziś."
    assert this_minute.status_code == 201, this_minute.text
    assert await _count_events(db_session) == 1


@pytest.mark.parametrize(
    ("ends_at", "message"),
    [
        ("2026-11-15T14:00:00", "Koniec musi być później niż początek."),
        ("2026-11-15T13:59:00", "Koniec musi być później niż początek."),
        ("2026-11-16T00:00:00", "Koniec musi przypadać tego samego dnia co początek."),
        ("2026-11-15T16:00:00+01:00", "Podaj datę i godzinę bez strefy czasowej."),
    ],
)
async def test_createEvent_endNotAfterStartOrOtherDay_returns400(
    client: AsyncClient,
    db_session: AsyncSession,
    frozen: datetime,
    ends_at: str,
    message: str,
) -> None:
    token = await _register(client, "ev.end@example.com")

    response = await _create_event(
        client, token, name="Piknik", starts_at="2026-11-15T14:00:00", ends_at=ends_at
    )

    assert response.status_code == 400, response.text
    assert response.json()["message"] == message
    assert await _count_events(db_session) == 0


async def test_createEvent_authorInBody_returns400NoEvent(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    token = await _register(client, "ev.extra@example.com")
    other_token = await _register(client, "ev.extra.other@example.com")
    other = await client.get("/api/people/me", headers=_auth(other_token))
    assert other.status_code == 200, other.text

    response = await _create_event(
        client,
        token,
        name="Piknik",
        starts_at="2026-11-15T14:00:00",
        author_party_id=other.json()["party_id"],
    )

    assert response.status_code == 400, response.text
    assert response.json()["message"] == "Validation failed"
    assert await _count_events(db_session) == 0


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"name": "   "}, "Podaj nazwę wydarzenia."),
        ({"name": "ab"}, "Nazwa musi mieć od 3 do 120 znaków."),
        ({"name": "x" * 121}, "Nazwa musi mieć od 3 do 120 znaków."),
        ({"description": "y" * 2001}, "Opis może mieć najwyżej 2000 znaków."),
    ],
)
async def test_createEvent_nameOrDescriptionOutOfBounds_returns400(
    client: AsyncClient,
    db_session: AsyncSession,
    frozen: datetime,
    overrides: dict[str, str],
    message: str,
) -> None:
    token = await _register(client, "ev.text@example.com")
    body = {"name": "Piknik", "starts_at": "2026-11-15T14:00:00", **overrides}

    response = await _create_event(client, token, **body)

    assert response.status_code == 400, response.text
    assert response.json()["message"] == message
    assert await _count_events(db_session) == 0


async def test_createEvent_foreignOrMissingLocation_returns403Or404(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    owner_token = await _register(client, "ev.loc.owner@example.com")
    other_token = await _register(client, "ev.loc.other@example.com")
    foreign = await _create_location(client, owner_token)
    deleted = await _create_location(client, other_token)
    removed = await client.delete(f"/api/locations/{deleted['id']}", headers=_auth(other_token))
    assert removed.status_code == 204, removed.text
    body = {"name": "Piknik", "starts_at": "2026-11-15T14:00:00"}

    forbidden = await _create_event(client, other_token, **body, location_id=foreign["id"])
    missing = await _create_event(client, other_token, **body, location_id=deleted["id"])

    assert forbidden.status_code == 403, forbidden.text
    assert forbidden.json()["message"] == "Access denied"
    assert missing.status_code == 404, missing.text
    assert await _count_events(db_session) == 0


@pytest.mark.usefixtures("_restore_classifier")
async def test_createEvent_rejectedText_returns400(
    client: AsyncClient,
    db_session: AsyncSession,
    frozen: datetime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = await _register(client, "ev.mod.reject@example.com")
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    text_guard.set_classifier(_RejectingClassifier())

    response = await _create_event(
        client, token, name="Piknik", starts_at="2026-11-15T14:00:00", description="Opis"
    )

    assert response.status_code == 400, response.text
    assert response.json()["message"] == (
        "Nazwa wydarzenia narusza zasady społeczności. Zmień ją i spróbuj ponownie."
    )
    assert text_guard.MESSAGES[text_guard.TextField.EVENT_DESCRIPTION] == (
        "Opis wydarzenia narusza zasady społeczności. Zmień go i spróbuj ponownie."
    )
    assert await _count_events(db_session) == 0


@pytest.mark.usefixtures("_restore_classifier")
async def test_createEvent_classifierUnavailable_returns503(
    client: AsyncClient,
    db_session: AsyncSession,
    frozen: datetime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = await _register(client, "ev.mod.down@example.com")
    monkeypatch.setattr(settings, "moderation_text_enabled", True)
    text_guard.set_classifier(_FailingClassifier())

    response = await _create_event(client, token, name="Piknik", starts_at="2026-11-15T14:00:00")

    assert response.status_code == 503, response.text
    assert response.json()["message"] == "Moderacja jest chwilowo niedostępna — spróbuj za chwilę."
    assert await _count_events(db_session) == 0
