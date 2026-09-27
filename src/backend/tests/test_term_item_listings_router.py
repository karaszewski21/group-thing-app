"""`/api/item-listing-preferences`, `/api/inventory-items/mine` and
`/api/term-item-listings` routes
(`app/groups/router/term_item_listings.py`) and
`POST /api/groups/mine/attendances/{id}/withdraw`
(`app/groups/router/circles.py`) — the HTTP-layer counterpart to
`test_term_item_listings.py`/`test_attendance_withdrawal.py`, which
exercise the same use cases directly against `db_session`. Setup mirrors
`test_pledge_fulfillment.py`'s style throughout.
"""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str, *, occurs_on: date | None = None
) -> tuple[int, int]:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (occurs_on or (date.today() + timedelta(days=7))).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return circle.json()["id"], term.json()["id"]


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


async def _set_preference(client: AsyncClient, token: str, item_id: int, mode: str) -> None:
    r = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": mode}, headers=_auth(token)
    )
    assert r.status_code == 200


async def test_listAndTake_fullHappyPath_reservationEndsUpConfirmed(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org1@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr1")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister1@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Rowerek")
    await _set_preference(client, lister_token, item_id, "LEND")

    taker_token, _ = await _register(client, "GUEST", "tilr.taker1@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    browse = await client.get(
        "/api/term-item-listings/browse", params={"term_id": term_id}, headers=_auth(taker_token)
    )
    assert browse.status_code == 200
    assert [row["item_id"] for row in browse.json()] == [item_id]

    take = await client.post(
        f"/api/term-item-listings/{item_id}/take",
        json={"term_id": term_id, "reservation_type": "LEND"},
        headers=_auth(taker_token),
    )
    assert take.status_code == 200
    reservation_id = take.json()["resolved_reservation_id"]
    assert reservation_id is not None

    reservation = await client.get(
        f"/api/reservations/{reservation_id}", headers=_auth(taker_token)
    )
    assert reservation.status_code == 200
    # No longer auto-confirmed on the lister's behalf at take-time (Group 3
    # removed `take_item_listing`'s auto-confirm) — the `Reservation` stays
    # `PENDING` until either party resolves it via `confirm-transaction`
    # once the Term ends.
    assert reservation.json()["status"] == "PENDING"


async def test_setPreference_notOwnItem_returns403(client: AsyncClient) -> None:
    _org_token, _ = await _register(client, "ORGANIZER", "tilr.org2@example.com")
    owner_token, _ = await _register(client, "GUEST", "tilr.owner2@example.com")
    item_id = await _register_personal_item(client, owner_token, "Klocki")

    other_token, _ = await _register(client, "GUEST", "tilr.other2@example.com")
    response = await client.put(
        f"/api/item-listing-preferences/{item_id}",
        json={"mode": "LEND"},
        headers=_auth(other_token),
    )
    assert response.status_code == 403


async def test_setPreference_ownItem_needsNoAttendance(client: AsyncClient) -> None:
    """Setting a standing preference from `Moje rzeczy` is ownership-only —
    unlike browsing/taking, it doesn't require the owner to have RSVP'd to
    any Term yet."""
    owner_token, _ = await _register(client, "GUEST", "tilr.owner2b@example.com")
    item_id = await _register_personal_item(client, owner_token, "Rakieta")

    response = await client.put(
        f"/api/item-listing-preferences/{item_id}",
        json={"mode": "GIFT"},
        headers=_auth(owner_token),
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "GIFT"


async def test_listMyInventoryItems_returnsOnlyCallersOwnWithModeAndReflectsClearing(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "GUEST", "tilr.owner2c@example.com")
    item_id = await _register_personal_item(client, owner_token, "Bilard")
    inventory_id = (
        await client.get(f"/api/inventory-items/{item_id}", headers=_auth(owner_token))
    ).json()["inventory_id"]
    untagged = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inventory_id,
            "product_id": await _resolve_product(client, owner_token, "Kredki"),
            "condition": "GOOD",
        },
        headers=_auth(owner_token),
    )
    assert untagged.status_code == 201
    untagged_item_id = untagged.json()["id"]
    await _set_preference(client, owner_token, item_id, "LEND")

    other_token, _ = await _register(client, "GUEST", "tilr.other2c@example.com")

    mine = await client.get("/api/inventory-items/mine", headers=_auth(owner_token))
    assert mine.status_code == 200
    modes = {row["id"]: row["listing_mode"] for row in mine.json()}
    assert modes == {item_id: "LEND", untagged_item_id: None}
    assert {row["product_name"] for row in mine.json()} == {"Bilard", "Kredki"}

    other_mine = await client.get("/api/inventory-items/mine", headers=_auth(other_token))
    assert other_mine.status_code == 200
    assert other_mine.json() == []

    clear = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": None}, headers=_auth(owner_token)
    )
    assert clear.status_code == 200
    assert clear.json() is None

    mine_after_clear = await client.get("/api/inventory-items/mine", headers=_auth(owner_token))
    assert {row["id"]: row["listing_mode"] for row in mine_after_clear.json()} == {
        item_id: None,
        untagged_item_id: None,
    }


