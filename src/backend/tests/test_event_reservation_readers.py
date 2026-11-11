"""Inventory context readers for event reservations: `GET
/api/reservations/{id}`, the item history's context date and the
`_for_events` selects next to their term siblings."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core import clock
from app.groups.infrastructure import inventory_bridge
from app.inventory import service as inventory_service
from app.inventory.models import ReservationType
from tests.conftest import create_location
from tests.test_event_item_reservations import _listed_items, _sign_up, _take
from tests.test_term_item_listings import (
    _auth,
    _create_circle_and_term,
    _principal,
    _register,
    _register_personal_item,
    _rsvp,
)

RESERVATION_DETAIL_KEYS = {
    "id",
    "item_id",
    "reservation_type",
    "reserved_by_user_id",
    "term_id",
    "event_id",
    "paired_reservation_id",
    "reserved_at",
    "expires_at",
    "status",
    "notes",
    "term_occurs_on",
    "personal_pickup",
}


async def _user_id(db: AsyncSession, token: str) -> uuid.UUID:
    username = _principal(token).username
    return (await db.execute(select(User.id).where(User.username == username))).scalar_one()


async def _create_event(
    client: AsyncClient, token: str, name: str = "Piknik wymiany"
) -> tuple[uuid.UUID, datetime]:
    starts_at = (clock.local_now() + timedelta(days=7)).replace(second=0, microsecond=0)
    response = await client.post(
        "/api/events",
        json={
            "location_id": await create_location(client, _auth(token)),
            "name": name,
            "starts_at": starts_at.isoformat(),
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"]), starts_at


async def _reserve(
    db: AsyncSession,
    item_id: uuid.UUID,
    taker_user_id: uuid.UUID,
    *,
    term_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
    reservation_type: ReservationType = ReservationType.GIFT,
) -> uuid.UUID:
    reservation = await inventory_service.create_reservation(
        db,
        item_id=item_id,
        reservation_type=reservation_type,
        reserved_by_user_id=taker_user_id,
        term_id=term_id,
        event_id=event_id,
    )
    return uuid.UUID(str(reservation.id))


async def test_getReservation_eventRow_returnsEventIdAndEventDate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author_token, _ = await _register(client, "GUEST", "evr.author1@example.com")
    event_id, starts_at = await _create_event(client, author_token)
    owner_token, _ = await _register(client, "GUEST", "evr.owner1@example.com")
    taker_token, _ = await _register(client, "GUEST", "evr.taker1@example.com")
    item_id = await _register_personal_item(client, owner_token, "Rowerek")
    reservation_id = await _reserve(
        db_session, item_id, await _user_id(db_session, taker_token), event_id=event_id
    )

    response = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(taker_token))

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == RESERVATION_DETAIL_KEYS
    assert body["event_id"] == str(event_id)
    assert body["term_id"] is None
    assert body["term_occurs_on"] == starts_at.isoformat()


async def test_getItemHistory_fulfilledEventGift_showsEventStartsAt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author_token, _ = await _register(client, "GUEST", "evr.author2@example.com")
    event_id, starts_at = await _create_event(client, author_token)
    owner_token, _ = await _register(client, "GUEST", "evr.owner2@example.com")
    taker_token, _ = await _register(client, "GUEST", "evr.taker2@example.com")
    item_id = await _register_personal_item(client, owner_token, "Sanki")
    taker_user_id = await _user_id(db_session, taker_token)
    reservation_id = await _reserve(db_session, item_id, taker_user_id, event_id=event_id)
    await inventory_service.fulfill_exchange(db_session, [reservation_id], taker_user_id)

    response = await client.get(
        f"/api/inventory-items/{item_id}/history", headers=_auth(taker_token)
    )

    assert response.status_code == 200, response.text
    gift = next(e for e in response.json() if e["movement_type"] == "GIFT")
    assert gift["term_occurs_on"] == starts_at.isoformat()


async def test_forEventsSelects_mixedContexts_returnOnlyTheirOwnContextRows(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "evr.org3@example.com")
    _, term_id = await _create_circle_and_term(client, org_token, "evr3")
    author_token, _ = await _register(client, "GUEST", "evr.author3@example.com")
    event_id, _ = await _create_event(client, author_token)
    owner_tokens = [
        (await _register(client, "GUEST", f"evr.owner3{n}@example.com"))[0] for n in range(3)
    ]
    taker_user_id = await _user_id(
        db_session, (await _register(client, "GUEST", "evr.taker3@example.com"))[0]
    )
    term_gift = await _reserve(
        db_session,
        await _register_personal_item(client, owner_tokens[0], "Klocki"),
        taker_user_id,
        term_id=term_id,
    )
    event_gift = await _reserve(
        db_session,
        await _register_personal_item(client, owner_tokens[1], "Lalka"),
        taker_user_id,
        event_id=event_id,
    )
    event_swap = await _reserve(
        db_session,
        await _register_personal_item(client, owner_tokens[2], "Piłka"),
        taker_user_id,
        event_id=event_id,
        reservation_type=ReservationType.SWAP,
    )

    hand_over_events = await inventory_bridge.list_active_hand_over_reservations_for_events(
        db_session, [event_id]
    )
    hand_over_terms = await inventory_bridge.list_active_hand_over_reservations_for_terms(
        db_session, [term_id]
    )
    event_ids = set(
        (
            await db_session.execute(inventory_bridge.reservation_ids_for_event_select(event_id))
        ).scalars()
    )
    term_ids = set(
        (
            await db_session.execute(inventory_bridge.reservation_ids_for_term_select(term_id))
        ).scalars()
    )
    open_for_event = await inventory_bridge.list_open_reservations_for_event(db_session, event_id)

    assert [r.id for r in hand_over_events] == [event_gift]
    assert [r.id for r in hand_over_terms] == [term_gift]
    assert event_ids == {event_gift, event_swap}
    assert term_ids == {term_gift}
    assert {r.id for r in open_for_event} == {event_gift, event_swap}


async def test_termScopedReaders_itemTakenOnEvent_skipEventRowAndRefuseTermTake(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "evr.org4@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "evr4")
    owner_token, _ = await _register(client, "GUEST", "evr.owner4@example.com")
    taker_token, _ = await _register(client, "GUEST", "evr.taker4@example.com")
    event_id, _ = await _create_event(client, org_token)
    for token in (owner_token, taker_token):
        await _rsvp(client, token, group_id, term_id)
        await _sign_up(client, event_id, token)
    (item_id,) = await _listed_items(client, owner_token, ("Rowerek evr4", "GIFT"))
    status, body = await _take(client, event_id, item_id, taker_token)
    assert status == 200, body

    mine_as_taker = await client.get(
        "/api/term-item-listings/mine-as-taker",
        params={"term_id": str(term_id)},
        headers=_auth(taker_token),
    )
    browse = await client.get(
        "/api/term-item-listings/browse",
        params={"term_id": str(term_id)},
        headers=_auth(taker_token),
    )
    term_take = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": {"kind": "TERM", "id": str(term_id)}, "reservation_type": "GIFT"},
        headers=_auth(taker_token),
    )

    assert mine_as_taker.status_code == 200, mine_as_taker.text
    assert mine_as_taker.json() == []
    assert browse.status_code == 200, browse.text
    assert str(item_id) not in {row["item_id"] for row in browse.json()}
    assert term_take.status_code == 409, term_take.text
