"""Migration `0099_wants`: the `wants`, `want_matches` and `want_scan_markers`
tables, the two generated `wants` columns and the two CHECKs. The round-trip
test downgrades the shared session database to 0098 and always upgrades it
back to head, so later tests see the full schema."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

import app.main  # noqa: F401 - registers every model's table for FK resolution
from app.notifications.models import Notification, NotificationKind
from app.party.models import Party, PartyType
from app.wants.domain.status import WantStatus
from app.wants.models import Want
from tests.test_inventory_location_migration import _alembic
from tests.test_locality_coordinates_migration import WARSAW_SIMC_ID

TABLES = {"wants", "want_matches", "want_scan_markers"}
RADIUS_CHECK = "ck_wants_radius_requires_locality"
CLOSED_AT_CHECK = "ck_wants_closed_at_matches_status"


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    present = TABLES & set(inspector.get_table_names())
    schema: dict[str, Any] = {"tables": present}
    for table in present:
        schema[table] = {
            "pk": inspector.get_pk_constraint(table)["name"],
            "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys(table)},
            "uniques": {
                uq["name"]: uq["column_names"] for uq in inspector.get_unique_constraints(table)
            },
            "checks": {ck["name"] for ck in inspector.get_check_constraints(table)},
            "indexes": {
                ix["name"]: ix for ix in inspector.get_indexes(table) if not ix.get("unique")
            },
        }
    return schema


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def _seeker(db: AsyncSession) -> uuid.UUID:
    party = Party(party_type=PartyType.PERSON)
    db.add(party)
    await db.flush()
    return party.id


async def _flush_want(db: AsyncSession, seeker_party_id: uuid.UUID, **overrides: Any) -> Want:
    """Flushes inside a savepoint, so a rejected row leaves the session usable."""
    values: dict[str, Any] = {
        "seeker_party_id": seeker_party_id,
        "name": "Wózek dziecięcy",
        "status": WantStatus.ACTIVE,
        "expires_at": datetime.utcnow() + timedelta(days=90),
    }
    want = Want(**(values | overrides))
    async with db.begin_nested():
        db.add(want)
        await db.flush()
    return want


async def _kinds_of(engine: AsyncEngine, party_id: uuid.UUID) -> set[str]:
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT kind FROM notifications WHERE party_id = :party_id"),
            {"party_id": party_id},
        )
        return set(result.scalars().all())


async def test_migration0099_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    async with AsyncSession(engine) as db:
        party_id = await _seeker(db)
        for kind in (NotificationKind.WANT_MATCH_FOUND, NotificationKind.SWAP_PROPOSED):
            db.add(Notification(party_id=party_id, kind=kind, message=kind.value))
        await db.commit()
    try:
        result = _alembic(database_url, "downgrade", "0098")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        assert (await _read_schema(engine))["tables"] == set()
        assert await _kinds_of(engine, party_id) == {NotificationKind.SWAP_PROPOSED.value}
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
        async with engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM notifications WHERE party_id = :id"), {"id": party_id}
            )
            await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": party_id})
    assert result.returncode == 0, result.stderr

    schema = await _read_schema(engine)
    assert schema["tables"] == TABLES
    wants = schema["wants"]
    assert wants["pk"] == "pk_wants"
    assert {name: fk["options"].get("ondelete") for name, fk in wants["fks"].items()} == {
        "fk_wants_seeker_party_id_parties": None,
        "fk_wants_category_id_categories": "SET NULL",
        "fk_wants_locality_id_localities": "RESTRICT",
    }
    assert wants["checks"] == {RADIUS_CHECK, CLOSED_AT_CHECK}
    assert {name: ix["column_names"] for name, ix in wants["indexes"].items()} == {
        "ix_wants_seeker_party_id_status": ["seeker_party_id", "status"],
        "ix_wants_active_expires_at": ["expires_at"],
        "ix_wants_closed_at": ["closed_at"],
    }
    partial = {
        name: ix["dialect_options"].get("postgresql_where") for name, ix in wants["indexes"].items()
    }
    assert partial["ix_wants_seeker_party_id_status"] is None
    assert "status" in partial["ix_wants_active_expires_at"]
    assert "<>" in partial["ix_wants_closed_at"]

    matches = schema["want_matches"]
    assert matches["pk"] == "pk_want_matches"
    assert matches["fks"]["fk_want_matches_want_id_wants"]["options"]["ondelete"] == "CASCADE"
    assert matches["uniques"] == {"uq_want_matches_want_id_item_id": ["want_id", "item_id"]}
    assert {name: ix["column_names"] for name, ix in matches["indexes"].items()} == {
        "ix_want_matches_item_id": ["item_id"]
    }
    assert schema["want_scan_markers"]["uniques"] == {
        "uq_want_scan_markers_scan_name": ["scan_name"]
    }


async def test_generatedColumns_insertedWant_foldedNameAndQueryFilled(
    db_session: AsyncSession,
) -> None:
    want = await _flush_want(db_session, await _seeker(db_session))

    generated = dict(
        (
            await db_session.execute(
                text(
                    "SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute "
                    "WHERE attrelid = 'wants'::regclass AND attgenerated = 's'"
                )
            )
        )
        .tuples()
        .all()
    )
    row = (
        await db_session.execute(
            text(
                "SELECT name_folded, CAST(name_query AS text), short_words_query "
                "FROM wants WHERE id = :id"
            ),
            {"id": want.id},
        )
    ).one()

    assert generated == {"name_folded": "text", "name_query": "tsquery"}
    assert tuple(row) == ("wozek dzieciecy", "'wozek' & 'dzieciecy'", None)


async def test_radiusCheck_zeroAbove100OrWithoutLocality_rejected(
    db_session: AsyncSession,
) -> None:
    seeker = await _seeker(db_session)

    for locality_id, radius_km in ((WARSAW_SIMC_ID, 0), (WARSAW_SIMC_ID, 101), (None, 10)):
        with pytest.raises(IntegrityError, match=RADIUS_CHECK):
            await _flush_want(db_session, seeker, locality_id=locality_id, radius_km=radius_km)

    for radius_km in (None, 1, 100):
        await _flush_want(db_session, seeker, locality_id=WARSAW_SIMC_ID, radius_km=radius_km)


async def test_closedAtCheck_notMatchingStatus_rejectedBothDirections(
    db_session: AsyncSession,
) -> None:
    seeker = await _seeker(db_session)
    now = datetime.utcnow()

    with pytest.raises(IntegrityError, match=CLOSED_AT_CHECK):
        await _flush_want(db_session, seeker, status=WantStatus.ACTIVE, closed_at=now)
    with pytest.raises(IntegrityError, match=CLOSED_AT_CHECK):
        await _flush_want(db_session, seeker, status=WantStatus.WITHDRAWN, closed_at=None)

    await _flush_want(db_session, seeker, status=WantStatus.FULFILLED, closed_at=now)
