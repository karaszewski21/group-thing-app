"""`/api/events`: one-off event creation with service-level Polish
validation, a required owned location, text moderation, the author's public
slug on every response, and the caller's own and attended event lists."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Generator
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import settings
from app.core import clock
from app.events.models import Event
from app.groups.domain.organizer_slug import derive_organizer_slug
from app.moderation import text_guard
from tests.conftest import count_queries, locality_ids

EVENT_KEYS = {
    "id",
    "name",
    "description",
    "starts_at",
    "ends_at",
    "location",
    "created_at",
    "updated_at",
    "author_slug",
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


async def _register(client: AsyncClient, email: str, role: str = "GUEST") -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": role, "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return str(response.json()["token"])


async def _create_location(client: AsyncClient, token: str) -> dict[str, Any]:
    response = await client.post(
        "/api/locations",
        json={
            "locality_id": (await locality_ids(client, _auth(token)))[0],
            "formatted_address": "al. Zieleniecka, 03-901 Warszawa",
            "source": "MANUAL",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _create_event(client: AsyncClient, token: str, **body: Any) -> Response:
    """Posts an event at a new place of the caller unless `location_id` is given."""
    if "location_id" not in body:
        body["location_id"] = (await _create_location(client, token))["id"]
    return await client.post("/api/events", json=body, headers=_auth(token))


async def _party_id(client: AsyncClient, token: str) -> str:
    response = await client.get("/api/people/me", headers=_auth(token))
    assert response.status_code == 200, response.text
    return str(response.json()["party_id"])


async def _create_organization(client: AsyncClient, token: str, name: str) -> str:
    response = await client.post(
        "/api/organizations/mine", json={"name": name}, headers=_auth(token)
    )
    assert response.status_code == 201, response.text
    return str(response.json()["slug"])


async def _seed_attendance(
    db_session: AsyncSession,
    event_id: str,
    party_id: str,
    withdrawn_at: datetime | None = None,
) -> None:
    """No sign-up endpoint exists yet, so attendances are seeded in SQL."""
    await db_session.execute(
        text(
            "INSERT INTO event_attendances (event_id, party_id, withdrawn_at, created_at, "
            "updated_at) VALUES (:event_id, :party_id, :withdrawn_at, now(), now())"
        ),
        {"event_id": event_id, "party_id": party_id, "withdrawn_at": withdrawn_at},
    )
    await db_session.commit()


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
    assert body["location"]["label"] == location["label"]
    assert body["location"]["formatted_address"] == "al. Zieleniecka, 03-901 Warszawa"
    assert set(body["location"]) == {
        "id",
        "locality",
        "label",
        "formatted_address",
        "google_place_id",
        "deleted_at",
    }
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


async def test_createEvent_withoutLocation_returns400NoEvent(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    token = await _register(client, "ev.noplace@example.com")
    body = {"name": "Piknik", "starts_at": "2026-11-15T14:00:00"}

    omitted = await client.post("/api/events", json=body, headers=_auth(token))
    explicit_null = await _create_event(client, token, **body, location_id=None)

    for response in (omitted, explicit_null):
        assert response.status_code == 400, response.text
        assert response.json()["message"] == "Wybierz miejsce wydarzenia."
    assert await _count_events(db_session) == 0


async def test_updateEvent_nullLocation_returns400KeepsPlace_otherFieldsStillEditable(
    client: AsyncClient, frozen: datetime
) -> None:
    token = await _register(client, "ev.patch.noplace@example.com")
    location = await _create_location(client, token)
    created = await _create_event(
        client, token, name="Piknik", starts_at="2026-11-15T14:00:00", location_id=location["id"]
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]

    rejected = await client.patch(
        f"/api/events/{event_id}", json={"location_id": None}, headers=_auth(token)
    )
    renamed = await client.patch(
        f"/api/events/{event_id}", json={"name": "Piknik 2"}, headers=_auth(token)
    )

    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["message"] == "Wybierz miejsce wydarzenia."
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["location"]["id"] == location["id"]


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


async def test_listMyEvents_ownOnly_returnsEarliestFirstExactKeys(
    client: AsyncClient, frozen: datetime
) -> None:
    token = await _register(client, "ev.mine@example.com")
    other = await _register(client, "ev.mine.other@example.com")
    location = await _create_location(client, token)
    later = (frozen + timedelta(days=9)).replace(hour=12, minute=0)
    sooner = (frozen + timedelta(days=2)).replace(hour=12, minute=0)
    later_response = await _create_event(client, token, name="Później", starts_at=_iso(later))
    await _create_event(
        client, token, name="Wcześniej", starts_at=_iso(sooner), location_id=location["id"]
    )
    await _create_event(client, other, name="Cudze", starts_at=_iso(sooner))

    response = await client.get("/api/events/mine", headers=_auth(token))

    assert response.status_code == 200, response.text
    body = response.json()
    assert [e["name"] for e in body] == ["Wcześniej", "Później"]
    assert all(set(e) == EVENT_KEYS for e in body)
    assert body[0]["location"]["id"] == location["id"]
    assert body[1]["location"]["id"] == later_response.json()["location"]["id"] != location["id"]


async def test_listMyEvents_manyEventsWithPlaces_queryCountDoesNotGrow(
    client: AsyncClient, engine: AsyncEngine, frozen: datetime
) -> None:
    token = await _register(client, "ev.mine.budget@example.com")
    starts_at = (frozen + timedelta(days=3)).replace(hour=12, minute=0)

    async def _statements() -> int:
        with count_queries(engine) as statements:
            response = await client.get("/api/events/mine", headers=_auth(token))
        assert response.status_code == 200
        return len(statements)

    location = await _create_location(client, token)
    await _create_event(
        client, token, name="Pierwsze", starts_at=_iso(starts_at), location_id=location["id"]
    )
    one = await _statements()
    for name in ("Drugie", "Trzecie", "Czwarte"):
        location = await _create_location(client, token)
        await _create_event(
            client, token, name=name, starts_at=_iso(starts_at), location_id=location["id"]
        )

    assert await _statements() == one


async def test_createEvent_authorOwnsOrganization_authorSlugIsOrgSlug(
    client: AsyncClient, frozen: datetime
) -> None:
    token = await _register(client, "ev.slug.org@example.com", role="ORGANIZER")
    slug = await _create_organization(client, token, "Fundacja Zielony Krąg")
    starts_at = (frozen + timedelta(days=4)).replace(hour=12, minute=0)

    created = await _create_event(client, token, name="Piknik", starts_at=_iso(starts_at))
    patched = await client.patch(
        f"/api/events/{created.json()['id']}", json={"name": "Piknik 2"}, headers=_auth(token)
    )

    assert created.status_code == 201, created.text
    assert set(created.json()) == EVENT_KEYS
    assert created.json()["author_slug"] == slug == "fundacja-zielony-krag"
    assert patched.status_code == 200, patched.text
    assert set(patched.json()) == EVENT_KEYS
    assert patched.json()["author_slug"] == slug


async def test_createEvent_authorWithoutOrganization_authorSlugMatchesTermOrganizerSlug(
    client: AsyncClient, frozen: datetime
) -> None:
    token = await _register(client, "ev.slug.party@example.com")
    party_id = uuid.UUID(await _party_id(client, token))
    starts_at = (frozen + timedelta(days=4)).replace(hour=12, minute=0)

    response = await _create_event(client, token, name="Piknik", starts_at=_iso(starts_at))
    mine = await client.get("/api/events/mine", headers=_auth(token))

    assert response.status_code == 201, response.text
    slug = response.json()["author_slug"]
    assert slug == str(party_id)
    assert slug == derive_organizer_slug(uuid.uuid4(), party_id, None)
    assert [e["author_slug"] for e in mine.json()] == [slug]


async def test_listAttending_onlyActiveAttendances_orderedByStartsAt(
    client: AsyncClient, db_session: AsyncSession, frozen: datetime
) -> None:
    author = await _register(client, "ev.att.author@example.com", role="ORGANIZER")
    slug = await _create_organization(client, author, "Muzyczne Skrzaty")
    caller = await _register(client, "ev.att.caller@example.com")
    caller_party = await _party_id(client, caller)
    location = await _create_location(client, author)
    day = (frozen + timedelta(days=5)).replace(hour=12, minute=0)

    async def _event(name: str, starts_at: datetime, **body: Any) -> str:
        response = await _create_event(client, author, name=name, starts_at=_iso(starts_at), **body)
        assert response.status_code == 201, response.text
        return str(response.json()["id"])

    later = await _event("Później", day + timedelta(days=3))
    sooner = await _event("Wcześniej", day, location_id=location["id"])
    withdrawn = await _event("Wypisane", day + timedelta(days=1))
    await _event("Bez zapisu", day + timedelta(days=2))
    await _seed_attendance(db_session, later, caller_party)
    await _seed_attendance(db_session, sooner, caller_party)
    await _seed_attendance(db_session, withdrawn, caller_party, withdrawn_at=datetime.utcnow())

    response = await client.get("/api/events/attending", headers=_auth(caller))
    anonymous = await client.get("/api/events/attending")

    assert response.status_code == 200, response.text
    body = response.json()
    assert [e["id"] for e in body] == [sooner, later]
    assert all(set(e) == EVENT_KEYS for e in body)
    assert all(e["author_slug"] == slug for e in body)
    assert body[0]["location"]["id"] == location["id"]
    assert body[1]["location"]["id"] != location["id"]
    assert anonymous.status_code == 401


async def test_listAttending_eventsByOneVsThreeAuthors_queryCountConstant(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine, frozen: datetime
) -> None:
    caller = await _register(client, "ev.att.budget@example.com")
    caller_party = await _party_id(client, caller)
    starts_at = (frozen + timedelta(days=3)).replace(hour=12, minute=0)

    async def _attend_event_by(token: str) -> None:
        location = await _create_location(client, token)
        response = await _create_event(
            client, token, name="Piknik", starts_at=_iso(starts_at), location_id=location["id"]
        )
        assert response.status_code == 201, response.text
        await _seed_attendance(db_session, response.json()["id"], caller_party)

    async def _statements() -> tuple[int, int]:
        with count_queries(engine) as statements:
            response = await client.get("/api/events/attending", headers=_auth(caller))
        assert response.status_code == 200, response.text
        return len(statements), len({e["author_slug"] for e in response.json()})

    first = await _register(client, "ev.att.budget.a1@example.com", role="ORGANIZER")
    await _create_organization(client, first, "Pierwsza Fundacja")
    await _attend_event_by(first)
    one, one_authors = await _statements()
    second = await _register(client, "ev.att.budget.a2@example.com", role="ORGANIZER")
    await _create_organization(client, second, "Druga Fundacja")
    await _attend_event_by(second)
    await _attend_event_by(await _register(client, "ev.att.budget.a3@example.com"))
    three, three_authors = await _statements()

    assert (one_authors, three_authors) == (1, 3)
    assert three == one
