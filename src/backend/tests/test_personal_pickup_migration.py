"""Migration `0074_personal_pickup_reservations`. The round-trip test moves the
shared session database to 0073 and always upgrades it back to head, so later
tests see the full schema. The guarded-downgrade test commits an open
no-context reservation to the real database and always deletes it again."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import datetime
from typing import cast

import pytest
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

import app.main  # noqa: F401 - registers every model's table for FK resolution
from app.auth.models import User
from app.category.models import Category
from app.circulation.models import (
    Inventory,
    InventoryItem,
    InventoryType,
    ItemCondition,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.core.base_model import BaseEntity
from app.groups.models import SwapProposal, SwapProposalStatus
from app.product.models import Product
from tests.conftest import BACKEND_ROOT

CONTEXT_CHECK = "ck_reservations_context"


def _alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )


def _id(entity: BaseEntity) -> uuid.UUID:
    return cast(uuid.UUID, entity.id)


async def _check_definition(engine: AsyncEngine) -> str:
    async with engine.connect() as conn:
        return cast(
            str,
            (
                await conn.execute(
                    text(
                        "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = :name"
                    ),
                    {"name": CONTEXT_CHECK},
                )
            ).scalar_one(),
        )


async def _seed_item(db: AsyncSession) -> tuple[list[BaseEntity], uuid.UUID, uuid.UUID]:
    """A user holding one item. Returns `(created rows, user_id, item_id)`."""
    user = User(username=f"pickup-{uuid.uuid4().hex[:12]}", password_hash="x")
    category = Category(name=f"Pickup {uuid.uuid4().hex[:8]}", sort_order=99)
    db.add_all([user, category])
    await db.flush()
    product = Product(name="Rower", sku=f"SKU-{uuid.uuid4().hex[:8]}", category_id=_id(category))
    inventory = Inventory(owner_user_id=_id(user), inventory_type=InventoryType.PERSONAL)
    db.add_all([product, inventory])
    await db.flush()
    item = InventoryItem(
        inventory_id=_id(inventory),
        product_id=_id(product),
        condition=ItemCondition.GOOD,
        added_at=datetime.utcnow(),
    )
    db.add(item)
    await db.flush()
    return [item, inventory, product, category, user], _id(user), _id(item)


def _reservation(
    user_id: uuid.UUID,
    item_id: uuid.UUID,
    status: ReservationStatus,
    reservation_type: ReservationType = ReservationType.GIFT,
    **context: uuid.UUID,
) -> Reservation:
    return Reservation(
        item_id=item_id,
        reservation_type=reservation_type,
        reserved_by_user_id=user_id,
        giver_user_id=user_id,
        reserved_at=datetime.utcnow(),
        status=status,
        **context,
    )


async def _insert_party(db: AsyncSession) -> uuid.UUID:
    party_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
            "VALUES (:id, 'PERSON', true, now(), now())"
        ),
        {"id": party_id},
    )
    return party_id


async def test_downgradeThenUpgrade_0074_roundTrips(engine: AsyncEngine, database_url: str) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0073")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        assert "status" in await _check_definition(engine)
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    definition = await _check_definition(engine)
    assert "num_nonnulls(term_id, event_id) <= 1" in definition
    assert "status" not in definition


async def test_insertOpenReservation_noContext_allowedAfter0074(
    db_session: AsyncSession,
) -> None:
    _, user_id, item_id = await _seed_item(db_session)
    for status in (ReservationStatus.PENDING, ReservationStatus.CONFIRMED):
        db_session.add(_reservation(user_id, item_id, status))

    await db_session.flush()


async def test_insertOpenReservation_bothContexts_violatesContextCheck(
    db_session: AsyncSession,
) -> None:
    _, user_id, item_id = await _seed_item(db_session)
    db_session.add(
        _reservation(
            user_id,
            item_id,
            ReservationStatus.PENDING,
            term_id=uuid.uuid4(),
            event_id=uuid.uuid4(),
        )
    )

    with pytest.raises(IntegrityError, match=CONTEXT_CHECK):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.parametrize("kind", ["pendingProposal", "personalGift"])
async def test_downgrade0074_openNoContextRows_refusesNamingRecovery(
    engine: AsyncEngine, database_url: str, kind: str
) -> None:
    async with AsyncSession(engine, expire_on_commit=False) as db:
        rows, user_id, item_id = await _seed_item(db)
        if kind == "pendingProposal":
            leg = _reservation(user_id, item_id, ReservationStatus.CONFIRMED, ReservationType.SWAP)
            db.add(leg)
            await db.flush()
            proposal = SwapProposal(
                proposer_party_id=await _insert_party(db),
                listing_item_id=uuid.uuid4(),
                offered_item_id=item_id,
                proposer_reservation_id=_id(leg),
                status=SwapProposalStatus.PROPOSED,
            )
            db.add(proposal)
            created: list[BaseEntity] = [proposal, leg]
        else:
            gift = _reservation(user_id, item_id, ReservationStatus.PENDING)
            db.add(gift)
            created = [gift]
        await db.commit()
    try:
        result = _alembic(database_url, "downgrade", "0073")

        assert result.returncode != 0
        assert "POST /api/swap-proposals/{id}/reject" in result.stderr
        assert "POST /api/reservations/{id}/cancel-transaction" in result.stderr
        assert "pre-0074 dump" in result.stderr
        assert "status" not in await _check_definition(engine)
    finally:
        async with AsyncSession(engine) as db:
            for row in [*created, *rows]:
                await db.execute(delete(type(row)).where(type(row).id == row.id))
            await db.commit()
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()


async def test_downgrade0075_openNoContextRows_refusesBeforeDroppingLocation(
    engine: AsyncEngine, database_url: str
) -> None:
    """A downgrade below 0074 must stop in 0075, before the owners' pickup
    places are dropped, while 0074's own guard would refuse anyway."""
    async with AsyncSession(engine, expire_on_commit=False) as db:
        rows, user_id, item_id = await _seed_item(db)
        gift = _reservation(user_id, item_id, ReservationStatus.PENDING)
        db.add(gift)
        await db.commit()
    try:
        result = _alembic(database_url, "downgrade", "0074")

        assert result.returncode != 0
        assert "Cannot downgrade 0075" in result.stderr
        assert "POST /api/reservations/{id}/cancel-transaction" in result.stderr
        async with engine.connect() as conn:
            location_column = (
                await conn.execute(
                    text(
                        "SELECT count(*) FROM information_schema.columns "
                        "WHERE table_name = 'inventories' AND column_name = 'location_id'"
                    )
                )
            ).scalar_one()
        assert location_column == 1
    finally:
        async with AsyncSession(engine) as db:
            for row in [gift, *rows]:
                await db.execute(delete(type(row)).where(type(row).id == row.id))
            await db.commit()
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