async def test_listMine_returnsOnlyCallersOwnListings(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org3@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr3")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister3@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Sanki")
    await _set_preference(client, lister_token, item_id, "GIFT")

    other_token, _ = await _register(client, "GUEST", "tilr.other3@example.com")
    await _rsvp(client, other_token, group_id, term_id)

    mine = await client.get(
        "/api/term-item-listings/mine", params={"term_id": term_id}, headers=_auth(lister_token)
    )
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0]["item_id"] == item_id

    other_mine = await client.get(
        "/api/term-item-listings/mine", params={"term_id": term_id}, headers=_auth(other_token)
    )
    assert other_mine.status_code == 200
    assert other_mine.json() == []


async def test_browse_neverIncludesCallersOwnListing(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org4@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr4")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister4@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Hulajnoga")
    await _set_preference(client, lister_token, item_id, "LEND")

    browse_as_lister = await client.get(
        "/api/term-item-listings/browse", params={"term_id": term_id}, headers=_auth(lister_token)
    )
    assert browse_as_lister.status_code == 200
    assert browse_as_lister.json() == []


async def test_browse_organizerOwnItem_visibleToAttendeeWithoutOrganizerRsvp(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org6@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr6")
    item_id = await _register_personal_item(client, org_token, "Namiot")
    await _set_preference(client, org_token, item_id, "LEND")

    attendee_token, _ = await _register(client, "GUEST", "tilr.att6@example.com")
    await _rsvp(client, attendee_token, group_id, term_id)

    browse = await client.get(
        "/api/term-item-listings/browse",
        params={"term_id": term_id},
        headers=_auth(attendee_token),
    )
    assert browse.status_code == 200
    assert [row["item_id"] for row in browse.json()] == [item_id]


async def test_withdrawAttendance_calledTwiceOverHttp_bothReturn200WithWithdrawnAt(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org5@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr5")

    guest_token, _ = await _register(client, "GUEST", "tilr.guest5@example.com")
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)

    first = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(guest_token)
    )
    assert first.status_code == 200
    assert first.json()["withdrawn_at"] is not None

    second = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(guest_token)
    )
    assert second.status_code == 200
    assert second.json()["withdrawn_at"] is not None
    assert second.json()["withdrawn_at"] == first.json()["withdrawn_at"]


# --- Group 5: propose/accept/reject/confirm-transaction routes -------------


