"""Migrations `0110_email_tables`, `0111_email_verified_at` and
`0112_backfill_google_verified`. Every test that moves the shared session
database below head upgrades it back to head in `finally`, so later tests see
the full schema; the backfill test also deletes the rows it committed."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT

_EMAIL_TABLES = ("email_messages", "email_preferences", "email_suppressions", "account_tokens")


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
    profile_columns = {col["name"] for col in inspector.get_columns("user_profiles")}
    return {
        "tables": {name for name in _EMAIL_TABLES if inspector.has_table(name)},
        "email_verified_at": "email_verified_at" in profile_columns,
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def test_upgradeHead_0110_createsNamedConstraintsAndIndexes(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        constraints = {
            row.conname: (row.contype, row.relname, row.confdeltype)
            for row in await conn.execute(
                text(
                    "SELECT c.conname, c.contype::text AS contype, r.relname, "
                    "c.confdeltype::text AS confdeltype "
                    "FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid "
                    "WHERE r.relname = ANY(:tables)"
                ),
                {"tables": list(_EMAIL_TABLES)},
            )
        }
        indexes = {
            row.indexname: row.indexdef
            for row in await conn.execute(
                text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = ANY(:tables)"),
                {"tables": list(_EMAIL_TABLES)},
            )
        }

    expected = {
        "pk_email_messages": "p",
        "uq_email_messages_idempotency_key": "u",
        "fk_email_messages_party_id_parties": "f",
        "ck_email_messages_stream": "c",
        "ck_email_messages_category_stream": "c",
        "ck_email_messages_status": "c",
        "ck_email_messages_skip_reason": "c",
        "ck_email_messages_skipped_reason": "c",
        "ck_email_messages_attempts": "c",
        "pk_email_preferences": "p",
        "fk_email_preferences_party_id_parties": "f",
        "uq_email_preferences_party_id_category": "u",
        "ck_email_preferences_category": "c",
        "pk_email_suppressions": "p",
        "uq_email_suppressions_address_normalized": "u",
        "ck_email_suppressions_address_normalized": "c",
        "ck_email_suppressions_reason": "c",
        "pk_account_tokens": "p",
        "fk_account_tokens_user_id_users": "f",
        "uq_account_tokens_token_hash": "u",
        "ck_account_tokens_purpose": "c",
    }
    assert {name: constraints[name][0] for name in expected if name in constraints} == expected
    # 'a' = NO ACTION (no ON DELETE rule), 'c' = CASCADE.
    assert constraints["fk_email_messages_party_id_parties"][2] == "a"
    assert constraints["fk_email_preferences_party_id_parties"][2] == "a"
    assert constraints["fk_account_tokens_user_id_users"][2] == "c"

    assert (
        "WHERE ((status)::text = 'PENDING'::text)"
        in indexes["ix_email_messages_pending_send_after"]
    )
    assert (
        "WHERE ((status)::text = 'SENDING'::text)"
        in indexes["ix_email_messages_sending_claimed_at"]
    )
    for name in (
        "ix_email_messages_party_id",
        "ix_email_messages_sent_at",
        "ix_email_messages_provider_message_id",
        "ix_account_tokens_user_id_purpose_created_at",
    ):
        assert name in indexes, name


async def test_upgradeHead_emailMessages_rejectsSkippedWithoutReasonAndNoAddressColumn(
    engine: AsyncEngine,
) -> None:
    async with engine.connect() as conn:
        columns = await conn.run_sync(
            lambda sync_conn: {c["name"] for c in inspect(sync_conn).get_columns("email_messages")}
        )
        check = await conn.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conname = 'ck_email_messages_skipped_reason'"
            )
        )
        definition = check.scalar_one()

    assert not {"address", "email", "recipient", "to_address"} & columns
    assert "SKIPPED" in definition and "skip_reason IS NOT NULL" in definition


async def test_downgradeThenUpgrade_0110_0112_roundTrips(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0109")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        assert await _read_schema(engine) == {"tables": set(), "email_verified_at": False}
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr
    assert await _read_schema(engine) == {"tables": set(_EMAIL_TABLES), "email_verified_at": True}


async def _insert_person(
    conn: Any,
    *,
    profile_email: str,
    identity_email: str | None,
    identity_verified: bool,
    verified_at: datetime | None,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    user_id, party_id, profile_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await conn.execute(
        text(
            "INSERT INTO users (id, username, password_hash, created_at, updated_at) "
            "VALUES (:id, :username, NULL, now(), now())"
        ),
        {"id": user_id, "username": f"backfill-{user_id.hex[:12]}"},
    )
    await conn.execute(
        text(
            "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
            "VALUES (:id, 'PERSON', true, now(), now())"
        ),
        {"id": party_id},
    )
    await conn.execute(
        text(
            "INSERT INTO user_profiles (id, party_id, account_user_id, display_name, email, "
            "email_verified_at, created_at, updated_at) "
            "VALUES (:id, :party_id, :user_id, 'Backfill', :email, :verified_at, now(), now())"
        ),
        {
            "id": profile_id,
            "party_id": party_id,
            "user_id": user_id,
            "email": profile_email,
            "verified_at": verified_at,
        },
    )
    if identity_email is not None:
        await conn.execute(
            text(
                "INSERT INTO user_identities (id, user_id, provider, subject, email, "
                "email_verified, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :user_id, 'GOOGLE', :subject, :email, :verified, "
                "now(), now())"
            ),
            {
                "user_id": user_id,
                "subject": f"sub-{user_id.hex}",
                "email": identity_email,
                "verified": identity_verified,
            },
        )
    return user_id, party_id, profile_id


async def test_upgrade0112_backfill_setsOnlyVerifiedCaseInsensitiveMatches(
    engine: AsyncEngine, database_url: str
) -> None:
    already = datetime(2020, 1, 1, 12, 0, 0)
    people: dict[str, tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = {}
    try:
        result = _alembic(database_url, "downgrade", "0111")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        async with engine.begin() as conn:
            people["match"] = await _insert_person(
                conn,
                profile_email="ala.backfill@example.test",
                identity_email="Ala.Backfill@Example.TEST",
                identity_verified=True,
                verified_at=None,
            )
            people["unverified"] = await _insert_person(
                conn,
                profile_email="ola.backfill@example.test",
                identity_email="ola.backfill@example.test",
                identity_verified=False,
                verified_at=None,
            )
            people["mismatch"] = await _insert_person(
                conn,
                profile_email="ela.backfill@example.test",
                identity_email="other.backfill@example.test",
                identity_verified=True,
                verified_at=None,
            )
            people["already"] = await _insert_person(
                conn,
                profile_email="iza.backfill@example.test",
                identity_email="iza.backfill@example.test",
                identity_verified=True,
                verified_at=already,
            )
            people["no_identity"] = await _insert_person(
                conn,
                profile_email="ewa.backfill@example.test",
                identity_email=None,
                identity_verified=False,
                verified_at=None,
            )

        result = _alembic(database_url, "upgrade", "0112")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        async with engine.connect() as conn:
            rows = await conn.execute(
                text("SELECT id, email_verified_at FROM user_profiles WHERE id = ANY(:ids)"),
                {"ids": [profile_id for _, _, profile_id in people.values()]},
            )
            verified_at = {row.id: row.email_verified_at for row in rows}
    finally:
        async with engine.begin() as conn:
            user_ids = [user_id for user_id, _, _ in people.values()]
            party_ids = [party_id for _, party_id, _ in people.values()]
            await conn.execute(
                text("DELETE FROM user_identities WHERE user_id = ANY(:ids)"), {"ids": user_ids}
            )
            await conn.execute(
                text("DELETE FROM user_profiles WHERE party_id = ANY(:ids)"), {"ids": party_ids}
            )
            await conn.execute(text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": user_ids})
            await conn.execute(text("DELETE FROM parties WHERE id = ANY(:ids)"), {"ids": party_ids})
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    assert verified_at[people["match"][2]] is not None
    assert verified_at[people["unverified"][2]] is None
    assert verified_at[people["mismatch"][2]] is None
    assert verified_at[people["already"][2]] == already
    assert verified_at[people["no_identity"][2]] is None
