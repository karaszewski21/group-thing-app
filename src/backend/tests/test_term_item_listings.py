"""`app.groups.application.term_item_listings` — the eligibility-gated
(attendee OR Circle organizer) list/browse/take use cases built on a
standing, Term-independent `ItemListingPreference` (implementation/spec.md,
redesigned after the original per-Term explicit-listing shape). No router
test exists for the preference-set endpoint here (see
`test_term_item_listings_router.py`); the use cases under test are called
directly against `db_session`; setup (users, circle, term, products,
inventory items, `TermAttendance` rows) goes through the real HTTP API,
mirroring `test_pledge_fulfillment.py`'s style.

`TermAttendance` rows are created via the existing, optional-auth
`POST /api/groups/public/{group_id}/rsvp` endpoint with an `Authorization`
header — it attaches the RSVP to the caller's own account party
(`attached_to_account: True`) rather than minting an anonymous profile.
"""

from __future__ import annotations

import inspect
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import cast

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application import reservation_transitions
from app.circulation.application.inventory import get_inventory
from app.circulation.application.inventory_items import get_item, get_item_balance
from app.circulation.models import (
    BalanceStatus,
    CirculationTransaction,
    Inventory,
    InventoryBalance,
    InventoryItem,
    MovementType,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, BusinessConflictException
from app.core.security import decode_token
from app.groups import service
from app.groups.application.term_item_listings import TermAlreadyResolvedException
from app.groups.infrastructure import circulation_bridge, repository
from app.groups.models import Term
from app.groups.schemas import TakeTermItemListingRequest
from tests.ledger_assertions import assert_ledger_matches_projection, movements_for_item


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _principal(token: str) -> Principal:
    """Builds a real `Principal` from a registered user's own login token
    (decoded, not fabricated) — `service.*` use cases resolve the caller's
    `UserProfile` from `principal.username` via `get_profile_by_principal`."""
    claims = decode_token(token, settings.jwt_secret)
    return Principal(username=claims["sub"], authorities=frozenset())


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, uuid.UUID]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], uuid.UUID(r.json()["party_id"])


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str
) -> tuple[uuid.UUID, uuid.UUID]:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return uuid.UUID(circle.json()["id"]), uuid.UUID(term.json()["id"])


async def _add_term(client: AsyncClient, org_token: str, group_id: uuid.UUID) -> uuid.UUID:
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": str(group_id),
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return uuid.UUID(term.json()["id"])


async def _rsvp(
    client: AsyncClient, token: str, group_id: uuid.UUID, term_id: uuid.UUID
) -> uuid.UUID:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": str(term_id), "guardian_name": "ignored", "child_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 201
    assert r.json()["attached_to_account"] is True
    return uuid.UUID(r.json()["id"])


async def _category_id(client: AsyncClient, token: str) -> str:
    categories = await client.get("/api/categories", headers=_auth(token))
    assert categories.status_code == 200
    return str(categories.json()[0]["id"])


async def _resolve_product(client: AsyncClient, token: str, name: str) -> str:
    r = await client.post(
        "/api/products/resolve",
        json={"name": name, "category_id": await _category_id(client, token)},
        headers=_auth(token),
    )
    assert r.status_code == 200
    return r.json()["id"]


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> uuid.UUID:
    product_id = await _resolve_product(client, token, product_name)
    inv = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inv.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={"inventory_id": inv.json()["id"], "product_id": product_id, "condition": "GOOD"},
        headers=_auth(token),
    )
    assert item.status_code == 201
    return uuid.UUID(item.json()["id"])


async def test_setPreference_activeAttendee_thenVisibleInMyListings(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "til.org1@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til1")

    lister_token, lister_party_id = await _register(client, "GUEST", "til.lister1@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Rowerek")

    preference = await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )
    assert preference is not None
    assert preference.item_id == item_id
    assert preference.mode == "LEND"

    mine = await service.list_my_term_item_listings(db_session, term_id, lister_party_id)
    assert len(mine) == 1
    assert mine[0].item_id == item_id
    assert mine[0].offered_types == ["LEND"]


async def test_setPreference_none_clearsIt(client: AsyncClient, db_session: AsyncSession) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "til.org2@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til2")

    lister_token, lister_party_id = await _register(client, "GUEST", "til.lister2@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Klocki")

    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )
    cleared = await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, None
    )
    assert cleared is None

    mine = await service.list_my_term_item_listings(db_session, term_id, lister_party_id)
    assert mine == []


async def test_browseListing_visibleOnlyToSameTermAttendee(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "til.org3@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til3")
    other_term_id = await _add_term(client, org_token, group_id)

    lister_token, _ = await _register(client, "GUEST", "til.lister3@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Sanki")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    same_term_token, same_term_party_id = await _register(client, "GUEST", "til.same3@example.com")
    await _rsvp(client, same_term_token, group_id, term_id)

    other_term_token, other_term_party_id = await _register(
        client, "GUEST", "til.other3@example.com"
    )
    await _rsvp(client, other_term_token, group_id, other_term_id)

    visible = await service.list_browsable_term_item_listings(
        db_session, term_id, same_term_party_id
    )
    assert len(visible) == 1
    assert visible[0].item_id == item_id

    # An attendee of a *different* Term, browsing that other Term, never
    # sees an item offered by someone who never attended it — a standing
    # preference alone isn't enough (Core Requirement 3), attendance for
    # *that* Term still is.
    visible_other_term = await service.list_browsable_term_item_listings(
        db_session, other_term_id, other_term_party_id
    )
    assert visible_other_term == []


async def test_browseListing_organizerItem_visibleWithoutOrganizerAttendance(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The organizer never RSVPs to their own Term, but their own moded
    items must still show up there for attendees to take."""
    org_token, org_party_id = await _register(client, "ORGANIZER", "til.org4@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til4")
    item_id = await _register_personal_item(client, org_token, "Namiot")
    await service.set_item_listing_preference(
        db_session, _principal(org_token), item_id, ReservationType.LEND
    )

    attendee_token, attendee_party_id = await _register(client, "GUEST", "til.att4@example.com")
    await _rsvp(client, attendee_token, group_id, term_id)

    visible = await service.list_browsable_term_item_listings(
        db_session, term_id, attendee_party_id
    )
    assert len(visible) == 1
    assert visible[0].item_id == item_id
    assert visible[0].lister_party_id == org_party_id

    # And the organizer sees it themself in "Twoje wystawione rzeczy"
    # without ever holding a `TermAttendance` row.
    mine = await service.list_my_term_item_listings(db_session, term_id, org_party_id)
    assert len(mine) == 1
    assert mine[0].item_id == item_id


async def test_takeListing_lendType_leavesReservationPendingAndNotifiesLister(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """(a) No more unilateral auto-confirm: a GIFT/LEND take leaves the
    `Reservation` `PENDING` — the lister must resolve it later via
    `confirm_transaction` — and the lister is notified of the take."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org5@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til5")

    lister_token, _ = await _register(client, "GUEST", "til.lister5@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Wozek")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    taker_token, taker_party_id = await _register(client, "GUEST", "til.taker5@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="LEND"),
    )

    assert taken.resolved_reservation_id is not None
    assert taken.taken_by_party_id == taker_party_id

    reservation = await client.get(
        f"/api/reservations/{taken.resolved_reservation_id}", headers=_auth(taker_token)
    )
    assert reservation.status_code == 200
    assert reservation.json()["reservation_type"] == "LEND"
    assert reservation.json()["item_id"] == str(item_id)
    assert reservation.json()["status"] == "PENDING"

    notifs = (await client.get("/api/notifications/mine", headers=_auth(lister_token))).json()
    assert any(n["kind"] == "TERM_ITEM_LISTING_TAKEN" for n in notifs)


