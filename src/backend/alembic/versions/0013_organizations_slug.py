"""organizations slug

Adds `organizations.slug` (the public `domena.pl/<slug>` page's URL
segment — see `app/organizations/slugs.py`, `router.py`'s
`GET /api/organizations/public/{slug}`). Nullable-then-backfill-then-NOT
NULL: any Organization rows created before this migration (there may be a
handful from local/dev testing) get a slug derived from their existing
`name`, deduplicated against each other with a `-2`, `-3`, ... suffix —
the same collision-avoidance scheme `service._generate_unique_slug` uses
for new rows, reimplemented standalone here since migrations must not
import app code (it can change independently of historical migrations).

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-08
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_POLISH_TRANSLATION = str.maketrans("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ")


def _slugify(name: str) -> str:
    value = name.translate(_POLISH_TRANSLATION)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "organizacja"


def upgrade() -> None:
    op.add_column("organizations", sa.Column("slug", sa.String(length=255), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, name FROM organizations ORDER BY id")).fetchall()
    used_slugs: set[str] = set()
    for row in rows:
        base = _slugify(row.name)
        candidate = base
        suffix = 2
        while candidate in used_slugs:
            candidate = f"{base}-{suffix}"
            suffix += 1
        used_slugs.add(candidate)
        connection.execute(
            sa.text("UPDATE organizations SET slug = :slug WHERE id = :id"),
            {"slug": candidate, "id": row.id},
        )

    op.alter_column("organizations", "slug", nullable=False)
    op.create_unique_constraint("uq_organizations_slug", "organizations", ["slug"])


def downgrade() -> None:
    op.drop_constraint("uq_organizations_slug", "organizations", type_="unique")
    op.drop_column("organizations", "slug")
