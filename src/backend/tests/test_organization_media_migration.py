"""Migration `0054_organization_media`: the moderated logo/cover/gallery table,
its cron-facing columns (identical to `profile_avatars`) and the partial
one-pending-per-slot unique index. The round-trip test downgrades the shared
session database to 0053 and always upgrades it back to head, so later tests
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

from app.auth.models import User
from app.moderation.status import ModerationStatus
from app.organizations.models import MediaKind, Organization, OrganizationMedia
from app.party.models import Party, PartyType
from tests.conftest import BACKEND_ROOT

TABLE = "organization_media"
CRON_COLUMNS = (
    "id",
    "storage_key",
    "content_sha256",
    "status",
    "moderation_attempts",
    "moderation_retry_at",
    "created_at",
    "updated_at",
)


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
    if not inspector.has_table(TABLE):
        return {"exists": False}
    return {
        "exists": True,
        "pk": inspector.get_pk_constraint(TABLE),
        "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys(TABLE)},
        "uniques": {uq["name"]: uq for uq in inspector.get_unique_constraints(TABLE)},
        "indexes": {ix["name"]: ix for ix in inspector.get_indexes(TABLE)},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def _indexdef(engine: AsyncEngine, name: str) -> str:
    async with engine.connect() as conn:
        result = await conn.exec_driver_sql(
            "SELECT pg_get_indexdef(indexrelid) FROM pg_index "
            f"WHERE indexrelid = '{name}'::regclass"
        )
        return str(result.scalar_one())


async def _column_info(engine: AsyncEngine, table: str) -> dict[str, tuple[Any, ...]]:
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT column_name, data_type, character_maximum_length, is_nullable "
                "FROM information_schema.columns WHERE table_name = :table"
            ),
            {"table": table},
        )
        return {row[0]: tuple(row[1:]) for row in result}


async def _create_organization(db_session: AsyncSession) -> tuple[Organization, User]:
    party = Party(party_type=PartyType.ORGANIZATION)
    user = User(username=f"orgmedia-{uuid.uuid4().hex[:8]}", password_hash="x")
    db_session.add_all([party, user])
    await db_session.flush()
    organization = Organization(
        party_id=party.id, name="Media Org", slug=f"media-org-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(organization)
    await db_session.flush()
    return organization, user


def _media(
    organization: Organization, user: User, kind: MediaKind, status: ModerationStatus
) -> OrganizationMedia:
    return OrganizationMedia(
        organization_id=organization.id,
        kind=kind,
        storage_key=f"organizations/{organization.id}/{uuid.uuid4()}",
        size_bytes=1000,
        content_sha256=uuid.uuid4().hex * 2,
        status=status,
        uploaded_by_user_id=user.id,
    )


async def test_upgrade_createsTableWithConstraintsAndIndexes(engine: AsyncEngine) -> None:
    schema = await _read_schema(engine)

    assert schema["exists"] is True
    assert schema["pk"]["name"] == "pk_organization_media"
    assert schema["pk"]["constrained_columns"] == ["id"]
    assert (
        schema["fks"]["fk_organization_media_organization_id_organizations"]["referred_table"]
        == "organizations"
    )
    assert (
        schema["fks"]["fk_organization_media_uploaded_by_user_id_users"]["referred_table"]
        == "users"
    )
    assert schema["uniques"]["uq_organization_media_organization_id_kind_content_sha256"][
        "column_names"
    ] == ["organization_id", "kind", "content_sha256"]
    assert schema["indexes"]["ix_organization_media_status"]["column_names"] == ["status"]

    pending = schema["indexes"]["ix_organization_media_pending_created_at"]
    assert pending["column_names"] == ["created_at", "id"]
    pending_def = await _indexdef(engine, "ix_organization_media_pending_created_at")
    assert "WHERE" in pending_def
    assert "'PENDING'" in pending_def

    one_pending = schema["indexes"]["uq_organization_media_one_pending_per_slot"]
    assert one_pending["unique"] is True
    assert one_pending["column_names"] == ["organization_id", "kind"]
    one_pending_def = await _indexdef(engine, "uq_organization_media_one_pending_per_slot")
    for literal in ("'PENDING'", "'NEEDS_REVIEW'", "'LOGO'", "'COVER'"):
        assert literal in one_pending_def
    assert "'GALLERY'" not in one_pending_def


async def test_cronColumns_matchProfileAvatars(engine: AsyncEngine) -> None:
    media = await _column_info(engine, TABLE)
    avatars = await _column_info(engine, "profile_avatars")

    for column in CRON_COLUMNS:
        assert media[column] == avatars[column], column


async def test_partialUnique_secondPendingLogo_rejected(db_session: AsyncSession) -> None:
    organization, user = await _create_organization(db_session)
    db_session.add(_media(organization, user, MediaKind.LOGO, ModerationStatus.PENDING))
    await db_session.flush()

    db_session.add(_media(organization, user, MediaKind.LOGO, ModerationStatus.NEEDS_REVIEW))
    with pytest.raises(IntegrityError, match="uq_organization_media_one_pending_per_slot"):
        await db_session.flush()


async def test_partialUnique_twoPendingGallery_allowed(db_session: AsyncSession) -> None:
    organization, user = await _create_organization(db_session)
    first = _media(organization, user, MediaKind.GALLERY, ModerationStatus.PENDING)
    second = _media(organization, user, MediaKind.GALLERY, ModerationStatus.PENDING)
    second.sort_order = 1
    approved_logo = _media(organization, user, MediaKind.LOGO, ModerationStatus.APPROVED)
    pending_logo = _media(organization, user, MediaKind.LOGO, ModerationStatus.PENDING)
    db_session.add_all([first, second, approved_logo, pending_logo])
    await db_session.flush()
    await db_session.refresh(first)

    assert first.sort_order == 0
    assert first.moderation_attempts == 0
    assert first.moderation_retry_at is None


async def test_downgrade_dropsTable(engine: AsyncEngine, database_url: str) -> None:
    try:
        _alembic(database_url, "downgrade", "0053")
        await engine.dispose()
        schema = await _read_schema(engine)
        assert schema["exists"] is False
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_schema(engine)
    assert schema["exists"] is True
