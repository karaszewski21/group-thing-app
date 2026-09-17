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

from datetime import date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.inventory_items import get_item_balance
from app.circulation.models import BalanceStatus, ReservationType
from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, BusinessConflictException
from app.core.security import decode_token
from app.groups import service
from app.groups.application.term_item_listings import TermAlreadyResolvedException
from app.groups.models import Term
from app.groups.schemas import TakeTermItemListingRequest


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _principal(token: str) -> Principal:
    """Builds a real `Principal` from a registered user's own login token
    (decoded, not fabricated) — `service.*` use cases resolve the caller's
    `UserProfile` from `principal.username` via `get_profile_by_principal`."""
    claims = decode_token(token, settings.jwt_secret)
    return Principal(username=claims["sub"], authorities=frozenset())


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str
) -> tuple[int, int]:
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
    return circle.json()["id"], term.json()["id"]


async def _add_term(client: AsyncClient, org_token: str, group_id: int) -> int:
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return int(term.json()["id"])


async def _rsvp(client: AsyncClient, token: str, group_id: int, term_id: int) -> int:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 201
    assert r.json()["attached_to_account"] is True
    return int(r.json()["id"])


async def _resolve_product(client: AsyncClient, token: str, name: str) -> int:
    r = await client.post(
        "/api/products/resolve", json={"name": name, "category_id": 5}, headers=_auth(token)
    )
    assert r.status_code == 200
    return int(r.json()["id"])


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> int:
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
    return int(item.json()["id"])


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
    assert reservation.json()["item_id"] == item_id
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
    assert proposer_reservation.json()["item_id"] == offered_item_id
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

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )

    notifs = (await client.get("/api/notifications/mine", headers=_auth(lister_token))).json()
    swap_notif = next(n for n in notifs if n["kind"] == "SWAP_PROPOSED")
    assert swap_notif["proposal_id"] == proposal.id
    # Distinct from the proposer's own reservation leg — this is exactly the
    # gap the fix closes (they must never be conflated).
    assert swap_notif["proposal_id"] != proposal.proposer_reservation_id


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

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )

    accepted = await service.accept_swap_proposal(
        db_session, _principal(lister_token), proposal.id
    )
    assert accepted.status == "ACCEPTED"

    owner_leg = await client.get(
        f"/api/reservations/{accepted.proposer_reservation_id}", headers=_auth(lister_token)
    )
    paired_id = owner_leg.json()["paired_reservation_id"]
    assert paired_id is not None

    listing_leg = await client.get(f"/api/reservations/{paired_id}", headers=_auth(lister_token))
    assert listing_leg.status_code == 200
    assert listing_leg.json()["item_id"] == listed_item_id
    assert listing_leg.json()["status"] == "CONFIRMED"
    assert listing_leg.json()["paired_reservation_id"] == accepted.proposer_reservation_id

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

    proposal = await service.propose_swap(
        db_session, _principal(taker_token), listed_item_id, offered_item_id, term_id
    )

    rejected = await service.reject_swap_proposal(
        db_session, _principal(lister_token), proposal.id
    )
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
            db_session, _principal(taker_token), taken.resolved_reservation_id, term_id
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
        db_session, _principal(taker_token), taken.resolved_reservation_id, term_id
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
        db_session, _principal(taker_token), taken.resolved_reservation_id, term_id
    )

    with pytest.raises(TermAlreadyResolvedException):
        await service.confirm_transaction(
            db_session, _principal(lister_token), taken.resolved_reservation_id, term_id
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
            db_session, _principal(outsider_token), taken.resolved_reservation_id, term_id
        )


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

    borrower_token, _ = await _register(client, "GUEST", "til.borrower8@example.com")
    borrower_inventory = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(borrower_token),
    )
    assert borrower_inventory.status_code == 201
    borrower_user_id = borrower_inventory.json()["owner_user_id"]

    reservation = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "LEND",
            "reserved_by_user_id": borrower_user_id,
        },
        headers=_auth(lister_token),
    )
    assert reservation.status_code == 201
    reservation_id = reservation.json()["id"]
    assert (
        await client.post(f"/api/reservations/{reservation_id}/confirm", headers=_auth(lister_token))
    ).status_code == 200
    assert (
        await client.post(f"/api/reservations/{reservation_id}/fulfill", headers=_auth(lister_token))
    ).status_code == 200

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
