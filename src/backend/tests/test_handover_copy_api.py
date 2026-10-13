"""Dated handover notification copy (take and swap accept) and the additive
`AcceptedSwapProposalResponse` fields of `POST /api/swap-proposals/{id}/accept`."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import InventoryItem, ReservationType
from app.groups import service
from app.groups.models import Group
from app.groups.schemas import TakeTermItemListingRequest
from app.product.models import Product
from app.users.models import UserProfile
from tests.test_term_item_listings import (
    _auth,
    _notifications,
    _principal,
    _register,
    _register_personal_item,
    _rsvp,
)

_NOW = datetime(2026, 10, 13, 12, 0)
_TERM_AT = "2026-10-14T16:30:00"
_WHEN = "śr 14.10 o 16:30"
_SWAP_RESPONSE_KEYS = {
    "id",
    "proposer_party_id",
    "listing_item_id",
    "offered_item_id",
    "proposer_reservation_id",
    "status",
    "created_at",
    "updated_at",
}


async def _circle_with_term(
    client: AsyncClient, org_token: str, name: str
) -> tuple[uuid.UUID, uuid.UUID]:
    circle = await client.post("/api/groups/mine", json={"name": name}, headers=_auth(org_token))
    assert circle.status_code == 201, circle.text
    group_id = uuid.UUID(circle.json()["id"])
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": str(group_id), "occurs_on": _TERM_AT},
        headers=_auth(org_token),
    )
    assert term.status_code == 201, term.text
    return group_id, uuid.UUID(term.json()["id"])


async def _listed_item(
    client: AsyncClient,
    db: AsyncSession,
    prefix: str,
    group_id: uuid.UUID,
    term_id: uuid.UUID,
    item_name: str,
    mode: ReservationType,
) -> tuple[str, uuid.UUID]:
    token, _ = await _register(client, "GUEST", f"{prefix}.lister@example.com")
    await _rsvp(client, token, group_id, term_id)
    item_id = await _register_personal_item(client, token, item_name)
    await service.set_item_listing_preference(db, _principal(token), item_id, mode)
    return token, item_id


async def _attendee(
    client: AsyncClient, prefix: str, group_id: uuid.UUID, term_id: uuid.UUID
) -> tuple[str, uuid.UUID]:
    token, party_id = await _register(client, "GUEST", f"{prefix}.taker@example.com")
    await _rsvp(client, token, group_id, term_id)
    return token, party_id


async def _take(db: AsyncSession, token: str, item_id: uuid.UUID, term_id: uuid.UUID) -> None:
    await service.take_item_listing(
        db,
        _principal(token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )


async def test_takeItemListing_giverAndTaker_receiveDatedCopyWithGroup(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    freeze_local_now(_NOW)
    org_token, _ = await _register(client, "ORGANIZER", "hc1.org@example.com")
    group_id, term_id = await _circle_with_term(client, org_token, "Krąg Kasztany")
    lister_token, item_id = await _listed_item(
        client, db_session, "hc1", group_id, term_id, "Rowerek", ReservationType.GIFT
    )
    taker_token, taker_party_id = await _attendee(client, "hc1", group_id, term_id)
    taker_name = (
        await db_session.execute(
            select(UserProfile.display_name).where(UserProfile.party_id == taker_party_id)
        )
    ).scalar_one()

    await _take(db_session, taker_token, item_id, term_id)

    [taken] = await _notifications(client, lister_token, "TERM_ITEM_LISTING_TAKEN")
    assert taken["message"] == (
        f"„{taker_name}” weźmie „Rowerek” — przynieś w {_WHEN} — Krąg Kasztany"
    )
    [reserved] = await _notifications(client, taker_token, "ITEM_RESERVED_FOR_PICKUP")
    assert reserved["message"] == f"Zarezerwowano „Rowerek” — odbierz w {_WHEN} — Krąg Kasztany"


async def test_takeItemListing_255CharacterNames_messagesCappedAt500AndPersisted(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    freeze_local_now(_NOW)
    org_token, _ = await _register(client, "ORGANIZER", "hc2.org@example.com")
    group_id, term_id = await _circle_with_term(client, org_token, "Krąg długi")
    lister_token, item_id = await _listed_item(
        client, db_session, "hc2", group_id, term_id, "Długa rzecz", ReservationType.GIFT
    )
    taker_token, taker_party_id = await _attendee(client, "hc2", group_id, term_id)

    item = (
        await db_session.execute(select(InventoryItem).where(InventoryItem.id == item_id))
    ).scalar_one()
    product = (
        await db_session.execute(select(Product).where(Product.id == item.product_id))
    ).scalar_one()
    product.name = "p" * 255
    group = (await db_session.execute(select(Group).where(Group.id == group_id))).scalar_one()
    group.name = "g" * 255
    profile = (
        await db_session.execute(select(UserProfile).where(UserProfile.party_id == taker_party_id))
    ).scalar_one()
    profile.display_name = "t" * 255
    await db_session.commit()

    await _take(db_session, taker_token, item_id, term_id)

    [taken] = await _notifications(client, lister_token, "TERM_ITEM_LISTING_TAKEN")
    [reserved] = await _notifications(client, taker_token, "ITEM_RESERVED_FOR_PICKUP")
    for message in (str(taken["message"]), str(reserved["message"])):
        assert len(message) == 500
        assert message.endswith("…")


async def test_acceptSwapProposal_viaApi_returnsTermAndGroupAndSendsDatedCopy(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    freeze_local_now(_NOW)
    org_token, _ = await _register(client, "ORGANIZER", "hc3.org@example.com")
    group_id, term_id = await _circle_with_term(client, org_token, "Krąg Zamiany")
    lister_token, listed_item_id = await _listed_item(
        client, db_session, "hc3", group_id, term_id, "Klocki", ReservationType.SWAP
    )
    proposer_token, _ = await _attendee(client, "hc3", group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Lalka")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )
    proposed = await client.post(
        f"/api/term-item-listings/{listed_item_id}/propose",
        json={"offered_item_id": str(offered_item_id), "term_id": str(term_id)},
        headers=_auth(proposer_token),
    )
    assert proposed.status_code == 200, proposed.text
    assert set(proposed.json()) == _SWAP_RESPONSE_KEYS

    accepted = await client.post(
        f"/api/swap-proposals/{proposed.json()['id']}/accept", headers=_auth(lister_token)
    )

    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["status"] == "ACCEPTED"
    assert body["proposer_reservation_id"] == proposed.json()["proposer_reservation_id"]
    assert body["term_id"] == str(term_id)
    assert body["term_occurs_on"] == _TERM_AT
    assert body["group_id"] == str(group_id)
    assert body["group_name"] == "Krąg Zamiany"
    [notification] = await _notifications(client, proposer_token, "SWAP_ACCEPTED")
    assert notification["message"] == (
        "Twoja propozycja zamiany za „Klocki” została zaakceptowana"
        f" — wymiana w {_WHEN} — Krąg Zamiany"
    )


async def test_rejectSwapProposal_viaApi_responseHasNoAcceptFields(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    freeze_local_now(_NOW)
    org_token, _ = await _register(client, "ORGANIZER", "hc4.org@example.com")
    group_id, term_id = await _circle_with_term(client, org_token, "Krąg Odmowy")
    lister_token, listed_item_id = await _listed_item(
        client, db_session, "hc4", group_id, term_id, "Puzzle", ReservationType.SWAP
    )
    proposer_token, _ = await _attendee(client, "hc4", group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Piłka")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )
    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )

    rejected = await client.post(
        f"/api/swap-proposals/{proposal.id}/reject", headers=_auth(lister_token)
    )

    assert rejected.status_code == 200, rejected.text
    assert set(rejected.json()) == _SWAP_RESPONSE_KEYS
    assert rejected.json()["status"] == "REJECTED"


async def _accepted_swap(
    client: AsyncClient, db: AsyncSession, prefix: str, group_name: str
) -> tuple[str, str, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    org_token, _ = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    group_id, term_id = await _circle_with_term(client, org_token, group_name)
    lister_token, listed_item_id = await _listed_item(
        client, db, prefix, group_id, term_id, "Klocki", ReservationType.SWAP
    )
    proposer_token, _ = await _attendee(client, prefix, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Lalka")
    await service.set_item_listing_preference(
        db, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )
    proposal = await service.propose_swap(
        db, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    return lister_token, proposer_token, group_id, term_id, listed_item_id, proposal.id


async def test_acceptSwapProposal_255CharacterNames_swapAcceptedMessageCappedAt500(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    freeze_local_now(_NOW)
    lister_token, proposer_token, group_id, _, listed_item_id, proposal_id = (
        await _accepted_swap(client, db_session, "hc5", "Krąg długi")
    )
    item = (
        await db_session.execute(select(InventoryItem).where(InventoryItem.id == listed_item_id))
    ).scalar_one()
    product = (
        await db_session.execute(select(Product).where(Product.id == item.product_id))
    ).scalar_one()
    product.name = "p" * 255
    group = (await db_session.execute(select(Group).where(Group.id == group_id))).scalar_one()
    group.name = "g" * 255
    await db_session.commit()

    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal_id)

    [notification] = await _notifications(client, proposer_token, "SWAP_ACCEPTED")
    message = str(notification["message"])
    assert len(message) == 500
    assert message.endswith("…")


async def test_getItemDetails_offeredItemInTransit_partiesSeeTermAndGroupOutsiderGetsNull(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    freeze_local_now(_NOW)
    lister_token, proposer_token, group_id, term_id, _, proposal_id = await _accepted_swap(
        client, db_session, "hc6", "Krąg Tranzyt"
    )
    offered_item_id = (
        await service.accept_swap_proposal(db_session, _principal(lister_token), proposal_id)
    ).offered_item_id
    outsider_token, _ = await _register(client, "GUEST", "hc6.outsider@example.com")

    statuses: dict[str, dict[str, object]] = {}
    for viewer, token in (
        ("proposer", proposer_token),
        ("lister", lister_token),
        ("outsider", outsider_token),
    ):
        response = await client.get(
            f"/api/inventory-items/{offered_item_id}/details", headers=_auth(token)
        )
        assert response.status_code == 200, response.text
        statuses[viewer] = response.json()["status"]

    for viewer in ("proposer", "lister"):
        assert statuses[viewer]["code"] == "IN_TRANSIT"
        assert statuses[viewer]["term_id"] == str(term_id)
        assert statuses[viewer]["group_id"] == str(group_id)
        assert statuses[viewer]["group_name"] == "Krąg Tranzyt"
    outsider = statuses["outsider"]
    assert outsider["code"] == "IN_TRANSIT"
    assert outsider["term_occurs_on"] == _TERM_AT
    assert (outsider["term_id"], outsider["group_id"], outsider["group_name"]) == (None, None, None)
