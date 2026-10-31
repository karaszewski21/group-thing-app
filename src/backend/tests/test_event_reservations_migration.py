"""Migration `0073_event_reservations`. The round-trip test moves the shared
session database to 0072 and always upgrades it back to head, so later tests
see the full schema. The guarded-downgrade test commits a context-less row to
the real database and always deletes it again."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import datetime
from typing import Any, cast

import pytest
from sqlalchemy import delete, inspect, select, text
from sqlalchemy.engine import Connection
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
from app.product.models import Product
from tests.conftest import BACKEND_ROOT

EVENT_FK = "fk_reservations_event_id_events"
EVENT_INDEX = "ix_reservations_event_id"
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


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        "columns": {col["name"]: col for col in inspector.get_columns("reservations")},
        "indexes": {index["name"]: index for index in inspector.get_indexes("reservations")},
        "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("reservations")},
        "checks": {ck["name"] for ck in inspector.get_check_constraints("reservations")},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


def _id(entity: BaseEntity) -> uuid.UUID:
    return cast(uuid.UUID, entity.id)


async def _seed_item(db: AsyncSession) -> tuple[list[BaseEntity], uuid.UUID, uuid.UUID]:
    """A user holding one item. Returns `(created rows, user_id, item_id)`."""
    user = User(username=f"evres-{uuid.uuid4().hex[:12]}", password_hash="x")
    category = Category(name=f"Evres {uuid.uuid4().hex[:8]}", sort_order=99)
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


async def _insert_event(db: AsyncSession) -> uuid.UUID:
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
            "VALUES (:id, :party_id, 'Wymiana zabawek', now(), now(), now())"
        ),
        {"id": event_id, "party_id": party_id},
    )
    return event_id


def _reservation(
    user_id: uuid.UUID,
    item_id: uuid.UUID,
    status: ReservationStatus,
    *,
    term_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
) -> Reservation:
    return Reservation(
        item_id=item_id,
        reservation_type=ReservationType.GIFT,
        reserved_by_user_id=user_id,
        giver_user_id=user_id,
        term_id=term_id,
        event_id=event_id,
        reserved_at=datetime.utcnow(),
        status=status,
    )


async def test_downgradeTo0072ThenUpgradeHead_succeeds(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0072")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        schema = await _read_schema(engine)
        assert "event_id" not in schema["columns"]
        assert schema["columns"]["term_id"]["nullable"] is False
        assert EVENT_FK not in schema["fks"]
        assert EVENT_INDEX not in schema["indexes"]
        assert CONTEXT_CHECK not in schema["checks"]
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    schema = await _read_schema(engine)
    assert schema["columns"]["term_id"]["nullable"] is True
    assert schema["columns"]["event_id"]["nullable"] is True
    fk = schema["fks"][EVENT_FK]
    assert fk["constrained_columns"] == ["event_id"]
    assert fk["referred_table"] == "events"
    assert fk["options"].get("ondelete") == "SET NULL"
    index = schema["indexes"][EVENT_INDEX]
    assert index["column_names"] == ["event_id"]
    assert "event_id IS NOT NULL" in index["dialect_options"]["postgresql_where"]
    assert CONTEXT_CHECK in schema["checks"]


async def test_downgradeTo0072_contextlessReservationExists_refusesWithRecoveryPath(
    engine: AsyncEngine, database_url: str
) -> None:
    async with AsyncSession(engine, expire_on_commit=False) as db:
        rows, user_id, item_id = await _seed_item(db)
        reservation = _reservation(user_id, item_id, ReservationStatus.CANCELLED)
        db.add(reservation)
        await db.commit()
    try:
        result = _alembic(database_url, "downgrade", "0072")

        assert result.returncode != 0
        assert "term_id IS NULL" in result.stderr
        assert "pre-0073 backup" in result.stderr
        schema = await _read_schema(engine)
        assert "event_id" in schema["columns"]
    finally:
        async with AsyncSession(engine) as db:
            await db.execute(delete(Reservation).where(Reservation.id == reservation.id))
            for row in rows:
                await db.execute(delete(type(row)).where(type(row).id == row.id))
            await db.commit()
        await engine.dispose()


@pytest.mark.parametrize(
    "context",
    [{}, {"term_id": uuid.uuid4(), "event_id": uuid.uuid4()}],
    ids=["noContext", "bothContexts"],
)
async def test_insertOpenReservation_invalidContext_violatesContextCheck(
    db_session: AsyncSession, context: dict[str, uuid.UUID]
) -> None:
    _, user_id, item_id = await _seed_item(db_session)
    db_session.add(_reservation(user_id, item_id, ReservationStatus.PENDING, **context))

    with pytest.raises(IntegrityError, match=CONTEXT_CHECK):
        await db_session.flush()
    await db_session.rollback()


async def test_deleteEvent_terminalReservations_detachesEventId(
    db_session: AsyncSession,
) -> None:
    _, user_id, item_id = await _seed_item(db_session)
    event_id = await _insert_event(db_session)
    cancelled = _reservation(user_id, item_id, ReservationStatus.CANCELLED, event_id=event_id)
    fulfilled = _reservation(user_id, item_id, ReservationStatus.FULFILLED, event_id=event_id)
    db_session.add_all([cancelled, fulfilled])
    await db_session.flush()

    await db_session.execute(text("DELETE FROM events WHERE id = :id"), {"id": event_id})

    rows = await db_session.execute(
        select(Reservation.event_id, Reservation.status).where(
            Reservation.id.in_([cancelled.id, fulfilled.id])
        )
    )
    assert sorted((event, status.value) for event, status in rows.tuples()) == [
        (None, "CANCELLED"),
        (None, "FULFILLED"),
    ]


def test_importEventsAcl_doesNotLoadEventsService() -> None:
    probe = (
        "import sys\n"
        "import app.groups.infrastructure.events_acl\n"
        "print('app.events.service' in sys.modules)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=str(BACKEND_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )

    assert result.stdout.strip() == "False"
