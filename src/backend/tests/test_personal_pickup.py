"""Personal pickup: a GIFT/SWAP reserved outside any term or event through
`POST /api/items/{id}/take|propose` with `{"kind": "PERSONAL"}`. The
reservation has no context column, needs the owner's pickup place, settles
immediately and is never prompted by the term-end scan."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import BalanceStatus, InventoryBalance, Reservation
from app.core import clock
from app.groups.application.term_end_scan import scan_for_term_ended
from app.groups.domain import swap_events
from app.groups.models import GiveawayTermEndMarker
from app.outbox.models import OutboxEntry
from app.users.models import UserProfile
from tests.test_event_item_reservations import (
    _create_event,
    _listed_items,
    _notifications,
    _sign_up,
)
from tests.test_term_item_listings import _auth, _register

PERSONAL = {"kind": "PERSONAL"}
NO_LOCATION_MESSAGE = "Właściciel nie ustawił miejsca odbioru"


async def _set_location(client: AsyncClient, token: str, place_id: str) -> str:
    created = await client.post(
        "/api/locations",
        json={
            "name": f"Dom {place_id}",
            "formatted_address": "ul. Puławska 1, 02-515 Warszawa",
            "source": "GOOGLE",
            "google_place_id": place_id,
            "lat": 52.2,
            "lng": 21.0,
        },
        headers=_auth(token),
    )
    assert created.status_code == 201, created.text
    location_id: str = created.json()["id"]
    response = await client.put(
        "/api/inventories/mine/location",
        json={"location_id": location_id},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return location_id


async def _owner(
    client: AsyncClient, prefix: str, mode: str = "GIFT", *, located: bool = True
) -> tuple[str, uuid.UUID]:
    token, _ = await _register(client, "GUEST", f"{prefix}.owner@example.com")
    (item_id,) = await _listed_items(client, token, (f"Rowerek {prefix}", mode))
    if located:
        await _set_location(client, token, f"ChIJ-{prefix}")
    return token, item_id


async def _take(client: AsyncClient, item_id: uuid.UUID, token: str) -> tuple[int, Any]:
    response = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": PERSONAL, "reservation_type": "GIFT"},
        headers=_auth(token),
    )
    return response.status_code, response.json()


async def _propose(
    client: AsyncClient, item_id: uuid.UUID, offered: uuid.UUID, token: str
) -> tuple[int, Any]:
    response = await client.post(
        f"/api/items/{item_id}/propose",
        json={"context": PERSONAL, "offered_item_id": str(offered)},
        headers=_auth(token),
    )
    return response.status_code, response.json()


async def _reservations(db: AsyncSession, *item_ids: uuid.UUID) -> list[Reservation]:
    rows = await db.scalars(
        select(Reservation)
        .where(Reservation.item_id.in_(item_ids))
        .execution_options(populate_existing=True)
    )
    return list(rows.all())


async def _display_name(db: AsyncSession, party_id: uuid.UUID) -> str:
    return (
        await db.execute(select(UserProfile.display_name).where(UserProfile.party_id == party_id))
    ).scalar_one()


async def test_takeItem_personalGift_createsNoContextReservationAndNullContext(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, item_id = await _owner(client, "pp1")
    taker, _ = await _register(client, "GUEST", "pp1.taker@example.com")

    status, body = await _take(client, item_id, taker)

    assert status == 200, body
    assert body == {"item_id": str(item_id), "product_name": "Rowerek pp1", "context": None}
    (reservation,) = await _reservations(db_session, item_id)
    assert (reservation.term_id, reservation.event_id) == (None, None)
    assert reservation.status.value == "PENDING"
    details = await client.get(f"/api/inventory-items/{item_id}/details", headers=_auth(taker))
    assert details.json()["status"]["code"] == "RESERVED"
    assert details.json()["status"]["personal_pickup"] is True
    detail = await client.get(f"/api/reservations/{reservation.id}", headers=_auth(taker))
    assert detail.status_code == 200, detail.text
    assert detail.json()["personal_pickup"] is True


async def test_takeItem_personalOwnerWithoutLocation_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, item_id = await _owner(client, "pp2", located=False)
    taker, _ = await _register(client, "GUEST", "pp2.taker@example.com")

    unset_status, unset_body = await _take(client, item_id, taker)
    location_id = await _set_location(client, owner, "ChIJ-pp2")
    deleted = await client.delete(f"/api/locations/{location_id}", headers=_auth(owner))
    assert deleted.status_code == 204, deleted.text
    deleted_status, deleted_body = await _take(client, item_id, taker)
    unlisted_status, _ = await _take(client, uuid.uuid4(), taker)

    assert (unset_status, unset_body["message"]) == (409, NO_LOCATION_MESSAGE)
    assert (deleted_status, deleted_body["message"]) == (409, NO_LOCATION_MESSAGE)
    assert unlisted_status == 404
    assert await _reservations(db_session, item_id) == []


async def test_proposeItemSwap_personal_acceptPairsNoContextLegsWithNullTermFields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, listed = await _owner(client, "pp3", "SWAP")
    proposer, _ = await _register(client, "GUEST", "pp3.proposer@example.com")
    (offered,) = await _listed_items(client, proposer, ("Puzzle pp3", "SWAP"))

    status, proposal = await _propose(client, listed, offered, proposer)
    assert status == 200, proposal
    accept = await client.post(f"/api/swap-proposals/{proposal['id']}/accept", headers=_auth(owner))

    assert accept.status_code == 200, accept.text
    body = accept.json()
    assert (body["term_id"], body["term_occurs_on"], body["group_id"], body["group_name"]) == (
        None,
        None,
        None,
        None,
    )
    legs = await _reservations(db_session, listed, offered)
    assert len(legs) == 2
    assert {(r.term_id, r.event_id, r.status.value) for r in legs} == {(None, None, "CONFIRMED")}
    assert {r.paired_reservation_id for r in legs} == {r.id for r in legs}
    (accepted,) = await _notifications(client, proposer, "SWAP_ACCEPTED")
    assert str(accepted["message"]).endswith("— odbiór osobisty")
    assert accepted["link_path"] == f"/product/{listed}"


async def test_confirmTransaction_personalGift_recipientConfirmsImmediately_giverRefused(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, item_id = await _owner(client, "pp4")
    taker, _ = await _register(client, "GUEST", "pp4.taker@example.com")
    status, body = await _take(client, item_id, taker)
    assert status == 200, body
    (reservation,) = await _reservations(db_session, item_id)
    path = f"/api/reservations/{reservation.id}/confirm-transaction"

    giver = await client.post(path, headers=_auth(owner))
    recipient = await client.post(path, headers=_auth(taker))

    assert giver.status_code == 403, giver.text
    assert recipient.status_code == 200, recipient.text
    (fulfilled,) = await _reservations(db_session, item_id)
    assert fulfilled.status.value == "FULFILLED"


async def test_cancelTransaction_personalGift_giverCancelsImmediately(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, item_id = await _owner(client, "pp5")
    taker, _ = await _register(client, "GUEST", "pp5.taker@example.com")
    status, body = await _take(client, item_id, taker)
    assert status == 200, body
    (reservation,) = await _reservations(db_session, item_id)

    response = await client.post(
        f"/api/reservations/{reservation.id}/cancel-transaction", headers=_auth(owner)
    )

    assert response.status_code == 200, response.text
    (cancelled,) = await _reservations(db_session, item_id)
    assert cancelled.status.value == "CANCELLED"
    balance = (
        await db_session.execute(
            select(InventoryBalance.status)
            .where(InventoryBalance.item_id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert balance == BalanceStatus.AVAILABLE
    detail = await client.get(f"/api/reservations/{reservation.id}", headers=_auth(taker))
    assert detail.json()["personal_pickup"] is False


async def test_takeItem_personal_notificationCopyForOwnerAndTaker(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, owner_party = await _register(client, "GUEST", "pp6.owner@example.com")
    (item_id,) = await _listed_items(client, owner_token, ("Hulajnoga pp6", "GIFT"))
    await _set_location(client, owner_token, "ChIJ-pp6")
    taker, taker_party = await _register(client, "GUEST", "pp6.taker@example.com")
    owner_name = await _display_name(db_session, owner_party)
    taker_name = await _display_name(db_session, taker_party)

    status, body = await _take(client, item_id, taker)
    assert status == 200, body

    (taken,) = await _notifications(client, owner_token, "TERM_ITEM_LISTING_TAKEN")
    (reserved,) = await _notifications(client, taker, "ITEM_RESERVED_FOR_PICKUP")
    assert taken["message"] == (
        f"„{taker_name}” odbierze osobiście „Hulajnoga pp6” — ustalcie szczegóły na czacie."
    )
    assert reserved["message"] == (
        f"Zarezerwowano „Hulajnoga pp6” — odbiór osobisty, ustal szczegóły z {owner_name}"
        " na czacie. Gdy odbierzesz rzecz, potwierdź to na stronie przedmiotu."
    )
    assert taken["link_path"] == reserved["link_path"] == f"/product/{item_id}"


async def test_termEndScan_personalReservation_sendsNoPrompt(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    _, item_id = await _owner(client, "pp7")
    taker, _ = await _register(client, "GUEST", "pp7.taker@example.com")
    status, body = await _take(client, item_id, taker)
    assert status == 200, body
    (reservation,) = await _reservations(db_session, item_id)

    freeze_local_now(clock.local_now() + timedelta(days=30))
    await scan_for_term_ended(db_session, window=timedelta(days=60))

    giveaways = await db_session.scalars(
        select(OutboxEntry).where(OutboxEntry.event_type == swap_events.TERM_ENDED_GIVEAWAY)
    )
    assert list(giveaways.all()) == []
    marker = await db_session.scalar(
        select(GiveawayTermEndMarker).where(GiveawayTermEndMarker.reservation_id == reservation.id)
    )
    assert marker is None


async def test_deleteEvent_openReservation_leavesNoOpenNoContextRow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """L7: a personal reservation has no discriminator column, so an event
    delete must never leave an open row whose `event_id` was nulled."""
    author, _ = await _register(client, "GUEST", "pp8.author@example.com")
    event_id, _ = await _create_event(client, author)
    owner, _ = await _register(client, "GUEST", "pp8.owner@example.com")
    taker, _ = await _register(client, "GUEST", "pp8.taker@example.com")
    for token in (owner, taker):
        await _sign_up(client, event_id, token)
    (item_id,) = await _listed_items(client, owner, ("Klocki pp8", "GIFT"))
    response = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": {"kind": "EVENT", "id": str(event_id)}, "reservation_type": "GIFT"},
        headers=_auth(taker),
    )
    assert response.status_code == 200, response.text
    for token in (owner, taker):
        withdrawn = await client.post(
            f"/api/events/{event_id}/attendances/withdraw", headers=_auth(token)
        )
        assert withdrawn.status_code == 204, withdrawn.text

    deleted = await client.delete(f"/api/events/{event_id}", headers=_auth(author))

    assert deleted.status_code == 204, deleted.text
    rows = await _reservations(db_session, item_id)
    assert len(rows) == 1
    assert {(r.status.value, r.term_id, r.event_id) for r in rows} == {("CANCELLED", None, None)}


async def test_personalGift_itemMadePrivateAndLocationRemoved_takerStillConfirms(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "GUEST", "pp9.owner@example.com")
    (item_id,) = await _listed_items(client, owner, ("Rowerek pp9", "GIFT"))
    location_id = await _set_location(client, owner, "ChIJ-pp9")
    taker, _ = await _register(client, "GUEST", "pp9.taker@example.com")
    status, body = await _take(client, item_id, taker)
    assert status == 200, body
    (reservation,) = await _reservations(db_session, item_id)
    made_private = await client.put(
        f"/api/item-listing-preferences/{item_id}",
        json={"mode": "GIFT", "visibility": "PRIVATE"},
        headers=_auth(owner),
    )
    assert made_private.status_code == 200, made_private.text
    deleted = await client.delete(f"/api/locations/{location_id}", headers=_auth(owner))
    assert deleted.status_code == 204, deleted.text

    actions = await client.get(f"/api/items/{item_id}/actions", headers=_auth(taker))
    assert actions.status_code == 200, actions.text
    party = actions.json()["party_reservation"]
    assert (party["reservation_id"], party["can_confirm"]) == (str(reservation.id), True)
    confirmed = await client.post(
        f"/api/reservations/{reservation.id}/confirm-transaction", headers=_auth(taker)
    )

    assert confirmed.status_code == 200, confirmed.text
    (fulfilled,) = await _reservations(db_session, item_id)
    assert fulfilled.status.value == "FULFILLED"
