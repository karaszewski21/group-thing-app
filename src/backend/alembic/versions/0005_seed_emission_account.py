"""seed emission account

Seeds the single system-wide `900-100` emission account (`account_type =
SYSTEM_EMISSION`, `owner_user_id IS NULL`) referenced by
`docs/system-wypozyczalni-inventory-accounting.md` §1's example chart of
accounts. Every posted `CirculationTransaction` credits this account. Data
only, no schema change — kept separate from 0004 per
`standards/backend/migrations.md`'s "Separate Schema and Data" rule.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_EMISSION_ACCOUNT_CODE = "900-100"
_EMISSION_ACCOUNT_NAME = "Emisja punktow za obieg"


def upgrade() -> None:
    op.execute(
        sa.text(
            "INSERT INTO accounts (id, code, name, account_type, owner_user_id, created_at, updated_at) "
            "VALUES (nextval('account_seq'), :code, :name, 'SYSTEM_EMISSION', NULL, now(), now()) "
            "ON CONFLICT (code) DO NOTHING"
        ).bindparams(code=_EMISSION_ACCOUNT_CODE, name=_EMISSION_ACCOUNT_NAME)
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM accounts WHERE code = :code").bindparams(code=_EMISSION_ACCOUNT_CODE)
    )
