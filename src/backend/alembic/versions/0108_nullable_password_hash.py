"""nullable password hash

`users.password_hash` becomes nullable: an account created through an
external identity (0107) has no password. The downgrade is guarded: it
refuses while any user has a NULL hash, since no account-deletion or
set-password path exists; the recovery is restoring the pre-0108 dump.
`SET NOT NULL` scans `users` under `ACCESS EXCLUSIVE`, hence the lock
timeout on both sides.

Revision ID: 0108
Revises: 0107
Create Date: 2026-11-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0108"
down_revision: str | None = "0107"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.alter_column("users", "password_hash", existing_type=sa.String(72), nullable=True)


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    passwordless = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM users WHERE password_hash IS NULL"))
        .scalar_one()
    )
    if passwordless:
        raise RuntimeError(
            f"Cannot downgrade 0108: {passwordless} user(s) have no password "
            "(accounts created through Google sign-in), and no account-deletion or "
            "set-password path exists. Restore the pre-0108 dump instead."
        )
    op.alter_column("users", "password_hash", existing_type=sa.String(72), nullable=False)
