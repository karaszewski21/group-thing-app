"""`GET/PATCH/DELETE /api/events/{id}`: the public event page (participants
with their listed items, per-viewer flags, constant query count),
author-only editing, and deleting only while nobody is signed up."""

from __future__ import annotations

import io
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.circulation.models import BalanceStatus
from app.events.models import Event, EventAttendance, EventBanner
from app.groups.models import ItemListingPreference
from app.moderation.status import ModerationStatus
from app.outbox.models import OutboxEntry
from app.storage.outbox_listener import OBJECTS_DELETE
from tests.conftest import count_queries
from tests.fake_storage import FakeStorage
from tests.test_organizer_bridges import _item, _photo, _set_balance, _uploader_id
from tests.test_organizer_page import _listed_items

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
    "author_slug",
    "banner_url",
    "attendee_count",
    "is_author",
    "author_display_name",
    "organization",
    "participants",
    "is_attending",
    "has_ended",
    "open_reservations",
}
ORGANIZATION_KEYS = {"name", "primary_color", "accent_color", "palette_preset"}
PARTICIPANT_KEYS = {"party_id", "display_name", "is_author", "is_me", "items", "items_total"}
ITEM_KEYS = {"item_id", "product_name", "mode", "thumb_url", "added_at", "reservation"}


@pytest.fixture(autouse=True)
def _frozen(freeze_local_now: Callable[[datetime], None]) -> None:
    freeze_local_now(NOW)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str) -> str:
    token, _ = await _register_with_party(client, email)
    return token


