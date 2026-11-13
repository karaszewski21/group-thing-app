"""`GET /api/public/organizations/{slug}/layout/{layout}`: the anonymous
organization page, one read per layout. Covers each layout's response
contract (and the absence of any identity field), the own-only stats, the
404 / 400 / empty cases, and the lists' limits and order. Other test files
import the helpers defined here.

Data is built over HTTP plus direct `db_session` writes, following
`test_public_term.py` / `test_term_item_listings.py`."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, get_args

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.groups.models import (
    Group,
    ItemListingPreference,
    Leadership,
)
from app.inventory.models import BalanceStatus
from app.organizations.models import Organization, OrganizationMembership
from app.organizations.page_layouts import PAGE_LAYOUT_KEYS
from app.pages.domain.page_content import PageLayout
from tests.conftest import create_location
from tests.test_organizer_bridges import (
    _register_items,
    _set_balance,
)
from tests.test_term_item_listings import _auth, _register, _rsvp

FORBIDDEN_KEYS = {
    "display_name",
    "lister_party_id",
    "lister_display_name",
    "party_id",
    "claimed_by_name",
    "claimed_by_party_id",
    "guardians",
    "organizer_display_name",
}


async def _organization_slug(client: AsyncClient, token: str, name: str) -> str:
    created = await client.post(
        "/api/organizations/mine", json={"name": name}, headers=_auth(token)
    )
    assert created.status_code == 201
    return str(created.json()["slug"])


async def _circle(
    client: AsyncClient, token: str, name: str, visibility: str = "PUBLIC"
) -> uuid.UUID:
    circle = await client.post(
        "/api/groups/mine/new",
        json={"name": name, "visibility": visibility},
        headers=_auth(token),
    )
    assert circle.status_code == 201
    return uuid.UUID(circle.json()["id"])


async def _term(
    client: AsyncClient,
    token: str,
    group_id: uuid.UUID,
    occurs_on: datetime,
    description: str | None = None,
) -> uuid.UUID:
    term = await client.post(
        "/api/terms",
        json={
            "location_id": await create_location(client, _auth(token)),
            "group_id": str(group_id),
            "occurs_on": occurs_on.isoformat(),
            "description": description,
        },
        headers=_auth(token),
    )
    assert term.status_code == 201
    return uuid.UUID(term.json()["id"])


async def _needed_item(client: AsyncClient, token: str, term_id: uuid.UUID, name: str) -> uuid.UUID:
    created = await client.post(
        "/api/needed-items",
        json={"term_id": str(term_id), "name": name},
        headers=_auth(token),
    )
    assert created.status_code == 201
    return uuid.UUID(created.json()["id"])


async def _listed_items(
    client: AsyncClient, token: str, *listings: tuple[str, str]
) -> list[uuid.UUID]:
    """One item per `(product_name, mode)` in the user's single PERSONAL
    inventory, each with its listing preference set."""
    item_ids = await _register_items(client, token, *(name for name, _ in listings))
    for item_id, (_, mode) in zip(item_ids, listings, strict=True):
        preference = await client.put(
            f"/api/item-listing-preferences/{item_id}", json={"mode": mode}, headers=_auth(token)
        )
        assert preference.status_code == 200
    return item_ids


def _keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {key for child in value.values() for key in _keys(child)}
    if isinstance(value, list):
        return {key for child in value for key in _keys(child)}
    return set()


def _in_days(days: int) -> datetime:
    return (clock.local_now() + timedelta(days=days)).replace(microsecond=0)


async def _layout(client: AsyncClient, slug: str, layout: str) -> dict[str, Any]:
    response = await client.get(f"/api/public/organizations/{slug}/layout/{layout}")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "public, max-age=0, s-maxage=60"
    body: dict[str, Any] = response.json()
    assert body["layout"] == layout
    return body


async def _event(client: AsyncClient, token: str, name: str, days: int) -> str:
    # Events keep whole minutes.
    event = await client.post(
        "/api/events",
        json={
            "location_id": await create_location(client, _auth(token)),
            "name": name,
            "starts_at": _in_days(days).replace(second=0).isoformat(),
        },
        headers=_auth(token),
    )
    assert event.status_code == 201, event.text
    return str(event.json()["id"])


DATE_KEYS = {"kind", "id", "name", "starts_at", "location_name", "attendee_count", "path"}
ITEM_KEYS = {"item_id", "product_name", "condition", "mode", "thumb_url", "added_at", "reservation"}


async def test_getOrganizationLayout_eachLayout_onlyItsPropsWithoutIdentityKeys(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "ol.shape.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Kształtne Nutki")
    group_id = await _circle(client, owner_token, "Nutki")
    occurs_on = _in_days(3)
    term_id = await _term(client, owner_token, group_id, occurs_on)
    await _listed_items(client, owner_token, ("Ol rowerek", "GIFT"))
    guest_token, _ = await _register(client, "GUEST", "ol.shape.guest@example.com")
    await _rsvp(client, guest_token, group_id, term_id)
    stats = {"group_count": 1, "item_count": 1, "meeting_count": 1}

    classic = await _layout(client, slug, "CLASSIC")
    links = await _layout(client, slug, "LINKS")
    schedule = await _layout(client, slug, "SCHEDULE")
    exchange = await _layout(client, slug, "EXCHANGE")

    assert set(classic) == {"layout", "stats", "upcoming_terms", "items"}
    assert classic["stats"] == stats
    [date] = classic["upcoming_terms"]
    assert set(date) == DATE_KEYS and date["attendee_count"] == 1
    assert date["path"] == f"/{slug}/group/{group_id}/term/{term_id}"
    assert set(classic["items"][0]) == ITEM_KEYS
    assert links == {"layout": "LINKS", "stats": stats}
    assert set(schedule) == {"layout", "stats", "upcoming_terms", "groups", "item_stats"}
    assert schedule["groups"] == [
        {
            "id": str(group_id),
            "name": "Nutki",
            "layout_mode": "CIRCLE",
            "next_term": {
                "id": str(term_id),
                "occurs_on": occurs_on.isoformat(),
                "attendee_count": 1,
            },
            "upcoming_term_count": 1,
        }
    ]
    assert schedule["item_stats"] == {"GIFT": 1, "SWAP": 0}
    assert set(exchange) == {"layout", "stats", "items", "term_links"}
    assert exchange["term_links"] == [
        {"kind": "TERM", "starts_at": occurs_on.isoformat(), "path": date["path"]}
    ]
    for body in (classic, links, schedule, exchange):
        assert _keys(body) & FORBIDDEN_KEYS == set()


async def test_getOrganizationLayout_stats_ownGroupsTermsEventsAndAvailableItemsOnly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "ol.own.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Własne Nutki")
    public_id = await _circle(client, owner_token, "Publiczny")
    private_id = await _circle(client, owner_token, "Prywatny", "PRIVATE")
    revoked_id = await _circle(client, owner_token, "Odwołany")
    public_term = await _term(client, owner_token, public_id, _in_days(4))
    for group_id in (private_id, revoked_id):
        await _term(client, owner_token, group_id, _in_days(2))
    leadership = (
        await db_session.execute(select(Leadership).where(Leadership.to_group_id == revoked_id))
    ).scalar_one()
    leadership.valid_to = clock.local_now().date()
    await db_session.flush()
    own_event = await _event(client, owner_token, "Ol własny piknik", 6)
    # Dates the owner only attends never count.
    other_token, _ = await _register(client, "ORGANIZER", "ol.own.other@example.com")
    other_group = await _circle(client, other_token, "Cudzy")
    other_term = await _term(client, other_token, other_group, _in_days(1))
    await _rsvp(client, owner_token, other_group, other_term)
    other_event = await _event(client, other_token, "Ol cudzy piknik", 2)
    attend = await client.post(f"/api/events/{other_event}/attendances", headers=_auth(owner_token))
    assert attend.status_code == 201, attend.text
    _, reserved_id, _ = await _listed_items(
        client, owner_token, ("Ol wolna", "GIFT"), ("Ol zajęta", "GIFT"), ("Ol zamiana", "SWAP")
    )
    await _set_balance(db_session, reserved_id, BalanceStatus.RESERVED)

    schedule = await _layout(client, slug, "SCHEDULE")

    assert schedule["stats"] == {"group_count": 1, "item_count": 2, "meeting_count": 2}
    assert schedule["item_stats"] == {"GIFT": 1, "SWAP": 1}
    assert [group["id"] for group in schedule["groups"]] == [str(public_id)]
    assert [date["id"] for date in schedule["upcoming_terms"]] == [str(public_term), own_event]


async def test_getOrganizationLayout_unknownSlugOwnerlessOrLayout_404Or400_emptyOrganization(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    base = "/api/public/organizations"
    missing = await client.get(f"{base}/nie-ma-takiej/layout/CLASSIC")
    assert missing.status_code == 404
    assert "cache-control" not in missing.headers
    assert (await client.get(f"{base}/k-0123456789ab/layout/LINKS")).status_code == 404

    ownerless_token, _ = await _register(client, "ORGANIZER", "ol.404.ownerless@example.com")
    ownerless_slug = await _organization_slug(client, ownerless_token, "Bez Właściciela")
    membership = (
        await db_session.execute(
            select(OrganizationMembership)
            .join(Organization, Organization.id == OrganizationMembership.to_organization_id)
            .where(Organization.slug == ownerless_slug)
        )
    ).scalar_one()
    membership.valid_to = clock.local_now().date()
    await db_session.flush()
    assert (await client.get(f"{base}/{ownerless_slug}/layout/CLASSIC")).status_code == 404

    empty_token, _ = await _register(client, "ORGANIZER", "ol.404.empty@example.com")
    empty_slug = await _organization_slug(client, empty_token, "Pusta Strona")
    for layout in ("custom", "classic", "FOOTER"):
        assert (await client.get(f"{base}/{empty_slug}/layout/{layout}")).status_code == 400

    zero = {"group_count": 0, "item_count": 0, "meeting_count": 0}
    assert await _layout(client, empty_slug, "CLASSIC") == {
        "layout": "CLASSIC",
        "stats": zero,
        "upcoming_terms": [],
        "items": [],
    }
    assert await _layout(client, empty_slug, "SCHEDULE") == {
        "layout": "SCHEDULE",
        "stats": zero,
        "upcoming_terms": [],
        "groups": [],
        "item_stats": {"GIFT": 0, "SWAP": 0},
    }
    assert await _layout(client, empty_slug, "EXCHANGE") == {
        "layout": "EXCHANGE",
        "stats": zero,
        "items": [],
        "term_links": [],
    }


async def test_getOrganizationLayout_limits_nearestDatesNewestItemsAndNewestGroups(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "ol.limit.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Limity")
    group_ids = [await _circle(client, owner_token, f"Ol grupa {index}") for index in range(5)]
    term_ids = [
        await _term(client, owner_token, group_id, _in_days(10 - index))
        for index, group_id in enumerate(group_ids)
    ]
    created = datetime(2026, 1, 1, 12, 0)
    for index, group_id in enumerate(group_ids):
        await db_session.execute(
            update(Group)
            .where(Group.id == group_id)
            .values(created_at=created + timedelta(days=index))
        )
    item_ids = await _listed_items(
        client, owner_token, *((f"Ol rzecz {index}", "GIFT") for index in range(9))
    )
    for index, item_id in enumerate(item_ids):
        await db_session.execute(
            update(ItemListingPreference)
            .where(ItemListingPreference.item_id == item_id)
            .values(created_at=created + timedelta(hours=index))
        )
    await db_session.commit()
    newest_items = [str(item_id) for item_id in reversed(item_ids)]
    nearest_terms = [str(term_id) for term_id in reversed(term_ids)]

    classic = await _layout(client, slug, "CLASSIC")
    schedule = await _layout(client, slug, "SCHEDULE")
    exchange = await _layout(client, slug, "EXCHANGE")

    assert [date["id"] for date in classic["upcoming_terms"]] == nearest_terms[:4]
    assert [item["item_id"] for item in classic["items"]] == newest_items[:4]
    assert [date["id"] for date in schedule["upcoming_terms"]] == nearest_terms[:4]
    assert [group["id"] for group in schedule["groups"]] == [
        str(group_id) for group_id in reversed(group_ids[1:])
    ]
    assert [item["item_id"] for item in exchange["items"]] == newest_items[:8]
    assert [link["path"].rsplit("/", 1)[1] for link in exchange["term_links"]] == nearest_terms[:2]
    assert exchange["stats"] == {"group_count": 5, "item_count": 9, "meeting_count": 5}


def test_pageLayoutPathParam_matchesPageLayoutKeys() -> None:
    assert set(get_args(PageLayout)) == PAGE_LAYOUT_KEYS


async def _group_terms(client: AsyncClient, slug: str, group_id: uuid.UUID) -> dict[str, Any]:
    response = await client.get(f"/api/public/organizations/{slug}/groups/{group_id}/terms")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "public, max-age=0, s-maxage=60"
    body: dict[str, Any] = response.json()
    return body


async def test_getOrganizationGroupTerms_group_tileAndUpcomingTermsEarliestFirst(
    client: AsyncClient,
) -> None:
    owner_token, owner_party_id = await _register(client, "ORGANIZER", "ogt.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Grupowe Nutki")
    group_id = await _circle(client, owner_token, "Maluchy")
    await _term(client, owner_token, group_id, _in_days(-1))
    later = await _term(client, owner_token, group_id, _in_days(9))
    sooner_on = _in_days(2)
    sooner = await _term(client, owner_token, group_id, sooner_on, "Rytmika w parku")
    guest_token, _ = await _register(client, "GUEST", "ogt.guest@example.com")
    await _rsvp(client, guest_token, group_id, sooner)

    body = await _group_terms(client, slug, group_id)

    assert set(body) == {"owner", "group", "description", "terms"}
    assert body["description"] is None
    assert body["owner"] == {
        "party_id": str(owner_party_id),
        "display_name": "Grupowe Nutki",
        "slug": slug,
    }
    assert body["group"] == {
        "id": str(group_id),
        "name": "Maluchy",
        "layout_mode": "CIRCLE",
        "next_term": {"id": str(sooner), "occurs_on": sooner_on.isoformat(), "attendee_count": 1},
        "upcoming_term_count": 2,
    }
    first, second = body["terms"]
    assert set(first) == {
        "id",
        "occurs_on",
        "description",
        "location_name",
        "attendee_count",
        "path",
    }
    assert (first["id"], first["description"], first["attendee_count"]) == (
        str(sooner),
        "Rytmika w parku",
        1,
    )
    assert first["path"] == f"/{slug}/group/{group_id}/term/{sooner}"
    assert first["location_name"]
    assert second["id"] == str(later)
    # `owner` is the Organization itself; the group and its terms name no person.
    assert _keys({"group": body["group"], "terms": body["terms"]}) & FORBIDDEN_KEYS == set()


async def test_getOrganizationGroupTerms_notOwnersPublicGroup_404_invalidId_400_emptyGroup(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "ogt404.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Strzeżone Nutki")
    private_id = await _circle(client, owner_token, "Prywatna", "PRIVATE")
    empty_id = await _circle(client, owner_token, "Bez terminów")
    other_token, _ = await _register(client, "ORGANIZER", "ogt404.other@example.com")
    other_slug = await _organization_slug(client, other_token, "Inne Nutki")
    other_group = await _circle(client, other_token, "Cudza")
    base = "/api/public/organizations"

    for path in (
        f"{base}/{slug}/groups/{private_id}/terms",
        f"{base}/{slug}/groups/{other_group}/terms",
        f"{base}/{slug}/groups/{uuid.uuid4()}/terms",
        f"{base}/nie-ma-takiej/groups/{empty_id}/terms",
    ):
        missing = await client.get(path)
        assert missing.status_code == 404, path
        assert "cache-control" not in missing.headers
    assert (await client.get(f"{base}/{slug}/groups/nie-uuid/terms")).status_code == 400
    assert (await _group_terms(client, other_slug, other_group))["terms"] == []

    empty = await _group_terms(client, slug, empty_id)
    assert empty["terms"] == []
    assert empty["group"]["next_term"] is None and empty["group"]["upcoming_term_count"] == 0
