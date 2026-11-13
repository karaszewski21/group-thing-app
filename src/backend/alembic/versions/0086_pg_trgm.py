"""pg_trgm extension

Enables trigram matching (`<%`, `word_similarity`, `gin_trgm_ops`) for the
global search. pg_trgm is a trusted extension on PostgreSQL 13+, so the
migration role needs only CREATE on the database (runbook check:
`SELECT has_database_privilege(current_user, current_database(), 'CREATE')`).

The downgrade drops the extension even when a DBA installed it before this
revision; check `pg_extension` ownership before downgrading past 0086. The
dependent trigram indexes are dropped earlier, by 0094's downgrade.

Revision ID: 0086
Revises: 0085
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0086"
down_revision: str | None = "0085"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
