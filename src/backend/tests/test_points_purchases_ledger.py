"""POINTS purchases in `app.points` (R5–R8): `lock_purchase` refusing an
ineligible, family or pair-limited buyer and a short balance, HOLD then
SALE posting the four balanced entries, and SALE and RELEASE excluding each
other while a repeat of either posts nothing."""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import clock
from app.families.models import FamilyMembership, FamilyRole, FamilyRoleType
from app.party.models import Party, PartyType
from app.points import service as points_service
from app.points.application.purchases import (
    FAMILY_MESSAGE,
    INELIGIBLE_MESSAGE,
    PAIR_LIMIT_MESSAGE,
    SETTLED_MESSAGE,
    SHORT_BALANCE_MESSAGE,
    PurchaseConflictException,
)
from app.points.infrastructure.ledger import (
    PointLine,
    account_balance,
    lock_accounts,
    post_points,
    system_account_id,
)
from app.points.models import (
    PointAccountType,
    PointsConfig,
    PointTransaction,
    PointTransactionType,
)
from tests.point_ledger_assertions import assert_point_transactions_balanced, point_row_counts
from tests.test_term_item_listings import _auth, _register

PARTY = PointAccountType.PARTY
HELD = PointAccountType.HELD
EMISSION = PointAccountType.EMISSION
BURN = PointAccountType.BURN


async def _pair(client: AsyncClient, prefix: str) -> tuple[uuid.UUID, uuid.UUID]:
    """`(buyer, seller)` party ids of two registered persons with a login."""
    _, buyer = await _register(client, "GUEST", f"buyer{prefix}@example.com")
    _, seller = await _register(client, "GUEST", f"seller{prefix}@example.com")
    return buyer, seller


async def _grant(db: AsyncSession, party_id: uuid.UUID, amount: int) -> None:
    accounts = await lock_accounts(db, [(party_id, PARTY)])
    await post_points(
        db,
        transaction_type=PointTransactionType.ATTENDANCE,
        source_id=uuid.uuid4(),
        party_id=party_id,
        counterparty_party_id=None,
        cap_month=date(2026, 11, 1),
        description="Krąg",
        occurred_at=datetime.utcnow(),
        entries=[
            PointLine(await system_account_id(db, EMISSION), -amount),
            PointLine(accounts[(party_id, PARTY)], amount),
        ],
    )
    await db.commit()


async def _hold(db: AsyncSession, buyer: uuid.UUID, seller: uuid.UUID, price: int) -> uuid.UUID:
    reservation_id = uuid.uuid4()
    purchase = await points_service.lock_purchase(db, buyer, seller, price)
    await points_service.post_hold(db, purchase, reservation_id, "Rowerek")
    await db.commit()
    return reservation_id


async def _balance(db: AsyncSession, party_id: uuid.UUID, account_type: PointAccountType) -> int:
    accounts = await lock_accounts(db, [(party_id, account_type)])
    return await account_balance(db, accounts[(party_id, account_type)])


async def _sale(db: AsyncSession, reservation_id: uuid.UUID) -> PointTransaction:
    return (
        await db.execute(
            select(PointTransaction)
            .where(
                PointTransaction.transaction_type == PointTransactionType.SALE,
                PointTransaction.source_id == reservation_id,
            )
            .options(selectinload(PointTransaction.entries))
        )
    ).scalar_one()


async def test_lockPurchase_shortBalance_raises409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    buyer, seller = await _pair(client, "short")
    await _grant(db_session, buyer, 10)

    with pytest.raises(PurchaseConflictException) as error:
        await points_service.lock_purchase(db_session, buyer, seller, 20)

    assert str(error.value) == SHORT_BALANCE_MESSAGE


@pytest.mark.parametrize("case", ["family", "organization"])
async def test_lockPurchase_familyPairOrIneligibleBuyer_raises409(
    client: AsyncClient, db_session: AsyncSession, case: str
) -> None:
    token, seller = await _register(client, "GUEST", f"seller-{case}@example.com")
    _, buyer = await _register(client, "GUEST", f"buyer-{case}@example.com")
    await _grant(db_session, buyer, 100)
    if case == "family":
        family = await client.post(
            "/api/families/mine", json={"name": "Rodzina"}, headers=_auth(token)
        )
        assert family.status_code == 201, family.text
        today = clock.local_now().date()
        role = FamilyRole(party_id=buyer, role_type=FamilyRoleType.GUARDIAN, valid_from=today)
        db_session.add(role)
        await db_session.flush()
        db_session.add(
            FamilyMembership(
                from_role_id=role.id, to_family_id=uuid.UUID(family.json()["id"]), valid_from=today
            )
        )
    else:
        await db_session.execute(
            update(Party).where(Party.id == buyer).values(party_type=PartyType.ORGANIZATION)
        )
    await db_session.commit()

    with pytest.raises(PurchaseConflictException) as error:
        await points_service.lock_purchase(db_session, buyer, seller, 20)

    assert str(error.value) == (FAMILY_MESSAGE if case == "family" else INELIGIBLE_MESSAGE)


