"""Migration `0070_events`. The downgrade test moves the shared session
database to 0069 and always upgrades it back to head, so later tests see the
full schema."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT

EVENT_TABLES = ("events", "event_banners", "event_attendances")
ATTENDANCE_UNIQUE = "uq_event_attendances_event_id_party_id"


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _present_tables(sync_conn: Connection) -> set[str]:
    inspector = inspect(sync_conn)
    return {table for table in EVENT_TABLES if inspector.has_table(table)}


def _constraints(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        table: {
            "pk": inspector.get_pk_constraint(table)["name"],
            "fks": {
                fk["name"]: (fk["constrained_columns"], fk["referred_table"])
                for fk in inspector.get_foreign_keys(table)
            },
            "uniques": {uq["name"] for uq in inspector.get_unique_constraints(table)},
            "indexes": {index["name"]: index for index in inspector.get_indexes(table)},
        }
        for table in EVENT_TABLES
    }


async def _run(engine: AsyncEngine, reader: Any) -> Any:
    async with engine.connect() as conn:
        return await conn.run_sync(reader)


async def test_downgrade0069_dropsEventTables_upgradeHeadRestores(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0069")
        await engine.dispose()
        assert await _run(engine, _present_tables) == set()
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    assert await _run(engine, _present_tables) == set(EVENT_TABLES)


async def test_upgradeHead_eventConstraints_namedAndPartial(engine: AsyncEngine) -> None:
    schema = await _run(engine, _constraints)
    events, banners, attendances = (schema[table] for table in EVENT_TABLES)

    assert events["pk"] == "pk_events"
    assert events["fks"] == {
        "fk_events_author_party_id_parties": (["author_party_id"], "parties"),
        "fk_events_location_id_locations": (["location_id"], "locations"),
    }
    assert events["indexes"] == {}

    assert banners["pk"] == "pk_event_banners"
    assert banners["fks"] == {"fk_event_banners_event_id_events": (["event_id"], "events")}
    assert banners["uniques"] == {"uq_event_banners_event_id"}

    assert attendances["pk"] == "pk_event_attendances"
    assert attendances["fks"] == {
        "fk_event_attendances_event_id_events": (["event_id"], "events"),
        "fk_event_attendances_party_id_parties": (["party_id"], "parties"),
    }
    assert set(attendances["indexes"]) == {"ix_event_attendances_event_id", ATTENDANCE_UNIQUE}
    partial = attendances["indexes"][ATTENDANCE_UNIQUE]
    assert partial["unique"] is True
    assert partial["column_names"] == ["event_id", "party_id"]
    assert "withdrawn_at IS NULL" in partial["dialect_options"]["postgresql_where"]
