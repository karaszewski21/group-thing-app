"""`inventory.service.cancel_reservations_without_commit`, the holder-side
bulk cancel used by event deletion, and the at-most-one-context rule of
`create_reservation`."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import cast

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.main  # noqa: F401 - registers every model's table for FK resolution
from app.auth.models import User
from app.category.models import Category
from app.core.base_model import BaseEntity
from app.inventory import service as inventory_service
from app.inventory.models import (
    BalanceStatus,
    InventoryBalance,
    InventoryItem,
    ItemCondition,
    Reservation,
    ReservationType,
)
from app.product.models import Product


def _id(entity: BaseEntity) -> uuid.UUID:
    return cast(uuid.UUID, entity.id)


async def _create_user(db: AsyncSession) -> uuid.UUID:
    user = User(username=f"bulk-{uuid.uuid4().hex[:12]}", password_hash="x")
    db.add(user)
    await db.flush()
    return _id(user)


async def _create_available_item(db: AsyncSession, owner_user_id: uuid.UUID) -> uuid.UUID:
    category = Category(name=f"Bulk {uuid.uuid4().hex[:8]}", sort_order=99)
    db.add(category)
    await db.flush()
    product = Product(
        name="Hulajnoga", sku=f"SKU-{uuid.uuid4().hex[:8]}", category_id=_id(category)
    )
    db.add(product)
    await db.flush()
    inventory = await inventory_service.get_or_create_personal_inventory(db, owner_user_id)
    item = InventoryItem(
        inventory_id=_id(inventory),
        product_id=_id(product),
        condition=ItemCondition.GOOD,
        added_at=datetime.utcnow(),
    )
    db.add(item)
    await db.flush()
    db.add(InventoryBalance(item_id=_id(item), status=BalanceStatus.AVAILABLE))
    await db.flush()
    return _id(item)


async def _create_event(db: AsyncSession) -> uuid.UUID:
    party_id = uuid.uuid4()
    event_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
            "VALUES (:id, 'PERSON', true, now(), now())"
        ),
        {"id": party_id},
    )
    await db.execute(
        text(
            "INSERT INTO events (id, author_party_id, name, starts_at, created_at, updated_at) "
            "VALUES (:id, :party_id, 'Wymiana książek', now(), now(), now())"
        ),
        {"id": event_id, "party_id": party_id},
    )
    return event_id


async def _reserve_for_event(
    db: AsyncSession, item_id: uuid.UUID, taker_user_id: uuid.UUID, event_id: uuid.UUID
) -> uuid.UUID:
    reservation = await inventory_service.create_reservation(
        db,
        item_id=item_id,
        reservation_type=ReservationType.GIFT,
        reserved_by_user_id=taker_user_id,
        event_id=event_id,
    )
    return _id(reservation)


async def _state(db: AsyncSession, reservation_id: uuid.UUID) -> tuple[str, str]:
    """`(reservation status, item balance status)` read fresh from the DB."""
    row = (
        await db.execute(
            select(Reservation.status, InventoryBalance.status)
            .join(InventoryBalance, InventoryBalance.item_id == Reservation.item_id)
            .where(Reservation.id == reservation_id)
            .execution_options(populate_existing=True)
        )
    ).one()
    return row[0].value, row[1].value


async def test_cancelReservationsWithoutCommit_openAndTerminal_cancelsOpenSkipsTerminal(
    db_session: AsyncSession,
) -> None:
    holder = await _create_user(db_session)
    taker = await _create_user(db_session)
    event_id = await _create_event(db_session)
    open_id = await _reserve_for_event(
        db_session, await _create_available_item(db_session, holder), taker, event_id
    )
    done_id = await _reserve_for_event(
        db_session, await _create_available_item(db_session, holder), taker, event_id
    )
    await inventory_service.cancel_reservation(db_session, done_id, holder)

    cancelled = await inventory_service.cancel_reservations_without_commit(
        db_session, [open_id, done_id]
    )

    assert [_id(reservation) for reservation in cancelled] == [open_id]
    assert await _state(db_session, open_id) == ("CANCELLED", "AVAILABLE")
    assert await _state(db_session, done_id) == ("CANCELLED", "AVAILABLE")


async def test_cancelReservationsWithoutCommit_sessionRolledBack_restoresPendingRows(
    db_session: AsyncSession,
) -> None:
    holder = await _create_user(db_session)
    taker = await _create_user(db_session)
    event_id = await _create_event(db_session)
    reservation_id = await _reserve_for_event(
        db_session, await _create_available_item(db_session, holder), taker, event_id
    )

    await inventory_service.cancel_reservations_without_commit(db_session, [reservation_id])
    assert await _state(db_session, reservation_id) == ("CANCELLED", "AVAILABLE")
    await db_session.rollback()

    assert await _state(db_session, reservation_id) == ("PENDING", "RESERVED")


async def test_createReservation_bothContexts_raisesValueError(
    db_session: AsyncSession,
) -> None:
    holder = await _create_user(db_session)
    item_id = await _create_available_item(db_session, holder)

    with pytest.raises(ValueError, match="not both"):
        await inventory_service.create_reservation(
            db_session,
            item_id=item_id,
            reservation_type=ReservationType.GIFT,
            reserved_by_user_id=await _create_user(db_session),
            term_id=uuid.uuid4(),
            event_id=uuid.uuid4(),
        )


async def test_createReservation_noContext_createsPendingPersonalReservation(
    db_session: AsyncSession,
) -> None:
    holder = await _create_user(db_session)
    item_id = await _create_available_item(db_session, holder)

    reservation = await inventory_service.create_reservation(
        db_session,
        item_id=item_id,
        reservation_type=ReservationType.GIFT,
        reserved_by_user_id=await _create_user(db_session),
        commit=False,
    )

    assert (reservation.term_id, reservation.event_id) == (None, None)
    assert await _state(db_session, _id(reservation)) == ("PENDING", "RESERVED")