async def test_proposeSwap_locksOnlyProposerItem_andNotifiesOwner(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """(b) `propose_swap` locks (and auto-confirms) only the proposer's own
    offered item, creates a `PROPOSED` `SwapProposal`, leaves the listed
    item `AVAILABLE`, and notifies the listing owner."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org6@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til6")

    lister_token, _ = await _register(client, "GUEST", "til.lister6@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Gra planszowa")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker6@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, "Puzzle")
    await service.set_item_listing_preference(
        db_session, _principal(taker_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )

    assert proposal.status == "PROPOSED"
    assert proposal.listing_item_id == listed_item_id
    assert proposal.offered_item_id == offered_item_id

    proposer_reservation = await client.get(
        f"/api/reservations/{proposal.proposer_reservation_id}", headers=_auth(taker_token)
    )
    assert proposer_reservation.status_code == 200
    assert proposer_reservation.json()["item_id"] == str(offered_item_id)
    assert proposer_reservation.json()["status"] == "CONFIRMED"

    listing_balance = await get_item_balance(db_session, listed_item_id)
    assert listing_balance.status == BalanceStatus.AVAILABLE

    notifs = (await client.get("/api/notifications/mine", headers=_auth(lister_token))).json()
    assert any(n["kind"] == "SWAP_PROPOSED" for n in notifs)


async def test_proposeSwap_notificationCarriesRealProposalId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Group 9 gap fix: the `SWAP_PROPOSED` notification exposes the real
    `SwapProposal.id` (not the proposer's `Reservation.id`) so the frontend's
    global pending-actions modal can `accept`/`reject` it directly, without
    a deep-link to the term page."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org22@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til22")

    lister_token, _ = await _register(client, "GUEST", "til.lister22@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Deskorolka")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker22@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, "Kask")
    await service.set_item_listing_preference(
        db_session, _principal(taker_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )

    notifs = (await client.get("/api/notifications/mine", headers=_auth(lister_token))).json()
    swap_notif = next(n for n in notifs if n["kind"] == "SWAP_PROPOSED")
    assert swap_notif["proposal_id"] == str(proposal.id)
    # Distinct from the proposer's own reservation leg — this is exactly the
    # gap the fix closes (they must never be conflated).
    assert swap_notif["proposal_id"] != str(proposal.proposer_reservation_id)


async def test_acceptSwapProposal_locksOwnerItem_pairsLegs_andNotifiesProposer(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """(c) Accepting locks the listing owner's item as the second, paired
    leg, sets the proposal `ACCEPTED`, and notifies the proposer."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org13@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til13")

    lister_token, _ = await _register(client, "GUEST", "til.lister13@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Rower")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker13@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, "Deska")
    await service.set_item_listing_preference(
        db_session, _principal(taker_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )

    accepted = await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)
    assert accepted.status == "ACCEPTED"

    owner_leg = await client.get(
        f"/api/reservations/{accepted.proposer_reservation_id}", headers=_auth(lister_token)
    )
    paired_id = owner_leg.json()["paired_reservation_id"]
    assert paired_id is not None

    listing_leg = await client.get(f"/api/reservations/{paired_id}", headers=_auth(lister_token))
    assert listing_leg.status_code == 200
    assert listing_leg.json()["item_id"] == str(listed_item_id)
    assert listing_leg.json()["status"] == "CONFIRMED"
    assert listing_leg.json()["paired_reservation_id"] == str(accepted.proposer_reservation_id)

    notifs = (await client.get("/api/notifications/mine", headers=_auth(taker_token))).json()
    assert any(n["kind"] == "SWAP_ACCEPTED" for n in notifs)


async def test_rejectSwapProposal_releasesProposerLock_andNotifiesProposer(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """(d) Rejecting cancels the proposer's own lock (item goes back to
    `AVAILABLE`), sets the proposal `REJECTED`, and notifies the proposer."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org14@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til14")

    lister_token, _ = await _register(client, "GUEST", "til.lister14@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Aparat")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker14@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, "Statyw")
    await service.set_item_listing_preference(
        db_session, _principal(taker_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )

    rejected = await service.reject_swap_proposal(db_session, _principal(lister_token), proposal.id)
    assert rejected.status == "REJECTED"

    offered_balance = await get_item_balance(db_session, offered_item_id)
    assert offered_balance.status == BalanceStatus.AVAILABLE

    notifs = (await client.get("/api/notifications/mine", headers=_auth(taker_token))).json()
    assert any(n["kind"] == "SWAP_REJECTED" for n in notifs)


async def test_confirmTransaction_beforeTermEnd_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """(e) `confirm_transaction` is blocked while the Term hasn't occurred
    yet."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org15@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til15")

    lister_token, _ = await _register(client, "GUEST", "til.lister15@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Kajak")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker15@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    with pytest.raises(BusinessConflictException):
        await service.confirm_transaction(
            db_session, _principal(taker_token), taken.resolved_reservation_id
        )


async def test_confirmTransaction_afterTermEnd_fulfillsReservation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """(f) After the Term has ended, either party's `confirm_transaction`
    call succeeds and actually moves inventory (`FULFILLED`)."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org16@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til16")

    lister_token, _ = await _register(client, "GUEST", "til.lister16@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Namiot16")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker16@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    fulfilled = await service.confirm_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )
    assert fulfilled.status == "FULFILLED"

    balance = await get_item_balance(db_session, item_id)
    assert balance.status == BalanceStatus.AVAILABLE


async def test_confirmTransaction_secondCaller_getsAlreadyResolvedOutcomeAndNotification(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """(g) Once the first party has resolved the transaction, the second
    (losing) party's call gets a distinguishable `TermAlreadyResolvedException`
    outcome, not a raw `BusinessConflictException`, plus a
    `TERM_ALREADY_RESOLVED` notification."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org17@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til17")

    lister_token, _ = await _register(client, "GUEST", "til.lister17@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Sanki17")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker17@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.confirm_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )

    with pytest.raises(TermAlreadyResolvedException):
        await service.confirm_transaction(
            db_session, _principal(lister_token), taken.resolved_reservation_id
        )

    notifs = (await client.get("/api/notifications/mine", headers=_auth(lister_token))).json()
    assert any(n["kind"] == "TERM_ALREADY_RESOLVED" for n in notifs)