async def test_proposeSwap_returns2xxWithProposalPayload(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org7@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr7")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister7@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listing_item_id = await _register_personal_item(client, lister_token, "Deskorolka")
    await _set_preference(client, lister_token, listing_item_id, "SWAP")

    proposer_token, _ = await _register(client, "GUEST", "tilr.proposer7@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Gra planszowa")
    await _set_preference(client, proposer_token, offered_item_id, "SWAP")

    propose = await client.post(
        f"/api/term-item-listings/{listing_item_id}/propose",
        json={"term_id": term_id, "offered_item_id": offered_item_id},
        headers=_auth(proposer_token),
    )
    assert propose.status_code in (200, 201)
    body = propose.json()
    assert body["listing_item_id"] == listing_item_id
    assert body["offered_item_id"] == offered_item_id
    assert body["status"] == "PROPOSED"


async def test_acceptSwapProposal_returns2xxWithUpdatedStatus(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org8@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr8")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister8@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listing_item_id = await _register_personal_item(client, lister_token, "Puzzle")
    await _set_preference(client, lister_token, listing_item_id, "SWAP")

    proposer_token, _ = await _register(client, "GUEST", "tilr.proposer8@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Lalka")
    await _set_preference(client, proposer_token, offered_item_id, "SWAP")

    propose = await client.post(
        f"/api/term-item-listings/{listing_item_id}/propose",
        json={"term_id": term_id, "offered_item_id": offered_item_id},
        headers=_auth(proposer_token),
    )
    assert propose.status_code in (200, 201)
    proposal_id = propose.json()["id"]

    accept = await client.post(
        f"/api/swap-proposals/{proposal_id}/accept", headers=_auth(lister_token)
    )
    assert accept.status_code in (200, 201)
    assert accept.json()["status"] == "ACCEPTED"


async def test_rejectSwapProposal_returns2xxWithUpdatedStatus(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org9@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr9")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister9@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listing_item_id = await _register_personal_item(client, lister_token, "Rower")
    await _set_preference(client, lister_token, listing_item_id, "SWAP")

    proposer_token, _ = await _register(client, "GUEST", "tilr.proposer9@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Piłka")
    await _set_preference(client, proposer_token, offered_item_id, "SWAP")

    propose = await client.post(
        f"/api/term-item-listings/{listing_item_id}/propose",
        json={"term_id": term_id, "offered_item_id": offered_item_id},
        headers=_auth(proposer_token),
    )
    assert propose.status_code in (200, 201)
    proposal_id = propose.json()["id"]

    reject = await client.post(
        f"/api/swap-proposals/{proposal_id}/reject", headers=_auth(lister_token)
    )
    assert reject.status_code in (200, 201)
    assert reject.json()["status"] == "REJECTED"


async def test_swapLifecycle_proposeAcceptTermEndConfirm_bothLegsFulfilledThroughRouter(
    client: AsyncClient,
) -> None:
    """Group 9 gap (b): the full swap end-to-end lifecycle — propose,
    accept, term-end, then the confirm-race on the paired leg — exercised
    entirely through the router, not the application layer directly."""
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org14@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr14")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister14@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listing_item_id = await _register_personal_item(client, lister_token, "Gitara")
    await _set_preference(client, lister_token, listing_item_id, "SWAP")

    proposer_token, _ = await _register(client, "GUEST", "tilr.proposer14@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Keyboard")
    await _set_preference(client, proposer_token, offered_item_id, "SWAP")

    propose = await client.post(
        f"/api/term-item-listings/{listing_item_id}/propose",
        json={"term_id": term_id, "offered_item_id": offered_item_id},
        headers=_auth(proposer_token),
    )
    assert propose.status_code in (200, 201)
    proposal = propose.json()
    proposer_reservation_id = proposal["proposer_reservation_id"]

    accept = await client.post(
        f"/api/swap-proposals/{proposal['id']}/accept", headers=_auth(lister_token)
    )
    assert accept.status_code in (200, 201)

    proposer_leg = await client.get(
        f"/api/reservations/{proposer_reservation_id}", headers=_auth(proposer_token)
    )
    paired_id = proposer_leg.json()["paired_reservation_id"]
    assert paired_id is not None

    await _end_term(client, org_token, term_id)

    # Either party may confirm first — the proposer confirms their own leg,
    # which (being a paired SWAP) must resolve both legs at once.
    confirm = await client.post(
        f"/api/reservations/{proposer_reservation_id}/confirm-transaction",
        headers=_auth(proposer_token),
    )
    assert confirm.status_code == 200
    assert confirm.json()["status"] == "FULFILLED"

    other_leg = await client.get(f"/api/reservations/{paired_id}", headers=_auth(lister_token))
    assert other_leg.json()["status"] == "FULFILLED"

    # The other party's own confirm attempt now gets the distinguishable
    # "already resolved" outcome, not a generic conflict.
    second_confirm = await client.post(
        f"/api/reservations/{paired_id}/confirm-transaction",
        headers=_auth(lister_token),
    )
    assert second_confirm.status_code == 409
    assert second_confirm.json()["already_resolved"] is True


async def test_confirmOrCancelTransaction_unacceptedSwapProposerLeg_returns409AndItemStays(
    client: AsyncClient,
) -> None:
    """A still-PROPOSED swap's proposer leg is unpaired; the listing owner
    must not be able to resolve it alone after the Term and take the
    proposer's item without giving their own."""
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org30@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr30")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister30@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listing_item_id = await _register_personal_item(client, lister_token, "Rower 30")
    await _set_preference(client, lister_token, listing_item_id, "SWAP")

    proposer_token, _ = await _register(client, "GUEST", "tilr.proposer30@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Hulajnoga 30")
    await _set_preference(client, proposer_token, offered_item_id, "SWAP")
    inventory_before = (
        await client.get(f"/api/inventory-items/{offered_item_id}", headers=_auth(proposer_token))
    ).json()["inventory_id"]

    propose = await client.post(
        f"/api/term-item-listings/{listing_item_id}/propose",
        json={"term_id": term_id, "offered_item_id": offered_item_id},
        headers=_auth(proposer_token),
    )
    assert propose.status_code in (200, 201)
    proposer_reservation_id = propose.json()["proposer_reservation_id"]
    await _end_term(client, org_token, term_id)

    confirm = await client.post(
        f"/api/reservations/{proposer_reservation_id}/confirm-transaction",
        headers=_auth(lister_token),
    )
    cancel = await client.post(
        f"/api/reservations/{proposer_reservation_id}/cancel-transaction",
        headers=_auth(lister_token),
    )

    assert confirm.status_code == 409
    assert confirm.json().get("already_resolved") is not True
    assert cancel.status_code == 409
    leg = await client.get(
        f"/api/reservations/{proposer_reservation_id}", headers=_auth(proposer_token)
    )
    assert leg.json()["status"] == "CONFIRMED"
    item = await client.get(
        f"/api/inventory-items/{offered_item_id}", headers=_auth(proposer_token)
    )
    assert item.json()["inventory_id"] == inventory_before


async def _take_lend_listing(
    client: AsyncClient,
    lister_token: str,
    taker_token: str,
    group_id: int,
    term_id: int,
    prefix: str,
) -> int:
    """Sets up a LEND listing, takes it, and returns the resulting (still
    `PENDING`) reservation id — shared setup for the confirm-transaction
    tests below. Must be called while `term_id` is still upcoming:
    `take_item_listing` itself rejects a take against an already-past Term."""
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, f"Rzecz {prefix}")
    await _set_preference(client, lister_token, item_id, "LEND")

    await _rsvp(client, taker_token, group_id, term_id)
    take = await client.post(
        f"/api/term-item-listings/{item_id}/take",
        json={"term_id": term_id, "reservation_type": "LEND"},
        headers=_auth(taker_token),
    )
    assert take.status_code == 200
    reservation_id = take.json()["resolved_reservation_id"]
    assert reservation_id is not None
    return reservation_id


async def _end_term(client: AsyncClient, org_token: str, term_id: int) -> None:
    """Moves `term_id` into the past via the organizer-only `PATCH
    /api/terms/{id}` route — used to simulate "the Term has ended" for
    `confirm-transaction` tests, since the take flow itself requires the
    Term to still be upcoming (see `_take_lend_listing`)."""
    patch = await client.patch(
        f"/api/terms/{term_id}",
        json={"occurs_on": (date.today() - timedelta(days=1)).isoformat()},
        headers=_auth(org_token),
    )
    assert patch.status_code == 200


async def test_confirmTransaction_beforeTermEnd_returnsConflict(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org10@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr10")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister10@example.com")
    taker_token, _ = await _register(client, "GUEST", "tilr.taker10@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, "10"
    )

    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        headers=_auth(taker_token),
    )
    assert confirm.status_code == 409
    assert confirm.json().get("already_resolved") is not True


async def test_confirmTransaction_afterTermEnd_returns2xxAndFulfillsReservation(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org11@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr11")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister11@example.com")
    taker_token, _ = await _register(client, "GUEST", "tilr.taker11@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, "11"
    )
    await _end_term(client, org_token, term_id)

    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        headers=_auth(taker_token),
    )
    assert confirm.status_code == 200
    body = confirm.json()
    assert body["already_resolved"] is False
    assert body["status"] == "FULFILLED"


