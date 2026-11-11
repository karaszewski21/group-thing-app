"""`GET /api/public/organizers/{slug}/items` and
`GET /api/public/parties/{party_id}/items`: the anonymous owner items
page. Covers the response contract, the 404s, mode filtering, ordering and
pagination, the owner's nearest public date (terms and events, private
circles excluded), the constant statement count, and the slug guard that
keeps Organization slugs from looking like party ids."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.groups.models import ItemListingPreference
from app.inventory.models import BalanceStatus
from app.moderation.status import ModerationStatus
from app.organizations.models import Organization
from tests.conftest import count_queries, create_location
from tests.test_organizer_bridges import _item, _photo, _set_balance, _uploader_id
from tests.test_organizer_page import _circle, _in_days, _listed_items, _organization_slug, _term
from tests.test_term_item_listings import _auth, _register, _rsvp

PAGE_KEYS = {"owner", "nearest", "counts", "items", "total", "page", "size"}
OWNER_KEYS = {"party_id", "display_name", "slug"}
ITEM_KEYS = {
    "item_id",
    "product_name",
    "condition",
    "mode",
    "thumb_url",
    "added_at",
    "reservation",
}
NEAREST_KEYS = {"kind", "id", "name", "starts_at", "location_name", "attendee_count", "path"}
ADDED = datetime(2026, 10, 1, 12, 0)


async def _items_page(client: AsyncClient, path: str) -> dict[str, Any]:
    response = await client.get(path)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "public, max-age=0, s-maxage=60"
    body: dict[str, Any] = response.json()
    assert set(body) == PAGE_KEYS
    assert set(body["owner"]) == OWNER_KEYS
    assert set(body["counts"]) == {"GIFT", "SWAP"}
    for item in body["items"]:
        assert set(item) == ITEM_KEYS
    if body["nearest"] is not None:
        assert set(body["nearest"]) == NEAREST_KEYS
    return body


async def _set_added_at(db_session: AsyncSession, added_at: dict[uuid.UUID, datetime]) -> None:
    for item_id, created_at in added_at.items():
        await db_session.execute(
            update(ItemListingPreference)
            .where(ItemListingPreference.item_id == item_id)
            .values(created_at=created_at)
        )
    await db_session.commit()


async def _create_event(client: AsyncClient, token: str, name: str, starts_at: datetime) -> str:
    response = await client.post(
        "/api/events",
        json={
            "location_id": await create_location(client, _auth(token)),
            "name": name,
            "starts_at": starts_at.isoformat(),
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def test_getOwnerItems_organizationSlug_exactShapeNewestFirstModeFilterAndPages(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, owner_party_id = await _register(client, "ORGANIZER", "oi.shape@example.com")
    slug = await _organization_slug(client, owner_token, "Rzeczowe Nutki")
    older, newest, oldest, reserved, unlisted = await _listed_items(
        client,
        owner_token,
        ("Oi starszy", "GIFT"),
        ("Oi najnowszy", "SWAP"),
        ("Oi najstarszy", "GIFT"),
        ("Oi zajęty", "GIFT"),
        ("Oi bez preferencji", "GIFT"),
    )
    cleared = await client.put(
        f"/api/item-listing-preferences/{unlisted}", json={"mode": None}, headers=_auth(owner_token)
    )
    assert cleared.status_code in (200, 204), cleared.text
    await _set_balance(db_session, reserved, BalanceStatus.RESERVED)
    await _set_added_at(
        db_session,
        {
            older: ADDED - timedelta(days=1),
            newest: ADDED,
            oldest: ADDED - timedelta(days=2),
            reserved: ADDED - timedelta(days=3),
        },
    )
    base = f"/api/public/organizers/{slug}/items"

    body = await _items_page(client, base)

    assert body["owner"] == {
        "party_id": str(owner_party_id),
        "display_name": "Rzeczowe Nutki",
        "slug": slug,
    }
    assert body["nearest"] is None
    assert body["counts"] == {"GIFT": 3, "SWAP": 1}
    assert (body["total"], body["page"], body["size"]) == (4, 1, 20)
    assert [i["item_id"] for i in body["items"]] == [
        str(newest),
        str(older),
        str(oldest),
        str(reserved),
    ]
    assert [i["reservation"] for i in body["items"]] == [
        None,
        None,
        None,
        {"by_name": None, "by_me": False},
    ]
    assert body["items"][0] == {
        "item_id": str(newest),
        "product_name": "Oi najnowszy",
        "condition": "GOOD",
        "mode": "SWAP",
        "thumb_url": None,
        "added_at": ADDED.isoformat(),
        "reservation": None,
    }

    gifts = await _items_page(client, f"{base}?mode=GIFT")
    assert gifts["counts"] == {"GIFT": 3, "SWAP": 1}
    assert [i["item_id"] for i in gifts["items"]] == [str(older), str(oldest), str(reserved)]
    assert gifts["total"] == 3

    second = await _items_page(client, f"{base}?page=2&size=1")
    assert [i["item_id"] for i in second["items"]] == [str(older)]
    assert (second["total"], second["page"], second["size"]) == (4, 2, 1)


async def test_getOwnerItems_unknownPseudoProfilelessOrNothingListed_returns404ElsePartyVariant(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    for slug in ("nie-ma-takiej", "k-0123456789ab"):
        missing = await client.get(f"/api/public/organizers/{slug}/items")
        assert missing.status_code == 404
        assert "cache-control" not in missing.headers
    assert (await client.get(f"/api/public/parties/{uuid.uuid4()}/items")).status_code == 404

    org_token, org_owner_party_id = await _register(client, "ORGANIZER", "oi.404.org@example.com")
    slug = await _organization_slug(client, org_token, "Profilowe Nutki")
    organization_party_id = (
        await db_session.execute(select(Organization.party_id).where(Organization.slug == slug))
    ).scalar_one()
    profileless = await client.get(f"/api/public/parties/{organization_party_id}/items")
    assert profileless.status_code == 404

    await _listed_items(client, org_token, ("Oi organizacji", "GIFT"))
    by_party = await _items_page(client, f"/api/public/parties/{org_owner_party_id}/items")
    # The person's own page: their name, not the Organization's.
    assert by_party["owner"]["slug"] is None
    assert by_party["owner"]["display_name"] != "Profilowe Nutki"

    guest_token, guest_party_id = await _register(client, "GUEST", "oi.404.guest@example.com")
    nothing_listed = await client.get(f"/api/public/parties/{guest_party_id}/items")
    assert nothing_listed.status_code == 404
    [item_id] = await _listed_items(client, guest_token, ("Oi gościa", "SWAP"))

    guest = await _items_page(client, f"/api/public/parties/{guest_party_id}/items")

    assert guest["owner"]["party_id"] == str(guest_party_id)
    assert guest["owner"]["slug"] is None
    assert guest["owner"]["display_name"]
    assert [i["item_id"] for i in guest["items"]] == [str(item_id)]


async def test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "oi.private@example.com")
    slug = await _organization_slug(client, owner_token, "Prywatne Rzeczy")
    private_id = await _circle(client, owner_token, "Oi prywatny", "PRIVATE")
    public_id = await _circle(client, owner_token, "Oi publiczny")
    await _term(client, owner_token, private_id, _in_days(1))
    public_on = _in_days(4)
    public_term = await _term(client, owner_token, public_id, public_on)
    await _term(client, owner_token, public_id, _in_days(-1))

    nearest = (await _items_page(client, f"/api/public/organizers/{slug}/items"))["nearest"]

    assert nearest == {
        "kind": "TERM",
        "id": str(public_term),
        "name": "Oi publiczny",
        "starts_at": public_on.isoformat(),
        "location_name": None,
        "attendee_count": 0,
        "path": f"/{slug}/group/{public_id}/term/{public_term}",
    }


async def test_getOwnerItems_nearest_earliestOfAttendedTermAndEvent(
    client: AsyncClient,
) -> None:
    organizer_token, _ = await _register(client, "ORGANIZER", "oi.near.organizer@example.com")
    organizer_slug = await _organization_slug(client, organizer_token, "Cudze Nutki")
    group_id = await _circle(client, organizer_token, "Oi cudzy krąg")
    term_on = _in_days(5)
    term_id = await _term(client, organizer_token, group_id, term_on)
    owner_token, owner_party_id = await _register(client, "GUEST", "oi.near.owner@example.com")
    await _listed_items(client, owner_token, ("Oi near", "GIFT"))
    await _rsvp(client, owner_token, group_id, term_id)
    path = f"/api/public/parties/{owner_party_id}/items"

    attended = (await _items_page(client, path))["nearest"]

    assert (attended["kind"], attended["id"], attended["attendee_count"]) == (
        "TERM",
        str(term_id),
        1,
    )
    assert attended["path"] == f"/{organizer_slug}/group/{group_id}/term/{term_id}"

    await _create_event(client, owner_token, "Oi późne wydarzenie", _in_days(9))
    event_on = _in_days(2).replace(second=0)
    event_id = await _create_event(client, owner_token, "Oi wczesne wydarzenie", event_on)

    earliest = (await _items_page(client, path))["nearest"]

    assert (earliest["kind"], earliest["id"], earliest["name"]) == (
        "EVENT",
        event_id,
        "Oi wczesne wydarzenie",
    )
    assert earliest["starts_at"] == event_on.isoformat()
    assert earliest["path"].endswith(f"/event/{event_id}")
    assert earliest["path"] == f"/{owner_party_id}/event/{event_id}"


async def _owner_with_items(
    client: AsyncClient, db_session: AsyncSession, prefix: str, item_count: int
) -> str:
    """An Organization owner with a public term, an upcoming event and
    `item_count` listed items, each with an APPROVED photo."""
    token, _ = await _register(client, "ORGANIZER", f"{prefix}@example.com")
    slug = await _organization_slug(client, token, f"Oi {prefix}")
    group_id = await _circle(client, token, f"Oi krąg {prefix}")
    await _term(client, token, group_id, _in_days(3))
    await _create_event(client, token, f"Oi event {prefix}", _in_days(6))
    uploader = await _uploader_id(db_session)
    item_ids = await _listed_items(
        client, token, *((f"Oi {prefix} {index}", "GIFT") for index in range(item_count))
    )
    for item_id in item_ids:
        product_id = (await _item(db_session, item_id)).product_id
        db_session.add(
            _photo(product_id, uploader, f"{prefix}-{item_id}", ModerationStatus.APPROVED, 0)
        )
    await db_session.commit()
    return slug


async def test_getOwnerItems_oneVsFiveItems_queryCountConstant(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    one = await _owner_with_items(client, db_session, "oi-budget-one", 1)
    five = await _owner_with_items(client, db_session, "oi-budget-five", 5)

    with count_queries(engine) as one_statements:
        one_body = await _items_page(client, f"/api/public/organizers/{one}/items")
    with count_queries(engine) as five_statements:
        five_body = await _items_page(client, f"/api/public/organizers/{five}/items")

    assert (len(one_body["items"]), len(five_body["items"])) == (1, 5)
    assert all(item["thumb_url"] for item in five_body["items"])
    assert one_body["nearest"]["kind"] == five_body["nearest"]["kind"] == "TERM"
    assert len(one_statements) == len(five_statements), (one_statements, five_statements)


async def test_createOrganization_uuidShapedName_getsNonUuidSlug(client: AsyncClient) -> None:
    token, _ = await _register(client, "ORGANIZER", "oi.uuid.slug@example.com")
    name = str(uuid.uuid4())

    slug = await _organization_slug(client, token, name)

    assert slug == f"{name}-2"


async def test_getOwnerItems_nearest_attendedEventUntilWithdrawn(client: AsyncClient) -> None:
    author_token, _ = await _register(client, "GUEST", "oi.attend.author@example.com")
    event_id = await _create_event(client, author_token, "Oi cudze wydarzenie", _in_days(3))
    owner_token, owner_party_id = await _register(client, "GUEST", "oi.attend.owner@example.com")
    await _listed_items(client, owner_token, ("Oi attend", "GIFT"))
    signed_up = await client.post(
        f"/api/events/{event_id}/attendances", json={}, headers=_auth(owner_token)
    )
    assert signed_up.status_code == 201, signed_up.text
    path = f"/api/public/parties/{owner_party_id}/items"

    attending = (await _items_page(client, path))["nearest"]
    withdrawn = await client.post(
        f"/api/events/{event_id}/attendances/withdraw", headers=_auth(owner_token)
    )
    assert withdrawn.status_code == 204, withdrawn.text
    after_withdraw = (await _items_page(client, path))["nearest"]

    assert (attending["kind"], attending["id"], attending["attendee_count"]) == (
        "EVENT",
        event_id,
        1,
    )
    assert after_withdraw is None
