"""fold_pl() SQL function

`fold_pl(text)`: the SQL twin of Python `app.locations.localities.fold_polish`
for Polish letters, case and whitespace: translates `ąćęłńóśźż` and their
upper-case forms to ASCII, lower-cases, collapses whitespace runs to one
space and trims. Other diacritics (é, ü) are kept, unlike Python's NFKD; the
parity test in `tests/test_search_migrations.py` pins the supported set.

IMMUTABLE so the generated `search_vector` columns (0088–0090) and the
trigram expression indexes (0094) can use it. Changing the body later means
DROP/ADD of those generated columns and a REINDEX of the expression indexes,
since stored values and index entries are not recomputed by
`CREATE OR REPLACE`.

Revision ID: 0087
Revises: 0086
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0087"
down_revision: str | None = "0086"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        r"""
        CREATE FUNCTION fold_pl(text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE
        AS $$
            SELECT btrim(
                regexp_replace(
                    lower(translate($1, 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')),
                    '\s+', ' ', 'g'
                )
            )
        $$
        """
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION fold_pl(text)")