async def test_confirmTransaction_nonParty_raisesAccessDenied(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """(h) A caller who is neither the reservation's holder nor its
    `reserved_by` party is rejected by
    `confirm_race_rules._require_race_participant`."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org18@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til18")

    lister_token, _ = await _register(client, "GUEST", "til.lister18@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Piłka18")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker18@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    outsider_token, _ = await _register(client, "GUEST", "til.outsider18@example.com")

    with pytest.raises(AccessDeniedException):
        await service.confirm_transaction(
            db_session, _principal(outsider_token), taken.resolved_reservation_id
        )


async def test_confirmTransaction_swapCounterpartyConfirmsViaPairedLegId_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression: the frontend's `resolvePendingReservationId` hands each
    caller the OTHER party's (paired) reservation_id, not their own leg's —
    so `confirm_transaction` must recognize the listing owner as a valid
    race participant when confirming via the PROPOSER's reservation_id
    (and vice versa), not just when a party happens to confirm their own
    leg's id. This was broken by an earlier fix attempt that conflated
    `_resolve_transaction_holder_user_id`'s "counterparty for the race
    check" role with the unrelated "current physical holder to satisfy
    `circulation_bridge.confirm_reservation`'s internal check" role,
    which caused the OPPOSITE bug (both parties always 403, regardless of
    which leg's id was used)."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org19@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til19")

    lister_token, _ = await _register(client, "GUEST", "til.lister19@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Gitara19")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    proposer_token, _ = await _register(client, "GUEST", "til.proposer19@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Keyboard19")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    proposer_leg = await client.get(
        f"/api/reservations/{proposal.proposer_reservation_id}", headers=_auth(proposer_token)
    )
    paired_leg_id = proposer_leg.json()["paired_reservation_id"]
    assert paired_leg_id is not None

    # The LISTER confirms using the PROPOSER's reservation id (the paired
    # leg from the lister's own perspective) — exactly the id
    # `resolvePendingReservationId` would hand them on the frontend.
    fulfilled = await service.confirm_transaction(
        db_session, _principal(lister_token), proposal.proposer_reservation_id
    )
    assert fulfilled.status == "FULFILLED"

    paired = await client.get(f"/api/reservations/{paired_leg_id}", headers=_auth(lister_token))
    assert paired.json()["status"] == "FULFILLED"

    # The actual point of a swap: each item must now sit in the OTHER
    # party's warehouse (inventory), not stay put. This is the exact gap
    # that let the real bug through every earlier test here — those only
    # ever asserted `Reservation.status`/`InventoryBalance.status`, never
    # where the item actually ended up.
    lister_account_user_id = uuid.UUID(
        (await client.get("/api/people/me", headers=_auth(lister_token))).json()["account_user_id"]
    )
    proposer_account_user_id = uuid.UUID(
        (await client.get("/api/people/me", headers=_auth(proposer_token))).json()[
            "account_user_id"
        ]
    )

    listed_item_after = await get_item(db_session, listed_item_id)
    offered_item_after = await get_item(db_session, offered_item_id)
    listed_item_inventory = await get_inventory(db_session, listed_item_after.inventory_id)
    offered_item_inventory = await get_inventory(db_session, offered_item_after.inventory_id)

    # The lister's listed item must now belong to the PROPOSER.
    assert listed_item_inventory.owner_user_id == proposer_account_user_id
    # The proposer's offered item must now belong to the LISTER.
    assert offered_item_inventory.owner_user_id == lister_account_user_id

    listing_balance = await get_item_balance(db_session, listed_item_id)
    offered_balance = await get_item_balance(db_session, offered_item_id)
    assert listing_balance.status == BalanceStatus.AVAILABLE
    assert offered_balance.status == BalanceStatus.AVAILABLE


async def test_cancelTransaction_beforeTermEnd_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Bug #4b: `cancel_transaction` shares the same term-ended gate as
    `confirm_transaction` via `_resolve_transaction_reservations_for_action`."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org20@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til20")

    lister_token, _ = await _register(client, "GUEST", "til.lister20@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Kajak20")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker20@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    with pytest.raises(BusinessConflictException):
        await service.cancel_transaction(
            db_session, _principal(taker_token), taken.resolved_reservation_id
        )


async def test_cancelTransaction_singleLendReservation_releasedToAvailable(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Happy path: a single LEND/GIFT-style reservation is CANCELLED and
    the item's balance goes back to AVAILABLE — the non-SWAP counterpart of
    `confirm_transaction`'s fulfill step."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org21@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til21")

    lister_token, _ = await _register(client, "GUEST", "til.lister21@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Namiot21")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker21@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    cancelled = await service.cancel_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )
    assert cancelled.status == "CANCELLED"

    balance = await get_item_balance(db_session, item_id)
    assert balance.status == BalanceStatus.AVAILABLE


async def test_cancelTransaction_swapPairedLegs_bothReleasedTogether(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Highest-regression-risk case per gap analysis: cancelling a SWAP via
    either party's reservation id must release BOTH paired legs, mirroring
    `confirm_transaction`'s SWAP-pair fulfillment symmetry."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org22@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til22")

    lister_token, _ = await _register(client, "GUEST", "til.lister22@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Gitara22")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    proposer_token, _ = await _register(client, "GUEST", "til.proposer22@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Keyboard22")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    proposer_leg = await client.get(
        f"/api/reservations/{proposal.proposer_reservation_id}", headers=_auth(proposer_token)
    )
    paired_leg_id = proposer_leg.json()["paired_reservation_id"]
    assert paired_leg_id is not None

    # The LISTER cancels using the PROPOSER's reservation id — exactly the
    # paired-leg-id scenario that
    # `test_confirmTransaction_swapCounterpartyConfirmsViaPairedLegId_succeeds`
    # exercises for confirm.
    cancelled = await service.cancel_transaction(
        db_session, _principal(lister_token), proposal.proposer_reservation_id
    )
    assert cancelled.status == "CANCELLED"

    paired = await client.get(f"/api/reservations/{paired_leg_id}", headers=_auth(lister_token))
    assert paired.json()["status"] == "CANCELLED"

    listing_balance = await get_item_balance(db_session, listed_item_id)
    offered_balance = await get_item_balance(db_session, offered_item_id)
    assert listing_balance.status == BalanceStatus.AVAILABLE
    assert offered_balance.status == BalanceStatus.AVAILABLE


async def test_cancelTransaction_secondCaller_getsAlreadyResolvedOutcomeAndNotification(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Already-resolved race: once the first party has cancelled the
    transaction, the second (losing) party's cancel call gets
    `TermAlreadyResolvedException`, not a raw conflict, plus the same
    `TERM_ALREADY_RESOLVED` notification `confirm_transaction` sends."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org23@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til23")

    lister_token, _ = await _register(client, "GUEST", "til.lister23@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Sanki23")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker23@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.cancel_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )

    with pytest.raises(TermAlreadyResolvedException):
        await service.cancel_transaction(
            db_session, _principal(lister_token), taken.resolved_reservation_id
        )

    notifs = (await client.get("/api/notifications/mine", headers=_auth(lister_token))).json()
    assert any(n["kind"] == "TERM_ALREADY_RESOLVED" for n in notifs)


async def test_cancelTransaction_nonParty_raisesAccessDenied(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A caller who is neither the reservation's holder nor its
    `reserved_by` party is rejected by the shared
    `confirm_race_rules._require_race_participant` gate, same as
    `confirm_transaction`."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org24@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til24")

    lister_token, _ = await _register(client, "GUEST", "til.lister24@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Piłka24")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker24@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    outsider_token, _ = await _register(client, "GUEST", "til.outsider24@example.com")

    with pytest.raises(AccessDeniedException):
        await service.cancel_transaction(
            db_session, _principal(outsider_token), taken.resolved_reservation_id
        )


async def test_setPreference_afterGiftFulfillment_reassignsOwnerToNewHolder(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Bug #2 regression: once a GIFT `confirm_transaction` actually moves
    the item into the taker's own personal inventory, the taker listing it
    must yield a preference owned by the new holder — not one still
    pointing at the original lister, which previously left the listing
    permanently misattributed to whoever first offered it."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org20@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til20")

    lister_token, lister_party_id = await _register(client, "GUEST", "til.lister20@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Deska20")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, taker_party_id = await _register(client, "GUEST", "til.taker20@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.confirm_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )

    # The item now physically belongs to the taker — the lister's GIFT
    # preference was cleared at fulfillment, so listing it creates a fresh
    # `ItemListingPreference` row owned by the taker.
    relisted = await service.set_item_listing_preference(
        db_session, _principal(taker_token), item_id, ReservationType.LEND
    )
    assert relisted is not None
    assert relisted.owner_party_id == taker_party_id

    taker_mine = await service.list_my_term_item_listings(db_session, term_id, taker_party_id)
    assert len(taker_mine) == 1
    assert taker_mine[0].item_id == item_id
    assert taker_mine[0].lister_party_id == taker_party_id

    # The original lister no longer sees it under their own listings.
    original_lister_mine = await service.list_my_term_item_listings(
        db_session, term_id, lister_party_id
    )
    assert original_lister_mine == []


async def test_setPreference_afterSwapFulfillment_reassignsOwnerForReceivedItem(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Same Bug #2 fix, exercised through the SWAP path: once
    `accept_swap_proposal` + `confirm_transaction` moves the listed item
    into the proposer's inventory (and the offered item into the original
    lister's), the proposer re-listing the item they just received must
    reassign `owner_party_id` to themself."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org21@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til21")

    lister_token, _ = await _register(client, "GUEST", "til.lister21@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Gitara21")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    proposer_token, proposer_party_id = await _register(
        client, "GUEST", "til.proposer21@example.com"
    )
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Keyboard21")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.confirm_transaction(
        db_session, _principal(proposer_token), proposal.proposer_reservation_id
    )

    # The proposer now physically holds the originally-listed item — they
    # re-list it under their own preference.
    relisted = await service.set_item_listing_preference(
        db_session, _principal(proposer_token), listed_item_id, ReservationType.GIFT
    )
    assert relisted is not None
    assert relisted.owner_party_id == proposer_party_id

    proposer_mine = await service.list_my_term_item_listings(db_session, term_id, proposer_party_id)
    item_ids = {pref.item_id for pref in proposer_mine}
    assert listed_item_id in item_ids


async def test_confirmTransaction_organizerGift_clearsPreference_notReofferedOnNextTerm(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression: after an organizer's GIFT is fulfilled the item belongs to
    the taker, so the organizer's standing GIFT preference is deleted —
    otherwise the organizer (always eligible to list) kept re-offering the
    already-given item on every following Term."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org40@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til40")
    item_id = await _register_personal_item(client, org_token, "Hulajnoga40")
    await service.set_item_listing_preference(
        db_session, _principal(org_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker40@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.confirm_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )

    assert await repository.get_item_listing_preference(db_session, item_id) is None

    next_term_id = await _add_term(client, org_token, group_id)
    viewer_token, viewer_party_id = await _register(client, "GUEST", "til.viewer40@example.com")
    await _rsvp(client, viewer_token, group_id, next_term_id)
    browse = await service.list_browsable_term_item_listings(
        db_session, next_term_id, viewer_party_id
    )
    assert item_id not in {row.item_id for row in browse}

    org_items = await service.list_my_inventory_items(db_session, _principal(org_token))
    assert item_id not in {row.id for row in org_items}
    taker_items = await service.list_my_inventory_items(db_session, _principal(taker_token))
    assert {row.id: row.listing_mode for row in taker_items} == {item_id: None}


async def test_confirmTransaction_swap_clearsBothPreferences(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Both swapped items change hands, so both parties' SWAP preferences
    are deleted — and the listing owner's later call is still recognized as
    a participant (via `giver_user_id`), getting the already-resolved
    outcome rather than a 403."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org41@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til41")

    lister_token, _ = await _register(client, "GUEST", "til.lister41@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Gitara41")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    proposer_token, _ = await _register(client, "GUEST", "til.proposer41@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Keyboard41")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.confirm_transaction(
        db_session, _principal(proposer_token), proposal.proposer_reservation_id
    )

    assert await repository.get_item_listing_preference(db_session, listed_item_id) is None
    assert await repository.get_item_listing_preference(db_session, offered_item_id) is None

    with pytest.raises(TermAlreadyResolvedException):
        await service.confirm_transaction(
            db_session, _principal(lister_token), proposal.proposer_reservation_id
        )


async def test_cancelTransaction_gift_keepsPreference(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A cancelled GIFT never changes hands, so the lister's offer stands."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org42@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til42")

    lister_token, _ = await _register(client, "GUEST", "til.lister42@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Sanki42")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker42@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.cancel_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )

    preference = await repository.get_item_listing_preference(db_session, item_id)
    assert preference is not None
    assert preference.mode == ReservationType.GIFT.value


async def test_takeListing_unofferedReservationType_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "til.org7@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til7")

    lister_token, _ = await _register(client, "GUEST", "til.lister7@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Hulajnoga")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker7@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    with pytest.raises(BusinessConflictException):
        await service.take_item_listing(
            db_session,
            _principal(taker_token),
            item_id,
            TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
        )


async def test_setPreference_whileItemLentOut_stillSucceeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression guard: while an item is on loan, `item.inventory_id`
    temporarily points at the borrower's VIRTUAL inventory (see
    `app.circulation`'s LEND fulfillment). `set_item_listing_preference`'s
    ownership check must resolve the item's *permanent* owner
    (`resolve_owning_inventory`), not its current physical location — the
    true owner must still be able to manage their own item's listing
    preference during the loan."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org8@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til8")

    lister_token, _ = await _register(client, "GUEST", "til.lister8@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Sanki")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    borrower_token, _ = await _register(client, "GUEST", "til.borrower8@example.com")
    await _rsvp(client, borrower_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(borrower_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="LEND"),
    )
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()
    await service.confirm_transaction(
        db_session, _principal(borrower_token), taken.resolved_reservation_id
    )

    item = await client.get(f"/api/inventory-items/{item_id}", headers=_auth(lister_token))
    assert item.json()["home_inventory_id"] is not None

    preference = await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.SWAP
    )
    assert preference is not None
    assert preference.mode == "SWAP"


# --- Gap-analysis coverage carried over from the original design -----------
#
# (a) time-based expiry of browsability (distinct from the
# attendance-withdrawal case in test_attendance_withdrawal.py), (b) a lister
# taking their own listing, (c) a taker's take succeeding only while the
# LISTER's own attendance is still active (re-checked inside
# `take_item_listing`, not just derived at browse-time), and (d) a SWAP take
# whose `offered_item_id` fails the taker's own-and-AVAILABLE check.


async def test_browseListing_termOccursOnInPast_becomesUnbrowsable(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Distinct from `test_attendance_withdrawal.py`'s withdrawal-based
    disappearance: here nobody withdraws — the Term itself simply passes
    (`Term.occurs_on < utcnow()`), which `list_browsable_term_item_listings`
    checks directly and short-circuits to `[]` before even querying rows."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org8@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til8")

    lister_token, _ = await _register(client, "GUEST", "til.lister8@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Latawiec")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    viewer_token, viewer_party_id = await _register(client, "GUEST", "til.viewer8@example.com")
    await _rsvp(client, viewer_token, group_id, term_id)

    visible_before = await service.list_browsable_term_item_listings(
        db_session, term_id, viewer_party_id
    )
    assert len(visible_before) == 1

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    visible_after = await service.list_browsable_term_item_listings(
        db_session, term_id, viewer_party_id
    )
    assert visible_after == []


async def test_takeListing_ownListing_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "til.org9@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til9")

    lister_token, _ = await _register(client, "GUEST", "til.lister9@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Skakanka")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    with pytest.raises(BusinessConflictException):
        await service.take_item_listing(
            db_session,
            _principal(lister_token),
            item_id,
            TakeTermItemListingRequest(term_id=term_id, reservation_type="LEND"),
        )


async def test_takeListing_listerAttendanceLapsedSinceListing_raisesAccessDenied(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """`take_item_listing` re-checks the LISTER's own eligibility (not just
    the taker's) at take-time — a standing preference set while the lister
    was an active attendee goes stale for this Term once they withdraw, even
    though the preference row itself is untouched."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org10@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til10")

    lister_token, _ = await _register(client, "GUEST", "til.lister10@example.com")
    lister_attendance_id = await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Deskorolka")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker10@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    await service.withdraw_attendance(db_session, _principal(lister_token), lister_attendance_id)

    with pytest.raises(AccessDeniedException):
        await service.take_item_listing(
            db_session,
            _principal(taker_token),
            item_id,
            TakeTermItemListingRequest(term_id=term_id, reservation_type="LEND"),
        )