async def test_confirmTransaction_secondCaller_getsDistinguishableAlreadyResolvedResponse(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org12@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr12")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister12@example.com")
    taker_token, _ = await _register(client, "GUEST", "tilr.taker12@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, "12"
    )
    await _end_term(client, org_token, term_id)

    first = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        headers=_auth(taker_token),
    )
    assert first.status_code == 200

    # The other party to the same transaction (the lister) calls it too —
    # they must get a clear, distinguishable "already resolved" response,
    # not a generic unexplained 409.
    second = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        headers=_auth(lister_token),
    )
    assert second.status_code == 409
    assert second.json()["already_resolved"] is True


async def test_confirmTransaction_nonParty_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org13@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr13")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister13@example.com")
    taker_token, _ = await _register(client, "GUEST", "tilr.taker13@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, "13"
    )
    await _end_term(client, org_token, term_id)

    outsider_token, _ = await _register(client, "GUEST", "tilr.outsider13@example.com")

    outsider_confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        headers=_auth(outsider_token),
    )
    assert outsider_confirm.status_code == 403


async def test_cancelTransaction_afterReservationTermEnded_returns200AndCancels(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org14@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr14")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister14@example.com")
    taker_token, _ = await _register(client, "GUEST", "tilr.taker14@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, "14"
    )
    await _end_term(client, org_token, term_id)

    cancel = await client.post(
        f"/api/reservations/{reservation_id}/cancel-transaction", headers=_auth(taker_token)
    )

    assert cancel.status_code == 200
    assert cancel.json()["already_resolved"] is False
    assert cancel.json()["status"] == "CANCELLED"


