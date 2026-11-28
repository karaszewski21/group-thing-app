"""Featuring a listed item (`PUT /api/item-listing-preferences/{id}/featured`):
the idempotent toggle, the 404 → 403 → draft 409 → limit-0 409 → cap 409
order, the Polish plural in the cap message, PRIVATE listings counting toward
the cap, lowered limits keeping existing marks, the mark living and dying with
the listing row (unlist and every confirmed GIFT, SWAP and POINTS hand-over),
the cap holding under a race and the owner's Party lock never blocking another
user's take or confirm on committed sessions."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.groups.application.term_item_listings import set_item_featured
from app.groups.infrastructure import inventory_bridge
from app.groups.infrastructure.repository import lock_owner_party
from app.groups.models import ItemListingPreference
from app.inventory.models import InventoryItem, Reservation
from app.settings.models import AppSettings
from tests import test_points_awards_contexts
from tests.point_ledger_assertions import point_row_counts
from tests.test_event_item_reservations import _listed_items
from tests.test_personal_pickup import _propose
from tests.test_points_purchase_flow import (
    _committed_purge,
    _grant,
    _pair,
    _points_item,
    _take,
)
from tests.test_term_item_listings import _auth, _principal, _register

committed_client = test_points_awards_contexts.committed_client

DRAFT_MESSAGE = "Wystaw rzecz, aby ją wyróżnić."
DISABLED_MESSAGE = "Wyróżnianie rzeczy jest teraz wyłączone."


async def _feature(
    client: AsyncClient, token: str, item_id: uuid.UUID, featured: object = True
) -> Response:
    return await client.put(
        f"/api/item-listing-preferences/{item_id}/featured",
        json={"featured": featured},
        headers=_auth(token),
    )


async def _set_limit(db: AsyncSession, limit: int) -> None:
    await db.execute(update(AppSettings).values(max_featured_items=limit))


async def _featured_at(db: AsyncSession, item_id: uuid.UUID) -> datetime | None:
    return (
        await db.execute(
            select(ItemListingPreference.featured_at)
            .where(ItemListingPreference.item_id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _owner_with_items(
    client: AsyncClient, prefix: str, count: int, mode: str = "GIFT"
) -> tuple[str, list[uuid.UUID]]:
    token, _ = await _register(client, "GUEST", f"{prefix}.owner@example.com")
    items = await _listed_items(
        client, token, *((f"Wyróżniony {prefix} {n}", mode) for n in range(count))
    )
    return token, items


async def test_setItemFeatured_featureUnfeatureRefeature_keepsFeaturedAt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, (item_id, other_id) = await _owner_with_items(client, "feat1", 2)

    featured = await _feature(client, token, item_id)
    stored = await _featured_at(db_session, item_id)
    await _set_limit(db_session, 1)
    again = await _feature(client, token, item_id)

    assert featured.status_code == 200, featured.text
    assert featured.json()["is_featured"] is True
    assert "featured_at" not in featured.json()
    assert stored is not None
    assert again.status_code == 200, again.text
    assert again.json()["is_featured"] is True
    assert await _featured_at(db_session, item_id) == stored

    unfeatured = await _feature(client, token, item_id, False)
    noop = await _feature(client, token, other_id, False)

    assert unfeatured.status_code == 200, unfeatured.text
    assert unfeatured.json()["is_featured"] is False
    assert await _featured_at(db_session, item_id) is None
    assert noop.status_code == 200, noop.text
    assert noop.json()["is_featured"] is False


async def test_setItemFeatured_draft_conflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, (item_id,) = await _owner_with_items(client, "feat2", 1)
    unlisted = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": None}, headers=_auth(token)
    )
    assert unlisted.status_code == 200, unlisted.text

    response = await _feature(client, token, item_id)

    assert response.status_code == 409, response.text
    assert response.json()["message"] == DRAFT_MESSAGE


async def test_setItemFeatured_notOwnerOrHidden_notFoundBeforeForbidden(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, (public_id, private_id) = await _owner_with_items(client, "feat3", 2)
    private = await client.put(
        f"/api/item-listing-preferences/{private_id}",
        json={"mode": "GIFT", "visibility": "PRIVATE"},
        headers=_auth(owner),
    )
    assert private.status_code == 200, private.text
    stranger, _ = await _register(client, "GUEST", "feat3.stranger@example.com")

    foreign = await _feature(client, stranger, public_id)
    missing = await _feature(client, stranger, uuid.uuid4())
    hidden = await _feature(client, stranger, private_id)

    assert foreign.status_code == 403, foreign.text
    assert missing.status_code == 404, missing.text
    assert hidden.status_code == 404, hidden.text
    assert await _featured_at(db_session, public_id) is None


@pytest.mark.parametrize(
    "body",
    [{"featured": 1}, {"featured": "true"}, {"featured": {}}, {}, {"featured": True, "x": 1}],
)
async def test_setItemFeatured_nonBoolean_badRequest(
    client: AsyncClient, db_session: AsyncSession, body: dict[str, object]
) -> None:
    token, (item_id,) = await _owner_with_items(client, "feat4", 1)

    response = await client.put(
        f"/api/item-listing-preferences/{item_id}/featured", json=body, headers=_auth(token)
    )

    assert response.status_code == 400, response.text
    assert await _featured_at(db_session, item_id) is None


@pytest.mark.parametrize(
    ("limit", "message"),
    [(3, "Możesz wyróżnić maksymalnie 3 rzeczy."), (1, "Możesz wyróżnić maksymalnie 1 rzecz.")],
)
async def test_setItemFeatured_capReached_conflictWithPluralN(
    client: AsyncClient, db_session: AsyncSession, limit: int, message: str
) -> None:
    token, items = await _owner_with_items(client, f"feat5.{limit}", limit + 1)
    # A PRIVATE listing counts toward the cap like a PUBLIC one.
    private = await client.put(
        f"/api/item-listing-preferences/{items[0]}",
        json={"mode": "GIFT", "visibility": "PRIVATE"},
        headers=_auth(token),
    )
    assert private.status_code == 200, private.text
    await _set_limit(db_session, limit)
    for item_id in items[:limit]:
        featured = await _feature(client, token, item_id)
        assert featured.status_code == 200, featured.text

    over = await _feature(client, token, items[limit])

    assert over.status_code == 409, over.text
    assert over.json()["message"] == message
    assert await _featured_at(db_session, items[limit]) is None


async def test_setItemFeatured_limitZero_disabledButUnfeatureAllowed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, (featured_id, other_id) = await _owner_with_items(client, "feat6", 2)
    assert (await _feature(client, token, featured_id)).status_code == 200
    await _set_limit(db_session, 0)

    refused = await _feature(client, token, other_id)
    unfeatured = await _feature(client, token, featured_id, False)

    assert refused.status_code == 409, refused.text
    assert refused.json()["message"] == DISABLED_MESSAGE
    assert unfeatured.status_code == 200, unfeatured.text
    assert unfeatured.json()["is_featured"] is False


async def test_setItemFeatured_limitLowered_keepsExistingMarks(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, items = await _owner_with_items(client, "feat7", 4)
    for item_id in items[:3]:
        assert (await _feature(client, token, item_id)).status_code == 200
    await _set_limit(db_session, 1)

    refused = await _feature(client, token, items[3])
    kept = await _feature(client, token, items[0])

    assert refused.status_code == 409, refused.text
    assert refused.json()["message"] == "Możesz wyróżnić maksymalnie 1 rzecz."
    assert kept.status_code == 200, kept.text
    assert [await _featured_at(db_session, i) is not None for i in items] == [
        True,
        True,
        True,
        False,
    ]


async def test_setItemFeatured_unlistOrHandOver_clearsMark(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, (relisted_id, edited_id, given_id) = await _owner_with_items(client, "feat8", 3)
    for item_id in (relisted_id, edited_id, given_id):
        assert (await _feature(client, token, item_id)).status_code == 200

    async def put(item_id: uuid.UUID, body: dict[str, object]) -> Response:
        response = await client.put(
            f"/api/item-listing-preferences/{item_id}", json=body, headers=_auth(token)
        )
        assert response.status_code == 200, response.text
        return response

    await put(relisted_id, {"mode": None})
    relisted = await put(relisted_id, {"mode": "GIFT"})
    await put(edited_id, {"mode": "SWAP"})
    edited = await put(edited_id, {"mode": "SWAP", "visibility": "PRIVATE"})

    assert relisted.json()["is_featured"] is False
    assert edited.json()["is_featured"] is True

    taker, _ = await _register(client, "GUEST", "feat8.taker@example.com")
    taken = await client.post(
        f"/api/items/{given_id}/take",
        json={"context": {"kind": "PERSONAL"}, "reservation_type": "GIFT"},
        headers=_auth(taker),
    )
    assert taken.status_code == 200, taken.text
    reservation_id = (
        await db_session.execute(select(Reservation.id).where(Reservation.item_id == given_id))
    ).scalar_one()
    confirmed = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction", headers=_auth(taker)
    )

    assert confirmed.status_code == 200, confirmed.text
    preference = (
        await db_session.execute(
            select(ItemListingPreference.id).where(ItemListingPreference.item_id == given_id)
        )
    ).scalar_one_or_none()
    assert preference is None


async def test_setItemFeatured_concurrentAtCap_onlyOneSucceeds(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A second session on the test connection features another item of the
    same owner after this call took the owner's Party lock and before it
    counts, so the count under the lock sees the winner and refuses."""
    token, (first_id, second_id) = await _owner_with_items(client, "feat9", 2)
    await _set_limit(db_session, 1)
    real_lock: Callable[[AsyncSession, uuid.UUID], Awaitable[InventoryItem]] = (
        inventory_bridge.get_item_for_update
    )
    raced: list[bool] = []

    async def feature_other_then_lock(db: AsyncSession, locked_id: uuid.UUID) -> InventoryItem:
        if not raced:
            raced.append(True)
            async with AsyncSession(
                bind=db_session.bind, join_transaction_mode="create_savepoint"
            ) as other:
                winner = await set_item_featured(other, _principal(token), second_id, True)
                assert winner.is_featured
        return await real_lock(db, locked_id)

    monkeypatch.setattr(inventory_bridge, "get_item_for_update", feature_other_then_lock)

    loser = await _feature(client, token, first_id)

    assert loser.status_code == 409, loser.text
    assert loser.json()["message"] == "Możesz wyróżnić maksymalnie 1 rzecz."
    assert await _featured_at(db_session, first_id) is None
    assert await _featured_at(db_session, second_id) is not None


