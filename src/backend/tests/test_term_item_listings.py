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


async def test_takeListing_lendType_createsReservationAndReportsIt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
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


async def test_takeListing_swapType_reportsFirstLegReservation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
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

    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        listed_item_id,
        TakeTermItemListingRequest(
            term_id=term_id, reservation_type="SWAP", offered_item_id=offered_item_id
        ),
    )

    reservation = await client.get(
        f"/api/reservations/{taken.resolved_reservation_id}", headers=_auth(taker_token)
    )
    assert reservation.status_code == 200
    body = reservation.json()
    assert body["item_id"] == listed_item_id
    assert body["reservation_type"] == "SWAP"
    assert body["paired_reservation_id"] is not None

    paired = await client.get(
        f"/api/reservations/{body['paired_reservation_id']}", headers=_auth(taker_token)
    )
    assert paired.status_code == 200
    assert paired.json()["item_id"] == offered_item_id


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
        await service.take_item_listing(
            db_session,
            _principal(taker_token),
            listed_item_id,
            TakeTermItemListingRequest(
                term_id=term_id, reservation_type="SWAP", offered_item_id=someone_elses_item_id
            ),
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
        await service.take_item_listing(
            db_session,
            _principal(taker_token),
            listed_item_id,
            TakeTermItemListingRequest(
                term_id=term_id, reservation_type="SWAP", offered_item_id=offered_item_id
            ),
        )
