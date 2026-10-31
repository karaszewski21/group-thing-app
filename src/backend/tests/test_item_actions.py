"""`GET /api/items/{item_id}/actions?term=|event=`: the item page's action
read model. Covers the viewer classification, the context visibility rules
(the owner must be eligible; a private term only for an eligible viewer),
a started context, both params at once and an item without a listing
preference."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient

from tests.test_event_item_reservations import _create_event, _listed_items, _sign_up
from tests.test_term_item_listings import (
    _auth,
    _create_circle_and_term,
    _register,
    _rsvp,
)

ACTIONS_KEYS = {"mode", "available", "owner", "context", "viewer", "nearest"}
OWNER_KEYS = {"party_id", "display_name", "slug", "items_total"}
CONTEXT_KEYS = {"kind", "id", "name", "starts_at", "path", "has_started"}
NEAREST_KEYS = {"kind", "id", "name", "starts_at", "location_name", "attendee_count", "path"}


async def _actions(
    client: AsyncClient, item_id: uuid.UUID, token: str | None = None, **params: uuid.UUID
) -> dict[str, Any]:
    response = await client.get(
        f"/api/items/{item_id}/actions",
        params={key: str(value) for key, value in params.items()},
        headers=_auth(token) if token is not None else {},
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert set(body) == ACTIONS_KEYS
    assert set(body["owner"]) == OWNER_KEYS
    if body["context"] is not None:
        assert set(body["context"]) == CONTEXT_KEYS
    if body["nearest"] is not None:
        assert set(body["nearest"]) == NEAREST_KEYS
    return body


async def test_getItemActions_eventContext_classifiesEveryViewer(client: AsyncClient) -> None:
    owner, owner_party = await _register(client, "GUEST", "ia1.owner@example.com")
    attendee, _ = await _register(client, "GUEST", "ia1.attendee@example.com")
    stranger, _ = await _register(client, "GUEST", "ia1.stranger@example.com")
    event_id, starts_at = await _create_event(client, owner)
    await _sign_up(client, event_id, attendee)
    (item_id,) = await _listed_items(client, owner, ("Rowerek ia1", "GIFT"))

    anonymous = await _actions(client, item_id, event=event_id)
    own = await _actions(client, item_id, owner, event=event_id)
    eligible = await _actions(client, item_id, attendee, event=event_id)
    not_eligible = await _actions(client, item_id, stranger, event=event_id)

    assert [b["viewer"] for b in (anonymous, own, eligible, not_eligible)] == [
        "ANONYMOUS",
        "OWN",
        "ELIGIBLE",
        "NOT_ELIGIBLE",
    ]
    assert anonymous["mode"] == "GIFT" and anonymous["available"] is True
    assert anonymous["owner"]["party_id"] == str(owner_party)
    assert anonymous["owner"]["items_total"] == 1
    assert anonymous["owner"]["slug"] is None
    context = anonymous["context"]
    assert context["kind"] == "EVENT" and context["id"] == str(event_id)
    assert context["starts_at"] == starts_at.isoformat()
    assert context["path"].endswith(f"/event/{event_id}")
    assert context["has_started"] is False
    assert all(b["context"] == context for b in (own, eligible, not_eligible))


async def test_getItemActions_termContext_attendeeIsEligible(client: AsyncClient) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "ia2.org@example.com")
    attendee, _ = await _register(client, "GUEST", "ia2.attendee@example.com")
    group_id, term_id = await _create_circle_and_term(client, organizer, "ia2")
    await _rsvp(client, attendee, group_id, term_id)
    (item_id,) = await _listed_items(client, organizer, ("Sanki ia2", "SWAP"))

    body = await _actions(client, item_id, attendee, term=term_id)

    assert body["viewer"] == "ELIGIBLE"
    assert body["mode"] == "SWAP"
    assert body["context"]["kind"] == "TERM"
    assert body["context"]["name"] == "Krąg ia2"
    assert body["context"]["path"].endswith(f"/group/{group_id}/term/{term_id}")
    assert body["nearest"]["kind"] == "TERM" and body["nearest"]["id"] == str(term_id)


async def test_getItemActions_bothTermAndEvent_returns400(client: AsyncClient) -> None:
    owner, _ = await _register(client, "GUEST", "ia3.owner@example.com")
    (item_id,) = await _listed_items(client, owner, ("Klocki ia3", "GIFT"))

    response = await client.get(
        f"/api/items/{item_id}/actions",
        params={"term": str(uuid.uuid4()), "event": str(uuid.uuid4())},
    )

    assert response.status_code == 400, response.text


async def test_getItemActions_startedEvent_hasStartedTrue(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    owner, _ = await _register(client, "GUEST", "ia4.owner@example.com")
    event_id, starts_at = await _create_event(client, owner)
    (item_id,) = await _listed_items(client, owner, ("Puzzle ia4", "GIFT"))

    freeze_local_now(starts_at + timedelta(minutes=1))
    body = await _actions(client, item_id, event=event_id)

    assert body["context"]["has_started"] is True


async def test_getItemActions_privateTerm_hiddenFromNonEligibleViewer(
    client: AsyncClient,
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "ia5.org@example.com")
    attendee, _ = await _register(client, "GUEST", "ia5.attendee@example.com")
    stranger, _ = await _register(client, "GUEST", "ia5.stranger@example.com")
    group_id, term_id = await _create_circle_and_term(client, organizer, "ia5")
    await _rsvp(client, attendee, group_id, term_id)
    patch = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Krąg ia5", "visibility": "PRIVATE"},
        headers=_auth(organizer),
    )
    assert patch.status_code == 200, patch.text
    (item_id,) = await _listed_items(client, organizer, ("Lalka ia5", "GIFT"))

    anonymous = await _actions(client, item_id, term=term_id)
    outsider = await _actions(client, item_id, stranger, term=term_id)
    eligible = await _actions(client, item_id, attendee, term=term_id)

    assert anonymous["context"] is None and anonymous["viewer"] == "ANONYMOUS"
    assert outsider["context"] is None and outsider["viewer"] == "NOT_ELIGIBLE"
    assert eligible["context"]["id"] == str(term_id) and eligible["viewer"] == "ELIGIBLE"


async def test_getItemActions_ownerNotEligibleOrUnknownContext_contextNull(
    client: AsyncClient,
) -> None:
    author, _ = await _register(client, "GUEST", "ia6.author@example.com")
    owner, _ = await _register(client, "GUEST", "ia6.owner@example.com")
    event_id, _ = await _create_event(client, author)
    (item_id,) = await _listed_items(client, owner, ("Narty ia6", "GIFT"))

    not_eligible_owner = await _actions(client, item_id, author, event=event_id)
    unknown = await _actions(client, item_id, event=uuid.uuid4())

    assert not_eligible_owner["context"] is None
    assert unknown["context"] is None


async def test_getItemActions_noListingPreference_modeNullOwnerSummaryPopulated(
    client: AsyncClient,
) -> None:
    owner, owner_party = await _register(client, "GUEST", "ia7.owner@example.com")
    viewer, _ = await _register(client, "GUEST", "ia7.viewer@example.com")
    event_id, _ = await _create_event(client, owner)
    _, unlisted = await _listed_items(client, owner, ("Gra ia7", "SWAP"), ("Książka ia7", "GIFT"))
    cleared = await client.put(
        f"/api/item-listing-preferences/{unlisted}", json={"mode": None}, headers=_auth(owner)
    )
    assert cleared.status_code == 200, cleared.text

    body = await _actions(client, unlisted, viewer)
    anonymous = await client.get(f"/api/items/{unlisted}/actions")
    unknown = await client.get(f"/api/items/{uuid.uuid4()}/actions")

    assert body["mode"] is None and body["available"] is False
    assert body["context"] is None and body["viewer"] == "NOT_ELIGIBLE"
    assert body["owner"]["party_id"] == str(owner_party)
    assert body["owner"]["display_name"]
    assert body["owner"]["items_total"] == 1
    assert body["nearest"]["kind"] == "EVENT" and body["nearest"]["id"] == str(event_id)
    assert (anonymous.status_code, unknown.status_code) == (404, 404)


async def test_getItemActions_eventAuthorViewerEligible_withdrawnAttendeeNotEligible(
    client: AsyncClient,
) -> None:
    author, _ = await _register(client, "GUEST", "ia8.author@example.com")
    owner, _ = await _register(client, "GUEST", "ia8.owner@example.com")
    leaver, _ = await _register(client, "GUEST", "ia8.leaver@example.com")
    event_id, _ = await _create_event(client, author)
    for token in (owner, leaver):
        await _sign_up(client, event_id, token)
    (item_id,) = await _listed_items(client, owner, ("Hulajnoga ia8", "GIFT"))
    withdrawn = await client.post(
        f"/api/events/{event_id}/attendances/withdraw", headers=_auth(leaver)
    )
    assert withdrawn.status_code == 204, withdrawn.text

    as_author = await _actions(client, item_id, author, event=event_id)
    as_leaver = await _actions(client, item_id, leaver, event=event_id)

    assert as_author["viewer"] == "ELIGIBLE"
    assert as_author["context"]["id"] == str(event_id)
    assert as_leaver["viewer"] == "NOT_ELIGIBLE"
    assert as_leaver["context"] == as_author["context"]