async def test_takeListing_swapOfferedItemNotOwnedByTaker_raisesAccessDenied(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "til.org11@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til11")

    lister_token, _ = await _register(client, "GUEST", "til.lister11@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Piłka")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker11@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    someone_elses_token, _ = await _register(client, "GUEST", "til.other11@example.com")
    someone_elses_item_id = await _register_personal_item(
        client, someone_elses_token, "Nie moja rzecz"
    )

    with pytest.raises(AccessDeniedException):
        await service.propose_swap(
            db_session, _principal(taker_token), listed_item_id, someone_elses_item_id, term_id
        )


async def test_listMyActiveTakenTermItemListings_pendingGiftTaken_returnsIt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The taker sees their own PENDING GIFT/LEND take via the new
    availability-independent query."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org23@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til23")

    lister_token, _ = await _register(client, "GUEST", "til.lister23@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Rolki")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, taker_party_id = await _register(client, "GUEST", "til.taker23@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    mine_as_taker = await service.list_my_active_taken_term_item_listings(
        db_session, term_id, taker_party_id
    )
    assert len(mine_as_taker) == 1
    assert mine_as_taker[0].item_id == item_id
    assert mine_as_taker[0].resolved_reservation_id == taken.resolved_reservation_id
    assert mine_as_taker[0].taken_by_party_id == taker_party_id


