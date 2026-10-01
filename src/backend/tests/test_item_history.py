"""`GET /api/inventory-items/{id}/history`: the privacy-labelled movement
timeline — newest first, server-built descriptions, no ids and never the
raw `CirculationTransaction.description`."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, cast

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import InventoryItem, Reservation, ReservationType
from app.groups import service as groups_service
from app.groups.models import Term
from app.groups.schemas import TakeTermItemListingRequest
from tests.ledger_assertions import movements_for_item
from tests.test_circulation_ledger import (
    _confirm_and_fulfill,
    _register_item_via_api,
    _register_user,
    _reserve,
    _return_via_raw_routes,
)
from tests.test_term_item_listings import (
    _accepted_swap_after_term,
    _auth,
    _create_circle_and_term,
    _principal,
    _register,
    _register_personal_item,
    _rsvp,
)

_ENTRY_KEYS = {"occurred_at", "movement_type", "description", "term_occurs_on"}


async def _display_name(client: AsyncClient, headers: dict[str, str]) -> str:
    me = await client.get("/api/people/me", headers=headers)
    assert me.status_code == 200
    return str(me.json()["display_name"])


async def _history(
    client: AsyncClient, item_id: uuid.UUID, headers: dict[str, str]
) -> list[dict[str, Any]]:
    response = await client.get(f"/api/inventory-items/{item_id}/history", headers=headers)
    assert response.status_code == 200, response.text
    return list(response.json())


def _keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in _keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in _keys(v)}
    return set()


async def test_getItemHistory_registerLendReturn_newestFirstWithPrivacyLabelsAndNoIds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_headers, owner_id = await _register_user(client, "ith.owner1@example.com")
    borrower_headers, borrower_id = await _register_user(client, "ith.borrower1@example.com")
    third_headers, third_id = await _register_user(client, "ith.third1@example.com")
    home_id, item_id = await _register_item_via_api(client, db_session, owner_headers)
    lend_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.LEND,
        reserved_by_user_id=borrower_id,
    )
    await _confirm_and_fulfill(db_session, lend_id, owner_id)
    virtual_id = (
        await db_session.execute(
            select(InventoryItem.inventory_id).where(InventoryItem.id == item_id)
        )
    ).scalar_one()
    return_id = await _return_via_raw_routes(client, borrower_headers, item_id)
    lend_term = (
        await db_session.execute(
            select(Term.occurs_on).join(Reservation, Reservation.term_id == Term.id).where(
                Reservation.id == lend_id
            )
        )
    ).scalar_one()
    owner_name = await _display_name(client, owner_headers)
    borrower_name = await _display_name(client, borrower_headers)

    expected = {
        "owner": [
            f"{borrower_name} → Ty",
            f"Ty → {borrower_name}",
            "Dodana przez: Ty",
        ],
        "borrower": [
            f"Ty → {owner_name}",
            f"{owner_name} → Ty",
            "Dodana przez: inna rodzina",
        ],
        "third": [
            "inna rodzina → inna rodzina",
            "inna rodzina → inna rodzina",
            "Dodana przez: inna rodzina",
        ],
    }
    transactions = await movements_for_item(db_session, item_id)
    forbidden = [
        str(value)
        for value in (
            owner_id, borrower_id, third_id, item_id, home_id, virtual_id, lend_id, return_id,
            *(t.id for t in transactions),
        )
    ] + [t.description for t in transactions]

    for viewer, headers in (
        ("owner", owner_headers),
        ("borrower", borrower_headers),
        ("third", third_headers),
    ):
        response = await client.get(f"/api/inventory-items/{item_id}/history", headers=headers)
        assert response.status_code == 200
        entries = response.json()

        assert [e["movement_type"] for e in entries] == ["RETURN", "LEND", "REGISTER"]
        assert [e["description"] for e in entries] == expected[viewer]
        assert [e["term_occurs_on"] for e in entries] == [None, lend_term.isoformat(), None]
        assert all(set(e) == _ENTRY_KEYS for e in entries)
        assert not any(k == "id" or k.endswith("_id") for k in _keys(entries))
        for value in forbidden:
            assert value not in response.text


async def test_getItemHistory_swapDeletedMissingAndAnonymous_handledPerSpec(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    swap = await _accepted_swap_after_term(
        client, db_session, "ith2", listed_name="Szachy ith2", offered_name="Warcaby ith2"
    )
    await groups_service.confirm_transaction(
        db_session, _principal(swap.lister_token), swap.proposer_reservation_id
    )
    proposer_name = await _display_name(client, _auth(swap.proposer_token))

    response = await client.get(
        f"/api/inventory-items/{swap.listed_item_id}/history", headers=_auth(swap.lister_token)
    )
    assert response.status_code == 200
    entries = response.json()
    assert [e["movement_type"] for e in entries] == ["SWAP", "REGISTER"]
    assert entries[0]["description"] == f"Ty → {proposer_name}"
    assert entries[0]["term_occurs_on"] is not None
    assert "Warcaby ith2" not in response.text
    assert str(swap.offered_item_id) not in response.text

    remover_token, _ = await _register(client, "GUEST", "ith.remover2@example.com")
    deleted_item_id = await _register_personal_item(client, remover_token, "Kredki ith2")
    deleted = await client.delete(
        f"/api/inventory-items/{deleted_item_id}", headers=_auth(remover_token)
    )
    assert deleted.status_code == 204
    deleted_history = await _history(client, deleted_item_id, _auth(remover_token))
    assert [(e["movement_type"], e["description"]) for e in deleted_history] == [
        ("REMOVE", "Usunięta przez: Ty"),
        ("REGISTER", "Dodana przez: Ty"),
    ]

    missing = await client.get(
        f"/api/inventory-items/{uuid.uuid4()}/history", headers=_auth(swap.lister_token)
    )
    assert missing.status_code == 404
    anonymous = await client.get(f"/api/inventory-items/{swap.listed_item_id}/history")
    assert anonymous.status_code == 401


async def test_getItemHistory_fulfilledGift_entryCarriesTermDateAndNewOwnerSeesIt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "ith.org3@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "ith3")
    lister_token, _ = await _register(client, "GUEST", "ith.lister3@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Puzzle ith3")
    await groups_service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )
    taker_token, _ = await _register(client, "GUEST", "ith.taker3@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await groups_service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()
    occurs_on = term.occurs_on.isoformat()
    await groups_service.confirm_transaction(
        db_session, _principal(taker_token), cast(uuid.UUID, taken.resolved_reservation_id)
    )
    lister_name = await _display_name(client, _auth(lister_token))

    entries = await _history(client, item_id, _auth(taker_token))

    assert [e["movement_type"] for e in entries] == ["GIFT", "REGISTER"]
    assert entries[0]["description"] == f"{lister_name} → Ty"
    assert entries[0]["term_occurs_on"] == occurs_on
    assert entries[1]["description"] == "Dodana przez: inna rodzina"
    assert entries[1]["term_occurs_on"] is None
