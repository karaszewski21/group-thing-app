"""Migrations `0057_locations`, `0058_group_term_location_capacity` and
`0080_item_location_locality`. The tests move the shared session database
below head (to 0056, so 0058's downgrade must run before 0057 drops the
table, or to 0079) and always upgrade it back to head, so later tests see the
full schema."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_inventory_location_migration import _alembic

GROUP_FK = "fk_groups_default_location_id_locations"
TERM_FK = "fk_terms_location_id_locations"
LOCALITY_FK = "fk_locations_locality_id_localities"
GOOGLE_PLACE_INDEX = "uq_locations_owner_party_id_google_place_id"
ADDRESS_CHECK = "ck_locations_address_fields"
# `inventories.location_id` is nulled too (else the delete would fail its FK),
# but 0080 drops that column, so only these three are left to check at head.
REFERENCES = (
    ("groups", "default_location_id"),
    ("terms", "location_id"),
    ("events", "location_id"),
)


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    has_locations = inspector.has_table("locations")
    return {
        "has_locations": has_locations,
        "location_columns": (
            {col["name"]: col for col in inspector.get_columns("locations")}
            if has_locations
            else {}
        ),
        "location_indexes": (
            {index["name"] for index in inspector.get_indexes("locations")}
            if has_locations
            else set()
        ),
        "location_fks": (
            {fk["name"]: fk for fk in inspector.get_foreign_keys("locations")}
            if has_locations
            else {}
        ),
        "location_checks": (
            {check["name"] for check in inspector.get_check_constraints("locations")}
            if has_locations
            else set()
        ),
        "group_columns": {col["name"] for col in inspector.get_columns("groups")},
        "term_columns": {col["name"] for col in inspector.get_columns("terms")},
        "group_fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("groups")},
        "term_fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("terms")},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


def _assert_group_term_fks(schema: dict[str, Any]) -> None:
    group_fk = schema["group_fks"][GROUP_FK]
    assert group_fk["constrained_columns"] == ["default_location_id"]
    assert group_fk["referred_table"] == "locations"
    term_fk = schema["term_fks"][TERM_FK]
    assert term_fk["constrained_columns"] == ["location_id"]
    assert term_fk["referred_table"] == "locations"


async def test_migration_downgradeTo0056AndUpgradeHead_reshapesLocations(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0056")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        schema = await _read_schema(engine)
        assert schema["has_locations"] is False
        assert {"default_location_id", "default_capacity"}.isdisjoint(schema["group_columns"])
        assert {"location_id", "capacity"}.isdisjoint(schema["term_columns"])
        assert GROUP_FK not in schema["group_fks"]
        assert TERM_FK not in schema["term_fks"]

        result = _alembic(database_url, "upgrade", "0058")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        schema = await _read_schema(engine)
        assert {"ix_locations_owner_party_id", GOOGLE_PLACE_INDEX} <= schema["location_indexes"]
        assert {"name", "notes"} <= schema["location_columns"].keys()
        assert schema["location_columns"]["formatted_address"]["nullable"] is False
        assert {"default_location_id", "default_capacity"} <= schema["group_columns"]
        assert {"location_id", "capacity"} <= schema["term_columns"]
        _assert_group_term_fks(schema)
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    schema = await _read_schema(engine)
    columns = schema["location_columns"]
    assert "ix_locations_owner_party_id" in schema["location_indexes"]
    assert GOOGLE_PLACE_INDEX not in schema["location_indexes"]
    assert columns["locality_id"]["nullable"] is False
    locality_fk = schema["location_fks"][LOCALITY_FK]
    assert locality_fk["constrained_columns"] == ["locality_id"]
    assert locality_fk["referred_table"] == "localities"
    assert {"name", "notes"}.isdisjoint(columns)
    assert columns["formatted_address"]["nullable"] is True
    assert columns["source"]["nullable"] is True
    assert ADDRESS_CHECK in schema["location_checks"]
    _assert_group_term_fks(schema)


async def _seed_references(engine: AsyncEngine) -> dict[str, uuid.UUID]:
    """At 0079: one place referenced by a circle, a term, an event and an
    inventory. Returns the created row ids by table."""
    ids = {
        table: uuid.uuid4()
        for table in ("parties", "users", "locations", "groups", "terms", "events", "inventories")
    }
    statements = (
        "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
        "VALUES (:parties, 'PERSON', true, now(), now())",
        "INSERT INTO users (id, username, password_hash, created_at, updated_at) "
        "VALUES (:users, :username, 'x', now(), now())",
        "INSERT INTO locations (id, owner_party_id, name, formatted_address, source, "
        "created_at, updated_at) VALUES (:locations, :parties, 'Dom', 'Kęty, ul. Krótka 1', "
        "'MANUAL', now(), now())",
        "INSERT INTO groups (id, party_id, name, default_location_id, created_at, updated_at) "
        "VALUES (:groups, :parties, 'Krąg 0080', :locations, now(), now())",
        "INSERT INTO terms (id, circle_group_id, occurs_on, location_id, created_at, updated_at) "
        "VALUES (:terms, :groups, now(), :locations, now(), now())",
        "INSERT INTO events (id, author_party_id, name, starts_at, location_id, created_at, "
        "updated_at) VALUES (:events, :parties, 'Wydarzenie 0080', now(), :locations, now(), "
        "now())",
        "INSERT INTO inventories (id, owner_user_id, inventory_type, location_id, created_at, "
        "updated_at) VALUES (:inventories, :users, 'PERSONAL', :locations, now(), now())",
    )
    params = {**ids, "username": f"loc-0080-{ids['users'].hex[:12]}"}
    async with engine.begin() as conn:
        for statement in statements:
            await conn.execute(text(statement), params)
    return ids


async def _delete_seeded(engine: AsyncEngine, ids: dict[str, uuid.UUID]) -> None:
    async with engine.begin() as conn:
        for table in ("terms", "events", "groups", "inventories", "locations", "users", "parties"):
            await conn.execute(text(f"DELETE FROM {table} WHERE id = :id"), {"id": ids[table]})


async def test_migration0080_upgrade_deletesLocationsAndNullsReferences(
    engine: AsyncEngine, database_url: str
) -> None:
    ids: dict[str, uuid.UUID] = {}
    try:
        result = _alembic(database_url, "downgrade", "0079")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        ids = await _seed_references(engine)

        result = _alembic(database_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr
        await engine.dispose()

        async with engine.connect() as conn:
            assert (await conn.execute(text("SELECT count(*) FROM locations"))).scalar_one() == 0
            for table, column in REFERENCES:
                value = (
                    await conn.execute(
                        text(f"SELECT {column} FROM {table} WHERE id = :id"), {"id": ids[table]}
                    )
                ).scalar_one()
                assert value is None, table
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
        if ids:
            await _delete_seeded(engine, ids)
