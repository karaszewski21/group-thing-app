"""Featured items in the read models: `is_featured` on the term page, the
event page, the owner items page, the profile's recent items, the item
actions and „Moje rzeczy”, and the featured-first order (most recently
featured first) everywhere except „Moje rzeczy”, which stays newest first,
and search, which neither carries the flag nor changes its order."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.groups.models import ItemListingPreference
from tests.conftest import create_location
from tests.test_event_item_reservations import _listed_items
from tests.test_item_actions import _actions
from tests.test_organizer_page import _organization_slug
from tests.test_owner_items_page import _items_page
from tests.test_public_term import _create_circle, _create_term
from tests.test_search_api import _search
from tests.test_term_item_listings import _auth, _register

ADDED = datetime(2026, 10, 1, 12, 0)


async def _feature(client: AsyncClient, token: str, item_id: uuid.UUID) -> None:
    response = await client.put(
        f"/api/item-listing-preferences/{item_id}/featured",
        json={"featured": True},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_featured"] is True


async def _set_times(
    db: AsyncSession,
    created_at: dict[uuid.UUID, datetime],
    featured_at: dict[uuid.UUID, datetime] | None = None,
) -> None:
    for item_id, created in created_at.items():
        values: dict[str, Any] = {"created_at": created}
        if featured_at is not None and item_id in featured_at:
            values["featured_at"] = featured_at[item_id]
        await db.execute(
            update(ItemListingPreference)
            .where(ItemListingPreference.item_id == item_id)
            .values(**values)
        )
    await db.commit()


def _ids(items: list[dict[str, Any]], key: str = "item_id") -> list[str]:
    return [str(item[key]) for item in items]


async def test_publicTerm_featuredItem_listedFirstWithFlag(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "ORGANIZER", "fio.term@example.com")
    group_id = await _create_circle(client, token, "Krąg wyróżnionych")
    term_id = await _create_term(
        client, token, group_id, clock.local_now().date() + timedelta(days=7)
    )
    oldest, middle, newest = await _listed_items(
        client, token, ("Fio stary", "GIFT"), ("Fio środkowy", "GIFT"), ("Fio nowy", "SWAP")
    )
    await _feature(client, token, newest)
    await _set_times(
        db_session,
        {oldest: ADDED - timedelta(days=2), middle: ADDED - timedelta(days=1), newest: ADDED},
    )

    response = await client.get(f"/api/public/groups/{group_id}?term_id={term_id}")

    assert response.status_code == 200, response.text
    listings = response.json()["term"]["item_listings"]
    assert _ids(listings) == [str(newest), str(oldest), str(middle)]
    assert [row["is_featured"] for row in listings] == [True, False, False]


async def test_eventPage_featuredOlderItem_insidePreviewWindow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "fio.event@example.com")
    event = await client.post(
        "/api/events",
        json={
            "location_id": await create_location(client, _auth(token)),
            "name": "Piknik wyróżnionych",
            "starts_at": (clock.local_now() + timedelta(days=7)).replace(microsecond=0).isoformat(),
        },
        headers=_auth(token),
    )
    assert event.status_code == 201, event.text
    oldest, older, newer, newest = await _listed_items(
        client,
        token,
        ("Fio e1", "GIFT"),
        ("Fio e2", "GIFT"),
        ("Fio e3", "GIFT"),
        ("Fio e4", "GIFT"),
    )
    await _feature(client, token, oldest)
    await _set_times(
        db_session,
        {
            oldest: ADDED - timedelta(days=3),
            older: ADDED - timedelta(days=2),
            newer: ADDED - timedelta(days=1),
            newest: ADDED,
        },
    )

    response = await client.get(f"/api/public/events/{event.json()['id']}")

    assert response.status_code == 200, response.text
    [author] = response.json()["participants"]
    assert _ids(author["items"]) == [str(oldest), str(newest), str(newer)]
    assert [item["is_featured"] for item in author["items"]] == [True, False, False]
    assert author["items_total"] == 4


async def test_ownerItemsPage_featuredFirst_inAllAndModeTab(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "ORGANIZER", "fio.owner@example.com")
    slug = await _organization_slug(client, token, "Wyróżnione Nutki")
    gift_old, gift_new, swap_old, gift_plain = await _listed_items(
        client,
        token,
        ("Fio o1", "GIFT"),
        ("Fio o2", "GIFT"),
        ("Fio o3", "SWAP"),
        ("Fio o4", "GIFT"),
    )
    for item_id in (gift_old, swap_old, gift_new):
        await _feature(client, token, item_id)
    await _set_times(
        db_session,
        {
            gift_old: ADDED - timedelta(days=3),
            gift_new: ADDED - timedelta(days=2),
            swap_old: ADDED - timedelta(days=1),
            gift_plain: ADDED,
        },
        featured_at={
            gift_old: ADDED + timedelta(hours=3),
            swap_old: ADDED + timedelta(hours=2),
            gift_new: ADDED + timedelta(hours=1),
        },
    )
    base = f"/api/public/organizers/{slug}/items"

    everything = await _items_page(client, base)
    gifts = await _items_page(client, f"{base}?mode=GIFT")

    assert _ids(everything["items"]) == [
        str(gift_old),
        str(swap_old),
        str(gift_new),
        str(gift_plain),
    ]
    assert [item["is_featured"] for item in everything["items"]] == [True, True, True, False]
    assert _ids(gifts["items"]) == [str(gift_old), str(gift_new), str(gift_plain)]


async def test_organizationOrProfileRecentItems_featuredFirst(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, party_id = await _register(client, "GUEST", "fio.profile@example.com")
    featured, plain = await _listed_items(client, token, ("Fio p1", "GIFT"), ("Fio p2", "SWAP"))
    await _feature(client, token, featured)
    await _set_times(db_session, {featured: ADDED - timedelta(days=1), plain: ADDED})

    response = await client.get(f"/api/public/parties/{party_id}")

    assert response.status_code == 200, response.text
    recent = response.json()["recent_items"]
    assert _ids(recent) == [str(featured), str(plain)]
    assert [item["is_featured"] for item in recent] == [True, False]


async def test_itemActions_featuredListing_isFeaturedForGuestAndViewer(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "GUEST", "fio.actions.owner@example.com")
    viewer, _ = await _register(client, "GUEST", "fio.actions.viewer@example.com")
    featured, plain = await _listed_items(client, owner, ("Fio a1", "GIFT"), ("Fio a2", "GIFT"))
    await _feature(client, owner, featured)

    assert (await _actions(client, featured))["is_featured"] is True
    assert (await _actions(client, featured, viewer))["is_featured"] is True
    assert (await _actions(client, featured, owner))["is_featured"] is True
    assert (await _actions(client, plain, viewer))["is_featured"] is False


async def test_myItems_featuredListedTrue_draftFalse(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "fio.mine@example.com")
    featured, plain, draft = await _listed_items(
        client, token, ("Fio m1", "GIFT"), ("Fio m2", "GIFT"), ("Fio m3", "GIFT")
    )
    await _feature(client, token, featured)
    cleared = await client.put(
        f"/api/item-listing-preferences/{draft}", json={"mode": None}, headers=_auth(token)
    )
    assert cleared.status_code == 200, cleared.text

    response = await client.get("/api/inventory-items/mine/page", headers=_auth(token))

    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert _ids(items, "id") == [str(draft), str(plain), str(featured)]
    assert [item["is_featured"] for item in items] == [False, False, True]


async def test_search_featuredItem_noFlagAndOrderUnchanged(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "GUEST", "fo.search.o@example.com")
    items = await _listed_items(client, owner, *((f"Żyrafolot {n}", "GIFT") for n in range(3)))
    await _set_times(db_session, {i: ADDED + timedelta(days=n) for n, i in enumerate(items)})
    # `_search` pins the exact result and meta key sets, so no `is_featured`.
    before = await _search(client, q="zyrafolot", mode="items")
    assert sorted(_ids(before["items"], "id")) == sorted(str(i) for i in items)

    await _feature(client, owner, uuid.UUID(before["items"][-1]["id"]))
    after = await _search(client, q="zyrafolot", mode="items")
    viewer, _ = await _register(client, "GUEST", "fo.search.v@example.com")
    logged_in = await _search(client, viewer, q="zyrafolot", mode="items", scope="all")

    assert _ids(after["items"], "id") == _ids(before["items"], "id")
    assert _ids(logged_in["items"], "id") == _ids(before["items"], "id")
