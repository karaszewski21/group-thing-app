"""`inventory_items.location_id`: required and owner-validated on create
(404 before 403), editable by PATCH, cleared by a GIFT/SWAP transfer and
exposed to the owner only, through `/details` and `/inventory-items/mine`,
while the place is live. A draft item is listed only with a live location;
an existing listing is never blocked by a deleted place."""

from __future__ import annotations

import uuid
from datetime import datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.infrastructure.ledger import MovementLeg, post_movement
from app.inventory.models import InventoryItem, MovementType
from tests.conftest import create_location, leaf_category_ids
from tests.test_event_item_reservations import _listed_items
from tests.test_personal_pickup import _propose, _reservations, _set_location
from tests.test_term_item_listings import _auth
from tests.test_term_item_listings import _register as _register_token


async def _register(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _inventory_id(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL"}, headers=headers
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _product_id(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post(
        "/api/products/resolve",
        json={"name": "Hulajnoga", "category_id": (await leaf_category_ids(client, headers))[0]},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


async def _item_body(client: AsyncClient, headers: dict[str, str]) -> dict[str, object]:
    """A create body without `location_id`; registers the caller's only
    PERSONAL inventory, so call it once per user."""
    return {
        "inventory_id": await _inventory_id(client, headers),
        "product_id": await _product_id(client, headers),
        "condition": "GOOD",
    }


async def _post_item(
    client: AsyncClient, headers: dict[str, str], body: dict[str, object]
) -> tuple[int, dict]:
    response = await client.post("/api/inventory-items", json=body, headers=headers)
    return response.status_code, response.json()


async def _create_item(client: AsyncClient, headers: dict[str, str], location_id: str) -> str:
    body = await _item_body(client, headers)
    status, created = await _post_item(client, headers, {**body, "location_id": location_id})
    assert status == 201, created
    return str(created["id"])


async def _stored_location_id(db: AsyncSession, item_id: str) -> uuid.UUID | None:
    result = await db.execute(
        select(InventoryItem.location_id).where(InventoryItem.id == uuid.UUID(item_id))
    )
    return result.scalar_one()


async def test_createItem_withoutLocationId_returns400(client: AsyncClient) -> None:
    headers = await _register(client, "itloc.missing@example.com")

    status, body = await _post_item(client, headers, await _item_body(client, headers))

    assert status == 400
    assert "location_id" in body["fieldErrors"]


async def test_createItem_foreignPlace403_deletedPlace404(client: AsyncClient) -> None:
    owner = await _register(client, "itloc.owner2@example.com")
    stranger = await _register(client, "itloc.stranger2@example.com")
    foreign = await create_location(client, stranger)
    deleted = await create_location(client, owner)
    assert (await client.delete(f"/api/locations/{deleted}", headers=owner)).status_code == 204

    body = await _item_body(client, owner)

    foreign_status, _ = await _post_item(client, owner, {**body, "location_id": foreign})
    deleted_status, _ = await _post_item(client, owner, {**body, "location_id": deleted})

    assert foreign_status == 403
    assert deleted_status == 404


async def test_patchItem_changesLocation_explicitNullReturns400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _register(client, "itloc.patch@example.com")
    first = await create_location(client, headers)
    second = await create_location(client, headers, address="ul. Długa 5")
    item_id = await _create_item(client, headers, first)

    moved = await client.patch(
        f"/api/inventory-items/{item_id}", json={"location_id": second}, headers=headers
    )
    cleared = await client.patch(
        f"/api/inventory-items/{item_id}", json={"location_id": None}, headers=headers
    )

    assert moved.status_code == 200, moved.text
    assert cleared.status_code == 400
    assert await _stored_location_id(db_session, item_id) == uuid.UUID(second)


async def test_transfer_registerKeepsLocation_giftClearsIt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    giver = await _register(client, "itloc.giver@example.com")
    receiver = await _register(client, "itloc.receiver@example.com")
    location_id = await create_location(client, giver)
    item_id = await _create_item(client, giver, location_id)
    receiver_inventory = uuid.UUID(await _inventory_id(client, receiver))
    assert await _stored_location_id(db_session, item_id) == uuid.UUID(location_id)

    item = await db_session.get(InventoryItem, uuid.UUID(item_id))
    assert item is not None
    await post_movement(
        db_session,
        movement_type=MovementType.GIFT,
        legs=[MovementLeg(item, item.inventory_id, receiver_inventory, None)],
        description="GIFT: Hulajnoga",
        occurred_at=datetime.utcnow(),
    )
    await db_session.commit()

    assert await _stored_location_id(db_session, item_id) is None


async def test_getItem_ownerResponse_hasNoLocationIdKey(client: AsyncClient) -> None:
    headers = await _register(client, "itloc.get@example.com")
    item_id = await _create_item(client, headers, await create_location(client, headers))

    response = await client.get(f"/api/inventory-items/{item_id}", headers=headers)

    assert response.status_code == 200, response.text
    assert "location_id" not in response.json()


async def test_itemDetails_locationId_ownerOnlyAndNullOnceThePlaceIsDeleted(
    client: AsyncClient,
) -> None:
    owner = await _register(client, "itloc.det.owner@example.com")
    other = await _register(client, "itloc.det.other@example.com")
    location_id = await create_location(client, owner)
    item_id = await _create_item(client, owner, location_id)
    url = f"/api/public/items/{item_id}/details"

    owner_live = (await client.get(url, headers=owner)).json()
    other_view = (await client.get(url, headers=other)).json()
    assert (await client.delete(f"/api/locations/{location_id}", headers=owner)).status_code == 204
    owner_deleted = (await client.get(url, headers=owner)).json()

    assert owner_live["location_id"] == location_id
    assert other_view["location_id"] is None
    assert owner_deleted["location_id"] is None


async def _delete_place(client: AsyncClient, headers: dict[str, str], location_id: str) -> None:
    response = await client.delete(f"/api/locations/{location_id}", headers=headers)
    assert response.status_code == 204, response.text


async def _list(
    client: AsyncClient, headers: dict[str, str], item_id: str, body: dict[str, object]
) -> tuple[int, dict]:
    response = await client.put(
        f"/api/item-listing-preferences/{item_id}", json=body, headers=headers
    )
    return response.status_code, response.json()


async def test_listItem_draftWithoutLiveLocation_returns409(client: AsyncClient) -> None:
    headers = await _register(client, "itloc.guard@example.com")
    location_id = await create_location(client, headers)
    item_id = await _create_item(client, headers, location_id)
    await _delete_place(client, headers, location_id)

    status, body = await _list(client, headers, item_id, {"mode": "GIFT"})
    relocated = await client.patch(
        f"/api/inventory-items/{item_id}",
        json={"location_id": await create_location(client, headers)},
        headers=headers,
    )
    relisted_status, _ = await _list(client, headers, item_id, {"mode": "GIFT"})

    assert (status, body["message"]) == (409, "Ustaw lokalizację przedmiotu, aby go wystawić")
    assert relocated.status_code == 200, relocated.text
    assert relisted_status == 200


async def test_listItem_alreadyListedAfterPlaceDeleted_modeAndVisibilityChangesSucceed(
    client: AsyncClient,
) -> None:
    headers = await _register(client, "itloc.listed@example.com")
    location_id = await create_location(client, headers)
    item_id = await _create_item(client, headers, location_id)
    assert (await _list(client, headers, item_id, {"mode": "GIFT"}))[0] == 200
    await _delete_place(client, headers, location_id)

    swapped, _ = await _list(client, headers, item_id, {"mode": "SWAP"})
    hidden, _ = await _list(client, headers, item_id, {"mode": "SWAP", "visibility": "PRIVATE"})
    cleared, _ = await _list(client, headers, item_id, {"mode": None})
    relisted, _ = await _list(client, headers, item_id, {"mode": "GIFT"})

    assert (swapped, hidden, cleared, relisted) == (200, 200, 200, 409)


async def test_myInventoryItems_carryLocationId(client: AsyncClient) -> None:
    headers = await _register(client, "itloc.mine@example.com")
    location_id = await create_location(client, headers)
    item_id = await _create_item(client, headers, location_id)

    response = await client.get("/api/inventory-items/mine", headers=headers)

    assert response.status_code == 200, response.text
    (row,) = response.json()
    assert (row["id"], row["location_id"]) == (item_id, location_id)


async def test_personalSwapConfirmed_bothItemsArriveDraftWithoutLocation_relistNeedsOne(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register_token(client, "GUEST", "itloc.swap.owner@example.com")
    proposer, _ = await _register_token(client, "GUEST", "itloc.swap.proposer@example.com")
    (listed,) = await _listed_items(client, owner, ("Rowerek itloc", "SWAP"))
    (offered,) = await _listed_items(client, proposer, ("Puzzle itloc", "SWAP"))
    status, proposal = await _propose(client, listed, offered, proposer)
    assert status == 200, proposal
    accept = await client.post(f"/api/swap-proposals/{proposal['id']}/accept", headers=_auth(owner))
    assert accept.status_code == 200, accept.text
    leg = (await _reservations(db_session, listed))[0]

    confirm = await client.post(
        f"/api/reservations/{leg.id}/confirm-transaction", headers=_auth(proposer)
    )

    assert confirm.status_code == 200, confirm.text
    for item_id, new_owner in ((listed, proposer), (offered, owner)):
        assert await _stored_location_id(db_session, str(item_id)) is None
        item = await client.get(f"/api/inventory-items/{item_id}", headers=_auth(new_owner))
        assert item.json()["listing_status"] == "DRAFT"
        status, body = await _list(client, _auth(new_owner), str(item_id), {"mode": "SWAP"})
        assert (status, body["message"]) == (409, "Ustaw lokalizację przedmiotu, aby go wystawić")
    await _set_location(client, proposer, listed)
    assert (await _list(client, _auth(proposer), str(listed), {"mode": "SWAP"}))[0] == 200
