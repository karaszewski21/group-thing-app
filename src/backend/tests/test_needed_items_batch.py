"""`GET /api/needed-items` with a repeated `term_id`: the needs of several
Terms in one request and one query."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import count_queries
from tests.test_group_soft_delete_reads import _delete
from tests.test_groups import NEEDED_ITEM_KEYS
from tests.test_organizer_page import _circle, _in_days, _needed_item, _term
from tests.test_term_item_listings import _auth, _register, _rsvp


def _url(term_ids: list[uuid.UUID]) -> str:
    return "/api/needed-items?" + "&".join(f"term_id={term_id}" for term_id in term_ids)


async def _circle_term(client: AsyncClient, token: str, name: str) -> tuple[uuid.UUID, uuid.UUID]:
    circle_id = await _circle(client, token, name)
    return circle_id, await _term(client, token, circle_id, _in_days(3))


async def test_listNeededItems_severalTerms_returnsEveryTermsNeedsWithClaimedFlag(
    client: AsyncClient,
) -> None:
    token, _ = await _register(client, "ORGANIZER", "nib.many.org@example.com")
    _, first_term = await _circle_term(client, token, "Krąg A")
    second_circle, second_term = await _circle_term(client, token, "Krąg B")
    drum = await _needed_item(client, token, first_term, "Nib bęben")
    flute = await _needed_item(client, token, second_term, "Nib flet")
    guest_token, _ = await _register(client, "GUEST", "nib.many.guest@example.com")
    await _rsvp(client, guest_token, second_circle, second_term)
    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": str(flute)}, headers=_auth(guest_token)
    )
    assert pledge.status_code == 201

    response = await client.get(_url([first_term, second_term]), headers=_auth(token))

    assert response.status_code == 200
    body = response.json()
    assert all(set(item) == NEEDED_ITEM_KEYS for item in body)
    assert {item["id"]: (item["term_id"], item["claimed"]) for item in body} == {
        str(drum): (str(first_term), False),
        str(flute): (str(second_term), True),
    }


async def test_listNeededItems_unknownOrDeletedCircleTerm_isSkipped(client: AsyncClient) -> None:
    token, _ = await _register(client, "ORGANIZER", "nib.skip.org@example.com")
    _, live_term = await _circle_term(client, token, "Krąg żywy")
    deleted_circle, deleted_term = await _circle_term(client, token, "Krąg usunięty")
    live_need = await _needed_item(client, token, live_term, "Nib żywy")
    await _needed_item(client, token, deleted_term, "Nib usunięty")
    await _delete(client, token, deleted_circle)

    response = await client.get(_url([live_term, deleted_term, uuid.uuid4()]), headers=_auth(token))

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(live_need)]


async def test_listNeededItems_singleUnknownTerm_returns404(client: AsyncClient) -> None:
    token, _ = await _register(client, "ORGANIZER", "nib.one.org@example.com")

    response = await client.get(_url([uuid.uuid4()]), headers=_auth(token))

    assert response.status_code == 404


async def test_listNeededItems_missingOrTooManyTermIds_returns400(client: AsyncClient) -> None:
    token, _ = await _register(client, "ORGANIZER", "nib.limits.org@example.com")

    missing = await client.get("/api/needed-items", headers=_auth(token))
    too_many = await client.get(_url([uuid.uuid4() for _ in range(101)]), headers=_auth(token))

    assert missing.status_code == 400
    assert too_many.status_code == 400


async def test_listNeededItems_queryCount_doesNotGrowWithTermCount(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    token, _ = await _register(client, "ORGANIZER", "nib.budget.org@example.com")
    term_ids = []
    for index in range(4):
        _, term_id = await _circle_term(client, token, f"Krąg {index}")
        await _needed_item(client, token, term_id, f"Nib rzecz {index}")
        term_ids.append(term_id)

    async def statement_count(ids: list[uuid.UUID]) -> int:
        with count_queries(engine) as statements:
            response = await client.get(_url(ids), headers=_auth(token))
        assert response.status_code == 200, response.text
        assert len(response.json()) == len(ids)
        return len(statements)

    assert await statement_count(term_ids[:2]) == await statement_count(term_ids)
