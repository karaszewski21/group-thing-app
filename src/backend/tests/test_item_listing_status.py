"""`InventoryItem.listing_status` in lockstep with `ItemListingPreference`:
register with an optional `listing_mode` (one commit, PERSONAL inventory
only), `PUT /api/item-listing-preferences/{id}` set/clear, the 10-item gift
limit on both paths, and a confirmed GIFT arriving at its new owner as a
draft. The invariant checked throughout: ACTIVE exactly when a pref row
exists."""

from __future__ import annotations

import uuid
from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import InventoryItem
from app.core import clock
from app.groups import service
from app.groups.models import ItemListingPreference, Term
from app.groups.schemas import TakeTermItemListingRequest
from tests.test_term_item_listings import (
    _auth,
    _create_circle_and_term,
    _principal,
    _register,
    _resolve_product,
    _rsvp,
)

REGISTER_LIMIT_MESSAGE = (
    "Możesz mieć maksymalnie 10 rzeczy do oddania. "
    "Wybierz „Zamienię” albo zapisz wersję roboczą."
)
PUT_LIMIT_MESSAGE = (
    "Możesz mieć maksymalnie 10 rzeczy do oddania. Zdejmij „Oddam” z innej rzeczy."
)


async def _inventory(client: AsyncClient, token: str, inventory_type: str = "PERSONAL") -> str:
    response = await client.post(
        "/api/inventories",
        json={"inventory_type": inventory_type, "location": None},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _post_item(
    client: AsyncClient, token: str, inventory_id: str, product_id: str, mode: str | None
) -> dict:
    response = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inventory_id,
            "product_id": product_id,
            "condition": "GOOD",
            "listing_mode": mode,
        },
        headers=_auth(token),
    )
    return {"status": response.status_code, "body": response.json()}


async def _mine(client: AsyncClient, token: str) -> dict[str, tuple[str | None, str]]:
    response = await client.get("/api/inventory-items/mine", headers=_auth(token))
    assert response.status_code == 200, response.text
    return {row["id"]: (row["listing_mode"], row["listing_status"]) for row in response.json()}


async def _item_count(db: AsyncSession, inventory_id: str) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(InventoryItem)
                .where(InventoryItem.inventory_id == uuid.UUID(inventory_id))
            )
        ).scalar_one()
    )


async def _pref_count(db: AsyncSession) -> int:
    return int(
        (await db.execute(select(func.count()).select_from(ItemListingPreference))).scalar_one()
    )


async def test_registerItem_noMode_isDraftWithoutPreference(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "ils.draft@example.com")
    inventory_id = await _inventory(client, token)
    product_id = await _resolve_product(client, token, "Rowerek ILS")

    created = await _post_item(client, token, inventory_id, product_id, None)

    assert created["status"] == 201, created["body"]
    assert created["body"]["listing_status"] == "DRAFT"
    assert await _mine(client, token) == {created["body"]["id"]: (None, "DRAFT")}


async def test_registerItem_swapMode_isActiveWithPreference(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "ils.swap@example.com")
    inventory_id = await _inventory(client, token)
    product_id = await _resolve_product(client, token, "Klocki ILS")

    created = await _post_item(client, token, inventory_id, product_id, "SWAP")

    assert created["status"] == 201, created["body"]
    assert created["body"]["listing_status"] == "ACTIVE"
    assert await _mine(client, token) == {created["body"]["id"]: ("SWAP", "ACTIVE")}


async def test_registerItem_modeIntoNonPersonalInventory_returns403AndPersistsNothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "ils.pickup@example.com")
    inventory_id = await _inventory(client, token, "PICKUP_POINT")
    product_id = await _resolve_product(client, token, "Hulajnoga ILS")
    prefs_before = await _pref_count(db_session)

    created = await _post_item(client, token, inventory_id, product_id, "GIFT")

    assert created["status"] == 403, created["body"]
    await db_session.rollback()
    assert await _item_count(db_session, inventory_id) == 0
    assert await _pref_count(db_session) == prefs_before


async def test_registerItem_lendMode_returns400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "ils.lend@example.com")
    inventory_id = await _inventory(client, token)
    product_id = await _resolve_product(client, token, "Namiot ILS")

    created = await _post_item(client, token, inventory_id, product_id, "LEND")

    assert created["status"] == 400, created["body"]
    assert await _item_count(db_session, inventory_id) == 0


async def test_setPreference_setThenClear_flipsActiveThenDraft(client: AsyncClient) -> None:
    token, _ = await _register(client, "GUEST", "ils.put@example.com")
    inventory_id = await _inventory(client, token)
    product_id = await _resolve_product(client, token, "Gitara ILS")
    item_id = (await _post_item(client, token, inventory_id, product_id, None))["body"]["id"]

    set_response = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": "GIFT"}, headers=_auth(token)
    )
    assert set_response.status_code == 200, set_response.text
    assert await _mine(client, token) == {item_id: ("GIFT", "ACTIVE")}

    clear_response = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": None}, headers=_auth(token)
    )
    assert clear_response.status_code == 200, clear_response.text
    assert await _mine(client, token) == {item_id: (None, "DRAFT")}


