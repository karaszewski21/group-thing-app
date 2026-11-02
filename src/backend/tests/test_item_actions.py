"""`GET /api/items/{item_id}/actions` v2: the item page's action read model.
Covers the response shape and viewer classification, the owner's upcoming
contexts (owner-eligible, viewer-filtered in SQL before the limit, ordered,
term wins a tie, at most 5), the viewer-shaped owner location, the personal
pickup rule and a statement count independent of the number of contexts."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core import clock
from tests.conftest import count_queries
from tests.test_event_item_reservations import _listed_items, _sign_up
from tests.test_personal_pickup import _set_location
from tests.test_term_item_listings import _auth, _register, _rsvp

ACTIONS_KEYS = {
    "mode",
    "visibility",
    "available",
    "reservation",
    "party_reservation",
    "owner",
    "viewer",
    "location",
    "contexts",
    "personal_pickup_available",
}
OWNER_KEYS = {"party_id", "display_name", "slug", "items_total"}
CONTEXT_KEYS = {
    "kind",
    "id",
    "name",
    "starts_at",
    "path",
    "has_started",
    "location_name",
    "eligible",
}
LOCATION_KEYS = {"name", "formatted_address", "deleted_at"}


async def _actions(
    client: AsyncClient, item_id: uuid.UUID, token: str | None = None
) -> dict[str, Any]:
    response = await client.get(
        f"/api/items/{item_id}/actions", headers=_auth(token) if token is not None else {}
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert set(body) == ACTIONS_KEYS
    assert set(body["owner"]) == OWNER_KEYS
    assert all(set(context) == CONTEXT_KEYS for context in body["contexts"])
    if body["location"] is not None:
        assert set(body["location"]) == LOCATION_KEYS
    return body


def _day(days: int, at: time = time(0, 0)) -> datetime:
    return datetime.combine(clock.local_now().date() + timedelta(days=days), at)


async def _circle(client: AsyncClient, token: str, name: str) -> uuid.UUID:
    response = await client.post("/api/groups/mine", json={"name": name}, headers=_auth(token))
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _term(client: AsyncClient, token: str, group_id: uuid.UUID, on: date) -> uuid.UUID:
    response = await client.post(
        "/api/terms",
        json={"circle_group_id": str(group_id), "occurs_on": on.isoformat()},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _event(client: AsyncClient, token: str, name: str, starts_at: datetime) -> uuid.UUID:
    response = await client.post(
        "/api/events",
        json={"name": name, "starts_at": starts_at.isoformat()},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _make_private(client: AsyncClient, token: str, group_id: uuid.UUID, name: str) -> None:
    response = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": name, "visibility": "PRIVATE"},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text


async def test_getItemActions_exactKeySet(client: AsyncClient) -> None:
    owner, owner_party = await _register(client, "GUEST", "ia1.owner@example.com")
    attendee, _ = await _register(client, "GUEST", "ia1.attendee@example.com")
    event_id = await _event(client, owner, "Wymiana ia1", _day(7, time(10, 0)))
    await _sign_up(client, event_id, attendee)
    listed, unlisted = await _listed_items(
        client, owner, ("Rowerek ia1", "GIFT"), ("Książka ia1", "GIFT")
    )
    cleared = await client.put(
        f"/api/item-listing-preferences/{unlisted}", json={"mode": None}, headers=_auth(owner)
    )
    assert cleared.status_code == 200, cleared.text

    anonymous = await _actions(client, listed)
    own = await _actions(client, listed, owner)
    other = await _actions(client, listed, attendee)
    draft = await _actions(client, unlisted, attendee)
    hidden = await client.get(f"/api/items/{unlisted}/actions")
    unknown = await client.get(f"/api/items/{uuid.uuid4()}/actions")

    assert [b["viewer"] for b in (anonymous, own, other)] == ["ANONYMOUS", "OWN", "OTHER"]
    assert anonymous["mode"] == "GIFT" and anonymous["available"] is True
    assert [b["visibility"] for b in (anonymous, own, other)] == [None, "PUBLIC", None]
    assert all(
        b["reservation"] is None and b["party_reservation"] is None for b in (anonymous, own, other)
    )
    assert anonymous["owner"]["party_id"] == str(owner_party)
    assert anonymous["owner"]["items_total"] == 1
    (context,) = other["contexts"]
    assert context["kind"] == "EVENT" and context["id"] == str(event_id)
    assert context["name"] == "Wymiana ia1" and context["has_started"] is False
    assert context["path"].endswith(f"/event/{event_id}")
    assert context["location_name"] is None
    assert context["eligible"] is True
    assert anonymous["contexts"][0]["eligible"] is False
    assert own["contexts"][0]["eligible"] is False
    assert draft["mode"] is None and draft["available"] is False
    assert draft["personal_pickup_available"] is False
    assert (hidden.status_code, unknown.status_code) == (404, 404)


async def test_getItemActions_contexts_ownerEligibleUpcomingOrderedTermWinsTieMax5(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "ia2.owner@example.com")
    other_org, _ = await _register(client, "ORGANIZER", "ia2.other@example.com")
    own_circle = await _circle(client, owner, "Krąg ia2")
    early_term = await _term(client, owner, own_circle, _day(2).date())
    tie_term = await _term(client, owner, own_circle, _day(7).date())
    host_org, _ = await _register(client, "ORGANIZER", "ia2.host@example.com")
    foreign_circle = await _circle(client, other_org, "Obcy ia2")
    await _term(client, other_org, foreign_circle, _day(3).date())
    rsvp_circle = await _circle(client, host_org, "Gościnny ia2")
    rsvp_term = await _term(client, host_org, rsvp_circle, _day(4).date())
    await _rsvp(client, owner, rsvp_circle, rsvp_term)
    await _event(client, owner, "Przeszłe ia2", _day(1, time(12, 0)))
    tie_event = await _event(client, owner, "Remis ia2", _day(7))
    late_event = await _event(client, owner, "Później ia2", _day(8))
    await _event(client, owner, "Najpóźniej ia2", _day(9))
    await _event(client, other_org, "Cudze ia2", _day(5))
    (item_id,) = await _listed_items(client, owner, ("Sanki ia2", "SWAP"))

    freeze_local_now(_day(1, time(13, 0)))
    body = await _actions(client, item_id)

    assert [(c["kind"], c["id"]) for c in body["contexts"]] == [
        ("TERM", str(early_term)),
        ("TERM", str(rsvp_term)),
        ("TERM", str(tie_term)),
        ("EVENT", str(tie_event)),
        ("EVENT", str(late_event)),
    ]
    first, rsvp = body["contexts"][0], body["contexts"][1]
    assert first["name"] == "Krąg ia2"
    assert first["path"].endswith(f"/group/{own_circle}/term/{early_term}")
    assert rsvp["name"] == "Gościnny ia2"
    assert rsvp["path"].endswith(f"/group/{rsvp_circle}/term/{rsvp_term}")
    assert all(c["eligible"] is False for c in body["contexts"])


async def test_getItemActions_contexts_viewerFilterBeforeLimit(client: AsyncClient) -> None:
    owner, _ = await _register(client, "ORGANIZER", "ia3.owner@example.com")
    stranger, _ = await _register(client, "GUEST", "ia3.stranger@example.com")
    member, _ = await _register(client, "GUEST", "ia3.member@example.com")
    circle = await _circle(client, owner, "Krąg ia3")
    terms = [await _term(client, owner, circle, _day(day).date()) for day in range(1, 6)]
    await _rsvp(client, member, circle, terms[2])
    await _make_private(client, owner, circle, "Krąg ia3")
    event_id = await _event(client, owner, "Otwarte ia3", _day(6))
    (item_id,) = await _listed_items(client, owner, ("Lalka ia3", "GIFT"))

    anonymous = await _actions(client, item_id)
    outsider = await _actions(client, item_id, stranger)
    attendee = await _actions(client, item_id, member)
    own = await _actions(client, item_id, owner)

    assert [c["id"] for c in anonymous["contexts"]] == [str(event_id)]
    assert [c["id"] for c in outsider["contexts"]] == [str(event_id)]
    assert [(c["id"], c["eligible"]) for c in attendee["contexts"]] == [
        (str(terms[2]), True),
        (str(event_id), False),
    ]
    assert [c["id"] for c in own["contexts"]] == [str(term) for term in terms]


async def test_getItemActions_location_shapedPerViewer(client: AsyncClient) -> None:
    owner, _ = await _register(client, "GUEST", "ia4.owner@example.com")
    viewer, _ = await _register(client, "GUEST", "ia4.viewer@example.com")
    unset_owner, _ = await _register(client, "GUEST", "ia4.unset@example.com")
    (item_id,) = await _listed_items(client, owner, ("Puzzle ia4", "GIFT"))
    (unset_item,) = await _listed_items(client, unset_owner, ("Klocki ia4", "GIFT"))
    location_id = await _set_location(client, owner, "ChIJ-ia4")

    own = await _actions(client, item_id, owner)
    other = await _actions(client, item_id, viewer)
    anonymous = await _actions(client, item_id)
    unset = await _actions(client, unset_item, viewer)

    assert own["location"] == {
        "name": "Dom ChIJ-ia4",
        "formatted_address": "ul. Puławska 1, 02-515 Warszawa",
        "deleted_at": None,
    }
    assert other["location"] == {
        "name": "Dom ChIJ-ia4",
        "formatted_address": None,
        "deleted_at": None,
    }
    assert anonymous["location"] is None
    assert unset["location"] is None

    deleted = await client.delete(f"/api/locations/{location_id}", headers=_auth(owner))
    assert deleted.status_code == 204, deleted.text
    own_after = await _actions(client, item_id, owner)
    other_after = await _actions(client, item_id, viewer)

    assert own_after["location"]["name"] == "Dom ChIJ-ia4"
    assert own_after["location"]["deleted_at"] is not None
    assert other_after["location"] is None


async def test_getItemActions_personalPickupAvailable_rules(client: AsyncClient) -> None:
    owner, _ = await _register(client, "GUEST", "ia5.owner@example.com")
    viewer, _ = await _register(client, "GUEST", "ia5.viewer@example.com")
    taker, _ = await _register(client, "GUEST", "ia5.taker@example.com")
    unset_owner, _ = await _register(client, "GUEST", "ia5.unset@example.com")
    free, taken = await _listed_items(client, owner, ("Gra ia5", "GIFT"), ("Lego ia5", "GIFT"))
    (unset_item,) = await _listed_items(client, unset_owner, ("Kredki ia5", "GIFT"))
    await _set_location(client, owner, "ChIJ-ia5")
    reserved = await client.post(
        f"/api/items/{taken}/take",
        json={"context": {"kind": "PERSONAL"}, "reservation_type": "GIFT"},
        headers=_auth(taker),
    )
    assert reserved.status_code == 200, reserved.text

    assert (await _actions(client, free, viewer))["personal_pickup_available"] is True
    assert (await _actions(client, free))["personal_pickup_available"] is False
    assert (await _actions(client, free, owner))["personal_pickup_available"] is False
    assert (await _actions(client, unset_item, viewer))["personal_pickup_available"] is False
    taken_body = await _actions(client, taken, viewer)
    assert taken_body["available"] is False
    assert taken_body["personal_pickup_available"] is False


async def test_getItemActions_statementCount_oneVsFiveContextsEqual(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    viewer, _ = await _register(client, "GUEST", "ia6.viewer@example.com")

    async def owner_with(prefix: str, count: int) -> tuple[uuid.UUID, uuid.UUID]:
        organizer, _ = await _register(client, "ORGANIZER", f"{prefix}.owner@example.com")
        circle = await _circle(client, organizer, f"Krąg {prefix}")
        for day in range(1, count + 1):
            await _term(client, organizer, circle, _day(day).date())
        guest, _ = await _register(client, "GUEST", f"{prefix}.author@example.com")
        for day in range(1, count + 1):
            await _event(client, guest, f"Wymiana {prefix} {day}", _day(day, time(12, 0)))
        (term_item,) = await _listed_items(client, organizer, (f"Rower {prefix}", "GIFT"))
        (event_item,) = await _listed_items(client, guest, (f"Hulajnoga {prefix}", "GIFT"))
        await _set_location(client, organizer, f"ChIJ-{prefix}-o")
        await _set_location(client, guest, f"ChIJ-{prefix}-g")
        return term_item, event_item

    one_term, one_event = await owner_with("ia6a", 1)
    five_term, five_event = await owner_with("ia6b", 5)

    counts = []
    for item_id, expected in ((one_term, 1), (five_term, 5), (one_event, 1), (five_event, 5)):
        with count_queries(engine) as statements:
            body = await _actions(client, item_id, viewer)
        assert len(body["contexts"]) == expected
        counts.append(len(statements))

    assert counts[0] == counts[1], counts
    assert counts[2] == counts[3], counts
