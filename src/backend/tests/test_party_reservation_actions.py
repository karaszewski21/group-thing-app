"""`/actions.party_reservation`: the confirm/cancel/accept/reject flags the
product page shows the two parties of an item's open reservation or pending
swap proposal, computed with the write paths' own rules."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from tests.test_event_item_reservations import _listed_items
from tests.test_personal_pickup import _owner, _propose, _reservations, _take
from tests.test_term_item_listings import _auth, _create_circle_and_term, _register, _rsvp

PARTY_KEYS = {
    "role",
    "reservation_id",
    "proposal_id",
    "reservation_type",
    "personal_pickup",
    "can_confirm",
    "can_cancel",
    "can_accept",
    "can_reject",
}
FLAGS = ("can_confirm", "can_cancel", "can_accept", "can_reject")


async def _party(client: AsyncClient, item_id: uuid.UUID, token: str | None) -> Any:
    response = await client.get(
        f"/api/items/{item_id}/actions", headers=_auth(token) if token is not None else {}
    )
    assert response.status_code == 200, response.text
    block = response.json()["party_reservation"]
    if block is not None:
        assert set(block) == PARTY_KEYS
    return block


def _flags(block: dict[str, Any]) -> tuple[bool, ...]:
    return tuple(block[flag] for flag in FLAGS)


async def test_partyReservation_nonParty_null(client: AsyncClient) -> None:
    owner, item_id = await _owner(client, "pr1")
    taker, _ = await _register(client, "GUEST", "pr1.taker@example.com")
    stranger, _ = await _register(client, "GUEST", "pr1.stranger@example.com")
    unreserved = await _party(client, item_id, owner)
    status, body = await _take(client, item_id, taker)
    assert status == 200, body

    assert unreserved is None
    assert await _party(client, item_id, stranger) is None
    assert await _party(client, item_id, None) is None


async def test_partyReservation_personalGift_receiverCanConfirm_giverCanCancelOnly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, item_id = await _owner(client, "pr2")
    taker, _ = await _register(client, "GUEST", "pr2.taker@example.com")
    status, body = await _take(client, item_id, taker)
    assert status == 200, body
    (reservation,) = await _reservations(db_session, item_id)

    receiver = await _party(client, item_id, taker)
    giver = await _party(client, item_id, owner)

    for block, role in ((receiver, "RECEIVER"), (giver, "GIVER")):
        assert block["role"] == role
        assert block["reservation_id"] == str(reservation.id)
        assert block["proposal_id"] is None
        assert block["reservation_type"] == "GIFT"
        assert block["personal_pickup"] is True
    assert _flags(receiver) == (True, True, False, False)
    assert _flags(giver) == (False, True, False, False)


async def test_partyReservation_pairedSwap_bothCanConfirmAndCancel(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, listed = await _owner(client, "pr3", "SWAP")
    proposer, _ = await _register(client, "GUEST", "pr3.proposer@example.com")
    (offered,) = await _listed_items(client, proposer, ("Puzzle pr3", "SWAP"))
    status, proposal = await _propose(client, listed, offered, proposer)
    assert status == 200, proposal
    accept = await client.post(f"/api/swap-proposals/{proposal['id']}/accept", headers=_auth(owner))
    assert accept.status_code == 200, accept.text
    (owner_leg,) = await _reservations(db_session, listed)

    giver = await _party(client, listed, owner)
    receiver = await _party(client, listed, proposer)

    assert (giver["role"], receiver["role"]) == ("GIVER", "RECEIVER")
    for block in (giver, receiver):
        assert block["reservation_id"] == str(owner_leg.id)
        assert block["proposal_id"] is None
        assert block["reservation_type"] == "SWAP"
        assert block["personal_pickup"] is True
        assert _flags(block) == (True, True, False, False)


async def test_partyReservation_unpairedSwapLeg_allFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, listed = await _owner(client, "pr4", "SWAP")
    proposer, _ = await _register(client, "GUEST", "pr4.proposer@example.com")
    (offered,) = await _listed_items(client, proposer, ("Puzzle pr4", "SWAP"))
    status, proposal = await _propose(client, listed, offered, proposer)
    assert status == 200, proposal
    (leg,) = await _reservations(db_session, offered)

    holder = await _party(client, offered, proposer)
    gainer = await _party(client, offered, owner)

    assert (holder["role"], gainer["role"]) == ("GIVER", "RECEIVER")
    for block in (holder, gainer):
        assert block["reservation_id"] == str(leg.id)
        assert block["reservation_type"] == "SWAP"
        assert _flags(block) == (False, False, False, False)


async def test_partyReservation_pendingProposal_ownerCanAcceptReject_proposerNone(
    client: AsyncClient,
) -> None:
    owner, listed = await _owner(client, "pr5", "SWAP")
    proposer, _ = await _register(client, "GUEST", "pr5.proposer@example.com")
    stranger, _ = await _register(client, "GUEST", "pr5.stranger@example.com")
    (offered,) = await _listed_items(client, proposer, ("Puzzle pr5", "SWAP"))
    status, proposal = await _propose(client, listed, offered, proposer)
    assert status == 200, proposal

    as_owner = await _party(client, listed, owner)
    as_proposer = await _party(client, listed, proposer)

    assert as_owner["role"] == "GIVER"
    assert as_owner["reservation_id"] is None
    assert as_owner["proposal_id"] == proposal["id"]
    assert as_owner["reservation_type"] == "SWAP"
    assert as_owner["personal_pickup"] is True
    assert _flags(as_owner) == (False, False, True, True)
    assert as_proposer["role"] == "RECEIVER"
    assert as_proposer["proposal_id"] == proposal["id"]
    assert _flags(as_proposer) == (False, False, False, False)
    assert await _party(client, listed, stranger) is None


async def test_partyReservation_termNotEnded_confirmCancelFalse(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "pr6.org@example.com")
    attendee, _ = await _register(client, "GUEST", "pr6.attendee@example.com")
    group_id, term_id = await _create_circle_and_term(client, organizer, "pr6")
    await _rsvp(client, attendee, group_id, term_id)
    (item_id,) = await _listed_items(client, organizer, ("Sanki pr6", "GIFT"))
    taken = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": {"kind": "TERM", "id": str(term_id)}, "reservation_type": "GIFT"},
        headers=_auth(attendee),
    )
    assert taken.status_code == 200, taken.text

    before = await _party(client, item_id, attendee)
    freeze_local_now(clock.local_now() + timedelta(days=8))
    after = await _party(client, item_id, attendee)

    assert before["personal_pickup"] is False
    assert _flags(before) == (False, False, False, False)
    assert _flags(after) == (True, True, False, False)


async def test_partyReservation_personalGiftCancelled_bothNull_itemAvailableAgain(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, item_id = await _owner(client, "pr7")
    taker, _ = await _register(client, "GUEST", "pr7.taker@example.com")
    third, _ = await _register(client, "GUEST", "pr7.third@example.com")
    status, body = await _take(client, item_id, taker)
    assert status == 200, body
    (reservation,) = await _reservations(db_session, item_id)
    cancelled = await client.post(
        f"/api/reservations/{reservation.id}/cancel-transaction", headers=_auth(taker)
    )
    assert cancelled.status_code == 200, cancelled.text

    assert await _party(client, item_id, taker) is None
    assert await _party(client, item_id, owner) is None
    actions = await client.get(f"/api/items/{item_id}/actions", headers=_auth(third))
    assert actions.status_code == 200, actions.text
    assert actions.json()["available"] is True
    assert actions.json()["reservation"] is None
    assert actions.json()["personal_pickup_available"] is True
