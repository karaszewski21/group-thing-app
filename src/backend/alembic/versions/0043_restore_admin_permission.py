"""restore admin permission

`0041_baseentity_id_uuid.py` wiped `user_permissions` and re-seeded the dev
`admin` account with only READ/EDIT/PLUGIN_MANAGEMENT, dropping the `ADMIN`
grant that `0025_category_reintroduction.py` had added. Re-grants it, using
the same idempotent INSERT ... WHERE NOT EXISTS shape as 0025. Data only.

Revision ID: 0043
Revises: 0042
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0043"
down_revision: str | None = "0042"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, :permission FROM users u "
            "WHERE u.username = 'admin' "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM user_permissions p "
            "  WHERE p.user_id = u.id AND p.permission = :permission"
            ")"
        ).bindparams(permission="ADMIN")
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM user_permissions "
            "WHERE user_id = (SELECT id FROM users WHERE username = 'admin') "
            "AND permission = :permission"
        ).bindparams(permission="ADMIN")
    )
