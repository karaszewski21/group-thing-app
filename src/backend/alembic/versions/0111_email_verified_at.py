"""email verified at

Additive: nullable `user_profiles.email_verified_at` (naive UTC), NULL = the
profile's current email is not verified. No backfill here; 0112 sets it for
verified Google identities. The downgrade drops the column and loses every
verification.

Revision ID: 0111
Revises: 0110
Create Date: 2026-11-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0111"
down_revision: str | None = "0110"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column("user_profiles", sa.Column("email_verified_at", sa.TIMESTAMP(), nullable=True))


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column("user_profiles", "email_verified_at")
