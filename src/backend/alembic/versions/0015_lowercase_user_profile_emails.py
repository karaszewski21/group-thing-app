"""lowercase user_profile emails

Data-only migration. `app/auth/router.py`'s login now matches
`UserProfile.email` against the trimmed+lowercased form the register/login
schemas produce (`app.users.schemas.normalize_email`). Any row written
before that change may hold a mixed-case or space-padded address that a
correct lowercase login would no longer match — this backfills them to the
canonical form.

`user_profiles.email` has no unique constraint, so in the (pre-production)
event that two rows differ only by case, both are lowercased and a later
duplicate-email register/merge check will surface the collision; nothing
here fails.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-09
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE user_profiles "
        "SET email = lower(btrim(email)) "
        "WHERE email IS NOT NULL AND email <> lower(btrim(email))"
    )


def downgrade() -> None:
    # Original casing is not recorded — no reversal, matching 0007's
    # precedent for purely data-normalizing migrations.
    pass
