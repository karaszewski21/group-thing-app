"""Migration `0061_messaging` and the `app.messaging` models. The round-trip
test moves the shared session database to 0060 and always upgrades it back to
head, so later tests see the full schema."""

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

import app.main  # noqa: F401 - registers every model's table for FK resolution
from app.messaging.models import Conversation, ConversationKind
from tests.conftest import BACKEND_ROOT

TABLES = ("conversations", "messages", "conversation_reads")
PARTIAL_UNIQUES = {
    "uq_conversations_group_id": "GROUP",
    "uq_conversations_term_id": "TERM",
    "uq_conversations_item_id_asker_party_id_owner_party_id": "ITEM",
}
CONVERSATION_FKS = {
    "fk_conversations_item_id_inventory_items": ("item_id", "inventory_items"),
    "fk_conversations_group_id_groups": ("group_id", "groups"),
    "fk_conversations_term_id_terms": ("term_id", "terms"),
    "fk_conversations_asker_party_id_parties": ("asker_party_id", "parties"),
    "fk_conversations_owner_party_id_parties": ("owner_party_id", "parties"),
}
MESSAGE_FKS = {
    "fk_messages_conversation_id_conversations": ("conversation_id", "conversations"),
    "fk_messages_sender_party_id_parties": ("sender_party_id", "parties"),
}
READ_FKS = {
    "fk_conversation_reads_conversation_id_conversations": ("conversation_id", "conversations"),
    "fk_conversation_reads_party_id_parties": ("party_id", "parties"),
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
    present = {table for table in TABLES if inspector.has_table(table)}
    return {
        "tables": present,
        "indexes": {
            table: {index["name"]: index for index in inspector.get_indexes(table)}
            for table in present
        },
        "fks": {
            table: {
                fk["name"]: (fk["constrained_columns"], fk["referred_table"])
                for fk in inspector.get_foreign_keys(table)
            }
            for table in present
        },
        "pks": {table: inspector.get_pk_constraint(table)["name"] for table in present},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def test_migration_downgradeTo0060AndUpgradeHead_succeeds(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0060")
        await engine.dispose()
        assert (await _read_schema(engine))["tables"] == set()
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_schema(engine)
    assert schema["tables"] == set(TABLES)
    assert schema["pks"] == {table: f"pk_{table}" for table in TABLES}

    conversation_indexes = schema["indexes"]["conversations"]
    for name, kind in PARTIAL_UNIQUES.items():
        index = conversation_indexes[name]
        assert index["unique"]
        assert f"'{kind}'" in index["dialect_options"]["postgresql_where"]
    assert conversation_indexes["uq_conversations_item_id_asker_party_id_owner_party_id"][
        "column_names"
    ] == ["item_id", "asker_party_id", "owner_party_id"]
    assert {
        "ix_conversations_asker_party_id",
        "ix_conversations_owner_party_id",
        "ix_conversations_group_id",
    } <= set(conversation_indexes)
    assert schema["indexes"]["messages"]["ix_messages_conversation_id_created_at_id"][
        "column_names"
    ] == ["conversation_id", "created_at", "id"]
    reads_unique = schema["indexes"]["conversation_reads"][
        "uq_conversation_reads_conversation_id_party_id"
    ]
    assert reads_unique["unique"]
    assert reads_unique["column_names"] == ["conversation_id", "party_id"]

    expected_fks = {
        "conversations": CONVERSATION_FKS,
        "messages": MESSAGE_FKS,
        "conversation_reads": READ_FKS,
    }
    for table, fks in expected_fks.items():
        assert schema["fks"][table] == {
            name: ([column], referred) for name, (column, referred) in fks.items()
        }


async def test_insertConversation_groupKind_secondForSameGroupViolatesUnique(
    db_session: AsyncSession,
) -> None:
    party_id = uuid.uuid4()
    group_id = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
            "VALUES (:id, 'PERSON', true, now(), now())"
        ),
        {"id": party_id},
    )
    await db_session.execute(
        text(
            "INSERT INTO groups (id, party_id, name, created_at, updated_at) "
            "VALUES (:id, :party_id, 'Krąg czatu', now(), now())"
        ),
        {"id": group_id, "party_id": party_id},
    )

    conversation = Conversation(kind=ConversationKind.GROUP, group_id=group_id)
    db_session.add(conversation)
    await db_session.flush()
    stored = await db_session.execute(
        text("SELECT kind, last_message_at, updated_at FROM conversations WHERE id = :id"),
        {"id": conversation.id},
    )
    row = stored.one()
    assert row.kind == "GROUP"
    assert row.last_message_at is None
    assert row.updated_at is not None

    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(Conversation(kind=ConversationKind.GROUP, group_id=group_id))
            await db_session.flush()
