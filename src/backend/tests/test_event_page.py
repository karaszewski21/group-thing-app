"""`GET/PATCH/DELETE /api/events/{id}`: the public event page, author-only
editing, and deleting only while nobody is signed up."""

from __future__ import annotations

import io
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.events.models import Event, EventAttendance, EventBanner
from app.outbox.models import OutboxEntry
from app.storage.outbox_listener import OBJECTS_DELETE
from tests.fake_storage import FakeStorage

NOW = datetime(2026, 11, 2, 10, 30)
DETAIL_KEYS = {
    "id",
    "name",
    "description",
    "starts_at",
    "ends_at",
    "location",
    "created_at",
    "updated_at",
    "banner_url",
    "attendee_count",
    "is_author",
}


@pytest.fixture(autouse=True)
def _frozen(freeze_local_now: Callable[[datetime], None]) -> None:
    freeze_local_now(NOW)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return str(response.json()["token"])


async def _create_event(client: AsyncClient, token: str) -> str:
    response = await client.post(
        "/api/events",
        json={"name": "Piknik w parku", "starts_at": "2026-11-15T14:00:00"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (40, 30, 90)).save(buffer, "PNG")
    return buffer.getvalue()


async def _sign_up(db_session: AsyncSession, event_id: str, *, withdrawn: bool) -> None:
    event = await db_session.get(Event, uuid.UUID(event_id))
    assert event is not None
    db_session.add(
        EventAttendance(
            event_id=event.id,
            party_id=event.author_party_id,
            withdrawn_at=NOW if withdrawn else None,
        )
    )
    await db_session.commit()


async def test_getEvent_anonymousAndAuthor_returnsExactKeysAndAuthorFlag(
    client: AsyncClient, fake_storage: FakeStorage
) -> None:
    token = await _register(client, "page.get@example.com")
    other = await _register(client, "page.get.other@example.com")
    event_id = await _create_event(client, token)
    upload = await client.post(
        f"/api/events/{event_id}/banner",
        files={"file": ("b.png", _png(), "image/png")},
        headers=_auth(token),
    )
    assert upload.status_code == 200, upload.text

    anonymous = await client.get(f"/api/events/{event_id}")
    as_other = await client.get(f"/api/events/{event_id}", headers=_auth(other))
    as_author = await client.get(f"/api/events/{event_id}", headers=_auth(token))

    assert anonymous.status_code == 200, anonymous.text
    body = anonymous.json()
    assert set(body) == DETAIL_KEYS
    assert body["name"] == "Piknik w parku"
    assert body["banner_url"] == upload.json()["url"]
    assert body["attendee_count"] == 0
    assert body["is_author"] is False
    assert as_other.json()["is_author"] is False
    assert as_author.json()["is_author"] is True


async def test_getEvent_unknownId_returns404Polish(client: AsyncClient) -> None:
    response = await client.get(f"/api/events/{uuid.uuid4()}")

    assert response.status_code == 404
    assert response.json()["message"] == "Nie znaleziono wydarzenia."


async def test_updateEvent_author_changesSentFieldsOnly(client: AsyncClient) -> None:
    token = await _register(client, "page.update@example.com")
    event_id = await _create_event(client, token)

    response = await client.patch(
        f"/api/events/{event_id}",
        json={"name": "Piknik nad rzeką", "starts_at": "2026-11-16T15:00:00", "ends_at": None},
        headers=_auth(token),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Piknik nad rzeką"
    assert body["starts_at"] == "2026-11-16T15:00:00"
    assert body["description"] is None
    page = await client.get(f"/api/events/{event_id}")
    assert page.json()["name"] == "Piknik nad rzeką"


async def test_updateEvent_nonAuthorOrMissing_returns403Or404(client: AsyncClient) -> None:
    token = await _register(client, "page.update.owner@example.com")
    other = await _register(client, "page.update.other@example.com")
    event_id = await _create_event(client, token)

    foreign = await client.patch(
        f"/api/events/{event_id}", json={"name": "Cudzy piknik"}, headers=_auth(other)
    )
    missing = await client.patch(
        f"/api/events/{uuid.uuid4()}", json={"name": "Piknik"}, headers=_auth(token)
    )

    assert foreign.status_code == 403
    assert foreign.json()["message"] == "Możesz zmieniać tylko swoje wydarzenia."
    assert missing.status_code == 404


async def test_updateEvent_startedEvent_keepsStartButRejectsNewPastStart(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "page.update.past@example.com")
    event_id = await _create_event(client, token)
    past = NOW - timedelta(hours=2)
    await db_session.execute(
        update(Event)
        .where(Event.id == uuid.UUID(event_id))
        .values(starts_at=past.replace(second=0))
    )
    await db_session.commit()

    unchanged = await client.patch(
        f"/api/events/{event_id}",
        json={"name": "Piknik trwa", "starts_at": past.replace(second=0).isoformat()},
        headers=_auth(token),
    )
    moved = await client.patch(
        f"/api/events/{event_id}",
        json={"starts_at": (past - timedelta(days=1)).isoformat()},
        headers=_auth(token),
    )

    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()["name"] == "Piknik trwa"
    assert moved.status_code == 400
    assert moved.json()["message"] == "Początek nie może być w przeszłości."


async def test_deleteEvent_activeSignUp_returns409KeepsEvent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "page.delete.busy@example.com")
    event_id = await _create_event(client, token)
    await _sign_up(db_session, event_id, withdrawn=False)

    response = await client.delete(f"/api/events/{event_id}", headers=_auth(token))

    assert response.status_code == 409
    assert response.json()["message"] == "Nie można usunąć wydarzenia, na które ktoś się zapisał."
    page = await client.get(f"/api/events/{event_id}")
    assert page.status_code == 200
    assert page.json()["attendee_count"] == 1


async def test_deleteEvent_withdrawnSignUpAndBanner_returns204StagesBannerDelete(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage
) -> None:
    token = await _register(client, "page.delete.ok@example.com")
    event_id = await _create_event(client, token)
    upload = await client.post(
        f"/api/events/{event_id}/banner",
        files={"file": ("b.png", _png(), "image/png")},
        headers=_auth(token),
    )
    assert upload.status_code == 200, upload.text
    banner = (
        await db_session.execute(
            select(EventBanner).where(EventBanner.event_id == uuid.UUID(event_id))
        )
    ).scalar_one()
    keys = [banner.large_key, banner.thumb_key]
    await _sign_up(db_session, event_id, withdrawn=True)

    response = await client.delete(f"/api/events/{event_id}", headers=_auth(token))

    assert response.status_code == 204, response.text
    assert (await client.get(f"/api/events/{event_id}")).status_code == 404
    staged = (
        await db_session.execute(
            select(OutboxEntry.payload).where(OutboxEntry.event_type == OBJECTS_DELETE)
        )
    ).scalars()
    assert [payload["keys"] for payload in staged] == [keys]


async def test_deleteEvent_nonAuthor_returns403(client: AsyncClient) -> None:
    token = await _register(client, "page.delete.owner@example.com")
    other = await _register(client, "page.delete.other@example.com")
    event_id = await _create_event(client, token)

    response = await client.delete(f"/api/events/{event_id}", headers=_auth(other))

    assert response.status_code == 403
    assert (await client.get(f"/api/events/{event_id}")).status_code == 200
