"""`GET /api/reservations/mine`: the items the caller is about to receive —
open GIFT reservations, accepted swap legs and their own pending swap
offers — never an offer made to them on their own listing."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import count_queries
from tests.test_event_item_reservations import (
    EVENT_NAME,
    _create_event,
    _event_ref,
    _listed_items,
    _sign_up,
)
from tests.test_personal_pickup import _owner, _propose, _take
from tests.test_term_item_listings import _auth, _item_link, _register

MINE = "/api/reservations/mine"

ROW_KEYS = {
    "item_id",
    "product_name",
    "thumb_url",
    "item_path",
    "owner_name",
    "mode",
    "status",
    "reservation_id",
    "context_kind",
    "context_name",
    "occurs_at",
    "reserved_at",
}


async def _mine(client: AsyncClient, token: str) -> list[dict[str, object]]:
    response = await client.get(MINE, headers=_auth(token))
    assert response.status_code == 200, response.text
    body: list[dict[str, object]] = response.json()
    return body


async def test_listMyReservations_personalGift_returnsItemWithOwnerAndPath(
    client: AsyncClient,
) -> None:
    owner, item_id = await _owner(client, "mr1")
    taker, _ = await _register(client, "GUEST", "mr1.taker@example.com")
    status, body = await _take(client, item_id, taker)
    assert status == 200, body

    (row,) = await _mine(client, taker)

    assert set(row) == ROW_KEYS
    assert row["item_id"] == str(item_id)
    assert row["product_name"] == "Rowerek mr1"
    assert row["item_path"] == await _item_link(client, owner, item_id)
    assert row["owner_name"]
    assert (row["mode"], row["status"], row["context_kind"]) == ("GIFT", "PENDING", "PERSONAL")
    assert (row["context_name"], row["occurs_at"]) == (None, None)
    assert row["reservation_id"] is not None
    assert await _mine(client, owner) == []


async def test_listMyReservations_pendingSwapOffer_listedForProposerOnly(
    client: AsyncClient,
) -> None:
    owner, listed = await _owner(client, "mr2", "SWAP")
    proposer, _ = await _register(client, "GUEST", "mr2.proposer@example.com")
    (offered,) = await _listed_items(client, proposer, ("Puzzle mr2", "SWAP"))
    status, proposal = await _propose(client, listed, offered, proposer)
    assert status == 200, proposal

    (row,) = await _mine(client, proposer)

    assert (row["item_id"], row["mode"], row["status"]) == (str(listed), "SWAP", "PROPOSED")
    assert row["reservation_id"] is None
    assert row["item_path"] == await _item_link(client, owner, listed)
    assert await _mine(client, owner) == []


async def test_listMyReservations_acceptedSwap_listsEachSidesIncomingItem(
    client: AsyncClient,
) -> None:
    owner, listed = await _owner(client, "mr3", "SWAP")
    proposer, _ = await _register(client, "GUEST", "mr3.proposer@example.com")
    (offered,) = await _listed_items(client, proposer, ("Puzzle mr3", "SWAP"))
    _, proposal = await _propose(client, listed, offered, proposer)
    accept = await client.post(f"/api/swap-proposals/{proposal['id']}/accept", headers=_auth(owner))
    assert accept.status_code == 200, accept.text

    (proposer_row,) = await _mine(client, proposer)
    (owner_row,) = await _mine(client, owner)

    assert (proposer_row["item_id"], proposer_row["status"]) == (str(listed), "CONFIRMED")
    assert (owner_row["item_id"], owner_row["status"]) == (str(offered), "CONFIRMED")
    assert owner_row["product_name"] == "Puzzle mr3"


async def test_listMyReservations_eventTake_carriesEventNameAndDate(
    client: AsyncClient,
) -> None:
    author, _ = await _register(client, "GUEST", "mr4.author@example.com")
    event_id, starts_at = await _create_event(client, author)
    (item_id,) = await _listed_items(client, author, ("Hulajnoga mr4", "GIFT"))
    taker, _ = await _register(client, "GUEST", "mr4.taker@example.com")
    await _sign_up(client, event_id, taker)
    take = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": _event_ref(event_id), "reservation_type": "GIFT"},
        headers=_auth(taker),
    )
    assert take.status_code == 200, take.text

    (row,) = await _mine(client, taker)

    assert (row["context_kind"], row["context_name"]) == ("EVENT", EVENT_NAME)
    assert row["occurs_at"] == starts_at.isoformat()


async def test_listMyReservations_queryCountDoesNotGrowWithRows(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    taker, _ = await _register(client, "GUEST", "mr5.taker@example.com")

    async def _count() -> int:
        with count_queries(engine) as statements:
            await _mine(client, taker)
        return len(statements)

    async def _reserve(prefix: str) -> None:
        _, item_id = await _owner(client, prefix)
        status, body = await _take(client, item_id, taker)
        assert status == 200, body

    await _reserve("mr5a")
    one = await _count()
    await _reserve("mr5b")
    await _reserve("mr5c")

    assert await _count() == one + 2  # one organization lookup per distinct owner


async def test_listMyReservations_anonymous_returns401(client: AsyncClient) -> None:
    response = await client.get(MINE)

    assert response.status_code == 401
