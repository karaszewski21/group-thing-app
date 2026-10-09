"""`GET /api/groups/public/organizers/{slug}`: the anonymous organizer
directory read model. Covers the response contract (and the absence of any
identity field), circle qualification, the 404 / empty cases, the 60-day
window, the `family_count` threshold, exchange eligibility and thumbnails,
and the needed items' `claimed` flag.

Data is built over HTTP plus direct `db_session` writes, following
`test_public_term.py` / `test_term_item_listings.py`."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import BalanceStatus
from app.groups import service
from app.groups.models import GroupRole, GroupRoleType, Leadership, TermAttendance
from app.moderation.status import ModerationStatus
from app.organizations.models import Organization, OrganizationMembership
from tests.test_organizer_bridges import (
    _item,
    _photo,
    _register_items,
    _set_balance,
    _uploader_id,
)
from tests.test_term_item_listings import _auth, _register, _resolve_product, _rsvp

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
            "circle_group_id": str(group_id),
            "occurs_on": occurs_on.isoformat(),
            "description": description,
        },
        headers=_auth(token),
    )
    assert term.status_code == 201
    return uuid.UUID(term.json()["id"])


async def _needed_item(
    client: AsyncClient, token: str, term_id: uuid.UUID, product_name: str
) -> uuid.UUID:
    created = await client.post(
        "/api/needed-items",
        json={
            "term_id": str(term_id),
            "product_id": await _resolve_product(client, token, product_name),
        },
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


async def _page(client: AsyncClient, slug: str) -> dict[str, Any]:
    response = await client.get(f"/api/groups/public/organizers/{slug}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {key for child in value.values() for key in _keys(child)}
    if isinstance(value, list):
        return {key for child in value for key in _keys(child)}
    return set()


def _in_days(days: int) -> datetime:
    return (datetime.now() + timedelta(days=days)).replace(microsecond=0)


async def test_getOrganizerPage_populatedDirectory_matchesContractWithoutIdentityKeys(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "op.shape.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Kształtne Nutki")
    group_id = await _circle(client, owner_token, "Nutki")
    occurs_on = _in_days(3)
    term_id = await _term(client, owner_token, group_id, occurs_on, "Rytmika w parku")
    await _needed_item(client, owner_token, term_id, "Op bębenek")
    await _listed_items(client, owner_token, ("Op rowerek", "GIFT"))
    guest_token, _ = await _register(client, "GUEST", "op.shape.guest@example.com")
    await _rsvp(client, guest_token, group_id, term_id)

    body = await _page(client, slug)

    assert set(body) == {"circles", "upcoming_terms", "exchange", "needed_items", "stats"}
    [circle] = body["circles"]
    assert set(circle) == {"id", "name", "layout_mode", "next_term", "upcoming_term_count"}
    assert circle["name"] == "Nutki" and circle["layout_mode"] == "CIRCLE"
    assert circle["next_term"] == {
        "id": str(term_id),
        "occurs_on": occurs_on.isoformat(),
        "attendee_count": 1,
    }
    [term] = body["upcoming_terms"]
    assert set(term) == {
        "term_id",
        "group_id",
        "group_name",
        "occurs_on",
        "description",
        "attendee_count",
    }
    assert term["group_name"] == "Nutki" and term["description"] == "Rytmika w parku"
    assert term["attendee_count"] == 1
    assert set(body["exchange"]) == {"counts", "items"}
    assert body["exchange"]["counts"] == {"GIFT": 1, "SWAP": 0, "LEND": 0}
    [item] = body["exchange"]["items"]
    assert set(item) == {
        "item_id",
        "product_name",
        "condition",
        "mode",
        "thumb_url",
        "term_id",
        "group_id",
        "occurs_on",
    }
    [needed] = body["needed_items"]
    assert set(needed) == {"id", "term_id", "group_id", "product_name", "claimed"}
    assert body["stats"] == {"circle_count": 1, "upcoming_term_count": 1, "family_count": None}
    assert _keys(body) & FORBIDDEN_KEYS == set()


async def test_getOrganizerPage_privateOrRevokedCircles_excludedFromEveryField(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, owner_party_id = await _register(client, "ORGANIZER", "op.priv.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Prywatne Nutki")
    public_id = await _circle(client, owner_token, "Publiczny")
    private_id = await _circle(client, owner_token, "Prywatny", "PRIVATE")
    revoked_id = await _circle(client, owner_token, "Odwołany")
    public_term = await _term(client, owner_token, public_id, _in_days(4))
    for group_id in (private_id, revoked_id):
        hidden_term = await _term(client, owner_token, group_id, _in_days(2))
        await _needed_item(client, owner_token, hidden_term, f"Op ukryte {group_id}")
    leadership = (
        await db_session.execute(select(Leadership).where(Leadership.to_group_id == revoked_id))
    ).scalar_one()
    leadership.valid_to = date.today()
    await db_session.flush()

    body = await _page(client, slug)

    assert [c["id"] for c in body["circles"]] == [str(public_id)]
    assert [t["term_id"] for t in body["upcoming_terms"]] == [str(public_term)]
    assert body["needed_items"] == []
    assert body["stats"]["circle_count"] == 1 and body["stats"]["upcoming_term_count"] == 1

    other_token, other_party_id = await _register(
        client, "ORGANIZER", "op.priv.other@example.com"
    )
    other_slug = await _organization_slug(client, other_token, "Odwołana Rola")
    other_group = await _circle(client, other_token, "Krąg z odwołaną rolą")
    await _term(client, other_token, other_group, _in_days(1))
    role = (
        await db_session.execute(
            select(GroupRole).where(
                GroupRole.party_id == other_party_id,
                GroupRole.role_type == GroupRoleType.ORGANIZATOR,
            )
        )
    ).scalar_one()
    role.valid_to = date.today()
    await db_session.flush()

    other_body = await _page(client, other_slug)

    assert other_body["circles"] == [] and other_body["upcoming_terms"] == []
    assert owner_party_id != other_party_id


async def test_getOrganizerPage_unknownPseudoOwnerlessOrEmpty_returns404OrEmpty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    assert (await client.get("/api/groups/public/organizers/nie-ma-takiej")).status_code == 404
    assert (await client.get("/api/groups/public/organizers/k-0123456789ab")).status_code == 404

    access = await client.get("/api/groups/public/organizers/access")
    assert access.status_code == 404
    assert "Organization" in access.json()["message"]

    ownerless_token, _ = await _register(client, "ORGANIZER", "op.404.ownerless@example.com")
    ownerless_slug = await _organization_slug(client, ownerless_token, "Bez Właściciela")
    membership = (
        await db_session.execute(
            select(OrganizationMembership)
            .join(Organization, Organization.id == OrganizationMembership.to_organization_id)
            .where(Organization.slug == ownerless_slug)
        )
    ).scalar_one()
    membership.valid_to = date.today()
    await db_session.flush()
    assert (
        await client.get(f"/api/groups/public/organizers/{ownerless_slug}")
    ).status_code == 404

    empty_token, _ = await _register(client, "ORGANIZER", "op.404.empty@example.com")
    empty_slug = await _organization_slug(client, empty_token, "Pusta Strona")

    assert await _page(client, empty_slug) == {
        "circles": [],
        "upcoming_terms": [],
        "exchange": {"counts": {"GIFT": 0, "SWAP": 0, "LEND": 0}, "items": []},
        "needed_items": [],
        "stats": {"circle_count": 0, "upcoming_term_count": 0, "family_count": None},
    }


async def test_getOrganizerPage_timeWindow_pastAndFarTermsOutOfWindowButFarStaysNext(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "op.window.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Okno Czasowe")
    near_id = await _circle(client, owner_token, "Zzz bliski")
    far_id = await _circle(client, owner_token, "Aaa daleki")
    await _term(client, owner_token, near_id, _in_days(-1))
    near_term = await _term(client, owner_token, near_id, _in_days(10))
    await _term(client, owner_token, near_id, _in_days(70))
    far_term = await _term(client, owner_token, far_id, _in_days(90))

    body = await _page(client, slug)

    near, far = body["circles"]
    assert (near["id"], far["id"]) == (str(near_id), str(far_id))
    assert near["next_term"]["id"] == str(near_term) and near["upcoming_term_count"] == 1
    assert far["next_term"]["id"] == str(far_term) and far["upcoming_term_count"] == 0
    assert far["next_term"]["attendee_count"] == 0
    assert [t["term_id"] for t in body["upcoming_terms"]] == [str(near_term)]
    assert body["stats"]["upcoming_term_count"] == 1


async def test_getOrganizerPage_familyCount_nullBelowThreeAndOwnerFamilyExcluded(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, owner_party_id = await _register(
        client, "ORGANIZER", "op.family.owner@example.com"
    )
    slug = await _organization_slug(client, owner_token, "Rodzinne Nutki")
    group_id = await _circle(client, owner_token, "Rodziny")
    await service.add_active_membership(db_session, group_id, owner_party_id)
    for index in range(2):
        _, party_id = await _register(client, "GUEST", f"op.family.g{index}@example.com")
        await service.add_active_membership(db_session, group_id, party_id)

    assert (await _page(client, slug))["stats"]["family_count"] is None

    _, third_party_id = await _register(client, "GUEST", "op.family.g2@example.com")
    await service.add_active_membership(db_session, group_id, third_party_id)

    assert (await _page(client, slug))["stats"]["family_count"] == 3


async def test_getOrganizerPage_exchange_onlyEligibleAvailableItemsDedupedToNearestTerm(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "op.ex.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Wymienne Nutki")
    first_group = await _circle(client, owner_token, "Pierwszy")
    second_group = await _circle(client, owner_token, "Drugi")
    first_term = await _term(client, owner_token, first_group, _in_days(3))
    later_first_term = await _term(client, owner_token, first_group, _in_days(10))
    second_term = await _term(client, owner_token, second_group, _in_days(5))

    owner_item, reserved_item = await _listed_items(
        client, owner_token, ("Op ex rower", "GIFT"), ("Op ex zajęty", "LEND")
    )
    await _set_balance(db_session, reserved_item, BalanceStatus.RESERVED)

    attendee_token, _ = await _register(client, "GUEST", "op.ex.attendee@example.com")
    await _rsvp(client, attendee_token, second_group, second_term)
    [attendee_item] = await _listed_items(client, attendee_token, ("Op ex lalka", "SWAP"))

    withdrawn_token, _ = await _register(client, "GUEST", "op.ex.withdrawn@example.com")
    attendance_id = await _rsvp(client, withdrawn_token, first_group, first_term)
    await _listed_items(client, withdrawn_token, ("Op ex wycofany", "LEND"))
    attendance = await db_session.get(TermAttendance, attendance_id)
    assert attendance is not None
    attendance.withdrawn_at = datetime.now()
    await db_session.flush()

    later_token, _ = await _register(client, "GUEST", "op.ex.later@example.com")
    await _rsvp(client, later_token, first_group, later_first_term)
    await _listed_items(client, later_token, ("Op ex późniejszy", "GIFT"))

    exchange = (await _page(client, slug))["exchange"]

    assert exchange["counts"] == {"GIFT": 1, "SWAP": 1, "LEND": 0}
    assert [
        (i["item_id"], i["term_id"], i["group_id"], i["mode"], i["product_name"], i["condition"])
        for i in exchange["items"]
    ] == [
        (str(owner_item), str(first_term), str(first_group), "GIFT", "Op ex rower", "GOOD"),
        (str(attendee_item), str(second_term), str(second_group), "SWAP", "Op ex lalka", "GOOD"),
    ]


async def test_getOrganizerPage_thumbUrl_onlyFromApprovedPhotoAndNullWithoutStorage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "op.thumb.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Zdjęciowe Nutki")
    group_id = await _circle(client, owner_token, "Zdjęcia")
    await _term(client, owner_token, group_id, _in_days(2))
    approved_item, pending_item = await _listed_items(
        client, owner_token, ("Op thumb aparat", "GIFT"), ("Op thumb bęben", "LEND")
    )
    uploader = await _uploader_id(db_session)
    approved_product = (await _item(db_session, approved_item)).product_id
    pending_product = (await _item(db_session, pending_item)).product_id
    db_session.add_all(
        [
            _photo(approved_product, uploader, "op-second", ModerationStatus.APPROVED, 2),
            _photo(approved_product, uploader, "op-first", ModerationStatus.APPROVED, 1),
            _photo(pending_product, uploader, "op-pending", ModerationStatus.PENDING, 0),
        ]
    )
    await db_session.flush()

    items = (await _page(client, slug))["exchange"]["items"]

    thumbs = {i["item_id"]: i["thumb_url"] for i in items}
    assert thumbs == {
        str(approved_item): "https://cdn.test/op-first/w400.webp",
        str(pending_item): None,
    }

    without_storage = await service.get_organizer_page(db_session, slug, None)

    assert [i.thumb_url for i in without_storage.exchange.items] == [None, None]


async def test_getOrganizerPage_neededItems_claimedFlagLiveItemsOfNextTermsOnly(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "op.need.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Potrzebne Nutki")
    group_id = await _circle(client, owner_token, "Potrzeby")
    next_term = await _term(client, owner_token, group_id, _in_days(2))
    later_term = await _term(client, owner_token, group_id, _in_days(9))
    claimed_id = await _needed_item(client, owner_token, next_term, "Op need ażur")
    open_id = await _needed_item(client, owner_token, next_term, "Op need balon")
    deleted_id = await _needed_item(client, owner_token, next_term, "Op need cymbałki")
    await _needed_item(client, owner_token, later_term, "Op need dzwonek")
    deleted = await client.delete(f"/api/needed-items/{deleted_id}", headers=_auth(owner_token))
    assert deleted.status_code == 204
    guest_token, _ = await _register(client, "GUEST", "op.need.guest@example.com")
    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": str(claimed_id)}, headers=_auth(guest_token)
    )
    assert pledge.status_code == 201

    body = await _page(client, slug)

    assert body["needed_items"] == [
        {
            "id": str(claimed_id),
            "term_id": str(next_term),
            "group_id": str(group_id),
            "product_name": "Op need ażur",
            "claimed": True,
        },
        {
            "id": str(open_id),
            "term_id": str(next_term),
            "group_id": str(group_id),
            "product_name": "Op need balon",
            "claimed": False,
        },
    ]
    assert _keys(body) & FORBIDDEN_KEYS == set()


async def test_getOrganizerPage_circleOrder_nextTermThenNameNullsLastAndEarlierTodayExcluded(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "op.order.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Uporządkowane Nutki")
    soon_id = await _circle(client, owner_token, "Ccc wkrótce")
    later_b_id = await _circle(client, owner_token, "Bbb później")
    later_a_id = await _circle(client, owner_token, "Aaa później")
    today_id = await _circle(client, owner_token, "Aab dziś rano")
    empty_id = await _circle(client, owner_token, "Aaa pusty")
    soon_term = await _term(client, owner_token, soon_id, _in_days(2))
    later = _in_days(5)
    later_b_term = await _term(client, owner_token, later_b_id, later)
    later_a_term = await _term(client, owner_token, later_a_id, later)
    await _term(client, owner_token, today_id, datetime.combine(date.today(), time.min))

    body = await _page(client, slug)

    assert [c["id"] for c in body["circles"]] == [
        str(soon_id),
        str(later_a_id),
        str(later_b_id),
        str(empty_id),
        str(today_id),
    ]
    earlier_today = body["circles"][-1]
    assert earlier_today["next_term"] is None and earlier_today["upcoming_term_count"] == 0
    assert [t["term_id"] for t in body["upcoming_terms"]] == [
        str(soon_term),
        *sorted([str(later_a_term), str(later_b_term)]),
    ]
    assert body["stats"] == {"circle_count": 5, "upcoming_term_count": 3, "family_count": None}


async def test_getOrganizerPage_manyCircles_cappedAt30CirclesAnd10UpcomingTerms(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "op.limit.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Liczne Nutki")
    circle_ids = []
    term_ids = []
    for index in range(31):
        circle_ids.append(await _circle(client, owner_token, f"Krąg {index:02d}"))
        term_ids.append(await _term(client, owner_token, circle_ids[-1], _in_days(index + 1)))

    body = await _page(client, slug)

    assert [c["id"] for c in body["circles"]] == [str(c) for c in circle_ids[:30]]
    assert [t["term_id"] for t in body["upcoming_terms"]] == [str(t) for t in term_ids[:10]]
    assert body["stats"]["circle_count"] == 30
    assert body["stats"]["upcoming_term_count"] == 30


async def test_getOrganizerPage_attendeeOnSeveralNextTerms_itemPlacedOnEarliestTermIdTieBreak(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "op.dedup.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Zdublowane Nutki")
    late_group = await _circle(client, owner_token, "Aaa późny")
    tied_groups = [
        await _circle(client, owner_token, "Mmm równy"),
        await _circle(client, owner_token, "Zzz równy"),
    ]
    late_term = await _term(client, owner_token, late_group, _in_days(6))
    tied_day = _in_days(2)
    tied_terms = {
        await _term(client, owner_token, group_id, tied_day): group_id for group_id in tied_groups
    }
    attendee_token, _ = await _register(client, "GUEST", "op.dedup.attendee@example.com")
    await _rsvp(client, attendee_token, late_group, late_term)
    for term_id, group_id in tied_terms.items():
        await _rsvp(client, attendee_token, group_id, term_id)
    [item_id] = await _listed_items(client, attendee_token, ("Op dedup klocki", "SWAP"))

    exchange = (await _page(client, slug))["exchange"]

    earliest_term = min(tied_terms)
    assert exchange["counts"] == {"GIFT": 0, "SWAP": 1, "LEND": 0}
    [item] = exchange["items"]
    assert (item["item_id"], item["term_id"], item["group_id"], item["occurs_on"]) == (
        str(item_id),
        str(earliest_term),
        str(tied_terms[earliest_term]),
        tied_day.isoformat(),
    )
