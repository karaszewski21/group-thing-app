"""POINTS offers on the read side (R4, R11): the search `offer_type=POINTS`
filter and the card's `points_price`, the buyer's `held_points` on their
reservation row and on the item page, the POINTS key in the per-mode counts,
and a want looking only for POINTS offers."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import seed_want_matches
from tests.test_points_awards import _listed_item, _person
from tests.test_points_purchase_flow import _grant, _pair, _points_item, _take
from tests.test_wants_api import _create_want


async def test_searchOfferTypePoints_returnsOnlyPointsWithPrice(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    seller = await _person(client, "prm.search.seller@example.com")
    points_item, price = await _points_item(client, db_session, seller, "Latawiec prm punkty")
    gift_item = await _listed_item(client, seller, "Latawiec prm prezent", "GIFT")

    filtered = await client.get(
        "/api/public/search", params={"q": "latawiec", "offer_type": "POINTS"}
    )
    unfiltered = await client.get("/api/public/search", params={"q": "latawiec"})

    assert filtered.status_code == 200, filtered.text
    (card,) = filtered.json()["items"]
    assert card["id"] == str(points_item)
    assert (card["meta"]["mode"], card["meta"]["points_price"]) == ("POINTS", price)
    by_id = {row["id"]: row["meta"] for row in unfiltered.json()["items"]}
    assert by_id[str(gift_item)]["points_price"] is None


async def test_myReservations_pointsRow_carriesHeldPoints(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    seller, buyer = await _pair(client, "prm.held")
    await _grant(db_session, buyer.party_id, 100)
    item_id, price = await _points_item(client, db_session, seller, "Hulajnoga prm.held")
    taken = await _take(client, buyer.headers, item_id, price)
    assert taken.status_code == 200, taken.text

    mine = await client.get("/api/reservations/mine", headers=buyer.headers)
    buyer_actions = await client.get(f"/api/public/items/{item_id}/actions", headers=buyer.headers)
    seller_actions = await client.get(
        f"/api/public/items/{item_id}/actions", headers=seller.headers
    )

    assert mine.status_code == 200, mine.text
    (row,) = mine.json()
    assert (row["mode"], row["held_points"]) == ("POINTS", price)
    for actions in (buyer_actions, seller_actions):
        assert actions.status_code == 200, actions.text
        assert actions.json()["points_price"] == price
        assert actions.json()["party_reservation"]["held_points"] == price


async def test_myItemsCounts_includePoints(client: AsyncClient, db_session: AsyncSession) -> None:
    seller = await _person(client, "prm.counts.seller@example.com")
    points_item, price = await _points_item(client, db_session, seller, "Rolki prm.counts")
    await _listed_item(client, seller, "Narty prm.counts", "GIFT")

    mine = await client.get(
        "/api/inventory-items/mine/page", params={"page": 1, "size": 10}, headers=seller.headers
    )
    owner_page = await client.get(f"/api/public/parties/{seller.party_id}/items")

    assert mine.status_code == 200, mine.text
    assert mine.json()["counts"] == {"ALL": 2, "GIFT": 1, "SWAP": 0, "POINTS": 1}
    prices = {row["id"]: row["points_price"] for row in mine.json()["items"]}
    assert prices[str(points_item)] == price
    assert owner_page.status_code == 200, owner_page.text
    body: dict[str, Any] = owner_page.json()
    assert body["counts"] == {"GIFT": 1, "SWAP": 0, "POINTS": 1}
    assert body["total"] == 2
    cards = {card["item_id"]: card for card in body["items"]}
    assert cards[str(points_item)]["points_price"] == price


async def test_wantOfferModePoints_matchesPointsListing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    seller = await _person(client, "prm.want.seller@example.com")
    seeker = await _person(client, "prm.want.seeker@example.com")
    item_id, price = await _points_item(client, db_session, seller, "Sanki prm.want")
    want = await _create_want(client, seeker.token, "sanki", offer_mode="POINTS")
    await seed_want_matches(db_session, want["id"], [item_id])

    matches = await client.get(f"/api/wants/{want['id']}/matches", headers=seeker.headers)

    assert want["offer_mode"] == "POINTS"
    assert matches.status_code == 200, matches.text
    (card,) = matches.json()
    assert card["id"] == str(item_id)
    assert (card["meta"]["mode"], card["meta"]["points_price"]) == ("POINTS", price)