async def test_listMyActiveTakenTermItemListings_excludesReservationsNotHeldByCaller(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A different attendee's own take never shows up in the caller's own
    "my active reservations as taker" list — scoped strictly to the caller."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org24@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til24")

    lister_token, _ = await _register(client, "GUEST", "til.lister24@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Longboard")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker24@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    bystander_token, bystander_party_id = await _register(
        client, "GUEST", "til.bystander24@example.com"
    )
    await _rsvp(client, bystander_token, group_id, term_id)

    mine_as_taker = await service.list_my_active_taken_term_item_listings(
        db_session, term_id, bystander_party_id
    )
    assert mine_as_taker == []


async def test_listMyActiveTakenTermItemListings_excludesListerNotEligibleForTerm(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Mirrors `_list_eligible_lister_party_ids` scoping: once the lister's
    own attendance for the Term is withdrawn, their listing must not surface
    for the taker either, even though the taker's own `Reservation` row still
    exists."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org25@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til25")

    lister_token, _ = await _register(client, "GUEST", "til.lister25@example.com")
    lister_attendance_id = await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Kamera")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, taker_party_id = await _register(client, "GUEST", "til.taker25@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    assert taken.resolved_reservation_id is not None

    await service.withdraw_attendance(db_session, _principal(lister_token), lister_attendance_id)

    mine_as_taker = await service.list_my_active_taken_term_item_listings(
        db_session, term_id, taker_party_id
    )
    assert mine_as_taker == []


async def test_listMyActiveTakenTermItemListings_afterTermEnd_stillResolves(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The behavior `list_browsable_term_item_listings` structurally cannot
    serve: once `term.occurs_on < now()`, the taker's own active reservation
    must still resolve here (unlike `browse`, which short-circuits to `[]`)."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org26@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til26")

    lister_token, _ = await _register(client, "GUEST", "til.lister26@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Sanki26")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, taker_party_id = await _register(client, "GUEST", "til.taker26@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    # The existing browse path structurally cannot serve this anymore.
    browsable = await service.list_browsable_term_item_listings(db_session, term_id, taker_party_id)
    assert browsable == []

    mine_as_taker = await service.list_my_active_taken_term_item_listings(
        db_session, term_id, taker_party_id
    )
    assert len(mine_as_taker) == 1
    assert mine_as_taker[0].item_id == item_id
    assert mine_as_taker[0].resolved_reservation_id == taken.resolved_reservation_id


async def test_listMyActiveTakenTermItemListings_callerNotEligibleForTerm_raisesAccessDenied(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The caller-eligibility gate (`_require_term_eligibility` on the
    caller themself) — a party with no attendance/organizer status for this
    Term is denied outright, regardless of any reservation they might hold."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org27@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til27")

    outsider_token, outsider_party_id = await _register(
        client, "GUEST", "til.outsider27@example.com"
    )

    with pytest.raises(AccessDeniedException):
        await service.list_my_active_taken_term_item_listings(
            db_session, term_id, outsider_party_id
        )


async def test_takeListing_swapOfferedItemNotAvailable_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The taker's own counter-offer must also be `AVAILABLE`
    (`_require_own_available_personal_item`'s balance check) — here it's
    already `RESERVED` by a third party's pending reservation."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org12@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til12")

    lister_token, _ = await _register(client, "GUEST", "til.lister12@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Rakietka")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker12@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, "Zajęty przedmiot")

    balance = await get_item_balance(db_session, offered_item_id)
    balance.status = BalanceStatus.RESERVED
    await db_session.commit()

    with pytest.raises(BusinessConflictException):
        await service.propose_swap(
            db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
        )


# --- Group 2: SWAP-mode enforcement + circulation-ledger audit -------------


async def test_proposeSwap_offeredItemTaggedSwap_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The offered item must itself carry a `SWAP`-tagged
    `ItemListingPreference` — when it does, `propose_swap` still succeeds
    exactly as before this enforcement was added."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org28@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til28")

    lister_token, _ = await _register(client, "GUEST", "til.lister28@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Szachy")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker28@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, "Domino")
    await service.set_item_listing_preference(
        db_session, _principal(taker_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )
    assert proposal.status == "PROPOSED"
    assert proposal.offered_item_id == offered_item_id


async def test_proposeSwap_offeredItemHasNoPreference_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Backend-enforced independently of frontend filtering: an offered item
    with no standing `ItemListingPreference` at all cannot be counter-offered
    in a swap."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org29@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til29")

    lister_token, _ = await _register(client, "GUEST", "til.lister29@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Warcaby")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker29@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, "Bez preferencji")

    with pytest.raises(BusinessConflictException):
        await service.propose_swap(
            db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
        )


async def test_proposeSwap_offeredItemModeMismatch_raisesBusinessConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A non-"zamienię"-tagged item — here explicitly tagged `GIFT` instead
    of `SWAP` — cannot be offered in a swap either, distinct from the
    absent-preference case above."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org30@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til30")

    lister_token, _ = await _register(client, "GUEST", "til.lister30@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Piłkarzyki")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker30@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, "Oddam za darmo")
    await service.set_item_listing_preference(
        db_session, _principal(taker_token), offered_item_id, ReservationType.GIFT
    )

    with pytest.raises(BusinessConflictException):
        await service.propose_swap(
            db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
        )


async def _account_user_id(client: AsyncClient, token: str) -> uuid.UUID:
    me = await client.get("/api/people/me", headers=_auth(token))
    assert me.status_code == 200
    return uuid.UUID(me.json()["account_user_id"])


def _entry_lines(
    transaction: CirculationTransaction,
) -> set[tuple[uuid.UUID, uuid.UUID | None, int, uuid.UUID | None]]:
    """`(item_id, inventory_id, quantity, reservation_id)` per entry."""
    return {
        (entry.item_id, entry.account.inventory_id, entry.quantity, entry.reservation_id)
        for entry in transaction.entries
    }