async def test_cancelTransaction_reservationTermUpcoming_returns409(client: AsyncClient) -> None:
    """The Term gate reads the reservation's own `term_id`; a `term_id` of
    some other, already-ended Term sent in the body is ignored."""
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org15@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr15")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister15@example.com")
    taker_token, _ = await _register(client, "GUEST", "tilr.taker15@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, "15"
    )
    other_term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=3)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert other_term.status_code == 201
    await _end_term(client, org_token, other_term.json()["id"])

    cancel = await client.post(
        f"/api/reservations/{reservation_id}/cancel-transaction",
        json={"term_id": other_term.json()["id"]},
        headers=_auth(taker_token),
    )

    assert cancel.status_code == 409
    assert cancel.json().get("already_resolved") is not True
    status = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(taker_token))
    assert status.json()["status"] == "PENDING"


async def test_cancelTransaction_onReturnReservation_returns409(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org16@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr16")

    lister_token, _ = await _register(client, "GUEST", "tilr.lister16@example.com")
    taker_token, _ = await _register(client, "GUEST", "tilr.taker16@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, "16"
    )
    await _end_term(client, org_token, term_id)
    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction", headers=_auth(taker_token)
    )
    assert confirm.status_code == 200

    item_id = (
        await client.get(f"/api/reservations/{reservation_id}", headers=_auth(taker_token))
    ).json()["item_id"]
    lister_me = await client.get("/api/people/me", headers=_auth(lister_token))
    return_reservation = await client.post(
        "/api/reservations",
        json={
            "item_id": item_id,
            "reservation_type": "RETURN",
            "reserved_by_user_id": lister_me.json()["account_user_id"],
        },
        headers=_auth(taker_token),
    )
    assert return_reservation.status_code == 201, return_reservation.text
    return_id = return_reservation.json()["id"]

    cancel = await client.post(
        f"/api/reservations/{return_id}/cancel-transaction", headers=_auth(lister_token)
    )

    assert cancel.status_code == 409
    status = await client.get(f"/api/reservations/{return_id}", headers=_auth(lister_token))
    assert status.json()["status"] == "PENDING"


