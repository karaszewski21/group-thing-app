"""`GET /api/groups/public/parties/{party_id}`: the anonymous person profile
behind `/<party-id>`. Covers the response contract, the 404s that keep a
private person hidden, each public footprint (listed item, authored event,
led PUBLIC circle), the bio and the recent items cap."""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient

from app.groups.application.owner_items import PROFILE_RECENT_ITEMS
from tests.test_organizer_page import _circle, _in_days, _listed_items, _organization_slug, _term
from tests.test_owner_items_page import ITEM_KEYS, NEAREST_KEYS, OWNER_KEYS, _create_event
from tests.test_term_item_listings import _auth, _register

PROFILE_KEYS = {"owner", "bio", "avatar_url", "nearest", "counts", "recent_items", "is_me"}


async def _profile(client: AsyncClient, party_id: uuid.UUID) -> dict[str, Any]:
    response = await client.get(f"/api/groups/public/parties/{party_id}")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "public, max-age=0, s-maxage=60"
    body: dict[str, Any] = response.json()
    assert set(body) == PROFILE_KEYS
    assert set(body["owner"]) == OWNER_KEYS
    for item in body["recent_items"]:
        assert set(item) == ITEM_KEYS
    if body["nearest"] is not None:
        assert set(body["nearest"]) == NEAREST_KEYS
    return body


async def test_getPartyProfile_unknownOrNoPublicFootprint_returns404(client: AsyncClient) -> None:
    assert (await client.get(f"/api/groups/public/parties/{uuid.uuid4()}")).status_code == 404

    _, quiet_party_id = await _register(client, "GUEST", "pp.quiet@example.com")
    assert (await client.get(f"/api/groups/public/parties/{quiet_party_id}")).status_code == 404

    org_token, org_party_id = await _register(client, "ORGANIZER", "pp.private.circle@example.com")
    await _circle(client, org_token, "Pp prywatny", "PRIVATE")
    assert (await client.get(f"/api/groups/public/parties/{org_party_id}")).status_code == 404


async def test_getPartyProfile_listedItems_bioCountsAndRecentItemsCapped(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "GUEST", "pp.items@example.com")
    updated = await client.patch(
        "/api/people/me",
        json={"display_name": "Ania z Mokotowa", "bio": "Oddaję ubranka po córce."},
        headers=_auth(token),
    )
    assert updated.status_code == 200, updated.text
    await _listed_items(
        client,
        token,
        *[(f"Pp rzecz {i}", "GIFT" if i % 2 else "SWAP") for i in range(PROFILE_RECENT_ITEMS + 1)],
    )

    body = await _profile(client, party_id)

    assert body["owner"] == {
        "party_id": str(party_id),
        "display_name": "Ania z Mokotowa",
        "slug": None,
    }
    assert body["bio"] == "Oddaję ubranka po córce."
    assert body["avatar_url"] is None
    assert body["counts"] == {"GIFT": 3, "SWAP": 4}
    assert len(body["recent_items"]) == PROFILE_RECENT_ITEMS
    assert body["nearest"] is None
    assert body["is_me"] is False
    own = await client.get(f"/api/groups/public/parties/{party_id}", headers=_auth(token))
    assert own.json()["is_me"] is True


async def test_getPartyProfile_authoredEventOnly_visibleWithNearestEvent(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "GUEST", "pp.event@example.com")
    event_id = await _create_event(client, token, "Pp wymianka", _in_days(2))

    body = await _profile(client, party_id)

    assert body["counts"] == {"GIFT": 0, "SWAP": 0}
    assert body["recent_items"] == []
    assert (body["nearest"]["kind"], body["nearest"]["id"]) == ("EVENT", event_id)


async def test_getPartyProfile_leadsPublicCircleOnly_visible(client: AsyncClient) -> None:
    token, party_id = await _register(client, "ORGANIZER", "pp.circle@example.com")
    group_id = await _circle(client, token, "Pp publiczny")
    term_id = await _term(client, token, group_id, _in_days(5))

    body = await _profile(client, party_id)

    assert (body["nearest"]["kind"], body["nearest"]["id"]) == ("TERM", str(term_id))


async def test_getPartyProfile_organizationOwner_carriesSlugForRedirect(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "ORGANIZER", "pp.org@example.com")
    slug = await _organization_slug(client, token, "Pp Organizacja")
    await _listed_items(client, token, ("Pp org rzecz", "GIFT"))

    body = await _profile(client, party_id)

    assert body["owner"]["slug"] == slug


async def test_getPublicCircle_organizerPartyId_linksPersonProfile(client: AsyncClient) -> None:
    token, party_id = await _register(client, "ORGANIZER", "pp.term.link@example.com")
    group_id = await _circle(client, token, "Pp link")

    response = await client.get(f"/api/groups/public/{group_id}")

    assert response.status_code == 200, response.text
    assert response.json()["organizer_party_id"] == str(party_id)
