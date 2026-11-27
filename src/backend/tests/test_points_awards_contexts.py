"""Exchange awards on the confirm path outside the term context (event and
personal pickup), a fulfil that fails after the award, and two parallel
confirms of one gift on committed sessions."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncGenerator, Callable, Sequence
from datetime import datetime
from typing import Any, cast

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
)

from app.groups.infrastructure import points_acl
from app.inventory.models import InventoryItem, Reservation, ReservationStatus
from app.points.infrastructure.ledger import system_account_id
from app.points.models import PointAccount, PointAccountType, PointTransactionType
from tests.point_ledger_assertions import (
    assert_point_transactions_balanced,
    point_row_counts,
    transactions_for_party,
)
from tests.test_event_item_reservations import _create_event, _listed_items, _sign_up
from tests.test_term_item_listings import _auth, _register

PERSONAL = {"kind": "PERSONAL"}


async def _take(
    client: AsyncClient, item_id: uuid.UUID, token: str, context: dict[str, str]
) -> None:
    response = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": context, "reservation_type": "GIFT"},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text


async def _reservation(db: AsyncSession, item_id: uuid.UUID) -> Reservation:
    return (
        await db.execute(
            select(Reservation)
            .where(Reservation.item_id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _confirm(client: AsyncClient, token: str, reservation_id: object) -> Any:
    return await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction", headers=_auth(token)
    )


@pytest.mark.parametrize("context", ["EVENT", "PERSONAL"])
async def test_confirmGift_eventAndPersonalContexts_postsGiveFreeAsInTermContext(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
    context: str,
) -> None:
    prefix = f"pac.{context.lower()}"
    giver, giver_party = await _register(client, "GUEST", f"{prefix}.giver@example.com")
    taker, taker_party = await _register(client, "GUEST", f"{prefix}.taker@example.com")
    name = f"Rowerek {prefix}"
    (item_id,) = await _listed_items(client, giver, (name, "GIFT"))
    if context == "EVENT":
        author, _ = await _register(client, "GUEST", f"{prefix}.author@example.com")
        event_id, starts_at = await _create_event(client, author)
        for token in (giver, taker):
            await _sign_up(client, event_id, token)
        await _take(client, item_id, taker, {"kind": "EVENT", "id": str(event_id)})
        freeze_local_now(starts_at)
    else:
        await _take(client, item_id, taker, PERSONAL)
    reservation = await _reservation(db_session, item_id)

    response = await _confirm(client, taker, reservation.id)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "FULFILLED"
    value = (
        await db_session.execute(
            select(InventoryItem.points_value).where(InventoryItem.id == item_id)
        )
    ).scalar_one()
    assert value is not None
    giver_account = (
        await db_session.execute(
            select(PointAccount.id).where(
                PointAccount.party_id == giver_party,
                PointAccount.account_type == PointAccountType.PARTY,
            )
        )
    ).scalar_one()
    (gift,) = await transactions_for_party(db_session, giver_party)
    assert gift.transaction_type == PointTransactionType.GIVE_FREE
    assert (gift.source_id, gift.party_id, gift.counterparty_party_id, gift.description) == (
        cast(uuid.UUID, reservation.id),
        giver_party,
        taker_party,
        name,
    )
    assert sorted((e.account_id, e.amount) for e in gift.entries) == sorted(
        [
            (await system_account_id(db_session, PointAccountType.EMISSION), -value),
            (giver_account, value),
        ]
    )
    assert await transactions_for_party(db_session, taker_party) == []
    await assert_point_transactions_balanced(db_session)


async def test_confirmGift_fulfilFailsAfterAward_returns409AndLeavesNoPointRows(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    giver, _ = await _register(client, "GUEST", "pac.stale.giver@example.com")
    taker, _ = await _register(client, "GUEST", "pac.stale.taker@example.com")
    (item_id,) = await _listed_items(client, giver, ("Hulajnoga pac.stale", "GIFT"))
    await _take(client, item_id, taker, PERSONAL)
    reservation = await _reservation(db_session, item_id)
    award_exchange = points_acl.award_exchange

    async def award_then_cancel_concurrently(
        db: AsyncSession, reservations: Sequence[Reservation]
    ) -> None:
        # The award is flushed; then the giver cancels behind the confirm's
        # back, so fulfil's versioned update of the reservation finds nothing.
        await award_exchange(db, reservations)
        assert await point_row_counts(db) == (1, 2)
        await db.execute(
            update(Reservation)
            .where(Reservation.id == reservation.id)
            .values(status=ReservationStatus.CANCELLED, updated_at=datetime.utcnow())
            .execution_options(synchronize_session=False)
        )

    monkeypatch.setattr(points_acl, "award_exchange", award_then_cancel_concurrently)

    response = await _confirm(client, taker, reservation.id)

    assert response.status_code == 409, response.text
    # The request's session ends without a commit, as `get_db` closes it.
    await db_session.rollback()
    assert await point_row_counts(db_session) == (0, 0)
    assert (await _reservation(db_session, item_id)).status == ReservationStatus.PENDING


@pytest.fixture
async def committed_client(engine: AsyncEngine) -> AsyncGenerator[AsyncClient, None]:
    """Every request on its own session that really commits, as in
    production, so two requests can race on separate connections."""
    from app.db import get_db
    from app.main import app

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _committing_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _committing_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_db, None)


_INVENTORIES = "SELECT id FROM inventories WHERE owner_user_id = ANY(:users)"
_ITEMS = (
    f"SELECT id FROM inventory_items WHERE owner_inventory_id IN ({_INVENTORIES}) "
    f"OR inventory_id IN ({_INVENTORIES})"
)
_PURGE = (
    "DELETE FROM point_entries WHERE transaction_id IN "
    "(SELECT id FROM point_transactions WHERE party_id = ANY(:parties))",
    "DELETE FROM point_transactions WHERE party_id = ANY(:parties)",
    "DELETE FROM point_accounts WHERE party_id = ANY(:parties) AND account_type <> 'EMISSION'",
    "DELETE FROM notifications WHERE party_id = ANY(:parties)",
    "DELETE FROM inventory_entries WHERE transaction_id = ANY(:inventory_transactions)",
    "DELETE FROM inventory_transactions WHERE id = ANY(:inventory_transactions)",
    f"DELETE FROM reservations WHERE item_id IN ({_ITEMS})",
    f"DELETE FROM inventory_balances WHERE item_id IN ({_ITEMS})",
    f"DELETE FROM inventory_items WHERE id IN ({_ITEMS})",
    "DELETE FROM products WHERE id = ANY(:products)",
    "DELETE FROM locations WHERE owner_party_id = ANY(:parties)",
    f"DELETE FROM accounts WHERE inventory_id IN ({_INVENTORIES})",
    "DELETE FROM inventories WHERE owner_user_id = ANY(:users)",
    "DELETE FROM family_memberships WHERE from_role_id IN "
    "(SELECT id FROM family_roles WHERE party_id = ANY(:parties))",
    "DELETE FROM family_roles WHERE party_id = ANY(:parties)",
    "DELETE FROM families WHERE party_id = ANY(:family_parties)",
    "DELETE FROM user_profiles WHERE party_id = ANY(:parties)",
    "DELETE FROM user_roles WHERE party_id = ANY(:parties)",
    "DELETE FROM user_permissions WHERE user_id = ANY(:users)",
    "DELETE FROM users WHERE id = ANY(:users)",
    "DELETE FROM parties WHERE id = ANY(:parties) OR id = ANY(:family_parties)",
)


async def _purge(engine: AsyncEngine, parties: list[uuid.UUID]) -> None:
    """Deletes everything the committed race test wrote: its point rows
    first (a posted transaction makes the 0105 downgrade refuse), then the
    exchange, the items and the two registered people with their families."""

    async def ids(conn: AsyncConnection, query: str, params: dict[str, Any]) -> list[uuid.UUID]:
        return list((await conn.execute(text(query), params)).scalars())

    async with engine.begin() as conn:
        users = await ids(
            conn,
            "SELECT account_user_id FROM user_profiles WHERE party_id = ANY(:parties)",
            {"parties": parties},
        )
        params: dict[str, Any] = {"parties": parties, "users": users}
        params["inventory_transactions"] = await ids(
            conn,
            f"SELECT transaction_id FROM inventory_entries WHERE item_id IN ({_ITEMS})",
            params,
        )
        params["products"] = await ids(
            conn, f"SELECT product_id FROM inventory_items WHERE id IN ({_ITEMS})", params
        )
        params["family_parties"] = await ids(
            conn,
            "SELECT f.party_id FROM families f JOIN family_memberships m "
            "ON m.to_family_id = f.id JOIN family_roles r ON r.id = m.from_role_id "
            "WHERE r.party_id = ANY(:parties)",
            params,
        )
        for statement in _PURGE:
            await conn.execute(text(statement), params)


async def test_confirmGift_parallelConfirmsOnCommittedSessions_postsExactlyOneAward(
    committed_client: AsyncClient, engine: AsyncEngine
) -> None:
    client = committed_client
    suffix = uuid.uuid4().hex[:10]
    parties: list[uuid.UUID] = []
    try:
        giver, giver_party = await _register(
            client, "GUEST", f"pac.race.giver.{suffix}@example.com"
        )
        parties.append(giver_party)
        taker, taker_party = await _register(
            client, "GUEST", f"pac.race.taker.{suffix}@example.com"
        )
        parties.append(taker_party)
        (item_id,) = await _listed_items(client, giver, (f"Sanki pac.race {suffix}", "GIFT"))
        await _take(client, item_id, taker, PERSONAL)
        async with AsyncSession(engine) as db:
            reservation_id = cast(uuid.UUID, (await _reservation(db, item_id)).id)

        responses = await asyncio.gather(
            _confirm(client, taker, reservation_id), _confirm(client, taker, reservation_id)
        )

        assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
        async with AsyncSession(engine) as db:
            (gift,) = await transactions_for_party(db, giver_party)
            assert (gift.transaction_type, gift.source_id) == (
                PointTransactionType.GIVE_FREE,
                reservation_id,
            )
            assert await transactions_for_party(db, taker_party) == []
            assert (await _reservation(db, item_id)).status == ReservationStatus.FULFILLED
    finally:
        await _purge(engine, parties)
        async with AsyncSession(engine) as db:
            assert await point_row_counts(db) == (0, 0)
