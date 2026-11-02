"""`POST /api/items/{item_id}/take|propose`: the single reservation write
path, its context reference validation and the TERM/EVENT contexts."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from tests.test_event_item_reservations import _attendees, _listed_items
from tests.test_term_item_listings import _auth, _create_circle_and_term, _register, _rsvp

CONTEXT_KEYS = {"kind", "id", "name", "starts_at", "path", "has_started"}


async def _take(
    client: AsyncClient,
    item_id: uuid.UUID,
    token: str,
    context: dict[str, Any],
    mode: str = "GIFT",
) -> tuple[int, Any]:
    response = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": context, "reservation_type": mode},
        headers=_auth(token),
    )
    return response.status_code, response.json()


@pytest.mark.parametrize(
    "context",
    [
        {"kind": "PERSONAL", "id": str(uuid.uuid4())},
        {"kind": "TERM"},
        {"kind": "EVENT", "id": None},
        {"kind": "SOMEWHERE"},
    ],
)
async def test_postTake_contextRefValidation_returns400(
    client: AsyncClient, context: dict[str, Any]
) -> None:
    token, _ = await _register(client, "GUEST", f"irr.v.{uuid.uuid4().hex[:8]}@example.com")

    bodies = {
        "take": {"context": context, "reservation_type": "GIFT"},
        "propose": {"context": context, "offered_item_id": str(uuid.uuid4())},
    }

    for action, body in bodies.items():
        response = await client.post(
            f"/api/items/{uuid.uuid4()}/{action}", json=body, headers=_auth(token)
        )
        # The app's validation handler answers 400 with field errors.
        assert response.status_code == 400, (action, response.text)
        fields = response.json()["fieldErrors"]
        assert any(field.startswith("context") for field in fields), response.text


async def test_postTake_termAndEventContexts_reserve(client: AsyncClient) -> None:
    org, _ = await _register(client, "ORGANIZER", "irr.t.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org, "irr-t")
    owner, _ = await _register(client, "GUEST", "irr.t.owner@example.com")
    taker, _ = await _register(client, "GUEST", "irr.t.taker@example.com")
    for token in (owner, taker):
        await _rsvp(client, token, group_id, term_id)
    (term_item,) = await _listed_items(client, owner, ("Rowerek irr-t", "GIFT"))

    event_id, _, (event_owner, event_taker) = await _attendees(client, "irr-e", "owner", "taker")
    (event_item,) = await _listed_items(client, event_owner, ("Sanki irr-e", "GIFT"))

    term_status, term_body = await _take(
        client, term_item, taker, {"kind": "TERM", "id": str(term_id)}
    )
    event_status, event_body = await _take(
        client, event_item, event_taker, {"kind": "EVENT", "id": str(event_id)}
    )

    assert term_status == 200, term_body
    assert set(term_body) == {"item_id", "product_name", "context"}
    assert set(term_body["context"]) == CONTEXT_KEYS
    assert (term_body["context"]["kind"], term_body["context"]["id"]) == ("TERM", str(term_id))
    assert term_body["context"]["path"].endswith(f"/group/{group_id}/term/{term_id}")
    assert event_status == 200, event_body
    assert (event_body["item_id"], event_body["product_name"]) == (
        str(event_item),
        "Sanki irr-e",
    )
    assert (event_body["context"]["kind"], event_body["context"]["id"]) == (
        "EVENT",
        str(event_id),
    )


async def test_postTake_swapMode_returns409(client: AsyncClient) -> None:
    event_id, _, (owner, taker) = await _attendees(client, "irr-s", "owner", "taker")
    (swap_item,) = await _listed_items(client, owner, ("Lalka irr-s", "SWAP"))

    status, body = await _take(
        client, swap_item, taker, {"kind": "EVENT", "id": str(event_id)}, mode="SWAP"
    )

    assert status == 409, body
    assert "propozycję zamiany" in body["message"]


async def test_postTake_privateNonMemberPersonal_returns404Not403Or409(
    client: AsyncClient,
) -> None:
    """The visibility gate runs before the context is built: without it the
    owner's missing pickup place would answer 409 and eligibility 403."""
    owner, _ = await _register(client, "GUEST", "irr.p.owner@example.com")
    stranger, _ = await _register(client, "GUEST", "irr.p.stranger@example.com")
    (item_id,) = await _listed_items(client, owner, ("Rowerek irr-p", "GIFT"))
    private = await client.put(
        f"/api/item-listing-preferences/{item_id}",
        json={"mode": "GIFT", "visibility": "PRIVATE"},
        headers=_auth(owner),
    )
    assert private.status_code == 200, private.text

    status, body = await _take(client, item_id, stranger, {"kind": "PERSONAL"})

    assert status == 404, body


@pytest.mark.parametrize(
    ("kind", "action"),
    [("TERM", "take"), ("TERM", "propose"), ("EVENT", "take"), ("EVENT", "propose")],
)
async def test_removedTakeProposeRoutes_returns404or405(
    client: AsyncClient, kind: str, action: str
) -> None:
    """Hit with a real, takeable listing so only a missing route can 404."""
    slug = f"irr-r-{kind.lower()}-{action}"
    mode = "GIFT" if action == "take" else "SWAP"
    if kind == "TERM":
        org, _ = await _register(client, "ORGANIZER", f"{slug}.org@example.com")
        group_id, term_id = await _create_circle_and_term(client, org, slug)
        owner, _ = await _register(client, "GUEST", f"{slug}.owner@example.com")
        taker, _ = await _register(client, "GUEST", f"{slug}.taker@example.com")
        for token in (owner, taker):
            await _rsvp(client, token, group_id, term_id)
        (item_id,) = await _listed_items(client, owner, (f"Rowerek {slug}", mode))
        (offered_id,) = await _listed_items(client, taker, (f"Hulajnoga {slug}", "SWAP"))
        path = f"/api/term-item-listings/{item_id}/{action}"
        body: dict[str, Any] = {"term_id": str(term_id)}
    else:
        event_id, _, (owner, taker) = await _attendees(client, slug, "owner", "taker")
        (item_id,) = await _listed_items(client, owner, (f"Sanki {slug}", mode))
        (offered_id,) = await _listed_items(client, taker, (f"Narty {slug}", "SWAP"))
        path = f"/api/events/{event_id}/items/{item_id}/{action}"
        body = {}
    if action == "take":
        body["reservation_type"] = "GIFT"
    else:
        body["offered_item_id"] = str(offered_id)

    response = await client.post(path, json=body, headers=_auth(taker))

    assert response.status_code in (404, 405), response.text
