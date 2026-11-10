"""Statement-count budgets of the organizer endpoints and of the term page's
listing thumbnails: the count must not grow with the number of circles,
terms or items, reserved ones included."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.moderation.status import ModerationStatus
from tests.conftest import count_queries
from tests.test_organizer_bridges import _item, _photo, _uploader_id
from tests.test_organizer_page import (
    _circle,
    _in_days,
    _listed_items,
    _needed_item,
    _organization_slug,
    _term,
)
from tests.test_term_item_listings import _auth, _register, _rsvp

# 10 directory statements, the owner's recent items select and the 6 of the
# owner's upcoming dates (`list_owner_dates`: terms, events, their places and
# the organizer slug lookups). The owner's thumbnails run only when the recent
# items select returns items.
MAIN_ENDPOINT_BUDGET = 17
# A logged-in viewer adds the viewer's profile lookup and the reserver names
# (one lookup per id kind) of the exchange items.
LOGGED_IN_MAIN_ENDPOINT_BUDGET = MAIN_ENDPOINT_BUDGET + 3
TERMS_ENDPOINT_BUDGET = 5


async def _statement_count(client: AsyncClient, engine: AsyncEngine, url: str) -> int:
    with count_queries(engine) as statements:
        response = await client.get(url)
    assert response.status_code == 200, response.text
    return len(statements)


async def _populated_organizer(
    client: AsyncClient,
    db_session: AsyncSession,
    prefix: str,
    circle_count: int,
    *,
    taken: bool = False,
) -> str:
    """An organizer whose every circle has a term with an attendee, the
    attendee's listed item with an APPROVED photo (`taken`: reserved by a
    second attendee), and a needed item."""
    owner_token, _ = await _register(client, "ORGANIZER", f"{prefix}.owner@example.com")
    slug = await _organization_slug(client, owner_token, f"Budżet {prefix}")
    uploader = await _uploader_id(db_session)
    for index in range(circle_count):
        group_id = await _circle(client, owner_token, f"Krąg {index}")
        term_id = await _term(client, owner_token, group_id, _in_days(index + 1))
        await _needed_item(client, owner_token, term_id, f"{prefix} potrzeba {index}")
        guest_token, _ = await _register(client, "GUEST", f"{prefix}.g{index}@example.com")
        await _rsvp(client, guest_token, group_id, term_id)
        [item_id] = await _listed_items(client, guest_token, (f"{prefix} rzecz {index}", "GIFT"))
        if taken:
            taker_token, _ = await _register(client, "GUEST", f"{prefix}.t{index}@example.com")
            await _rsvp(client, taker_token, group_id, term_id)
            take = await client.post(
                f"/api/items/{item_id}/take",
                json={"context": {"kind": "TERM", "id": str(term_id)}, "reservation_type": "GIFT"},
                headers=_auth(taker_token),
            )
            assert take.status_code == 200, take.text
        product_id = (await _item(db_session, item_id)).product_id
        db_session.add(
            _photo(product_id, uploader, f"{prefix}-{index}", ModerationStatus.APPROVED, 0)
        )
    await db_session.flush()
    return slug


async def test_getOrganizerPage_oneVsFiveCircles_constantStatementCountWithinBudget(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    one_slug = await _populated_organizer(client, db_session, "opq-one", 1)
    five_slug = await _populated_organizer(client, db_session, "opq-five", 5)

    one = await _statement_count(client, engine, f"/api/public/organizers/{one_slug}")
    five = await _statement_count(client, engine, f"/api/public/organizers/{five_slug}")

    assert one == five, (one, five)
    assert five <= MAIN_ENDPOINT_BUDGET, five


async def test_getOrganizerPage_loggedInOneVsFiveCirclesAllReserved_constantStatementCount(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    one_slug = await _populated_organizer(client, db_session, "opr-one", 1, taken=True)
    five_slug = await _populated_organizer(client, db_session, "opr-five", 5, taken=True)
    viewer_token, _ = await _register(client, "GUEST", "opr.viewer@example.com")

    counts = []
    for slug in (one_slug, five_slug):
        with count_queries(engine) as statements:
            response = await client.get(
                f"/api/public/organizers/{slug}", headers=_auth(viewer_token)
            )
        assert response.status_code == 200, response.text
        assert all(item["reservation"] for item in response.json()["exchange"]["items"])
        counts.append(len(statements))

    assert counts[0] == counts[1], counts
    assert counts[1] <= LOGGED_IN_MAIN_ENDPOINT_BUDGET, counts


async def test_listOrganizerTerms_oneVsFiveCirclesAndOneVs25Terms_constantStatementCount(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    one_slug = await _populated_organizer(client, db_session, "otq-one", 1)
    five_slug = await _populated_organizer(client, db_session, "otq-five", 5)
    many_token, _ = await _register(client, "ORGANIZER", "otq.many.owner@example.com")
    many_slug = await _organization_slug(client, many_token, "Budżet wielu terminów")
    many_group = await _circle(client, many_token, "Wiele terminów")
    for day in range(1, 26):
        await _term(client, many_token, many_group, _in_days(day))

    counts = [
        await _statement_count(client, engine, f"/api/public/organizers/{slug}/terms")
        for slug in (one_slug, five_slug, many_slug)
    ]

    assert len(set(counts)) == 1, counts
    assert counts[0] <= TERMS_ENDPOINT_BUDGET, counts


async def _term_with_listings(
    client: AsyncClient, db_session: AsyncSession, prefix: str, listing_count: int, photo_count: int
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    """A circle whose single term has one attendee listing `listing_count`
    items; the first `photo_count` of them get an APPROVED photo."""
    owner_token, _ = await _register(client, "ORGANIZER", f"{prefix}.owner@example.com")
    group_id = await _circle(client, owner_token, f"Krąg {prefix}")
    term_id = await _term(client, owner_token, group_id, _in_days(1))
    guest_token, _ = await _register(client, "GUEST", f"{prefix}.guest@example.com")
    await _rsvp(client, guest_token, group_id, term_id)
    item_ids = await _listed_items(
        client, guest_token, *((f"{prefix} rzecz {i}", "GIFT") for i in range(listing_count))
    )
    uploader = await _uploader_id(db_session)
    for index, item_id in enumerate(item_ids[:photo_count]):
        product_id = (await _item(db_session, item_id)).product_id
        db_session.add(
            _photo(product_id, uploader, f"{prefix}-{index}", ModerationStatus.APPROVED, 0)
        )
    await db_session.flush()
    return group_id, item_ids


async def _photo_statement_count(client: AsyncClient, engine: AsyncEngine, url: str) -> int:
    with count_queries(engine) as statements:
        response = await client.get(url)
    assert response.status_code == 200, response.text
    return sum("product_photos" in statement for statement in statements)


async def test_getGroupAccess_oneVsFiveListings_singleProductPhotosStatement(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    one_group, _ = await _term_with_listings(client, db_session, "tpq-one", 1, 1)
    five_group, _ = await _term_with_listings(client, db_session, "tpq-five", 5, 5)

    one = await _photo_statement_count(client, engine, f"/api/public/groups/{one_group}/access")
    five = await _photo_statement_count(client, engine, f"/api/public/groups/{five_group}/access")

    assert (one, five) == (1, 1)


async def test_getGroupAccess_listingThumbs_approvedPhotoUrlOrNull(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, (with_photo, without_photo) = await _term_with_listings(
        client, db_session, "tpq-thumb", 2, 1
    )

    response = await client.get(f"/api/public/groups/{group_id}/access")

    assert response.status_code == 200, response.text
    listings = response.json()["group"]["term"]["item_listings"]
    assert {listing["item_id"]: listing["thumb_url"] for listing in listings} == {
        str(with_photo): "https://cdn.test/tpq-thumb-0/w400.webp",
        str(without_photo): None,
    }


async def test_getPublicCircle_listingWithApprovedPhoto_thumbUrlFilled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, [item_id] = await _term_with_listings(client, db_session, "tpq-public", 1, 1)

    response = await client.get(f"/api/public/groups/{group_id}")

    assert response.status_code == 200, response.text
    [listing] = response.json()["term"]["item_listings"]
    assert listing["item_id"] == str(item_id)
    assert listing["thumb_url"] == "https://cdn.test/tpq-public-0/w400.webp"