async def _register_with_party(
    client: AsyncClient, email: str, role: str = "GUEST"
) -> tuple[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": role, "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return str(response.json()["token"]), str(response.json()["party_id"])


async def _create_event(client: AsyncClient, token: str) -> str:
    response = await client.post(
        "/api/events",
        json={"name": "Piknik w parku", "starts_at": "2026-11-15T14:00:00"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _attend(client: AsyncClient, event_id: str, token: str) -> None:
    response = await client.post(
        f"/api/events/{event_id}/attendances", json={}, headers=_auth(token)
    )
    assert response.status_code == 201, response.text


async def _page(client: AsyncClient, event_id: str, token: str | None = None) -> dict[str, Any]:
    """The detail payload, with its exact key sets checked at every level."""
    response = await client.get(f"/api/events/{event_id}", headers=_auth(token) if token else None)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert set(body) == DETAIL_KEYS
    for participant in body["participants"]:
        assert set(participant) == PARTICIPANT_KEYS
        for item in participant["items"]:
            assert set(item) == ITEM_KEYS
    return body


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (40, 30, 90)).save(buffer, "PNG")
    return buffer.getvalue()


async def _sign_up(
    client: AsyncClient, db_session: AsyncSession, event_id: str, *, withdrawn: bool
) -> None:
    """A guest sign-up, marked withdrawn over SQL when asked (guests cannot
    withdraw over HTTP)."""
    response = await client.post(f"/api/events/{event_id}/attendances", json={"guest_name": "Gość"})
    assert response.status_code == 201, response.text
    if withdrawn:
        await db_session.execute(
            update(EventAttendance)
            .where(EventAttendance.id == uuid.UUID(response.json()["id"]))
            .values(withdrawn_at=NOW)
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
    assert body["open_reservations"] is None
    assert as_other.json()["open_reservations"] is None
    assert as_author.json()["open_reservations"] == {"total": 0, "swaps": 0}


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
    await _sign_up(client, db_session, event_id, withdrawn=False)

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
    await _sign_up(client, db_session, event_id, withdrawn=True)

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


async def test_getEvent_withAttendees_authorFirstThenSignUpOrder_isMeAndIsAuthorFlags(
    client: AsyncClient,
) -> None:
    author, author_party = await _register_with_party(
        client, "page.flags.author@example.com", "ORGANIZER"
    )
    organization = await client.post(
        "/api/organizations/mine", json={"name": "Fundacja Zielony Krąg"}, headers=_auth(author)
    )
    assert organization.status_code == 201, organization.text
    first, first_party = await _register_with_party(client, "page.flags.first@example.com")
    second, second_party = await _register_with_party(client, "page.flags.second@example.com")
    event_id = await _create_event(client, author)
    await _attend(client, event_id, first)
    guest = await client.post(f"/api/events/{event_id}/attendances", json={"guest_name": "Ania"})
    assert guest.status_code == 201, guest.text
    await _attend(client, event_id, second)

    as_first = await _page(client, event_id, first)
    as_author = await _page(client, event_id, author)

    assert as_first["author_display_name"] == "Fundacja Zielony Krąg"
    assert as_first["author_slug"] == organization.json()["slug"]
    assert set(as_first["organization"]) == ORGANIZATION_KEYS
    assert as_first["organization"]["name"] == "Fundacja Zielony Krąg"
    assert as_first["attendee_count"] == 3
    assert (as_first["is_author"], as_first["is_attending"]) == (False, True)
    participants = as_first["participants"]
    assert [p["display_name"] for p in participants] == [
        "Fundacja Zielony Krąg",
        "Page Flags First",
        "Ania",
        "Page Flags Second",
    ]
    assert [participants[i]["party_id"] for i in (0, 1, 3)] == [
        author_party,
        first_party,
        second_party,
    ]
    assert [(p["is_author"], p["is_me"]) for p in participants] == [
        (True, False),
        (False, True),
        (False, False),
        (False, False),
    ]
    assert (as_author["is_author"], as_author["is_attending"]) == (True, False)
    assert [p["is_me"] for p in as_author["participants"]] == [True, False, False, False]


async def test_getEvent_afterLoggedInWithdraw_attendeeLeavesListAndIsAttendingFalse(
    client: AsyncClient,
) -> None:
    author = await _register(client, "page.withdraw.author@example.com")
    stays, _ = await _register_with_party(client, "page.withdraw.stays@example.com")
    leaves, leaves_party = await _register_with_party(client, "page.withdraw.leaves@example.com")
    event_id = await _create_event(client, author)
    await _attend(client, event_id, stays)
    await _attend(client, event_id, leaves)

    withdrawn = await client.post(
        f"/api/events/{event_id}/attendances/withdraw", headers=_auth(leaves)
    )
    as_leaver = await _page(client, event_id, leaves)

    assert withdrawn.status_code == 204, withdrawn.text
    assert (as_leaver["is_attending"], as_leaver["attendee_count"]) == (False, 1)
    assert leaves_party not in [p["party_id"] for p in as_leaver["participants"]]
    assert [p["is_me"] for p in as_leaver["participants"]] == [False, False]


async def test_getEvent_participantItems_listedLiveItemsIncludingReserved(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _register(client, "page.items.author@example.com")
    attendee = await _register(client, "page.items.attendee@example.com")
    event_id = await _create_event(client, author)
    [author_item] = await _listed_items(client, author, ("Pi Zabawka autora", "GIFT"))
    klocki, auto, lalka, rower = await _listed_items(
        client,
        attendee,
        ("Pi Klocki", "GIFT"),
        ("Pi Auto", "SWAP"),
        ("Pi Lalka", "GIFT"),
        ("Pi Rower", "SWAP"),
    )
    cleared = await client.put(
        f"/api/item-listing-preferences/{lalka}", json={"mode": None}, headers=_auth(attendee)
    )
    assert cleared.status_code == 200, cleared.text
    await _set_balance(db_session, rower, BalanceStatus.RESERVED)
    product_id = (await _item(db_session, klocki)).product_id
    uploader = await _uploader_id(db_session)
    db_session.add(_photo(product_id, uploader, "pi-klocki", ModerationStatus.APPROVED, 0))
    await db_session.commit()
    await _attend(client, event_id, attendee)

    await _set_added_at(
        db_session, {klocki: NOW - timedelta(days=2), rower: NOW - timedelta(days=1), auto: NOW}
    )

    body = await _page(client, event_id)

    author_row, attendee_row = body["participants"]
    assert [_without_added_at(item) for item in author_row["items"]] == [
        {
            "item_id": str(author_item),
            "product_name": "Pi Zabawka autora",
            "mode": "GIFT",
            "thumb_url": None,
            "reservation": None,
        }
    ]
    assert [_without_added_at(item) for item in attendee_row["items"]] == [
        {
            "item_id": str(auto),
            "product_name": "Pi Auto",
            "mode": "SWAP",
            "thumb_url": None,
            "reservation": None,
        },
        {
            "item_id": str(rower),
            "product_name": "Pi Rower",
            "mode": "SWAP",
            "thumb_url": None,
            "reservation": {"by_name": None, "by_me": False},
        },
        {
            "item_id": str(klocki),
            "product_name": "Pi Klocki",
            "mode": "GIFT",
            "thumb_url": "https://cdn.test/pi-klocki/w400.webp",
            "reservation": None,
        },
    ]
    assert [item["added_at"] for item in attendee_row["items"]] == [
        NOW.isoformat(),
        (NOW - timedelta(days=1)).isoformat(),
        (NOW - timedelta(days=2)).isoformat(),
    ]
    assert (author_row["items_total"], attendee_row["items_total"]) == (1, 3)


async def _set_added_at(db_session: AsyncSession, added_at: dict[uuid.UUID, datetime]) -> None:
    """Pins each item's listing-preference `created_at` (naive UTC)."""
    for item_id, created_at in added_at.items():
        await db_session.execute(
            update(ItemListingPreference)
            .where(ItemListingPreference.item_id == item_id)
            .values(created_at=created_at)
        )
    await db_session.commit()


def _without_added_at(item: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key != "added_at"}


async def test_getEvent_participantWithFiveItems_returnsThreeNewestAndItemsTotal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _register(client, "page.newest.author@example.com")
    attendee = await _register(client, "page.newest.attendee@example.com")
    event_id = await _create_event(client, author)
    first, second, third, fourth, fifth = await _listed_items(
        client,
        attendee,
        ("Pn Arbuz", "GIFT"),
        ("Pn Balon", "SWAP"),
        ("Pn Cymbałki", "GIFT"),
        ("Pn Domek", "GIFT"),
        ("Pn Ekran", "SWAP"),
    )
    await _set_added_at(
        db_session,
        {
            first: NOW - timedelta(days=1),
            second: NOW - timedelta(days=5),
            third: NOW,
            fourth: NOW - timedelta(days=3),
            fifth: NOW - timedelta(hours=2),
        },
    )
    await _attend(client, event_id, attendee)

    body = await _page(client, event_id)

    author_row, attendee_row = body["participants"]
    assert (author_row["items"], author_row["items_total"]) == ([], 0)
    assert [item["item_id"] for item in attendee_row["items"]] == [
        str(third),
        str(fifth),
        str(first),
    ]
    assert attendee_row["items_total"] == 5


async def test_getEvent_anonymousOrInvalidToken_returns200NotAuthorView(
    client: AsyncClient,
) -> None:
    author, author_party = await _register_with_party(client, "page.anon.author@example.com")
    attendee = await _register(client, "page.anon.attendee@example.com")
    event_id = await _create_event(client, author)
    await _attend(client, event_id, attendee)

    anonymous = await _page(client, event_id)
    invalid = await _page(client, event_id, "not-a-valid-token")

    for body in (anonymous, invalid):
        assert (body["is_author"], body["is_attending"]) == (False, False)
        assert body["organization"] is None
        assert body["author_display_name"] == "Page Anon Author"
        assert body["author_slug"] == author_party
        assert body["attendee_count"] == 1
        assert body["participants"][0]["party_id"] == author_party
        assert [p["is_me"] for p in body["participants"]] == [False, False]


async def test_getEvent_afterEnd_hasEndedTrue(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register(client, "page.ended@example.com")
    event_id = await _create_event(client, token)
    upcoming = await _page(client, event_id)
    await db_session.execute(
        update(Event)
        .where(Event.id == uuid.UUID(event_id))
        .values(starts_at=NOW - timedelta(hours=3), ends_at=NOW)
    )
    await db_session.commit()

    ended = await _page(client, event_id)

    assert upcoming["has_ended"] is False
    assert ended["has_ended"] is True


async def _populated_event(
    client: AsyncClient, db_session: AsyncSession, prefix: str, attendee_count: int
) -> str:
    """An event whose author and every attendee list two items, each with an
    APPROVED photo."""
    uploader = await _uploader_id(db_session)
    tokens = [
        await _register(client, f"{prefix}.{index}@example.com")
        for index in range(attendee_count + 1)
    ]
    event_id = await _create_event(client, tokens[0])
    for index, token in enumerate(tokens):
        item_ids = await _listed_items(
            client, token, (f"{prefix} a{index}", "GIFT"), (f"{prefix} b{index}", "SWAP")
        )
        for item_id in item_ids:
            product_id = (await _item(db_session, item_id)).product_id
            db_session.add(
                _photo(product_id, uploader, f"{prefix}-{item_id}", ModerationStatus.APPROVED, 0)
            )
        if index > 0:
            await _attend(client, event_id, token)
    await db_session.commit()
    return event_id


async def test_getEvent_oneVsFiveParticipantsWithItems_queryCountConstant(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    viewer = await _register(client, "page.budget.viewer@example.com")
    one = await _populated_event(client, db_session, "page-budget-one", 1)
    five = await _populated_event(client, db_session, "page-budget-five", 5)

    with count_queries(engine) as one_statements:
        one_body = await _page(client, one, viewer)
    with count_queries(engine) as five_statements:
        five_body = await _page(client, five, viewer)

    assert [len(p["items"]) for p in one_body["participants"]] == [2, 2]
    assert [len(p["items"]) for p in five_body["participants"]] == [2] * 6
    assert [p["items_total"] for p in five_body["participants"]] == [2] * 6
    assert all(item["thumb_url"] for p in five_body["participants"] for item in p["items"])
    assert len(one_statements) == len(five_statements), (one_statements, five_statements)


async def test_getEvent_authorProfileUnresolvable_returns200WithPlaceholderName(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, party_id = await _register_with_party(client, "page.noprofile@example.com")
    event_id = await _create_event(client, token)
    await db_session.execute(
        text("DELETE FROM user_profiles WHERE party_id = :party_id"), {"party_id": party_id}
    )
    await db_session.commit()

    body = await _page(client, event_id)

    assert body["author_display_name"] == "Użytkownik"
    assert body["participants"][0]["display_name"] == "Użytkownik"
