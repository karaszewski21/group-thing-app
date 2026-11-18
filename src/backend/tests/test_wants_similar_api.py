"""The related-items list of a want (`GET /api/wants/{id}/similar`, SIMILAR
pairs only): the card, the best ten by score, the read-time visibility
filter, and that SIMILAR pairs neither count as matches nor answer the
`matched_item_id` lookup. The pairs are seeded as the matcher service
writes them."""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.groups.models import ItemListingPreference
from app.wants.models import WantMatchTier
from tests.conftest import _Owner, count_queries, seed_want_matches
from tests.test_term_item_listings import _auth, _register
from tests.test_wants_api import NOT_FOUND_MESSAGE, _create_want

SIMILAR_KEYS = {"id", "title", "href", "meta", "reserved_by_me", "proposed_by_me"}
META_KEYS = {"mode", "condition", "thumb_url", "reserved", "reserved_until"}


async def _similar(client: AsyncClient, token: str, want_id: str) -> list[dict[str, Any]]:
    response = await client.get(f"/api/wants/{want_id}/similar", headers=_auth(token))
    assert response.status_code == 200, response.text
    cards: list[dict[str, Any]] = response.json()
    return cards


async def _seed_similar(
    db: AsyncSession, want_id: str, item_ids: list[uuid.UUID], *, score: float = 0.9
) -> None:
    await seed_want_matches(db, want_id, item_ids, tier=WantMatchTier.SIMILAR, score=score)


async def test_listSimilar_storedSimilarPair_returnsExactCardKeySetWithoutVectorOrScore(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.card.o@example.com")
    token, _ = await _register(client, "GUEST", "ws.card.s@example.com")
    stroller = await owner.lists("Wózek spacerowy")
    want = await _create_want(client, token, "spacerówka")
    await _seed_similar(db_session, want["id"], [stroller])
    owner_party = await db_session.scalar(
        select(ItemListingPreference.owner_party_id).where(
            ItemListingPreference.item_id == stroller
        )
    )

    (card,) = await _similar(client, token, want["id"])

    assert set(card) == SIMILAR_KEYS
    assert set(card["meta"]) == META_KEYS
    assert card == {
        "id": str(stroller),
        "title": "Wózek spacerowy",
        "href": f"/{owner_party}/product/{stroller}",
        "meta": {
            "mode": "GIFT",
            "condition": "GOOD",
            "thumb_url": None,
            "reserved": False,
            "reserved_until": None,
        },
        "reserved_by_me": False,
        "proposed_by_me": False,
    }


async def test_listSimilar_twelvePairs_bestTenByScoreThenItemId_sameStatementCount(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    owner = await _Owner.create(client, "ws.order.o@example.com")
    token, _ = await _register(client, "GUEST", "ws.order.s@example.com")
    related = [await owner.lists(f"Kurtka zimowa {number}") for number in range(12)]
    tied = [await owner.lists("Płaszcz wełniany"), await owner.lists("Płaszcz puchowy")]
    want = await _create_want(client, token, "parka")
    for number, item_id in enumerate(related):
        await _seed_similar(db_session, want["id"], [item_id], score=0.5 + number / 100)
    await _seed_similar(db_session, want["id"], tied, score=0.99)

    with count_queries(engine) as statements:
        cards = await _similar(client, token, want["id"])

    assert len(cards) == 10
    assert [card["id"] for card in cards] == [
        *sorted(str(item_id) for item_id in tied),
        *(str(item_id) for item_id in related[:3:-1]),
    ]
    one = await _create_want(client, token, "kurtka narciarska")
    await _seed_similar(db_session, one["id"], related[:1])
    with count_queries(engine) as one_statements:
        assert len(await _similar(client, token, one["id"])) == 1
    assert len(one_statements) == len(statements)


async def test_listSimilar_foreignUnknownOrWithdrawnWant_returns404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.gone.o@example.com")
    token, _ = await _register(client, "GUEST", "ws.gone.s@example.com")
    stranger, _ = await _register(client, "GUEST", "ws.gone.x@example.com")
    lamp = await owner.lists("Lampka nocna")
    want = await _create_want(client, token, "lampa biurkowa")
    await _seed_similar(db_session, want["id"], [lamp])
    url = f"/api/wants/{want['id']}/similar"

    foreign = await client.get(url, headers=_auth(stranger))
    unknown = await client.get(f"/api/wants/{uuid.uuid4()}/similar", headers=_auth(token))
    await client.post(
        f"/api/wants/{want['id']}/close", json={"outcome": "WITHDRAWN"}, headers=_auth(token)
    )
    withdrawn = await client.get(url, headers=_auth(token))

    for response in (foreign, unknown, withdrawn):
        assert response.status_code == 404, response.text
        assert response.json()["message"] == NOT_FOUND_MESSAGE


async def test_listSimilar_hiddenPrivateItem_leftOut(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.vis.o@example.com")
    token, _ = await _register(client, "GUEST", "ws.vis.s@example.com")
    kept = await owner.lists("Kubek termiczny")
    hidden = await owner.lists("Termos stalowy")
    want = await _create_want(client, token, "bidon")
    await _seed_similar(db_session, want["id"], [kept, hidden])
    changed = await client.put(
        f"/api/item-listing-preferences/{hidden}",
        json={"mode": "GIFT", "visibility": "PRIVATE"},
        headers=_auth(owner.token),
    )
    assert changed.status_code == 200, changed.text

    cards = await _similar(client, token, want["id"])

    assert [card["id"] for card in cards] == [str(kept)]


async def test_listSimilar_similarPairs_changeNeitherMatchCountNorNewMatchCount(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.count.o@example.com")
    token, _ = await _register(client, "GUEST", "ws.count.s@example.com")
    match = await owner.lists("Rower trekkingowy")
    related = [await owner.lists("Hulajnoga"), await owner.lists("Rolki")]
    want = await _create_want(client, token, "rower")
    await seed_want_matches(db_session, want["id"], [match], seen=False)
    await seed_want_matches(db_session, want["id"], related, tier=WantMatchTier.SIMILAR, seen=False)

    assert len(await _similar(client, token, want["id"])) == 2
    single = (await client.get(f"/api/wants/{want['id']}", headers=_auth(token))).json()
    listed = (await client.get("/api/wants", headers=_auth(token))).json()

    assert (single["match_count"], single["new_match_count"]) == (1, 1)
    assert [(row["match_count"], row["new_match_count"]) for row in listed] == [(1, 1)]


async def test_listWants_matchedItemId_excludesWantHoldingTheItemOnlyAsSimilar(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "ws.item.o@example.com")
    token, _ = await _register(client, "GUEST", "ws.item.s@example.com")
    chair = await owner.lists("Krzesło biurowe")
    holding = await _create_want(client, token, "krzesło")
    related_only = await _create_want(client, token, "fotel gamingowy")
    await seed_want_matches(db_session, holding["id"], [chair])
    await _seed_similar(db_session, related_only["id"], [chair])

    found = await client.get(
        "/api/wants", params={"matched_item_id": str(chair)}, headers=_auth(token)
    )

    assert found.status_code == 200, found.text
    assert [want["id"] for want in found.json()] == [holding["id"]]
