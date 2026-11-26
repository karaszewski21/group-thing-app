"""Migrations `0107_user_identities` and `0108_nullable_password_hash`. The
round-trip test moves the shared session database to 0106 and always upgrades
it back to head, so later tests see the full schema. The guarded-downgrade
test commits a NULL-hash user to the real database and always deletes it
again."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT


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
    password_hash = {col["name"]: col for col in inspector.get_columns("users")}["password_hash"]
    if not inspector.has_table("user_identities"):
        return {"table": False, "password_hash_nullable": password_hash["nullable"]}
    return {
        "table": True,
        "password_hash_nullable": password_hash["nullable"],
        "pk": inspector.get_pk_constraint("user_identities")["name"],
        "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("user_identities")},
        "uniques": {
            uq["name"]: uq["column_names"]
            for uq in inspector.get_unique_constraints("user_identities")
        },
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def test_downgradeThenUpgrade_0107_0108_roundTrips(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0106")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        downgraded = await _read_schema(engine)
        assert downgraded == {"table": False, "password_hash_nullable": False}
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    schema = await _read_schema(engine)
    assert schema["table"] is True
    assert schema["password_hash_nullable"] is True
    assert schema["pk"] == "pk_user_identities"
    fk = schema["fks"]["fk_user_identities_user_id_users"]
    assert fk["referred_table"] == "users"
    assert fk["constrained_columns"] == ["user_id"]
    assert fk["options"].get("ondelete") == "CASCADE"
    assert schema["uniques"] == {
        "uq_user_identities_provider_subject": ["provider", "subject"],
        "uq_user_identities_user_id_provider": ["user_id", "provider"],
    }


async def test_downgrade0108_nullHashUser_refusesNamingRecovery(
    engine: AsyncEngine, database_url: str
) -> None:
    user_id = uuid.uuid4()
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO users (id, username, password_hash, created_at, updated_at) "
                "VALUES (:id, :username, NULL, now(), now())"
            ),
            {"id": user_id, "username": f"google-only-{user_id.hex[:8]}"},
        )
    try:
        result = _alembic(database_url, "downgrade", "0107")

        assert result.returncode != 0
        assert "RuntimeError" in result.stderr
        assert "1 user(s)" in result.stderr
        assert "pre-0108 dump" in result.stderr
        await engine.dispose()
        assert (await _read_schema(engine))["password_hash_nullable"] is True
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