async def _preference_exists(db: AsyncSession, item_id: uuid.UUID) -> bool:
    return (
        await db.execute(
            select(ItemListingPreference.id).where(ItemListingPreference.item_id == item_id)
        )
    ).scalar_one_or_none() is not None


async def test_setItemFeatured_confirmedSwap_clearsBothMarks(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, (listed,) = await _owner_with_items(client, "feat10", 1, "SWAP")
    proposer, (offered,) = await _owner_with_items(client, "feat10.p", 1, "SWAP")
    assert (await _feature(client, owner, listed)).status_code == 200
    assert (await _feature(client, proposer, offered)).status_code == 200
    status, proposal = await _propose(client, listed, offered, proposer)
    assert status == 200, proposal
    accepted = await client.post(
        f"/api/swap-proposals/{proposal['id']}/accept", headers=_auth(owner)
    )
    assert accepted.status_code == 200, accepted.text
    # Accepting keeps the listings (and marks) until the hand-over is confirmed.
    assert await _featured_at(db_session, listed) is not None

    confirmed = await client.post(
        f"/api/reservations/{proposal['proposer_reservation_id']}/confirm-transaction",
        headers=_auth(proposer),
    )

    assert confirmed.status_code == 200, confirmed.text
    assert not await _preference_exists(db_session, listed)
    assert not await _preference_exists(db_session, offered)


async def test_setItemFeatured_confirmedPointsSale_clearsMark(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    seller, buyer = await _pair(client, "feat11")
    await _grant(db_session, buyer.party_id, 100)
    item_id, price = await _points_item(client, db_session, seller, "Rowerek feat11")
    featured = await _feature(client, seller.token, item_id)
    assert featured.status_code == 200, featured.text
    taken = await _take(client, buyer.headers, item_id, price)
    assert taken.status_code == 200, taken.text
    reservation_id = (
        await db_session.execute(select(Reservation.id).where(Reservation.item_id == item_id))
    ).scalar_one()

    confirmed = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction", headers=buyer.headers
    )

    assert confirmed.status_code == 200, confirmed.text
    assert not await _preference_exists(db_session, item_id)


async def test_setItemFeatured_ownerPartyLockHeld_takeAndConfirmDoNotWaitTogglesDo(
    committed_client: AsyncClient, engine: AsyncEngine
) -> None:
    """Real connections: one holds the owner's Party lock exactly as a toggle
    does mid-transaction, while another user takes and confirms that owner's
    item. Their FK checks on the Party row (the owner's notification, the
    owner's point account) take FOR KEY SHARE, which FOR NO KEY UPDATE never
    blocks; a second toggle of the same owner does wait for the lock."""
    client = committed_client
    suffix = uuid.uuid4().hex[:10]
    parties: list[uuid.UUID] = []
    try:
        owner, owner_party = await _register(client, "GUEST", f"feat.lock.o.{suffix}@example.com")
        parties.append(owner_party)
        taker, taker_party = await _register(client, "GUEST", f"feat.lock.t.{suffix}@example.com")
        parties.append(taker_party)
        given_id, other_id = await _listed_items(
            client,
            owner,
            (f"Sanki feat.lock {suffix}", "GIFT"),
            (f"Narty feat.lock {suffix}", "GIFT"),
        )

        async with engine.connect() as connection, AsyncSession(bind=connection) as holder:
            await lock_owner_party(holder, owner_party)

            taken = await asyncio.wait_for(
                client.post(
                    f"/api/items/{given_id}/take",
                    json={"context": {"kind": "PERSONAL"}, "reservation_type": "GIFT"},
                    headers=_auth(taker),
                ),
                timeout=10,
            )
            assert taken.status_code == 200, taken.text
            async with AsyncSession(engine) as db:
                reservation_id = (
                    await db.execute(select(Reservation.id).where(Reservation.item_id == given_id))
                ).scalar_one()
            confirmed = await asyncio.wait_for(
                client.post(
                    f"/api/reservations/{reservation_id}/confirm-transaction",
                    headers=_auth(taker),
                ),
                timeout=10,
            )
            assert confirmed.status_code == 200, confirmed.text

            toggle = asyncio.create_task(_feature(client, owner, other_id))
            await asyncio.sleep(0.5)
            assert not toggle.done()
            await holder.rollback()

        featured = await asyncio.wait_for(toggle, timeout=10)
        assert featured.status_code == 200, featured.text
        assert featured.json()["is_featured"] is True
    finally:
        await _committed_purge(engine, parties)
        async with AsyncSession(engine) as db:
            assert await point_row_counts(db) == (0, 0)
