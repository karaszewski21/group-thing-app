"""drop footprint_audit_log (carbon footprint feature removed)

Removes the `footprint_audit_log` table (created by `0001_initial_schema`)
and its owned `footprint_audit_log_id_seq` sequence — the carbon footprint
feature (`app/footprint`) has been removed entirely (frontend pages, API
router, calculation engine). `downgrade()` recreates the table and sequence
exactly as `0001_initial_schema` defined them, mirroring
`0024_outbox_schema.py`'s detach-then-drop-then-drop-sequence convention.
The audit rows themselves are not recoverable.

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_SEQ = "footprint_audit_log_id_seq"


def upgrade() -> None:
    op.execute(f"ALTER SEQUENCE {_SEQ} OWNED BY NONE")
    op.drop_table("footprint_audit_log")
    op.execute(f"DROP SEQUENCE {_SEQ}")


def downgrade() -> None:
    op.execute(f"CREATE SEQUENCE {_SEQ}")
    op.create_table(
        "footprint_audit_log",
        sa.Column(
            "id",
            sa.BigInteger(),
            server_default=sa.text(f"nextval('{_SEQ}')"),
            nullable=False,
        ),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("comparison_group_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("product_id", sa.String(length=100), nullable=False),
        sa.Column("caller_id", sa.String(length=100), nullable=True),
        sa.Column("requested_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("total_kg_co2", sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column("strictness", sa.String(length=16), nullable=False),
        sa.Column("normalisation", sa.String(length=16), nullable=False),
        sa.Column("breakdown", postgresql.JSONB(), nullable=False),
        sa.Column("warnings", postgresql.JSONB(), nullable=False),
        sa.Column("factor_versions", postgresql.JSONB(), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_footprint_audit_log"),
        sa.UniqueConstraint("correlation_id", name="uq_footprint_audit_log_correlation_id"),
    )
    op.execute(f"ALTER SEQUENCE {_SEQ} OWNED BY footprint_audit_log.id")
