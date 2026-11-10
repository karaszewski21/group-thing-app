"""`GET /api/groups/mine/terms` (the panel's led and member terms, latest date
first) and `GET /api/groups/{group_id}/terms`, both paginated."""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups import service
from tests.test_organizer_page import _circle, _in_days, _term
from tests.test_term_item_listings import _auth, _register, _rsvp

_MY_TERM_KEYS = {
    "id",
    "group_id",
    "occurs_on",
    "description",
    "attendee_count",
    "child_count",
    "location",
    "capacity",
    "group_name",
    "organizer_slug",
}


async def _my_terms(client: AsyncClient, token: str, **params: Any) -> dict[str, Any]:
    response = await client.get("/api/groups/mine/terms", params=params, headers=_auth(token))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_listMyTerms_led_latestDateFirstAcrossPages(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "mt.led.org@example.com")
    first = await _circle(client, org_token, "Pierwszy krąg")
    second = await _circle(client, org_token, "Drugi krąg")
    later = await _term(client, org_token, first, _in_days(9))
    soon = await _term(client, org_token, second, _in_days(1))
    middle = await _term(client, org_token, first, _in_days(4))
    old = await _term(client, org_token, second, _in_days(-10))
    recent = await _term(client, org_token, first, _in_days(-2))
    guest_token, _ = await _register(client, "GUEST", "mt.led.guest@example.com")
    await _rsvp(client, guest_token, second, soon)
    other_token, _ = await _register(client, "ORGANIZER", "mt.led.other@example.com")
    await _term(client, other_token, await _circle(client, other_token, "Cudzy"), _in_days(2))

    page_one = await _my_terms(client, org_token, role="led", size=3)
    page_two = await _my_terms(client, org_token, role="led", size=3, page=2)

    assert (page_one["total"], page_two["total"]) == (5, 5)
    items = page_one["items"] + page_two["items"]
    assert [t["id"] for t in items] == [str(later), str(middle), str(soon), str(recent), str(old)]
    by_id = {t["id"]: t for t in items}
    assert set(by_id[str(soon)]) == _MY_TERM_KEYS
    assert by_id[str(soon)]["group_name"] == "Drugi krąg"
    assert by_id[str(soon)]["organizer_slug"]
    assert (by_id[str(soon)]["attendee_count"], by_id[str(soon)]["child_count"]) == (1, 0)
    assert by_id[str(middle)]["attendee_count"] == 0


async def test_listMyTerms_memberRole_privateFamilyCirclesWithoutLedOrPublicOnesOrCounts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "mt.member.org@example.com")
    family_circle = await _circle(client, org_token, "Krąg rodziny", "PRIVATE")
    family_term = await _term(client, org_token, family_circle, _in_days(3))
    stranger_circle = await _circle(client, org_token, "Obcy krąg", "PRIVATE")
    await _term(client, org_token, stranger_circle, _in_days(2))
    public_circle = await _circle(client, org_token, "Publiczny krąg")
    await _term(client, org_token, public_circle, _in_days(4))
    guest_token, guest_party = await _register(client, "GUEST", "mt.member.guest@example.com")
    family = await client.post(
        "/api/families/mine", json={"name": "Rodzina Testowa"}, headers=_auth(guest_token)
    )
    assert family.status_code == 201, family.text
    guardian = await client.post(
        f"/api/families/{family.json()['id']}/guardians",
        json={"username": "mt-member-second", "password": "secret123", "display_name": "Ola"},
        headers=_auth(guest_token),
    )
    assert guardian.status_code == 201, guardian.text
    await service.add_active_membership(
        db_session, family_circle, uuid.UUID(guardian.json()["party_id"])
    )
    await service.add_active_membership(db_session, public_circle, guest_party)
    own_circle = await _circle(client, guest_token, "Mój krąg", "PRIVATE")
    await _term(client, guest_token, own_circle, _in_days(1))
    await service.add_active_membership(db_session, own_circle, guest_party)
    await db_session.commit()

    member = await _my_terms(client, guest_token, role="member")

    assert member["total"] == 1
    (term,) = member["items"]
    assert set(term) == _MY_TERM_KEYS
    assert term["id"] == str(family_term)
    assert term["group_name"] == "Krąg rodziny"
    assert (term["attendee_count"], term["child_count"]) == (None, None)


async def test_listMyTerms_invalidOrMissingParams_return400(client: AsyncClient) -> None:
    token, _ = await _register(client, "ORGANIZER", "mt.invalid@example.com")

    for params in ({}, {"role": "boss"}, {"role": "led", "size": 101}):
        response = await client.get("/api/groups/mine/terms", params=params, headers=_auth(token))
        assert response.status_code == 400, params
    assert (
        await client.get("/api/groups/mine/terms", params={"role": "led"})
    ).status_code == 401


async def test_listGroupTerms_paginatedWithOrganizerOnlyCounts(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gt.page.org@example.com")
    group_id = await _circle(client, org_token, "Krąg stron")
    old = await _term(client, org_token, group_id, _in_days(-3))
    soon = await _term(client, org_token, group_id, _in_days(2))
    later = await _term(client, org_token, group_id, _in_days(6))
    guest_token, _ = await _register(client, "GUEST", "gt.page.guest@example.com")
    url = f"/api/groups/{group_id}/terms"

    everything = await client.get(url, params={"size": 2}, headers=_auth(org_token))
    upcoming = await client.get(url, params={"period": "upcoming"}, headers=_auth(guest_token))
    past = await client.get(url, params={"period": "past"}, headers=_auth(org_token))

    assert everything.status_code == upcoming.status_code == past.status_code == 200
    assert (everything.json()["total"], everything.json()["size"]) == (3, 2)
    assert [t["id"] for t in everything.json()["items"]] == [str(later), str(soon)]
    assert everything.json()["items"][0]["attendee_count"] == 0
    assert [t["id"] for t in upcoming.json()["items"]] == [str(soon), str(later)]
    assert upcoming.json()["items"][0]["attendee_count"] is None
    assert [t["id"] for t in past.json()["items"]] == [str(old)]
    missing = await client.get(f"/api/groups/{uuid.uuid4()}/terms", headers=_auth(org_token))
    assert missing.status_code == 404


async def test_getGroup_returnsTermCount(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gt.count.org@example.com")
    group_id = await _circle(client, org_token, "Krąg liczony")
    await _term(client, org_token, group_id, _in_days(2))
    await _term(client, org_token, group_id, _in_days(-2))

    response = await client.get(f"/api/groups/{group_id}", headers=_auth(org_token))

    assert response.status_code == 200
    assert response.json()["term_count"] == 2
