"""unique user_profile email (case-insensitive)

Schema migration: a partial functional unique index on
`lower(user_profiles.email)` for non-null emails. `email` stays
`nullable=True` (anonymous RSVP profiles have `email IS NULL` and are
excluded by the `WHERE` clause), but a real login/account email can now
belong to exactly one `UserProfile` — a DB-level guarantee behind the
app-level `DuplicateEmailException` check in
`app.users.service.register` / `app.groups.service.merge_anonymous_profile`.

Fixes the failure mode where two profiles shared an email and
`POST /api/auth/login`'s `scalar_one_or_none()` raised (HTTP 500 instead of
a clean 401/200). Runs after 0015 has canonicalised existing values.

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-09
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_INDEX_NAME = "uq_user_profiles_email_lower"


def upgrade() -> None:
    op.execute(
        f"CREATE UNIQUE INDEX {_INDEX_NAME} "
        "ON user_profiles (lower(email)) "
        "WHERE email IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {_INDEX_NAME}")
