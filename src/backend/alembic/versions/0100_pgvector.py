"""pgvector extension

Enables the `halfvec` type and the cosine distance `<=>` for the wants
SIMILAR tier (0101). `vector` is not a trusted extension, so the migration
role must be a superuser (runbook check:
`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`), and the
database image must ship it (`pgvector/pgvector:0.8.7-pg18-trixie`).

The downgrade drops the extension even when a DBA installed it before this
revision; check `pg_extension` ownership before downgrading past 0100. The
dependent `halfvec` columns are dropped earlier, by 0101's downgrade.

Revision ID: 0100
Revises: 0099
Create Date: 2026-11-18
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0100"
down_revision: str | None = "0099"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS vector")
