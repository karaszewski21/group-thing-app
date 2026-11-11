"""Migrations `0081_profile_page_appearance`, `0082_media` and
`0083_drop_legacy_image_tables`: the appearance columns on `user_profiles`,
the `media` table with its constraints and partial indexes, and the drop of
`organization_media`/`profile_avatars`. The round-trip test downgrades the
shared session database to 0080 and always upgrades it back to head, so later
tests see the full schema."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import delete, inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.auth.models import User
from app.media.models import Media, MediaKind
from app.moderation.status import ModerationStatus
from app.outbox.models import OutboxEntry
from app.party.models import Party, PartyType
from tests.test_inventory_location_migration import _alembic

TABLE = "media"
LEGACY_TABLES = ("organization_media", "profile_avatars")
APPEARANCE_COLUMNS = {"page_layout", "palette_preset", "primary_color", "accent_color"}
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


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    tables = set(inspector.get_table_names())
    schema: dict[str, Any] = {
        "tables": tables,
        "profile_columns": {c["name"] for c in inspector.get_columns("user_profiles")},
    }
    if TABLE in tables:
        schema["pk"] = inspector.get_pk_constraint(TABLE)
        schema["fks"] = {fk["name"]: fk for fk in inspector.get_foreign_keys(TABLE)}
        schema["uniques"] = {uq["name"]: uq for uq in inspector.get_unique_constraints(TABLE)}
        schema["indexes"] = {ix["name"]: ix for ix in inspector.get_indexes(TABLE)}
    return schema


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


async def _owner(db: AsyncSession) -> tuple[Party, User]:
    party = Party(party_type=PartyType.PERSON)
    user = User(username=f"media-mig-{uuid.uuid4().hex[:8]}", password_hash="x")
    db.add_all([party, user])
    await db.flush()
    return party, user


def _media(party: Party, user: User, kind: MediaKind, status: ModerationStatus) -> Media:
    return Media(
        owner_party_id=party.id,
        kind=kind,
        storage_key=f"media/{party.id}/{uuid.uuid4()}",
        size_bytes=1000,
        content_sha256=uuid.uuid4().hex * 2,
        status=status,
        uploaded_by_user_id=user.id,
    )


async def test_upgrade_createsMediaWithConstraintsAndIndexes_dropsLegacyTables(
    engine: AsyncEngine,
) -> None:
    schema = await _read_schema(engine)

    assert TABLE in schema["tables"]
    assert not set(LEGACY_TABLES) & schema["tables"]
    assert schema["profile_columns"] >= APPEARANCE_COLUMNS
    assert schema["pk"]["name"] == "pk_media"
    assert schema["pk"]["constrained_columns"] == ["id"]
    assert schema["fks"]["fk_media_owner_party_id_parties"]["referred_table"] == "parties"
    assert schema["fks"]["fk_media_uploaded_by_user_id_users"]["referred_table"] == "users"
    assert schema["uniques"]["uq_media_owner_party_id_kind_content_sha256"]["column_names"] == [
        "owner_party_id",
        "kind",
        "content_sha256",
    ]
    assert schema["indexes"]["ix_media_status"]["column_names"] == ["status"]
    assert schema["indexes"]["ix_media_pending_created_at"]["column_names"] == ["created_at", "id"]
    assert "'PENDING'" in await _indexdef(engine, "ix_media_pending_created_at")
    one_pending = schema["indexes"]["uq_media_one_pending_per_slot"]
    assert one_pending["unique"] is True
    assert one_pending["column_names"] == ["owner_party_id", "kind"]
    one_pending_def = await _indexdef(engine, "uq_media_one_pending_per_slot")
    for literal in ("'PENDING'", "'NEEDS_REVIEW'", "'LOGO'", "'AVATAR'", "'COVER'"):
        assert literal in one_pending_def
    assert "'GALLERY'" not in one_pending_def


async def test_cronColumns_matchProductPhotos(engine: AsyncEngine) -> None:
    media = await _column_info(engine, TABLE)
    photos = await _column_info(engine, "product_photos")

    for column in CRON_COLUMNS:
        assert media[column] == photos[column], column


async def test_partialUnique_secondPendingAvatar_rejected(db_session: AsyncSession) -> None:
    party, user = await _owner(db_session)
    db_session.add(_media(party, user, MediaKind.AVATAR, ModerationStatus.PENDING))
    await db_session.flush()

    db_session.add(_media(party, user, MediaKind.AVATAR, ModerationStatus.NEEDS_REVIEW))
    with pytest.raises(IntegrityError, match="uq_media_one_pending_per_slot"):
        await db_session.flush()


async def test_partialUnique_twoPendingGalleryAndPendingPerSlotKind_allowed(
    db_session: AsyncSession,
) -> None:
    party, user = await _owner(db_session)
    first = _media(party, user, MediaKind.GALLERY, ModerationStatus.PENDING)
    second = _media(party, user, MediaKind.GALLERY, ModerationStatus.PENDING)
    second.sort_order = 1
    db_session.add_all(
        [first, second]
        + [
            _media(party, user, kind, ModerationStatus.PENDING)
            for kind in (MediaKind.LOGO, MediaKind.AVATAR, MediaKind.COVER)
        ]
        + [_media(party, user, MediaKind.AVATAR, ModerationStatus.APPROVED)]
    )
    await db_session.flush()
    await db_session.refresh(first)

    assert first.sort_order == 0
    assert first.moderation_attempts == 0
    assert first.moderation_retry_at is None


async def test_downgrade0080_dropsMediaStagesFilesRestoresLegacyTables_upgradeHeadReverses(
    engine: AsyncEngine, database_url: str
) -> None:
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        party, user = await _owner(db)
        row = _media(party, user, MediaKind.GALLERY, ModerationStatus.APPROVED)
        db.add(row)
        await db.commit()
    await engine.dispose()
    expected_keys = [f"{row.storage_key}/w1600.webp", f"{row.storage_key}/w400.webp"]
    try:
        result = _alembic(database_url, "downgrade", "0080")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        downgraded = await _read_schema(engine)
        async with engine.connect() as conn:
            legacy_rows = {
                table: (await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()
                for table in LEGACY_TABLES
            }
            staged = (
                await conn.execute(
                    text(
                        "SELECT count(*) FROM outbox_entries "
                        "WHERE event_type = 'storage.objects_delete' "
                        "AND payload -> 'keys' = CAST(:keys AS jsonb)"
                    ),
                    {"keys": f'["{expected_keys[0]}", "{expected_keys[1]}"]'},
                )
            ).scalar_one()
    finally:
        upgraded = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
        async with sessions() as db:
            await db.execute(
                delete(OutboxEntry).where(
                    OutboxEntry.payload["keys"].astext.contains(row.storage_key)
                )
            )
            await db.execute(delete(Media).where(Media.id == row.id))
            await db.execute(delete(Party).where(Party.id == party.id))
            await db.execute(delete(User).where(User.id == user.id))
            await db.commit()
        await engine.dispose()

    assert TABLE not in downgraded["tables"]
    assert set(LEGACY_TABLES) <= downgraded["tables"]
    assert legacy_rows == {table: 0 for table in LEGACY_TABLES}
    assert not APPEARANCE_COLUMNS & downgraded["profile_columns"]
    assert staged == 1
    assert upgraded.returncode == 0, upgraded.stderr
    schema = await _read_schema(engine)
    assert TABLE in schema["tables"]
    assert not set(LEGACY_TABLES) & schema["tables"]
    assert schema["profile_columns"] >= APPEARANCE_COLUMNS
