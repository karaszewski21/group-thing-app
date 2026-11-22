"""The owner's points reads (R7): `GET /api/points/me` and
`GET /api/points/me/history`, visible only to their owner (R8)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.points.infrastructure.ledger import (
    PointLine,
    emission_account_id,
    lock_accounts,
    post_points,
)
from app.points.models import PointAccount, PointTransactionType
from app.users.models import UserProfile
from tests.conftest import count_queries
from tests.test_points_awards import _gift_confirmed, _setup
from tests.test_term_item_listings import _auth, _register

SUMMARY_KEYS = {"balance", "reputation"}
PAGE_KEYS = {"items", "total", "page", "size"}
ENTRY_KEYS = {
    "id",
    "type",
    "amount",
    "reputation",
    "description",
    "counterparty_name",
    "occurred_at",
}


async def _display_name(db: AsyncSession, party_id: uuid.UUID) -> str:
    return (
        await db.execute(select(UserProfile.display_name).where(UserProfile.party_id == party_id))
    ).scalar_one()


async def _post_awards(
    db: AsyncSession, party_id: uuid.UUID, other_id: uuid.UUID, count: int, start: datetime
) -> None:
    """`count` ATTENDANCE awards of 10 to `party_id`, one EXCHANGE of 5 each
    with `other_id` (the lower party as beneficiary) after them."""
    accounts = await lock_accounts(db, [party_id, other_id])
    emission = await emission_account_id(db)
    for index in range(count):
        await post_points(
            db,
            transaction_type=PointTransactionType.ATTENDANCE,
            source_id=uuid.uuid4(),
            party_id=party_id,
            counterparty_party_id=None,
            cap_month=date(2026, 11, 1),
            description="Krąg testowy",
            occurred_at=start + timedelta(minutes=index),
            entries=[
                PointLine(emission, -10),
                PointLine(accounts[party_id], 10),
            ],
        )
    lower, higher = sorted([party_id, other_id])
    await post_points(
        db,
        transaction_type=PointTransactionType.EXCHANGE,
        source_id=uuid.uuid4(),
        party_id=lower,
        counterparty_party_id=higher,
        cap_month=None,
        description="Lampa ↔ Rower",
        occurred_at=start + timedelta(days=1),
        entries=[
            PointLine(emission, -10),
            PointLine(accounts[party_id], 5),
            PointLine(accounts[other_id], 5),
        ],
    )
    await db.commit()


async def test_getMe_afterConfirmedGift_returnsExactSummaryAndHistoryShapes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    setup = await _setup(client, "me1")
    await _gift_confirmed(client, db_session, setup, "Lampa me1")

    summary = await client.get("/api/points/me", headers=setup.giver.headers)
    assert summary.status_code == 200, summary.text
    assert set(summary.json()) == SUMMARY_KEYS
    value = summary.json()["balance"]
    assert value > 0
    assert summary.json()["reputation"] == value

    history = await client.get("/api/points/me/history", headers=setup.giver.headers)
    assert history.status_code == 200, history.text
    body = history.json()
    assert set(body) == PAGE_KEYS
    assert (body["total"], body["page"], body["size"]) == (1, 1, 20)
    [entry] = body["items"]
    assert set(entry) == ENTRY_KEYS
    assert entry["type"] == "GIVE_FREE"
    assert entry["amount"] == value
    assert entry["reputation"] == value
    assert entry["description"] == "Lampa me1"
    assert entry["counterparty_name"] == await _display_name(db_session, setup.taker.party_id)


async def test_getMe_anyCaller_setsPersonalisedCacheHeadersAndAnonymousIs401(
    client: AsyncClient,
) -> None:
    token, _ = await _register(client, "GUEST", "pm.headers@example.com")

    for path in ("/api/points/me", "/api/points/me/history"):
        response = await client.get(path, headers=_auth(token))
        assert response.status_code == 200, response.text
        assert response.headers["Cache-Control"] == "private, no-store"
        assert response.headers["Vary"] == "Authorization, Cookie"
        assert (await client.get(path)).status_code == 401


async def test_getMe_personWithoutAccount_returnsZerosAndCreatesNoAccount(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, party_id = await _register(client, "GUEST", "pm.empty@example.com")

    summary = await client.get("/api/points/me", headers=_auth(token))
    history = await client.get("/api/points/me/history", headers=_auth(token))

    assert summary.json() == {"balance": 0, "reputation": 0}
    assert history.json() == {"items": [], "total": 0, "page": 1, "size": 20}
    accounts = (
        await db_session.execute(
            select(func.count()).select_from(PointAccount).where(PointAccount.party_id == party_id)
        )
    ).scalar_one()
    assert accounts == 0


async def _history_statements(
    client: AsyncClient, engine: AsyncEngine, token: str
) -> tuple[int, dict[str, object]]:
    with count_queries(engine) as statements:
        response = await client.get("/api/points/me/history?size=50", headers=_auth(token))
    assert response.status_code == 200, response.text
    return len(statements), response.json()


async def test_getMeHistory_twoVersusTwelveEntries_constantQueriesAndViewerRelativeCounterparty(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    start = datetime(2026, 11, 1, 12, 0)
    small_token, small_id = await _register(client, "GUEST", "pm.small@example.com")
    large_token, large_id = await _register(client, "GUEST", "pm.large@example.com")
    await _post_awards(db_session, small_id, large_id, 1, start)
    await _post_awards(db_session, large_id, small_id, 11, start)

    small_count, small_body = await _history_statements(client, engine, small_token)
    large_count, large_body = await _history_statements(client, engine, large_token)

    assert small_count == large_count
    small_items = small_body["items"]
    large_items = large_body["items"]
    assert isinstance(small_items, list) and isinstance(large_items, list)
    # Both EXCHANGE awards plus each party's own ATTENDANCE awards.
    assert (len(small_items), len(large_items)) == (3, 13)
    keys = [(entry["occurred_at"], entry["id"]) for entry in large_items]
    assert keys == sorted(keys, reverse=True)

    small_name = await _display_name(db_session, small_id)
    large_name = await _display_name(db_session, large_id)
    for items, other_name in ((small_items, large_name), (large_items, small_name)):
        exchanges = [entry for entry in items if entry["type"] == "EXCHANGE"]
        assert [entry["counterparty_name"] for entry in exchanges] == [other_name, other_name]
        assert all(entry["amount"] == 5 and entry["reputation"] == 0 for entry in exchanges)
        attendances = [entry for entry in items if entry["type"] == "ATTENDANCE"]
        assert attendances
        assert all(entry["counterparty_name"] is None for entry in attendances)