async def test_lockPurchase_pairLimitWithOpenHold_raises409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    buyer, seller = await _pair(client, "limit")
    await _grant(db_session, buyer, 100)
    await _grant(db_session, seller, 100)
    await db_session.execute(update(PointsConfig).values(pair_reward_limit=1))
    await db_session.commit()
    await _hold(db_session, buyer, seller, 20)

    # The open hold uses the pair's only slot, in either direction.
    with pytest.raises(PurchaseConflictException) as error:
        await points_service.lock_purchase(db_session, seller, buyer, 20)

    assert str(error.value) == PAIR_LIMIT_MESSAGE


async def test_postHold_thenSettleSale_postsFourBalancedEntries(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    buyer, seller = await _pair(client, "sale")
    await _grant(db_session, buyer, 100)
    reservation_id = await _hold(db_session, buyer, seller, 30)
    assert await points_service.hold_amounts(db_session, [reservation_id]) == {reservation_id: 30}
    assert await _balance(db_session, buyer, PARTY) == 70
    assert await _balance(db_session, buyer, HELD) == 30

    await points_service.settle_sale(db_session, reservation_id)
    await db_session.commit()
    counts = await point_row_counts(db_session)
    await points_service.settle_sale(db_session, reservation_id)
    await db_session.commit()

    assert await point_row_counts(db_session) == counts
    sale = await _sale(db_session, reservation_id)
    assert (sale.party_id, sale.counterparty_party_id) == (seller, buyer)
    assert sale.description == "Rowerek"
    burn = await system_account_id(db_session, BURN)
    emission = await system_account_id(db_session, EMISSION)
    held = (await lock_accounts(db_session, [(buyer, HELD)]))[(buyer, HELD)]
    seller_party = (await lock_accounts(db_session, [(seller, PARTY)]))[(seller, PARTY)]
    assert sorted((entry.account_id, entry.amount) for entry in sale.entries) == sorted(
        [(held, -30), (burn, 30), (emission, -30), (seller_party, 30)]
    )
    await assert_point_transactions_balanced(db_session)
    assert await account_balance(db_session, burn) == 30
    assert await _balance(db_session, buyer, HELD) == 0
    assert await _balance(db_session, buyer, PARTY) == 70
    assert await _balance(db_session, seller, PARTY) == 30


async def test_releaseAfterSale_raises409(client: AsyncClient, db_session: AsyncSession) -> None:
    buyer, seller = await _pair(client, "relsale")
    await _grant(db_session, buyer, 100)
    reservation_id = await _hold(db_session, buyer, seller, 20)
    await points_service.settle_sale(db_session, reservation_id)
    await db_session.commit()

    with pytest.raises(PurchaseConflictException) as error:
        await points_service.release_hold(db_session, reservation_id)

    assert str(error.value) == SETTLED_MESSAGE


async def test_saleAfterRelease_raises409(client: AsyncClient, db_session: AsyncSession) -> None:
    buyer, seller = await _pair(client, "salerel")
    await _grant(db_session, buyer, 100)
    reservation_id = await _hold(db_session, buyer, seller, 20)

    await points_service.lock_release_accounts(db_session, [reservation_id])
    await points_service.release_hold(db_session, reservation_id)
    await db_session.commit()
    counts = await point_row_counts(db_session)
    await points_service.release_hold(db_session, reservation_id)
    await db_session.commit()

    assert await point_row_counts(db_session) == counts
    assert await _balance(db_session, buyer, PARTY) == 100
    assert await _balance(db_session, buyer, HELD) == 0
    await assert_point_transactions_balanced(db_session)
    with pytest.raises(PurchaseConflictException) as error:
        await points_service.settle_sale(db_session, reservation_id)
    assert str(error.value) == SETTLED_MESSAGE


async def test_lockPurchase_pairLimitWithSettledSale_countsSaleOnceThenRefuses(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    buyer, seller = await _pair(client, "salelimit")
    await _grant(db_session, buyer, 100)
    await _grant(db_session, seller, 100)
    await db_session.execute(update(PointsConfig).values(pair_reward_limit=2))
    await db_session.commit()
    sold = await _hold(db_session, buyer, seller, 20)
    await points_service.settle_sale(db_session, sold)
    await db_session.commit()

    # The SALE uses one slot and its settled HOLD none, so one slot is left,
    # in either direction.
    await _hold(db_session, seller, buyer, 20)
    with pytest.raises(PurchaseConflictException) as error:
        await points_service.lock_purchase(db_session, buyer, seller, 20)

    assert str(error.value) == PAIR_LIMIT_MESSAGE