async def test_registerItem_eleventhGift_returns409AndPersistsNothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "ils.limit1@example.com")
    inventory_id = await _inventory(client, token)
    product_id = await _resolve_product(client, token, "Książka ILS")
    for _ in range(10):
        created = await _post_item(client, token, inventory_id, product_id, "GIFT")
        assert created["status"] == 201, created["body"]

    eleventh = await _post_item(client, token, inventory_id, product_id, "GIFT")

    assert eleventh["status"] == 409, eleventh["body"]
    assert eleventh["body"]["message"] == REGISTER_LIMIT_MESSAGE
    await db_session.rollback()
    assert await _item_count(db_session, inventory_id) == 10
    swap = await _post_item(client, token, inventory_id, product_id, "SWAP")
    assert swap["status"] == 201, swap["body"]


async def test_setPreference_eleventhGift_returns409AndKeepsDraft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "ils.limit2@example.com")
    inventory_id = await _inventory(client, token)
    product_id = await _resolve_product(client, token, "Piłka ILS")
    for _ in range(10):
        created = await _post_item(client, token, inventory_id, product_id, "GIFT")
        assert created["status"] == 201, created["body"]
    item_id = (await _post_item(client, token, inventory_id, product_id, None))["body"]["id"]

    response = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": "GIFT"}, headers=_auth(token)
    )

    assert response.status_code == 409, response.text
    assert response.json()["message"] == PUT_LIMIT_MESSAGE
    await db_session.rollback()
    assert (await _mine(client, token))[item_id] == (None, "DRAFT")


async def test_confirmTransaction_gift_itemIsDraftAtNewOwner(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "ils.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "ils")
    inventory_id = await _inventory(client, org_token)
    product_id = await _resolve_product(client, org_token, "Lalka ILS")
    item_id = (await _post_item(client, org_token, inventory_id, product_id, "GIFT"))["body"]["id"]

    taker_token, _ = await _register(client, "GUEST", "ils.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        uuid.UUID(item_id),
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = clock.local_now() - timedelta(days=1)
    await db_session.commit()

    await service.confirm_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )

    assert await _mine(client, taker_token) == {item_id: (None, "DRAFT")}


async def _invariant_violations(db: AsyncSession, item_ids: list[str]) -> int:
    """Items among `item_ids` whose status disagrees with the pref table."""
    return int(
        (
            await db.execute(
                text(
                    "SELECT count(*) FROM inventory_items i WHERE i.id = ANY(:ids) "
                    "AND (i.listing_status = 'ACTIVE') <> EXISTS "
                    "(SELECT 1 FROM item_listing_preferences p WHERE p.item_id = i.id)"
                ),
                {"ids": [uuid.UUID(item_id) for item_id in item_ids]},
            )
        ).scalar_one()
    )


async def test_listingInvariant_registerSetClearConfirmSequence_activeExactlyWhenPrefExists(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "ils.seq.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "ilsseq")
    inventory_id = await _inventory(client, org_token)
    product_id = await _resolve_product(client, org_token, "Termos ILS")
    swap_id = (await _post_item(client, org_token, inventory_id, product_id, "SWAP"))["body"]["id"]
    draft_id = (await _post_item(client, org_token, inventory_id, product_id, None))["body"]["id"]
    gift_id = (await _post_item(client, org_token, inventory_id, product_id, "GIFT"))["body"]["id"]
    item_ids = [swap_id, draft_id, gift_id]
    assert await _invariant_violations(db_session, item_ids) == 0

    steps = ((draft_id, "GIFT"), (swap_id, None), (swap_id, "GIFT"), (swap_id, "SWAP"))
    for item_id, mode in steps:
        response = await client.put(
            f"/api/item-listing-preferences/{item_id}",
            json={"mode": mode},
            headers=_auth(org_token),
        )
        assert response.status_code == 200, response.text
        assert await _invariant_violations(db_session, item_ids) == 0

    taker_token, _ = await _register(client, "GUEST", "ils.seq.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        uuid.UUID(gift_id),
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = clock.local_now() - timedelta(days=1)
    await db_session.commit()
    await service.confirm_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )

    assert await _invariant_violations(db_session, item_ids) == 0
    assert await _mine(client, org_token) == {
        swap_id: ("SWAP", "ACTIVE"),
        draft_id: ("GIFT", "ACTIVE"),
    }
    assert await _mine(client, taker_token) == {gift_id: (None, "DRAFT")}


async def test_setPreference_atGiftLimit_ownGiftIsNotCountedAndSwapFreesASlot(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "ils.limit3@example.com")
    inventory_id = await _inventory(client, token)
    product_id = await _resolve_product(client, token, "Kubek ILS")
    gift_ids = []
    for _ in range(10):
        created = await _post_item(client, token, inventory_id, product_id, "GIFT")
        assert created["status"] == 201, created["body"]
        gift_ids.append(created["body"]["id"])
    draft_id = (await _post_item(client, token, inventory_id, product_id, None))["body"]["id"]

    async def put(item_id: str, mode: str) -> int:
        response = await client.put(
            f"/api/item-listing-preferences/{item_id}", json={"mode": mode}, headers=_auth(token)
        )
        return response.status_code

    assert await put(gift_ids[0], "GIFT") == 200
    assert await put(gift_ids[0], "SWAP") == 200
    assert await put(draft_id, "GIFT") == 200
    assert await put(gift_ids[0], "GIFT") == 409
    await db_session.rollback()

    mine = await _mine(client, token)
    assert mine[gift_ids[0]] == ("SWAP", "ACTIVE")
    assert mine[draft_id] == ("GIFT", "ACTIVE")
    assert sum(1 for mode, _ in mine.values() if mode == "GIFT") == 10
