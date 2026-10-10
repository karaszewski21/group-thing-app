"""`GET /api/groups/public/organizers/{slug}/terms`: every upcoming term of
the organizer's qualifying PUBLIC circles, paginated, optionally narrowed to
one circle by `group_id`."""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient

from tests.test_organizer_page import _circle, _in_days, _organization_slug, _term
from tests.test_term_item_listings import _register, _rsvp


async def _terms(client: AsyncClient, slug: str, **params: Any) -> dict[str, Any]:
    response = await client.get(f"/api/groups/public/organizers/{slug}/terms", params=params)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "public, max-age=0, s-maxage=60"
    body: dict[str, Any] = response.json()
    return body


async def test_listOrganizerTerms_futureTermsBeyondWindow_orderedAcrossPages(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "ot.order.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Terminowe Nutki")
    first_group = await _circle(client, owner_token, "Pierwszy")
    second_group = await _circle(client, owner_token, "Drugi")
    await _term(client, owner_token, first_group, _in_days(-2))
    same_day = _in_days(5)
    expected = sorted(
        [
            (same_day, await _term(client, owner_token, first_group, same_day, "Rytmika")),
            (same_day, await _term(client, owner_token, second_group, same_day)),
            (_in_days(1), await _term(client, owner_token, second_group, _in_days(1))),
            (_in_days(90), await _term(client, owner_token, first_group, _in_days(90))),
        ]
    )
    guest_token, _ = await _register(client, "GUEST", "ot.order.guest@example.com")
    await _rsvp(client, guest_token, second_group, expected[0][1])

    first = await _terms(client, slug, page=1, size=3)
    second = await _terms(client, slug, page=2, size=3)

    assert (first["total"], first["page"], first["size"]) == (4, 1, 3)
    assert (second["total"], second["page"], second["size"]) == (4, 2, 3)
    items = first["items"] + second["items"]
    assert [i["term_id"] for i in items] == [str(term_id) for _, term_id in expected]
    assert items[0] == {
        "term_id": str(expected[0][1]),
        "group_id": str(second_group),
        "group_name": "Drugi",
        "occurs_on": expected[0][0].isoformat(),
        "description": None,
        "attendee_count": 1,
    }
    assert {i["attendee_count"] for i in items[1:]} == {0}


async def test_listOrganizerTerms_groupId_foreignOrPrivateEmptyQualifyingNarrows(
    client: AsyncClient,
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "ot.filter.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Filtrowane Nutki")
    public_id = await _circle(client, owner_token, "Publiczny")
    other_public_id = await _circle(client, owner_token, "Inny publiczny")
    private_id = await _circle(client, owner_token, "Prywatny", "PRIVATE")
    public_term = await _term(client, owner_token, public_id, _in_days(3))
    await _term(client, owner_token, other_public_id, _in_days(2))
    await _term(client, owner_token, private_id, _in_days(1))
    other_token, _ = await _register(client, "ORGANIZER", "ot.filter.other@example.com")
    await _organization_slug(client, other_token, "Cudze Nutki")
    foreign_id = await _circle(client, other_token, "Cudzy")
    await _term(client, other_token, foreign_id, _in_days(1))

    assert (await _terms(client, slug))["total"] == 2
    for group_id in (private_id, foreign_id, uuid.uuid4()):
        assert await _terms(client, slug, group_id=str(group_id)) == {
            "items": [],
            "total": 0,
            "page": 1,
            "size": 20,
        }
    narrowed = await _terms(client, slug, group_id=str(public_id))
    assert narrowed["total"] == 1
    assert [i["term_id"] for i in narrowed["items"]] == [str(public_term)]


async def test_listOrganizerTerms_invalidQueryParams_return400(client: AsyncClient) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", "ot.invalid.owner@example.com")
    slug = await _organization_slug(client, owner_token, "Błędne Nutki")
    url = f"/api/groups/public/organizers/{slug}/terms"

    for params in ({"group_id": "nie-uuid"}, {"size": 101}, {"page": 0}, {"page": 10_001}):
        assert (await client.get(url, params=params)).status_code == 400, params


async def test_listOrganizerTerms_unknownSlug_returns404(client: AsyncClient) -> None:
    response = await client.get("/api/groups/public/organizers/nie-ma-takiej/terms")

    assert response.status_code == 404
    assert "cache-control" not in response.headers
    assert "Organization" in response.json()["message"]