async def _lend_to_taker(client: AsyncClient, prefix: str) -> tuple[str, str, int]:
    """A LEND fulfilled via the groups flow. Returns `(lister_token,
    taker_token, item_id)` — the item now sits in the taker's VIRTUAL
    inventory with `home_inventory_id` pointing at the lister's PERSONAL."""
    org_token, _ = await _register(client, "ORGANIZER", f"tilr.org{prefix}@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, f"tilr{prefix}")
    lister_token, _ = await _register(client, "GUEST", f"tilr.lister{prefix}@example.com")
    taker_token, _ = await _register(client, "GUEST", f"tilr.taker{prefix}@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, prefix
    )
    await _end_term(client, org_token, term_id)
    confirm = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction", headers=_auth(taker_token)
    )
    assert confirm.status_code == 200
    reservation = await client.get(
        f"/api/reservations/{reservation_id}", headers=_auth(taker_token)
    )
    return lister_token, taker_token, int(reservation.json()["item_id"])


async def test_listMyInventoryItems_borrower_doesNotSeeBorrowedItemOfOwner(
    client: AsyncClient,
) -> None:
    _lister_token, taker_token, item_id = await _lend_to_taker(client, "17")
    own_item_id = await _register_personal_item(client, taker_token, "Własna rzecz 17")

    mine = await client.get("/api/inventory-items/mine", headers=_auth(taker_token))

    assert mine.status_code == 200
    assert [row["id"] for row in mine.json()] == [own_item_id]
    assert item_id != own_item_id


async def test_listMyInventoryItems_softDeletedItem_isExcluded(client: AsyncClient) -> None:
    owner_token, _ = await _register(client, "GUEST", "tilr.owner18@example.com")
    kept_id = await _register_personal_item(client, owner_token, "Zostaje 18")
    inventory_id = (
        await client.get(f"/api/inventory-items/{kept_id}", headers=_auth(owner_token))
    ).json()["inventory_id"]
    deleted = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inventory_id,
            "product_id": await _resolve_product(client, owner_token, "Usunięta 18"),
            "condition": "GOOD",
        },
        headers=_auth(owner_token),
    )
    assert deleted.status_code == 201
    deleted_id = deleted.json()["id"]
    delete = await client.delete(f"/api/inventory-items/{deleted_id}", headers=_auth(owner_token))
    assert delete.status_code == 204

    mine = await client.get("/api/inventory-items/mine", headers=_auth(owner_token))

    assert [row["id"] for row in mine.json()] == [kept_id]


async def test_listInventoryItems_borrowerVirtualInventory_stillListsBorrowedItem(
    client: AsyncClient,
) -> None:
    _lister_token, taker_token, item_id = await _lend_to_taker(client, "19")
    virtual_inventory_id = (
        await client.get(f"/api/inventory-items/{item_id}", headers=_auth(taker_token))
    ).json()["inventory_id"]

    listed = await client.get(
        "/api/inventory-items",
        params={"inventory_id": virtual_inventory_id},
        headers=_auth(taker_token),
    )

    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [item_id]


async def test_newExchangeRoutes_unauthenticated_return401(client: AsyncClient) -> None:
    propose = await client.post(
        "/api/term-item-listings/1/propose", json={"term_id": 1, "offered_item_id": 1}
    )
    assert propose.status_code == 401

    accept = await client.post("/api/swap-proposals/1/accept")
    assert accept.status_code == 401

    reject = await client.post("/api/swap-proposals/1/reject")
    assert reject.status_code == 401

    confirm = await client.post("/api/reservations/1/confirm-transaction")
    assert confirm.status_code == 401


async def test_cancelTransaction_nonParty_reservationTermUpcoming_returns403(
    client: AsyncClient,
) -> None:
    """The participant gate runs before the Term gate: an outsider learns
    nothing about the Term's timing (403, not 409)."""
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org20@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr20")
    lister_token, _ = await _register(client, "GUEST", "tilr.lister20@example.com")
    taker_token, _ = await _register(client, "GUEST", "tilr.taker20@example.com")
    reservation_id = await _take_lend_listing(
        client, lister_token, taker_token, group_id, term_id, "20"
    )
    outsider_token, _ = await _register(client, "GUEST", "tilr.outsider20@example.com")

    cancel = await client.post(
        f"/api/reservations/{reservation_id}/cancel-transaction",
        headers=_auth(outsider_token),
    )

    assert cancel.status_code == 403
    status = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(taker_token))
    assert status.json()["status"] == "PENDING"


