"""paid terms

Schema only: additive columns, no backfill.

- `groups.default_price` / `default_payment_url` / `default_payment_method`,
  the Circle defaults copied by value into each new Term.
- `terms.price` / `payment_url` / `payment_method` (NULL price = free).
  A payment link needs a price, and the method is set exactly when the link
  is (`ck_*_payment_method_url`, to be relaxed by the PLATFORM gateway),
  and a link starts with `https://` in any case (`ck_*_payment_url_https`
  uses `ILIKE`, so the link is stored as typed; a backstop for the request
  validation, which also needs a host and no userinfo).
- `term_attendances.payment_status` (NOT NULL DEFAULT 'UNPAID', which
  PostgreSQL applies without rewriting the table) and `paid_marked_at`
  (naive UTC), set exactly while the status is PAID.

The downgrade drops the CHECKs, then the columns, losing prices, payment
links and payment marks.

Revision ID: 0106
Revises: 0105
Create Date: 2026-11-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0106"
down_revision: str | None = "0105"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_CHECKS = (
    ("ck_groups_default_price_positive", "groups", "default_price > 0"),
    (
        "ck_groups_default_payment_url_requires_price",
        "groups",
        "default_payment_url IS NULL OR default_price IS NOT NULL",
    ),
    (
        "ck_groups_default_payment_method_url",
        "groups",
        "num_nonnulls(default_payment_url, default_payment_method) IN (0, 2)",
    ),
    (
        "ck_groups_default_payment_url_https",
        "groups",
        "default_payment_url IS NULL OR default_payment_url ILIKE 'https://%'",
    ),
    ("ck_terms_price_positive", "terms", "price > 0"),
    (
        "ck_terms_payment_url_requires_price",
        "terms",
        "payment_url IS NULL OR price IS NOT NULL",
    ),
    (
        "ck_terms_payment_method_url",
        "terms",
        "num_nonnulls(payment_url, payment_method) IN (0, 2)",
    ),
    (
        "ck_terms_payment_url_https",
        "terms",
        "payment_url IS NULL OR payment_url ILIKE 'https://%'",
    ),
    (
        "ck_term_attendances_paid_marked",
        "term_attendances",
        "(payment_status = 'PAID') = (paid_marked_at IS NOT NULL)",
    ),
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column("groups", sa.Column("default_price", sa.Numeric(10, 2), nullable=True))
    op.add_column("groups", sa.Column("default_payment_url", sa.String(500), nullable=True))
    op.add_column("groups", sa.Column("default_payment_method", sa.String(20), nullable=True))

    op.add_column("terms", sa.Column("price", sa.Numeric(10, 2), nullable=True))
    op.add_column("terms", sa.Column("payment_url", sa.String(500), nullable=True))
    op.add_column("terms", sa.Column("payment_method", sa.String(20), nullable=True))

    op.add_column(
        "term_attendances",
        sa.Column("payment_status", sa.String(10), nullable=False, server_default="UNPAID"),
    )
    op.add_column("term_attendances", sa.Column("paid_marked_at", sa.TIMESTAMP(), nullable=True))

    for name, table, condition in _CHECKS:
        op.create_check_constraint(name, table, condition)


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    for name, table, _ in reversed(_CHECKS):
        op.drop_constraint(name, table, type_="check")

    op.drop_column("term_attendances", "paid_marked_at")
    op.drop_column("term_attendances", "payment_status")

    op.drop_column("terms", "payment_method")
    op.drop_column("terms", "payment_url")
    op.drop_column("terms", "price")

    op.drop_column("groups", "default_payment_method")
    op.drop_column("groups", "default_payment_url")
    op.drop_column("groups", "default_price")
