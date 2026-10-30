"""Migration `0071_event_conversations`. The round-trip test moves the shared
session database to 0070 and always upgrades it back to head, so later tests
see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from typing import Any

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from tests.conftest import BACKEND_ROOT

EVENT_FK = "fk_conversations_event_id_events"
EVENT_UNIQUE = "uq_conversations_event_id"
EVENT_INDEX = "ix_conversations_event_id"
CASCADE_FKS = {
    "messages": "fk_messages_conversation_id_conversations",
    "conversation_reads": "fk_conversation_reads_conversation_id_conversations",
}


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
        "columns": {col["name"]: col for col in inspector.get_columns("conversations")},
        "indexes": {index["name"]: index for index in inspector.get_indexes("conversations")},
        "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("conversations")},
        "ondelete": {
            table: {
                fk["name"]: fk["options"].get("ondelete")
                for fk in inspector.get_foreign_keys(table)
            }[name]
            for table, name in CASCADE_FKS.items()
        },
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def test_downgradeTo0070ThenUpgradeHead_succeeds(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0070")
        await engine.dispose()
        schema = await _read_schema(engine)
        assert "event_id" not in schema["columns"]
        assert EVENT_FK not in schema["fks"]
        assert {EVENT_UNIQUE, EVENT_INDEX}.isdisjoint(schema["indexes"])
        assert schema["ondelete"] == {"messages": None, "conversation_reads": None}
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_schema(engine)
    assert schema["columns"]["event_id"]["nullable"] is True
    fk = schema["fks"][EVENT_FK]
    assert fk["constrained_columns"] == ["event_id"]
    assert fk["referred_table"] == "events"
    assert fk["options"].get("ondelete") == "CASCADE"
    unique = schema["indexes"][EVENT_UNIQUE]
    assert unique["unique"]
    assert unique["column_names"] == ["event_id"]
    assert "'EVENT'" in unique["dialect_options"]["postgresql_where"]
    plain = schema["indexes"][EVENT_INDEX]
    assert not plain["unique"]
    assert plain["column_names"] == ["event_id"]
    assert schema["ondelete"] == {"messages": "CASCADE", "conversation_reads": "CASCADE"}


async def test_insertDuplicateEventConversation_violatesUniqueIndex(
    db_session: AsyncSession,
) -> None:
    party_id = uuid.uuid4()
    event_id = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
            "VALUES (:id, 'PERSON', true, now(), now())"
        ),
        {"id": party_id},
    )
    await db_session.execute(
        text(
            "INSERT INTO events (id, author_party_id, name, starts_at, created_at, updated_at) "
            "VALUES (:id, :party_id, 'Wymiana ubrań', now(), now(), now())"
        ),
        {"id": event_id, "party_id": party_id},
    )
    insert_conversation = text(
        "INSERT INTO conversations (id, kind, event_id, created_at, updated_at) "
        "VALUES (gen_random_uuid(), 'EVENT', :event_id, now(), now())"
    )
    await db_session.execute(insert_conversation, {"event_id": event_id})

    with pytest.raises(IntegrityError, match=EVENT_UNIQUE):
        async with db_session.begin_nested():
            await db_session.execute(insert_conversation, {"event_id": event_id})