async def test_confirmTransaction_nonParty_onReturnReservation_returns403(
    client: AsyncClient,
) -> None:
    lister_token, taker_token, item_id = await _lend_to_taker(client, "21")
    return_reservation = await client.post(
        "/api/reservations", json={"item_id": item_id}, headers=_auth(taker_token)
    )
    assert return_reservation.status_code == 201, return_reservation.text
    return_id = return_reservation.json()["id"]
    outsider_token, _ = await _register(client, "GUEST", "tilr.outsider21@example.com")

    confirm = await client.post(
        f"/api/reservations/{return_id}/confirm-transaction", headers=_auth(outsider_token)
    )

    assert confirm.status_code == 403
    status = await client.get(f"/api/reservations/{return_id}", headers=_auth(lister_token))
    assert status.json()["status"] == "PENDING"


async def test_listMyInventoryItems_lentItem_lentFieldsMatchBorrowerProfileAndBalanceDueDate(
    client: AsyncClient,
) -> None:
    lister_token, taker_token, item_id = await _lend_to_taker(client, "22")
    taker_name = (
        await client.get("/api/people/me", headers=_auth(taker_token))
    ).json()["display_name"]
    lister_name = (
        await client.get("/api/people/me", headers=_auth(lister_token))
    ).json()["display_name"]
    balance = await client.get(
        f"/api/inventory-items/{item_id}/balance", headers=_auth(lister_token)
    )
    assert balance.json()["due_date"] is not None

    mine = await client.get("/api/inventory-items/mine", headers=_auth(lister_token))

    rows = {row["id"]: row for row in mine.json()}
    assert rows[item_id]["lent_to_display_name"] == taker_name
    assert rows[item_id]["lent_to_display_name"] != lister_name
    assert rows[item_id]["lent_due_date"] == balance.json()["due_date"]


async def test_listMineAsTaker_ownerWithBorrowersPendingReturn_showsOnlyOwnTakesOfThatTerm(
    client: AsyncClient,
) -> None:
    """A RETURN names the owner as `reserved_by`, but it is not something the
    owner took; and a take belongs only to its own Term's list."""
    org_token, _ = await _register(client, "ORGANIZER", "tilr.org31@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tilr31")
    later_term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=14)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert later_term.status_code == 201
    later_term_id = later_term.json()["id"]

    owner_token, _ = await _register(client, "GUEST", "tilr.lister31@example.com")
    borrower_token, _ = await _register(client, "GUEST", "tilr.taker31@example.com")
    lend_id = await _take_lend_listing(client, owner_token, borrower_token, group_id, term_id, "31")
    await _end_term(client, org_token, term_id)
    confirm = await client.post(
        f"/api/reservations/{lend_id}/confirm-transaction", headers=_auth(borrower_token)
    )
    assert confirm.status_code == 200
    lent_item_id = (
        await client.get(f"/api/reservations/{lend_id}", headers=_auth(borrower_token))
    ).json()["item_id"]
    return_reservation = await client.post(
        "/api/reservations",
        json={"item_id": lent_item_id, "reservation_type": "RETURN"},
        headers=_auth(borrower_token),
    )
    assert return_reservation.status_code == 201, return_reservation.text

    other_lister_token, _ = await _register(client, "GUEST", "tilr.other31@example.com")
    await _rsvp(client, other_lister_token, group_id, term_id)
    await _rsvp(client, other_lister_token, group_id, later_term_id)
    await _rsvp(client, owner_token, group_id, later_term_id)
    other_item_id = await _register_personal_item(client, other_lister_token, "Namiot 31")
    await _set_preference(client, other_lister_token, other_item_id, "LEND")
    take = await client.post(
        f"/api/term-item-listings/{other_item_id}/take",
        json={"term_id": later_term_id, "reservation_type": "LEND"},
        headers=_auth(owner_token),
    )
    assert take.status_code == 200

    ended_term_list = await client.get(
        "/api/term-item-listings/mine-as-taker",
        params={"term_id": term_id},
        headers=_auth(owner_token),
    )
    later_term_list = await client.get(
        "/api/term-item-listings/mine-as-taker",
        params={"term_id": later_term_id},
        headers=_auth(owner_token),
    )

    assert ended_term_list.status_code == 200
    assert ended_term_list.json() == []
    assert [row["item_id"] for row in later_term_list.json()] == [other_item_id]
