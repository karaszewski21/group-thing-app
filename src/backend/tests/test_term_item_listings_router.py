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
        json={"term_id": term_id},
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
        json={"term_id": term_id},
        headers=_auth(lister_token),
    )
    assert second_confirm.status_code == 409
    assert second_confirm.json()["already_resolved"] is True


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
        json={"term_id": term_id},
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
        json={"term_id": term_id},
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
        json={"term_id": term_id},
        headers=_auth(taker_token),
    )
    assert first.status_code == 200

    # The other party to the same transaction (the lister) calls it too —
    # they must get a clear, distinguishable "already resolved" response,
    # not a generic unexplained 409.
    second = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction",
        json={"term_id": term_id},
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
        json={"term_id": term_id},
        headers=_auth(outsider_token),
    )
    assert outsider_confirm.status_code == 403


async def test_newExchangeRoutes_unauthenticated_return401(client: AsyncClient) -> None:
    propose = await client.post(
        "/api/term-item-listings/1/propose", json={"term_id": 1, "offered_item_id": 1}
    )
    assert propose.status_code == 401

    accept = await client.post("/api/swap-proposals/1/accept")
    assert accept.status_code == 401

    reject = await client.post("/api/swap-proposals/1/reject")
    assert reject.status_code == 401

    confirm = await client.post(
        "/api/reservations/1/confirm-transaction", json={"term_id": 1}
    )
    assert confirm.status_code == 401
