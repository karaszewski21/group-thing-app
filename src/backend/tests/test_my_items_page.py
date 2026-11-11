"""`GET /api/inventory-items/mine/page`: the caller's items at home page by
page, newest first, filtered by listing mode and part of the name, with the
per-mode counts over every item."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from tests.conftest import count_queries
from tests.test_item_listing_status import _inventory, _post_item
from tests.test_term_item_listings import _auth, _register, _resolve_product

PAGE_KEYS = {"counts", "items", "total", "page", "size"}


async def _page(client: AsyncClient, token: str, **params: str | int) -> dict:
    response = await client.get(
        "/api/inventory-items/mine/page", params=params, headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _seed(
    client: AsyncClient,
    token: str,
    names_and_modes: list[tuple[str, str | None]],
    inventory_id: str | None = None,
) -> list[str]:
    inventory_id = inventory_id or await _inventory(client, token)
    ids = []
    for name, mode in names_and_modes:
        product_id = await _resolve_product(client, token, name)
        created = await _post_item(client, token, inventory_id, product_id, mode)
        assert created["status"] == 201, created["body"]
        ids.append(created["body"]["id"])
    return ids


async def test_myItemsPage_pagesOfFive_newestFirstWithCounts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "mip.pages@example.com")
    modes = ["GIFT", "SWAP", None, "GIFT", "SWAP", None, "GIFT"]
    ids = await _seed(client, token, [(f"Rzecz MIP {i}", mode) for i, mode in enumerate(modes)])

    first = await _page(client, token, page=1, size=5)
    second = await _page(client, token, page=2, size=5)

    assert set(first) == PAGE_KEYS
    assert [item["id"] for item in first["items"] + second["items"]] == list(reversed(ids))
    assert (first["total"], first["page"], first["size"]) == (7, 1, 5)
    assert len(second["items"]) == 2
    assert first["counts"] == {"ALL": 7, "GIFT": 3, "SWAP": 2}
    assert first["items"][0]["listing_mode"] == "GIFT"


async def test_myItemsPage_modeAndNameFilters_narrowItemsButNotCounts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "mip.filters@example.com")
    await _seed(
        client,
        token,
        [
            ("Książeczki MIP", "GIFT"),
            ("Książka 100% MIP", "SWAP"),
            ("Rowerek MIP", "GIFT"),
            ("Klocki MIP", None),
        ],
    )

    by_name = await _page(client, token, q="  KSIĄ ")
    gifts = await _page(client, token, mode="GIFT")
    both = await _page(client, token, mode="GIFT", q="książ")
    percent = await _page(client, token, q="100%")
    literal_wildcard = await _page(client, token, q="%")

    assert sorted(item["product_name"] for item in by_name["items"]) == [
        "Książeczki MIP",
        "Książka 100% MIP",
    ]
    assert by_name["total"] == 2
    assert {item["product_name"] for item in gifts["items"]} == {"Książeczki MIP", "Rowerek MIP"}
    assert [item["product_name"] for item in both["items"]] == ["Książeczki MIP"]
    assert [item["product_name"] for item in percent["items"]] == ["Książka 100% MIP"]
    assert literal_wildcard["total"] == 1
    assert both["counts"] == {"ALL": 4, "GIFT": 2, "SWAP": 1}


async def test_myItems_reservedItem_carriesBalanceStatusAndReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "GUEST", "mip.balance.owner@example.com")
    taker, _ = await _register(client, "GUEST", "mip.balance.taker@example.com")
    free_id, taken_id = await _seed(client, owner, [("Gra MIP", "GIFT"), ("Lego MIP", "GIFT")])
    reserved = await client.post(
        f"/api/items/{taken_id}/take",
        json={"context": {"kind": "PERSONAL"}, "reservation_type": "GIFT"},
        headers=_auth(taker),
    )
    assert reserved.status_code == 200, reserved.text
    balance = await client.get(f"/api/inventory-items/{taken_id}/balance", headers=_auth(owner))

    paged = {item["id"]: item for item in (await _page(client, owner))["items"]}
    full = await client.get("/api/inventory-items/mine", headers=_auth(owner))

    free = paged[free_id]
    assert (free["balance_status"], free["reservation_id"]) == ("AVAILABLE", None)
    assert paged[taken_id]["balance_status"] == balance.json()["status"] == "RESERVED"
    assert paged[taken_id]["reservation_id"] == balance.json()["reservation_id"] is not None
    assert {item["id"]: item["reservation_id"] for item in full.json()} == {
        free_id: None,
        taken_id: balance.json()["reservation_id"],
    }


async def test_myItemsPage_invalidParams_return400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "mip.invalid@example.com")

    for params in ({"mode": "LEND"}, {"size": 0}, {"q": "x" * 101}):
        response = await client.get(
            "/api/inventory-items/mine/page", params=params, headers=_auth(token)
        )
        assert response.status_code == 400, (params, response.text)
    assert (await _page(client, token))["counts"] == {"ALL": 0, "GIFT": 0, "SWAP": 0}


async def test_myItemsPage_queryCount_doesNotGrowWithItems(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    token, _ = await _register(client, "GUEST", "mip.queries@example.com")
    inventory_id = await _inventory(client, token)
    await _seed(client, token, [("Kubek MIP 0", "GIFT")], inventory_id)
    with count_queries(engine) as one:
        await _page(client, token)

    await _seed(client, token, [(f"Kubek MIP {i}", "SWAP") for i in range(1, 5)], inventory_id)
    with count_queries(engine) as five:
        await _page(client, token)

    assert len(five) == len(one)
