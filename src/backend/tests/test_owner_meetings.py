"""`GET /api/public/organizers/{slug}/meetings` and
`GET /api/public/parties/{party_id}/meetings`: the owner meetings
pages behind `/<org-slug>/meetings` and `/<party-id>/meetings`. Covers the
response contract, terms and events merged earliest first, PRIVATE circles
left out, the 404 for an unknown party and the empty list of an account
with nothing public, the person (not their Organization) as the owner of the
party page, and a statement count that does not grow with the list."""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import count_queries
from tests.test_organizer_page import _circle, _in_days, _organization_slug, _term
from tests.test_owner_items_page import NEAREST_KEYS, OWNER_KEYS, _create_event
from tests.test_term_item_listings import _register


async def _meetings(client: AsyncClient, path: str) -> dict[str, Any]:
    response = await client.get(path)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "public, max-age=0, s-maxage=60"
    body: dict[str, Any] = response.json()
    assert set(body) == {"owner", "meetings"}
    assert set(body["owner"]) == OWNER_KEYS
    for meeting in body["meetings"]:
        assert set(meeting) == NEAREST_KEYS
    return body


async def test_getOrganizationMeetings_termsAndEvents_mergedEarliestFirstWithoutPrivate(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "ORGANIZER", "om.org@example.com")
    slug = await _organization_slug(client, token, "Spotkaniowe Nutki")
    group_id = await _circle(client, token, "Om publiczny")
    private_id = await _circle(client, token, "Om prywatny", "PRIVATE")
    later_term = await _term(client, token, group_id, _in_days(6))
    early_term = await _term(client, token, group_id, _in_days(2))
    await _term(client, token, private_id, _in_days(3))
    event_id = await _create_event(client, token, "Om wymianka", _in_days(4))

    body = await _meetings(client, f"/api/public/organizers/{slug}/meetings")

    assert body["owner"] == {
        "party_id": str(party_id),
        "display_name": "Spotkaniowe Nutki",
        "slug": slug,
    }
    assert [(m["kind"], m["id"]) for m in body["meetings"]] == [
        ("TERM", str(early_term)),
        ("EVENT", event_id),
        ("TERM", str(later_term)),
    ]
    assert body["meetings"][0]["name"] == "Om publiczny"
    assert body["meetings"][0]["path"] == f"/{slug}/group/{group_id}/term/{early_term}"
    assert body["meetings"][1]["path"] == f"/{slug}/event/{event_id}"


async def test_getOrganizationMeetings_unknownSlug_returns404(client: AsyncClient) -> None:
    response = await client.get("/api/public/organizers/om-nie-ma/meetings")
    assert response.status_code == 404, response.text


async def test_getPartyMeetings_unknown404_accountWithNothingPublicEmpty(
    client: AsyncClient,
) -> None:
    assert (await client.get(f"/api/public/parties/{uuid.uuid4()}/meetings")).status_code == 404
    _, quiet_party_id = await _register(client, "GUEST", "om.quiet@example.com")
    quiet = await _meetings(client, f"/api/public/parties/{quiet_party_id}/meetings")
    assert quiet["meetings"] == []


async def test_getPartyMeetings_personWithoutOrganization_listsLedTermsAndEvents(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "ORGANIZER", "om.person@example.com")
    group_id = await _circle(client, token, "Om krąg osoby")
    term_id = await _term(client, token, group_id, _in_days(3))
    event_id = await _create_event(client, token, "Om wymianka osoby", _in_days(1))

    body = await _meetings(client, f"/api/public/parties/{party_id}/meetings")

    assert body["owner"]["slug"] is None
    assert [(m["kind"], m["id"]) for m in body["meetings"]] == [
        ("EVENT", event_id),
        ("TERM", str(term_id)),
    ]


async def test_getPartyMeetings_organizationOwner_staysThePerson(
    client: AsyncClient,
) -> None:
    token, party_id = await _register(client, "ORGANIZER", "om.redirect@example.com")
    slug = await _organization_slug(client, token, "Om Przekierowanie")
    await _create_event(client, token, "Om wydarzenie", _in_days(2))

    body = await _meetings(client, f"/api/public/parties/{party_id}/meetings")

    assert body["owner"]["slug"] is None
    assert body["owner"]["display_name"] != "Om Przekierowanie"
    assert slug


async def test_getOrganizationMeetings_moreMeetings_sameStatementCount(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    token, _ = await _register(client, "ORGANIZER", "om.count@example.com")
    slug = await _organization_slug(client, token, "Liczone Nutki")
    group_id = await _circle(client, token, "Om liczony")
    await _term(client, token, group_id, _in_days(2))
    await _create_event(client, token, "Om liczone 1", _in_days(3))
    path = f"/api/public/organizers/{slug}/meetings"

    with count_queries(engine) as one_each:
        await _meetings(client, path)
    other_circle = await _circle(client, token, "Om liczony 2")
    await _term(client, token, other_circle, _in_days(4))
    await _term(client, token, group_id, _in_days(5))
    await _create_event(client, token, "Om liczone 2", _in_days(6))
    with count_queries(engine) as more:
        body = await _meetings(client, path)

    assert len(body["meetings"]) == 5
    assert len(more) == len(one_each)
