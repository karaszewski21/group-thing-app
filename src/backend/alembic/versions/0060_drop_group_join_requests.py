"""drop group join requests

Private groups are now joined with the organizer's access code
(`groups.join_code`, 0059), so the request/approve flow goes away. The
upgrade, in order: deletes the `GROUP_JOIN_*` notifications (their kinds no
longer exist in the string-backed `NotificationKind`, so the rows would fail
to load), drops the loose `notifications.join_request_id` column (no FK, no
index), then drops `group_join_requests`. No sequence: 0041 already dropped
it.

The downgrade rebuilds the post-0041 UUID shape, in reverse order:
- `id UUID` PK, `server_default=gen_random_uuid()`, `pk_group_join_requests`
- `group_id`, `requester_party_id` (NOT NULL), `term_id` (NULL) as `UUID`,
  with their 0037 FK names
- `status VARCHAR(20)`, `created_at TIMESTAMP NOT NULL`,
  `updated_at TIMESTAMP NOT NULL`
- `ix_group_join_requests_group_id` and the partial unique
  `uq_group_join_requests_pending_requester_group` on PENDING
- `notifications.join_request_id UUID NULL`

Deleted notifications are not restored.

Rollback order: run `alembic downgrade 0058` with the NEW image first (it
still ships 0059/0060), then deploy the old image. Rolling back loses every
join code (0059 drops `groups.join_code`), the deleted `GROUP_JOIN_*`
notifications stay gone, and memberships created by redeeming a code stay.

Revision ID: 0060
Revises: 0059
Create Date: 2026-10-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0060"
down_revision: str | None = "0059"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'")
    op.drop_column("notifications", "join_request_id")
    op.drop_index(
        "uq_group_join_requests_pending_requester_group", table_name="group_join_requests"
    )
    op.drop_index("ix_group_join_requests_group_id", table_name="group_join_requests")
    op.drop_table("group_join_requests")


def downgrade() -> None:
    op.create_table(
        "group_join_requests",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requester_party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("term_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_group_join_requests"),
        sa.ForeignKeyConstraint(
            ["group_id"], ["groups.id"], name="fk_group_join_requests_group_id_groups"
        ),
        sa.ForeignKeyConstraint(
            ["requester_party_id"],
            ["parties.id"],
            name="fk_group_join_requests_requester_party_id_parties",
        ),
        sa.ForeignKeyConstraint(
            ["term_id"], ["terms.id"], name="fk_group_join_requests_term_id_terms"
        ),
    )
    op.create_index(
        "ix_group_join_requests_group_id", "group_join_requests", ["group_id"], unique=False
    )
    op.create_index(
        "uq_group_join_requests_pending_requester_group",
        "group_join_requests",
        ["requester_party_id", "group_id"],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.add_column(
        "notifications",
        sa.Column("join_request_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
