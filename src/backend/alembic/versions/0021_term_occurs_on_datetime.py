"""term occurs_on: DATE -> TIMESTAMP (add wall-clock start time)

`terms.occurs_on` carried only a date; guardians also need the start hour of
the class. Widen the column to `TIMESTAMP WITHOUT TIME ZONE` (naive local,
same convention as `created_at`/`updated_at`). Existing rows keep their date
at midnight (`::timestamp`).

`downgrade()` narrows back to `DATE` (`::date`) — the time-of-day is lost,
the same one-way trim the column had before this revision.

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "terms",
        "occurs_on",
        existing_type=sa.Date(),
        type_=sa.DateTime(),
        existing_nullable=False,
        postgresql_using="occurs_on::timestamp",
    )


def downgrade() -> None:
    op.alter_column(
        "terms",
        "occurs_on",
        existing_type=sa.DateTime(),
        type_=sa.Date(),
        existing_nullable=False,
        postgresql_using="occurs_on::date",
    )
