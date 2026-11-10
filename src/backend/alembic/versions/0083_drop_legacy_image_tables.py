"""drop legacy image tables

Drops `organization_media` (0054) and `profile_avatars` (0051), replaced by
`media` (0082). Their rows are not carried over (a test database, wiped like
0080): each row first stages a `storage.objects_delete` outbox entry for its
two files, as `_stage_files_delete` in `app/media/service.py` names them, and
the moderation log entries of the dropped subjects (`AVATAR`,
`ORGANIZATION_MEDIA`, values `ModerationSubjectType` no longer knows) are
deleted.

The downgrade is a plain lossy reverse: it stages the deletes of every
`media` file, deletes the `MEDIA` log entries and all `media` rows, and
recreates both tables empty with their original DDL. No image-only rollback:
an older image reads tables this revision drops.

Revision ID: 0083
Revises: 0082
Create Date: 2026-11-10
"""

from __future__ import annotations

import importlib.util
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0083"
down_revision: str | None = "0082"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_OBJECTS_DELETE = "storage.objects_delete"


def _stage_files_delete(table: str) -> sa.TextClause:
    """One outbox event per row (its large and thumb file), so no
    `DeleteObjects` call exceeds its 1000-key limit."""
    return sa.text(
        "INSERT INTO outbox_entries "
        "(id, event_type, payload, status, attempts, created_at, updated_at) "
        "SELECT gen_random_uuid(), :event_type, "
        "jsonb_build_object('keys', jsonb_build_array("
        "t.storage_key || '/w1600.webp', t.storage_key || '/w400.webp')), "
        "'PENDING', 0, timezone('utc', now()), timezone('utc', now()) "
        f"FROM {table} t"
    )


def _revision(filename: str) -> ModuleType:
    """An earlier revision's module, whose `upgrade()` recreates its table."""
    path = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    bind = op.get_bind()
    for table in ("organization_media", "profile_avatars"):
        bind.execute(_stage_files_delete(table), {"event_type": _OBJECTS_DELETE})
    op.execute(
        "DELETE FROM moderation_decisions WHERE subject_type IN ('AVATAR', 'ORGANIZATION_MEDIA')"
    )
    op.drop_index("uq_organization_media_one_pending_per_slot", table_name="organization_media")
    op.drop_index("ix_organization_media_pending_created_at", table_name="organization_media")
    op.drop_index("ix_organization_media_status", table_name="organization_media")
    op.drop_table("organization_media")
    op.drop_index("ix_profile_avatars_pending_created_at", table_name="profile_avatars")
    op.drop_index("ix_profile_avatars_status", table_name="profile_avatars")
    op.drop_table("profile_avatars")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.get_bind().execute(_stage_files_delete("media"), {"event_type": _OBJECTS_DELETE})
    op.execute("DELETE FROM moderation_decisions WHERE subject_type = 'MEDIA'")
    op.execute("DELETE FROM media")
    _revision("0051_profile_avatars.py").upgrade()
    _revision("0054_organization_media.py").upgrade()
