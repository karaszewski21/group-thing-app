"""user_profiles.account_user_id nullable

Lightweight family members (children, or guardians added without their own
login — see `app.families.service.create_lightweight_family_member`) get a
`UserProfile` row with no backing `auth.User` row: there is no login, no
credential, nothing for `account_user_id` to point at. Drops the `NOT NULL`
constraint so such rows can be inserted with `account_user_id = NULL`.

Single logical change per `standards/backend/migrations.md`'s "one logical
change" rule — no data backfill needed, every existing row already has a
non-null `account_user_id`.

`downgrade()` re-adds `NOT NULL` and will fail (as expected/documented) if
any lightweight-member row (`account_user_id IS NULL`) exists by then —
acceptable for a dev-only rollback path per the standard's own scope.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "user_profiles", "account_user_id", existing_type=sa.BigInteger(), nullable=True
    )


def downgrade() -> None:
    op.alter_column(
        "user_profiles", "account_user_id", existing_type=sa.BigInteger(), nullable=False
    )
