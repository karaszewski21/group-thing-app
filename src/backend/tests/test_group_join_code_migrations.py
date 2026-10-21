"""Migrations 0059 (join code) and 0060 (request flow removal). Each
downgrade test moves the shared session database to the previous revision and
always upgrades it back to head, so later tests see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import inspect, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from sqlalchemy.types import String

from tests.conftest import BACKEND_ROOT

# The names 0037/0041 created, hard-coded so the shape checks test 0060's
# downgrade instead of echoing it.
_TABLE = "group_join_requests"
_NOTIFICATION_COLUMN = "join_request_id"


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        "group_columns": {col["name"]: col for col in inspector.get_columns("groups")},
        "indexed_columns": {
            column for index in inspector.get_indexes("groups") for column in index["column_names"]
        },
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


def _removed_objects(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    table = _TABLE
    notification_columns = {col["name"]: col for col in inspector.get_columns("notifications")}
    if not inspector.has_table(table):
        return {"table": None, "notification_columns": notification_columns}
    return {
        "table": {
            "columns": {col["name"]: col for col in inspector.get_columns(table)},
            "pk": inspector.get_pk_constraint(table)["name"],
            "fks": {fk["name"] for fk in inspector.get_foreign_keys(table)},
            "indexes": {index["name"]: index for index in inspector.get_indexes(table)},
        },
        "notification_columns": notification_columns,
    }


async def _read_removed_objects(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_removed_objects)


async def test_downgrade0058_dropsJoinCode_upgradeHeadRestoresIt(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0058")
        await engine.dispose()
        schema = await _read_schema(engine)
        assert "join_code" not in schema["group_columns"]
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_schema(engine)
    join_code = schema["group_columns"]["join_code"]
    assert isinstance(join_code["type"], String)
    assert join_code["type"].length == 6
    assert join_code["nullable"] is True
    assert "join_code" not in schema["indexed_columns"]


async def test_insertGroup_withoutCode_joinCodeIsNull(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    register = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": "join-code-null@example.com", "password": "secret123"},
    )
    assert register.status_code == 201
    headers = {"Authorization": f"Bearer {register.json()['token']}"}
    created = await client.post("/api/groups/mine", json={"name": "Krąg bez kodu"}, headers=headers)
    assert created.status_code == 201

    result = await db_session.execute(
        text("SELECT join_code FROM groups WHERE id = :id"),
        {"id": uuid.UUID(created.json()["id"])},
    )
    assert result.scalar_one() is None


async def test_downgrade0059_recreatesGroupJoinRequestsUuidShape_upgradeHeadDropsIt(
    engine: AsyncEngine, database_url: str
) -> None:
    column = _NOTIFICATION_COLUMN
    party_id = uuid.uuid4()
    try:
        _alembic(database_url, "downgrade", "0059")
        await engine.dispose()
        removed = await _read_removed_objects(engine)
        shape = removed["table"]
        assert shape is not None
        for name in ("id", "group_id", "requester_party_id", "term_id"):
            assert isinstance(shape["columns"][name]["type"], UUID)
        assert shape["columns"]["term_id"]["nullable"] is True
        assert shape["columns"]["status"]["type"].length == 20
        assert "gen_random_uuid()" in shape["columns"]["id"]["default"]
        assert shape["pk"] == "pk_group_join_requests"
        assert shape["fks"] == {
            "fk_group_join_requests_group_id_groups",
            "fk_group_join_requests_requester_party_id_parties",
            "fk_group_join_requests_term_id_terms",
        }
        assert set(shape["indexes"]) == {
            "ix_group_join_requests_group_id",
            "uq_group_join_requests_pending_requester_group",
        }
        pending = shape["indexes"]["uq_group_join_requests_pending_requester_group"]
        assert pending["unique"]
        assert "PENDING" in pending["dialect_options"]["postgresql_where"]
        assert isinstance(removed["notification_columns"][column]["type"], UUID)
        assert removed["notification_columns"][column]["nullable"] is True

        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                    "VALUES (:id, 'PERSON', true, now(), now())"
                ),
                {"id": party_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO notifications (party_id, kind, message, created_at, updated_at) "
                    "VALUES (:party_id, :kind, 'x', now(), now()), "
                    "(:party_id, 'PLEDGE_CREATED', 'y', now(), now())"
                ),
                {"party_id": party_id, "kind": "GROUP_JOIN_APPROVED"},
            )
        await engine.dispose()
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    removed = await _read_removed_objects(engine)
    assert removed["table"] is None
    assert column not in removed["notification_columns"]
    async with engine.begin() as conn:
        kinds = await conn.execute(
            text("SELECT kind FROM notifications WHERE party_id = :party_id"),
            {"party_id": party_id},
        )
        assert [row.kind for row in kinds] == ["PLEDGE_CREATED"]
        await conn.execute(
            text("DELETE FROM notifications WHERE party_id = :party_id"), {"party_id": party_id}
        )
        await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": party_id})
    await engine.dispose()
