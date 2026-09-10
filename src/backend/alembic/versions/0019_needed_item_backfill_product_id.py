"""needed_item backfill product_id from legacy category (data only)

Second of three revisions (see 0018's docstring). Pure data: for each
legacy `category` value, get-or-create one canonical `products` row
(case-insensitive name match within `category = 'OTHER'`, mirroring
`app.product.service.get_or_create_product_by_name`), then point every
still-unlinked `needed_items` row at it. All land in `ProductCategory.OTHER`
— none of TOY/BOOK/GAME/CLOTHING fit "instrument"/"mata"/"materiały".

`downgrade()` only re-nulls `needed_items.product_id`; it does NOT delete
the synthetic products (they may already be referenced by `inventory_items`
from a fulfilled pledge) and cannot reconstruct the exact per-row category
— the same one-way asymmetry the 0006/0007 downgrades accept.

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-10
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# legacy needed_items.category value -> canonical product name
_BACKFILL: tuple[tuple[str, str], ...] = (
    ("INSTRUMENT", "Instrument"),
    ("MAT_BLANKET", "Mata/koc"),
    ("ART_SUPPLIES", "Materiały plastyczne"),
    ("OTHER", "Przedmiot na zajęcia"),
)
_FALLBACK_NAME = "Przedmiot na zajęcia"  # also covers any NULL category


def upgrade() -> None:
    for name in {n for _, n in _BACKFILL} | {_FALLBACK_NAME}:
        op.execute(
            f"""
            INSERT INTO products
                (id, name, description, photo_url, price, sku, category, plugin_data,
                 created_at, updated_at)
            SELECT nextval('product_seq'), '{name}', NULL, NULL, 0.01,
                   upper(left('{name}', 10)) || '-' || (extract(epoch from now()) * 1000)::bigint,
                   'OTHER', NULL, now(), now()
            WHERE NOT EXISTS (
                SELECT 1 FROM products WHERE lower(name) = lower('{name}') AND category = 'OTHER'
            )
            """
        )

    for legacy_value, name in _BACKFILL:
        op.execute(
            f"""
            UPDATE needed_items ni
            SET product_id = (
                SELECT id FROM products
                WHERE lower(name) = lower('{name}') AND category = 'OTHER'
                ORDER BY id LIMIT 1
            )
            WHERE ni.product_id IS NULL AND coalesce(ni.category, 'OTHER') = '{legacy_value}'
            """
        )

    # Any row whose category is neither a known legacy value nor NULL-handled above.
    op.execute(
        f"""
        UPDATE needed_items ni
        SET product_id = (
            SELECT id FROM products
            WHERE lower(name) = lower('{_FALLBACK_NAME}') AND category = 'OTHER'
            ORDER BY id LIMIT 1
        )
        WHERE ni.product_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute("UPDATE needed_items SET product_id = NULL")
