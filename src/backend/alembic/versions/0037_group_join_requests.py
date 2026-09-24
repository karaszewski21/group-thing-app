"""group join requests

Adds `app/groups/models.py`'s `GroupJoinRequest`: a person's request to
join a `PRIVATE` Circle, decided by the Circle's active organizer (status
PENDING/APPROVED/REJECTED/WITHDRAWN, terminal rows kept as history).
`term_id` is optional link context only.

The partial unique index `uq_group_join_requests_pending_requester_group`
enforces "at most one PENDING request per (requester, group)" and is
declared only here, not in the model's `__table_args__` — same precedent
as `0023`'s `uq_pledges_active_needed_item`. Sequence helpers mirror
`0031`.

Revision ID: 0037
Revises: 0036
Create Date: 2026-09-24
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_GROUP_JOIN_REQUEST_SEQ = "group_join_request_seq"


def _sequenced_id(sequence_name: str) -> sa.Column[Any]:
    return sa.Column(
        "id",
        sa.BigInteger(),
        server_default=sa.text(f"nextval('{sequence_name}')"),
        nullable=False,
    )


def upgrade() -> None:
    op.execute(f"CREATE SEQUENCE {_GROUP_JOIN_REQUEST_SEQ}")
    op.create_table(
        "group_join_requests",
        _sequenced_id(_GROUP_JOIN_REQUEST_SEQ),
        sa.Column("group_id", sa.BigInteger(), nullable=False),
        sa.Column("requester_party_id", sa.BigInteger(), nullable=False),
        sa.Column("term_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_group_join_requests"),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name="fk_group_join_requests_group_id_groups",
        ),
        sa.ForeignKeyConstraint(
            ["requester_party_id"],
            ["parties.id"],
            name="fk_group_join_requests_requester_party_id_parties",
        ),
        sa.ForeignKeyConstraint(
            ["term_id"],
            ["terms.id"],
            name="fk_group_join_requests_term_id_terms",
        ),
    )
    op.execute(f"ALTER SEQUENCE {_GROUP_JOIN_REQUEST_SEQ} OWNED BY group_join_requests.id")
    op.create_index(
        "ix_group_join_requests_group_id",
        "group_join_requests",
        ["group_id"],
        unique=False,
    )
    op.create_index(
        "uq_group_join_requests_pending_requester_group",
        "group_join_requests",
        ["requester_party_id", "group_id"],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING'"),
    )


def downgrade() -> None:
    op.execute(f"ALTER SEQUENCE {_GROUP_JOIN_REQUEST_SEQ} OWNED BY NONE")
    op.drop_table("group_join_requests")
    op.execute(f"DROP SEQUENCE {_GROUP_JOIN_REQUEST_SEQ}")
