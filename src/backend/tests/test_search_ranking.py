"""Search ranking through `GET /api/public/search`: an item named with the
query above items found through their category branch, groups matched by
name above groups matched only by their description (also when the latter
meets sooner, Q4), terms in date order, and the person-run group rule."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.category import service as category_service
from app.category.schemas import CreateCategoryRequest
from app.groups.models import ItemListingPreference
from tests.conftest import create_location, leaf_category_ids
from tests.test_membership_characterisation import _add_member
from tests.test_organizer_page import _circle, _in_days, _organization_slug, _term
from tests.test_search_api import _search
from tests.test_term_item_listings import _auth, _register


async def _category(db: AsyncSession, name: str, parent_id: uuid.UUID | None = None) -> uuid.UUID:
    created = await category_service.create_category(
        db, CreateCategoryRequest(name=name, parent_id=parent_id)
    )
    return created.id


async def _listed_in(
    client: AsyncClient, token: str, *specs: tuple[str, object]
) -> list[uuid.UUID]:
    """One PERSONAL inventory with a listed GIFT item per `(product name,
    category id)`."""
    inventory = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inventory.status_code == 201, inventory.text
    item_ids = []
    for name, category_id in specs:
        product = await client.post(
            "/api/products/resolve",
            json={"name": name, "category_id": str(category_id)},
            headers=_auth(token),
        )
        assert product.status_code == 200, product.text
        item = await client.post(
            "/api/inventory-items",
            json={
                "inventory_id": inventory.json()["id"],
                "product_id": product.json()["id"],
                "condition": "GOOD",
                "location_id": await create_location(client, _auth(token)),
            },
            headers=_auth(token),
        )
        assert item.status_code == 201, item.text
        item_id = uuid.UUID(item.json()["id"])
        listed = await client.put(
            f"/api/item-listing-preferences/{item_id}", json={"mode": "GIFT"}, headers=_auth(token)
        )
        assert listed.status_code == 200, listed.text
        item_ids.append(item_id)
    return item_ids


async def _group(
    client: AsyncClient, token: str, name: str, description: str | None = None
) -> uuid.UUID:
    response = await client.post(
        "/api/groups/mine/new",
        json={"name": name, "visibility": "PUBLIC", "description": description},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


def _ids(body: dict[str, Any]) -> list[str]:
    return [result["id"] for result in body["items"]]


async def test_searchItems_dzieciece_nameMatchAboveDescendantCategoryItems(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "sr-kids.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "sr-kids.v@example.com")
    group_id = await _circle(client, owner, "Krąg sr-kids")
    await _add_member(db_session, group_id, viewer_party)
    root = await _category(db_session, "Dla dzieci")
    toys = await _category(db_session, "Zabawki", root)
    blocks = await _category(db_session, "Klocki", toys)
    clothes = await _category(db_session, "Odzież", root)
    (other_leaf,) = await leaf_category_ids(client, _auth(owner))
    named, tower, body_suit = await _listed_in(
        client,
        owner,
        ("Ubranka dziecięce", other_leaf),
        ("Wieża Bumbo", blocks),
        ("Body Bumbo", clothes),
    )
    await db_session.execute(
        update(ItemListingPreference)
        .where(ItemListingPreference.item_id.in_({named, tower, body_suit}))
        .values(created_at=datetime(2026, 1, 1, 12, 0))
    )
    await db_session.commit()

    for scope in ("mine", "all"):
        body = await _search(client, viewer, q="dziecięce", mode="items", scope=scope)

        assert body["total"] == 3
        ids = _ids(body)
        assert ids[0] == str(named)
        assert set(ids[1:]) == {str(tower), str(body_suit)}
        assert all(result["meta"]["reserved"] is False for result in body["items"])


async def test_searchMeetings_descriptionOnlyGroup_belowNameMatchedGroup(
    client: AsyncClient,
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sr-desc.o@example.com")
    await _organization_slug(client, organizer, "Fundacja Rzeczna")
    by_description = await _group(
        client, organizer, "Krąg Wiosłowy", "Obserwujemy kormoran i czaple nad rzeką."
    )
    by_name = await _group(client, organizer, "Kormoran Klub")

    body = await _search(client, q="kormoran", mode="events", scope="all")

    assert _ids(body) == [str(by_name), str(by_description)]
    description_group = body["items"][1]
    assert description_group["meta"]["description"] == "Obserwujemy kormoran i czaple nad rzeką."
    assert description_group["meta"]["next_starts_at"] is None


async def test_searchMeetings_matchClassBeatsDate_termsStayInDateOrder(
    client: AsyncClient,
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sr-q4.o@example.com")
    await _organization_slug(client, organizer, "Fundacja Brzegowa")
    by_description = await _group(
        client, organizer, "Krąg Żeglarski", "Pływamy tam, gdzie mieszka perkoz."
    )
    by_name = await _group(client, organizer, "Perkoz Klub")
    await _term(client, organizer, by_description, _in_days(1))
    later = await _term(client, organizer, by_name, _in_days(21))
    sooner = await _term(client, organizer, by_name, _in_days(14))

    body = await _search(client, q="perkoz", mode="events", scope="all")

    ids = _ids(body)
    assert body["total"] == 4
    assert set(ids) == {str(by_name), str(by_description), str(sooner), str(later)}
    # The description-only group meets first (tomorrow) and still ranks last.
    assert ids[-1] == str(by_description)
    assert ids.index(str(by_name)) < ids.index(str(by_description))
    assert ids.index(str(sooner)) < ids.index(str(later))


async def test_searchMeetings_personRunGroup_omittedWithoutUpcomingTermLinkedToIt(
    client: AsyncClient,
) -> None:
    person, _ = await _register(client, "ORGANIZER", "sr-person.o@example.com")
    group_id = await _circle(client, person, "Szuwarek Krąg")

    without = await _search(client, q="szuwarek", mode="events", scope="all")

    assert without["total"] == 0

    term_id = await _term(client, person, group_id, _in_days(5))
    with_term = await _search(client, q="szuwarek", mode="events", scope="all")

    group = next(result for result in with_term["items"] if result["kind"] == "group")
    assert group["id"] == str(group_id)
    assert group["href"].endswith(f"/group/{group_id}/term/{term_id}")
    assert group["meta"]["next_starts_at"] is not None
    assert group["subtitle"] is None