async def _fresh_reservation(db: AsyncSession, reservation_id: uuid.UUID) -> Reservation:
    return (
        await db.execute(
            select(Reservation)
            .where(Reservation.id == reservation_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _fresh_item(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem:
    return (
        await db.execute(
            select(InventoryItem)
            .where(InventoryItem.id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _fresh_balance_status(db: AsyncSession, item_id: uuid.UUID) -> BalanceStatus:
    return (
        await db.execute(
            select(InventoryBalance.status)
            .where(InventoryBalance.item_id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@dataclass(frozen=True)
class _AcceptedSwap:
    lister_token: str
    proposer_token: str
    listed_item_id: uuid.UUID
    offered_item_id: uuid.UUID
    proposer_reservation_id: uuid.UUID
    owner_reservation_id: uuid.UUID


async def _accepted_swap_after_term(
    client: AsyncClient,
    db_session: AsyncSession,
    suffix: str,
    listed_name: str = "Monopoly",
    offered_name: str = "Scrabble",
) -> _AcceptedSwap:
    """Lister's item and proposer's item, both in their owners' PERSONAL
    inventories and tagged SWAP; the proposal is accepted (both legs
    CONFIRMED and paired) and the Term has already ended."""
    org_token, _ = await _register(client, "ORGANIZER", f"til.org{suffix}@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, f"til{suffix}")

    lister_token, _ = await _register(client, "GUEST", f"til.lister{suffix}@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, listed_name)
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    proposer_token, _ = await _register(client, "GUEST", f"til.proposer{suffix}@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, offered_name)
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)
    proposer_reservation = await circulation_bridge.get_reservation(
        db_session, proposal.proposer_reservation_id
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    return _AcceptedSwap(
        lister_token=lister_token,
        proposer_token=proposer_token,
        listed_item_id=listed_item_id,
        offered_item_id=offered_item_id,
        proposer_reservation_id=proposal.proposer_reservation_id,
        owner_reservation_id=cast(uuid.UUID, proposer_reservation.paired_reservation_id),
    )


async def test_confirmTransaction_giftFulfillment_postsGiftTransactionBetweenPersonalInventories(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A GIFT fulfilled via `confirm_transaction` posts one GIFT transaction
    moving the item from the lister's PERSONAL inventory to the taker's."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org31@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til31")

    lister_token, _ = await _register(client, "GUEST", "til.lister31@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Encyklopedia")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker31@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    lister_inventory_id = (await _fresh_item(db_session, item_id)).inventory_id
    reservation_id = cast(uuid.UUID, taken.resolved_reservation_id)

    await service.confirm_transaction(db_session, _principal(taker_token), reservation_id)

    taker_inventory = await circulation_bridge.find_personal_inventory(
        db_session, await _account_user_id(client, taker_token)
    )
    assert taker_inventory is not None
    gift = (await movements_for_item(db_session, item_id))[-1]
    assert gift.movement_type == MovementType.GIFT
    assert "Encyklopedia" in gift.description
    assert _entry_lines(gift) == {
        (item_id, lister_inventory_id, -1, reservation_id),
        (item_id, cast(uuid.UUID, taker_inventory.id), 1, reservation_id),
    }
    await assert_ledger_matches_projection(db_session, [item_id])


async def test_confirmTransaction_swap_postsSingleSwapTransactionWithFourEntries(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Both legs of a SWAP are posted as ONE SWAP transaction with 4 entries
    PERSONAL(A) <-> PERSONAL(B), each leg tagged with its own reservation,
    committed together with the deletion of both listing preferences."""
    swap = await _accepted_swap_after_term(client, db_session, "32")
    lister_inventory_id = (await _fresh_item(db_session, swap.listed_item_id)).inventory_id
    proposer_inventory_id = (await _fresh_item(db_session, swap.offered_item_id)).inventory_id

    await service.confirm_transaction(
        db_session, _principal(swap.lister_token), swap.proposer_reservation_id
    )
    # Discarding whatever is left uncommitted proves the use case committed
    # the exchange and the preference deletions together.
    await db_session.rollback()

    swap_transactions = [
        t
        for t in await movements_for_item(db_session, swap.listed_item_id)
        if t.movement_type == MovementType.SWAP
    ]
    assert len(swap_transactions) == 1
    transaction = swap_transactions[0]
    assert transaction.description == "SWAP: Scrabble ⇄ Monopoly"
    assert _entry_lines(transaction) == {
        (swap.offered_item_id, proposer_inventory_id, -1, swap.proposer_reservation_id),
        (swap.offered_item_id, lister_inventory_id, 1, swap.proposer_reservation_id),
        (swap.listed_item_id, lister_inventory_id, -1, swap.owner_reservation_id),
        (swap.listed_item_id, proposer_inventory_id, 1, swap.owner_reservation_id),
    }
    offered_movements = await movements_for_item(db_session, swap.offered_item_id)
    assert offered_movements[-1].id == transaction.id

    listed_item = await _fresh_item(db_session, swap.listed_item_id)
    offered_item = await _fresh_item(db_session, swap.offered_item_id)
    assert listed_item.inventory_id == proposer_inventory_id
    assert offered_item.inventory_id == lister_inventory_id
    for reservation_id in (swap.proposer_reservation_id, swap.owner_reservation_id):
        reservation = await _fresh_reservation(db_session, reservation_id)
        assert reservation.status == ReservationStatus.FULFILLED
    assert await repository.get_item_listing_preference(db_session, swap.listed_item_id) is None
    assert await repository.get_item_listing_preference(db_session, swap.offered_item_id) is None
    await assert_ledger_matches_projection(
        db_session, [swap.listed_item_id, swap.offered_item_id]
    )


async def test_confirmTransaction_swapFailureInSecondLeg_leavesNoChanges(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    swap = await _accepted_swap_after_term(client, db_session, "50")
    item_ids = (swap.listed_item_id, swap.offered_item_id)
    inventories_before = {
        item_id: (await _fresh_item(db_session, item_id)).inventory_id for item_id in item_ids
    }
    transactions_before = {
        item_id: len(await movements_for_item(db_session, item_id)) for item_id in item_ids
    }

    original = reservation_transitions.get_or_create_personal_inventory
    calls = 0

    async def failing_on_second_call(db: AsyncSession, owner_user_id: uuid.UUID) -> Inventory:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("forced failure in the second leg")
        return await original(db, owner_user_id)

    monkeypatch.setattr(
        reservation_transitions, "get_or_create_personal_inventory", failing_on_second_call
    )

    with pytest.raises(RuntimeError):
        await service.confirm_transaction(
            db_session, _principal(swap.proposer_token), swap.proposer_reservation_id
        )
    await db_session.rollback()

    assert calls == 2
    for reservation_id in (swap.proposer_reservation_id, swap.owner_reservation_id):
        reservation = await _fresh_reservation(db_session, reservation_id)
        assert reservation.status == ReservationStatus.CONFIRMED
    for item_id in item_ids:
        assert (await _fresh_item(db_session, item_id)).inventory_id == inventories_before[item_id]
        assert len(await movements_for_item(db_session, item_id)) == transactions_before[item_id]
        assert await repository.get_item_listing_preference(db_session, item_id) is not None


async def test_cancelTransaction_swap_cancelsBothLegsInOneCommit(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    swap = await _accepted_swap_after_term(client, db_session, "51")

    await service.cancel_transaction(
        db_session, _principal(swap.proposer_token), swap.owner_reservation_id
    )
    await db_session.rollback()

    for reservation_id in (swap.proposer_reservation_id, swap.owner_reservation_id):
        reservation = await _fresh_reservation(db_session, reservation_id)
        assert reservation.status == ReservationStatus.CANCELLED
    for item_id in (swap.listed_item_id, swap.offered_item_id):
        assert await _fresh_balance_status(db_session, item_id) == BalanceStatus.AVAILABLE


async def test_cancelExchange_failureInSecondLeg_leavesFirstLegUntouched(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    swap = await _accepted_swap_after_term(client, db_session, "52")
    lister_user_id = await _account_user_id(client, swap.lister_token)

    original = reservation_transitions.get_item_balance
    calls = 0

    async def failing_on_second_call(db: AsyncSession, item_id: uuid.UUID) -> InventoryBalance:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("forced failure in the second leg")
        return await original(db, item_id)

    monkeypatch.setattr(reservation_transitions, "get_item_balance", failing_on_second_call)

    with pytest.raises(RuntimeError):
        await circulation_bridge.cancel_exchange(
            db_session,
            [swap.proposer_reservation_id, swap.owner_reservation_id],
            lister_user_id,
        )
    await db_session.rollback()

    assert calls == 2
    first_leg = await _fresh_reservation(db_session, swap.proposer_reservation_id)
    assert first_leg.status == ReservationStatus.CONFIRMED
    assert await _fresh_balance_status(db_session, swap.offered_item_id) == (
        BalanceStatus.IN_TRANSIT
    )


async def test_fulfillExchange_unpairedLegs_raisesConflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A still-PROPOSED swap has one unpaired SWAP leg: it can be fulfilled
    neither alone nor passed twice as its own pair."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org53@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til53")
    lister_token, _ = await _register(client, "GUEST", "til.lister53@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Gitara53")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )
    proposer_token, _ = await _register(client, "GUEST", "til.proposer53@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Keyboard53")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )
    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    proposer_user_id = await _account_user_id(client, proposer_token)
    leg_id = proposal.proposer_reservation_id

    for reservation_ids in ([leg_id], [leg_id, leg_id]):
        with pytest.raises(BusinessConflictException):
            await circulation_bridge.fulfill_exchange(db_session, reservation_ids, proposer_user_id)

    assert (await _fresh_reservation(db_session, leg_id)).status == ReservationStatus.CONFIRMED


async def test_fulfillExchange_nonPartyActor_raisesAccessDeniedWithoutStateChange(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    swap = await _accepted_swap_after_term(client, db_session, "54")
    outsider_token, _ = await _register(client, "GUEST", "til.outsider54@example.com")
    outsider_user_id = await _account_user_id(client, outsider_token)
    inventory_before = (await _fresh_item(db_session, swap.listed_item_id)).inventory_id
    transactions_before = len(await movements_for_item(db_session, swap.listed_item_id))

    with pytest.raises(AccessDeniedException):
        await circulation_bridge.fulfill_exchange(
            db_session,
            [swap.proposer_reservation_id, swap.owner_reservation_id],
            outsider_user_id,
        )

    for reservation_id in (swap.proposer_reservation_id, swap.owner_reservation_id):
        reservation = await _fresh_reservation(db_session, reservation_id)
        assert reservation.status == ReservationStatus.CONFIRMED
    assert (await _fresh_item(db_session, swap.listed_item_id)).inventory_id == inventory_before
    assert len(await movements_for_item(db_session, swap.listed_item_id)) == transactions_before


async def test_cancelExchange_nonPartyActor_raisesAccessDeniedWithoutStateChange(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    swap = await _accepted_swap_after_term(client, db_session, "55")
    outsider_token, _ = await _register(client, "GUEST", "til.outsider55@example.com")
    outsider_user_id = await _account_user_id(client, outsider_token)

    with pytest.raises(AccessDeniedException):
        await circulation_bridge.cancel_exchange(
            db_session,
            [swap.owner_reservation_id, swap.proposer_reservation_id],
            outsider_user_id,
        )

    for reservation_id in (swap.proposer_reservation_id, swap.owner_reservation_id):
        reservation = await _fresh_reservation(db_session, reservation_id)
        assert reservation.status == ReservationStatus.CONFIRMED
    for item_id in (swap.listed_item_id, swap.offered_item_id):
        assert await _fresh_balance_status(db_session, item_id) == BalanceStatus.IN_TRANSIT


async def test_swapReservedByUserId_notInverted_andTermEndGate_usesLocalNow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression guard for the two already-fixed, currently-uncommitted
    bugs (do not modify the guarded lines beyond what's incidentally
    touched):

    (1) `reserved_by_user_id` on each swap leg names the party GAINING that
    leg's item, not the party creating the reservation — inverted, it made
    `fulfill_reservation`'s inventory-transfer step a no-op.
    (2) `confirm_transaction`'s term-end gate compares against server-local
    `datetime.now()`, not `datetime.utcnow()` — asserted here by reading the
    function's own source, since `Term.occurs_on` is itself a naive local
    value and the two clocks only diverge test-detectably by the server's
    UTC offset."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org33@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til33")

    lister_token, _ = await _register(client, "GUEST", "til.lister33@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Karty33")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    proposer_token, _ = await _register(client, "GUEST", "til.proposer33@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Puzzle33")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    lister_account_user_id = (
        await client.get("/api/people/me", headers=_auth(lister_token))
    ).json()["account_user_id"]
    proposer_account_user_id = (
        await client.get("/api/people/me", headers=_auth(proposer_token))
    ).json()["account_user_id"]

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    # The proposer's own leg is created (and auto-confirmed) immediately by
    # `propose_swap` — `reserved_by_user_id` must already be the LISTER
    # (gaining this leg's item), not the proposer themself.
    proposer_leg = await client.get(
        f"/api/reservations/{proposal.proposer_reservation_id}", headers=_auth(proposer_token)
    )
    assert proposer_leg.json()["reserved_by_user_id"] == lister_account_user_id

    accepted = await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)
    owner_leg = await client.get(
        f"/api/reservations/{accepted.proposer_reservation_id}", headers=_auth(lister_token)
    )
    paired_id = owner_leg.json()["paired_reservation_id"]
    # The listing owner's own leg, created by `accept_swap_proposal` —
    # `reserved_by_user_id` must be the PROPOSER (gaining this leg's item),
    # not the owner themself.
    listing_leg = await client.get(f"/api/reservations/{paired_id}", headers=_auth(lister_token))
    assert listing_leg.json()["reserved_by_user_id"] == proposer_account_user_id

    from app.groups.application import term_item_listings

    # The docstring itself discusses the historical `datetime.utcnow()` bug
    # by name — only the executable body (after the docstring) matters here.
    # The term-end gate itself now lives in the shared gating helper both
    # `confirm_transaction` and `cancel_transaction` call (Bug #4b's
    # extraction), not inline in `confirm_transaction` anymore.
    source = inspect.getsource(term_item_listings._resolve_transaction_reservations_for_action)
    body = source.split('"""', 2)[-1]
    assert "term.occurs_on > datetime.now()" in body
    assert "datetime.utcnow()" not in body


# --- Bug #4c: InventoryBalanceResponse.reservation_id ------------------


async def test_getItemBalance_availableItem_reservationIdIsNull(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An `AVAILABLE` item (no reservation ever taken against it) has a
    `null` `reservation_id` on its balance — the common case, and the one
    `get_active_reservation_id_for_item` should short-circuit without
    querying `Reservation` at all."""
    lister_token, _ = await _register(client, "GUEST", "til.balance1@example.com")
    item_id = await _register_personal_item(client, lister_token, "Deska34")

    balance = await client.get(
        f"/api/inventory-items/{item_id}/balance", headers=_auth(lister_token)
    )
    assert balance.status_code == 200
    assert balance.json()["status"] == "AVAILABLE"
    assert balance.json()["reservation_id"] is None


async def test_getItemBalance_reservedStatus_includesReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Taking a LEND listing leaves the item `RESERVED` (Reservation still
    `PENDING`) — the balance's `reservation_id` must resolve to exactly that
    reservation, so the frontend tile can drive its "Odebrał"/"Anuluj
    wymianę" fallback buttons off it (bug #4c)."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org34@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til34")

    lister_token, _ = await _register(client, "GUEST", "til.lister34@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Wozek34")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker34@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="LEND"),
    )

    balance = await client.get(
        f"/api/inventory-items/{item_id}/balance", headers=_auth(lister_token)
    )
    assert balance.status_code == 200
    assert balance.json()["status"] == "RESERVED"
    assert balance.json()["reservation_id"] == str(taken.resolved_reservation_id)


async def test_getItemBalance_inTransitStatus_stillReportsSameReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Confirming the reservation (holder confirms receipt-in-progress)
    moves the balance to `IN_TRANSIT` — `reservation_id` must still resolve
    to the same (now `CONFIRMED`) reservation, not go `null`."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org35@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til35")

    lister_token, _ = await _register(client, "GUEST", "til.lister35@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Wozek35")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker35@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="LEND"),
    )

    # The item's owner (still the holder before fulfillment) confirms.
    lister_me = await client.get("/api/people/me", headers=_auth(lister_token))
    await circulation_bridge.confirm_reservation(
        db_session, taken.resolved_reservation_id, uuid.UUID(lister_me.json()["account_user_id"])
    )

    balance = await client.get(
        f"/api/inventory-items/{item_id}/balance", headers=_auth(lister_token)
    )
    assert balance.status_code == 200
    assert balance.json()["status"] == "IN_TRANSIT"
    assert balance.json()["reservation_id"] == str(taken.resolved_reservation_id)


async def test_getItemBalance_swapBothLegs_eachHasOwnDistinctReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Multi-persona SWAP tile state (Group 7 gap analysis): each party's
    own item balance must resolve to THAT leg's own `Reservation.id`, not
    the counterparty's paired leg — otherwise the frontend tile's
    "Odebrał"/"Anuluj wymianę" buttons would call confirm/cancel-transaction
    with the wrong reservation id on one side. Confirms both legs are
    correct and distinct."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org37@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til37")

    lister_token, _ = await _register(client, "GUEST", "til.lister37@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, "Gitara37")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    proposer_token, _ = await _register(client, "GUEST", "til.proposer37@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Keyboard37")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)

    listed_balance = await client.get(
        f"/api/inventory-items/{listed_item_id}/balance", headers=_auth(lister_token)
    )
    offered_balance = await client.get(
        f"/api/inventory-items/{offered_item_id}/balance", headers=_auth(proposer_token)
    )
    assert listed_balance.status_code == 200
    assert offered_balance.status_code == 200

    listed_reservation_id = listed_balance.json()["reservation_id"]
    offered_reservation_id = offered_balance.json()["reservation_id"]
    assert listed_reservation_id is not None
    assert offered_reservation_id is not None
    assert listed_reservation_id != offered_reservation_id

    proposer_leg = await client.get(
        f"/api/reservations/{proposal.proposer_reservation_id}", headers=_auth(proposer_token)
    )
    paired_leg_id = proposer_leg.json()["paired_reservation_id"]
    assert {listed_reservation_id, offered_reservation_id} == {
        str(proposal.proposer_reservation_id),
        paired_leg_id,
    }


async def test_getItemBalance_afterCancelTransaction_reservationIdClearedToNull(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Once `cancel_transaction` releases the item back to `AVAILABLE`, the
    balance's `reservation_id` must go back to `null` — it must not keep
    pointing at the now-`CANCELLED` reservation."""
    org_token, _ = await _register(client, "ORGANIZER", "til.org36@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "til36")

    lister_token, _ = await _register(client, "GUEST", "til.lister36@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Namiot36")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.taker36@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.cancel_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )

    balance = await client.get(
        f"/api/inventory-items/{item_id}/balance", headers=_auth(lister_token)
    )
    assert balance.status_code == 200
    assert balance.json()["status"] == "AVAILABLE"
    assert balance.json()["reservation_id"] is None


async def _swap_listing(
    client: AsyncClient, db_session: AsyncSession, prefix: str
) -> tuple[str, str, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """A SWAP-moded listing plus one attendee's SWAP-moded offer. Returns
    `(lister_token, taker_token, group_id, term_id, listed_item_id,
    offered_item_id)`."""
    org_token, _ = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, prefix)

    lister_token, _ = await _register(client, "GUEST", f"{prefix}.lister@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, f"Lista {prefix}")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )

    taker_token, _ = await _register(client, "GUEST", f"{prefix}.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, taker_token, f"Oferta {prefix}")
    await service.set_item_listing_preference(
        db_session, _principal(taker_token), offered_item_id, ReservationType.SWAP
    )
    return lister_token, taker_token, group_id, term_id, listed_item_id, offered_item_id


async def _notifications(client: AsyncClient, token: str, kind: str) -> list[dict[str, object]]:
    notifs = (await client.get("/api/notifications/mine", headers=_auth(token))).json()
    return [n for n in notifs if n["kind"] == kind]


async def test_takeItemListing_taker_receivesItemReservedForPickupWithProductLink(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "til.link1.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tillink1")

    lister_token, _ = await _register(client, "GUEST", "til.link1.lister@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Hulajnoga link1")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.LEND
    )

    taker_token, _ = await _register(client, "GUEST", "til.link1.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="LEND"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    [reserved] = await _notifications(client, taker_token, "ITEM_RESERVED_FOR_PICKUP")
    assert reserved["message"] == (
        f"Zarezerwowano „Hulajnoga link1” — odbierz na terminie {term.occurs_on:%d.%m}"
    )
    assert reserved["link_path"] == f"/product/{item_id}"

    [taken] = await _notifications(client, lister_token, "TERM_ITEM_LISTING_TAKEN")
    assert taken["link_path"] == f"/product/{item_id}"


async def test_proposeSwap_owner_notificationLinksToOfferedItem(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    lister_token, taker_token, _, term_id, listed_item_id, offered_item_id = await _swap_listing(
        client, db_session, "tillink2"
    )

    await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )

    [proposed] = await _notifications(client, lister_token, "SWAP_PROPOSED")
    assert proposed["link_path"] == f"/product/{offered_item_id}"


async def test_acceptSwapProposal_proposerAndAutoRejected_notificationsLinkToListingItem(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    lister_token, taker_token, group_id, term_id, listed_item_id, offered_item_id = (
        await _swap_listing(client, db_session, "tillink3")
    )
    rival_token, _ = await _register(client, "GUEST", "tillink3.rival@example.com")
    await _rsvp(client, rival_token, group_id, term_id)
    rival_item_id = await _register_personal_item(client, rival_token, "Rywal tillink3")
    await service.set_item_listing_preference(
        db_session, _principal(rival_token), rival_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )
    await service.propose_swap(
        db_session, _principal(rival_token), listed_item_id, rival_item_id, term_id
    )
    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)

    [accepted] = await _notifications(client, taker_token, "SWAP_ACCEPTED")
    assert accepted["link_path"] == f"/product/{listed_item_id}"
    [auto_rejected] = await _notifications(client, rival_token, "SWAP_REJECTED")
    assert auto_rejected["link_path"] == f"/product/{listed_item_id}"


async def test_rejectSwapProposal_proposer_notificationLinksToListingItem(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    lister_token, taker_token, _, term_id, listed_item_id, offered_item_id = await _swap_listing(
        client, db_session, "tillink4"
    )

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )
    await service.reject_swap_proposal(db_session, _principal(lister_token), proposal.id)

    [rejected] = await _notifications(client, taker_token, "SWAP_REJECTED")
    assert rejected["link_path"] == f"/product/{listed_item_id}"


async def test_resolveTransactionReservations_alreadyResolved_notificationLinksToItem(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "til.link5.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tillink5")

    lister_token, _ = await _register(client, "GUEST", "til.link5.lister@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Sanki link5")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "til.link5.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    await service.confirm_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )
    with pytest.raises(TermAlreadyResolvedException):
        await service.confirm_transaction(
            db_session, _principal(lister_token), taken.resolved_reservation_id
        )

    [resolved] = await _notifications(client, lister_token, "TERM_ALREADY_RESOLVED")
    assert resolved["link_path"] == f"/product/{item_id}"
