"""backfill google verified

Data only: marks a profile's email verified when its account has a
`user_identities` row whose provider reported the email verified and whose
email equals the profile email case-insensitively. Profiles already verified
keep their timestamp.

The downgrade is a deliberate no-op: the backfilled values cannot be told
apart from later verifications, and the 0111 downgrade drops the column
anyway.

Revision ID: 0112
Revises: 0111
Create Date: 2026-11-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0112"
down_revision: str | None = "0111"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "UPDATE user_profiles AS profile "
        "SET email_verified_at = timezone('utc', now()) "
        "FROM user_identities AS identity "
        "WHERE identity.user_id = profile.account_user_id "
        "AND identity.email_verified "
        "AND lower(identity.email) = lower(profile.email) "
        "AND profile.email_verified_at IS NULL"
    )


def downgrade() -> None:
    pass
