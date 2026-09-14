"""`/api/item-listing-preferences` and `/api/term-item-listings` routes
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


async def test_listAndTake_fullHappyPath_reservationEndsUpPending(client: AsyncClient) -> None:
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


async def test_listMyPreferences_returnsOnlyCallersOwnAndReflectsClearing(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "GUEST", "tilr.owner2c@example.com")
    item_id = await _register_personal_item(client, owner_token, "Bilard")
    await _set_preference(client, owner_token, item_id, "LEND")

    other_token, _ = await _register(client, "GUEST", "tilr.other2c@example.com")

    mine = await client.get("/api/item-listing-preferences/mine", headers=_auth(owner_token))
    assert mine.status_code == 200
    assert [row["item_id"] for row in mine.json()] == [item_id]

    other_mine = await client.get("/api/item-listing-preferences/mine", headers=_auth(other_token))
    assert other_mine.status_code == 200
    assert other_mine.json() == []

    clear = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": None}, headers=_auth(owner_token)
    )
    assert clear.status_code == 200
    assert clear.json() is None

    mine_after_clear = await client.get(
        "/api/item-listing-preferences/mine", headers=_auth(owner_token)
    )
    assert mine_after_clear.json() == []


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
