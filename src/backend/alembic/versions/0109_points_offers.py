"""points offers

Schema and seed in one revision, a recorded exception to the
separate-schema-and-data rule: the BURN row is the only data and must exist
the moment the new CHECK and the partial unique index admit it, so splitting
it out would leave a head where a SALE cannot be posted.

- `points_config` gains `price_min_ratio` / `price_max_ratio`
  (NUMERIC(4,2)), `price_cap` and `price_step` (INTEGER), added NOT NULL
  with the seed values as server defaults (no table rewrite) and the
  defaults then dropped, like every other config column.
- `item_listing_preferences.points_price` (SMALLINT, NULL), set exactly for
  a POINTS listing (`ck_item_listing_preferences_points_price`) and
  positive (`ck_item_listing_preferences_points_price_positive`).
- `point_accounts`: one account per `(party_id, account_type)` instead of
  one per party; PARTY and HELD accounts belong to a party, EMISSION and
  BURN are system accounts; at most one BURN row, seeded here with explicit
  `id`, `created_at` and `updated_at` (BaseEntity has no server default for
  the timestamps).

Guarded downgrade: refuses while any HOLD/SALE/RELEASE point transaction,
POINTS listing preference or POINTS reservation exists; the recovery is
restoring the pre-0109 dump. Otherwise it deletes the HELD and BURN
accounts (entry-free once the guard passes) and reverses the schema.
`wants.offer_mode = 'POINTS'` rows are left as they are and match nothing.

Revision ID: 0109
Revises: 0108
Create Date: 2026-11-26
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0109"
down_revision: str | None = "0108"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_NOW_UTC = "(now() AT TIME ZONE 'UTC')"

_CONFIG_COLUMNS: tuple[tuple[str, sa.types.TypeEngine[Any], str], ...] = (
    ("price_min_ratio", sa.Numeric(4, 2), "0.50"),
    ("price_max_ratio", sa.Numeric(4, 2), "1.50"),
    ("price_cap", sa.Integer(), "100"),
    ("price_step", sa.Integer(), "10"),
)

_ACCOUNT_CHECK = "ck_point_accounts_party_id_account_type"
_NEW_ACCOUNT_CHECK = (
    "(account_type IN ('PARTY', 'HELD') AND party_id IS NOT NULL) "
    "OR (account_type IN ('EMISSION', 'BURN') AND party_id IS NULL)"
)
_OLD_ACCOUNT_CHECK = (
    "(account_type = 'PARTY' AND party_id IS NOT NULL) "
    "OR (account_type = 'EMISSION' AND party_id IS NULL)"
)
_BURN_INDEX = "uq_point_accounts_account_type_burn"

_GUARD_COUNTS = (
    (
        "HOLD/SALE/RELEASE point transactions",
        "SELECT count(*) FROM point_transactions "
        "WHERE transaction_type IN ('HOLD', 'SALE', 'RELEASE')",
    ),
    (
        "POINTS listing preferences",
        "SELECT count(*) FROM item_listing_preferences WHERE mode = 'POINTS'",
    ),
    (
        "POINTS reservations",
        "SELECT count(*) FROM reservations WHERE reservation_type = 'POINTS'",
    ),
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    for name, type_, default in _CONFIG_COLUMNS:
        op.add_column(
            "points_config",
            sa.Column(name, type_, nullable=False, server_default=sa.text(default)),
        )
    for name, _, _ in _CONFIG_COLUMNS:
        op.alter_column("points_config", name, server_default=None)

    op.add_column(
        "item_listing_preferences", sa.Column("points_price", sa.SmallInteger(), nullable=True)
    )
    op.create_check_constraint(
        "ck_item_listing_preferences_points_price",
        "item_listing_preferences",
        "(mode = 'POINTS') = (points_price IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_item_listing_preferences_points_price_positive",
        "item_listing_preferences",
        "points_price IS NULL OR points_price > 0",
    )

    op.drop_constraint("uq_point_accounts_party_id", "point_accounts", type_="unique")
    op.create_unique_constraint(
        "uq_point_accounts_party_id_account_type", "point_accounts", ["party_id", "account_type"]
    )
    op.drop_constraint(_ACCOUNT_CHECK, "point_accounts", type_="check")
    op.create_check_constraint(_ACCOUNT_CHECK, "point_accounts", _NEW_ACCOUNT_CHECK)
    op.create_index(
        _BURN_INDEX,
        "point_accounts",
        ["account_type"],
        unique=True,
        postgresql_where=sa.text("account_type = 'BURN'"),
    )

    op.execute(
        "INSERT INTO point_accounts (id, account_type, party_id, created_at, updated_at) "
        f"VALUES (gen_random_uuid(), 'BURN', NULL, {_NOW_UTC}, {_NOW_UTC})"
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    bind = op.get_bind()
    counts = [(label, bind.execute(sa.text(sql)).scalar_one()) for label, sql in _GUARD_COUNTS]
    if any(count for _, count in counts):
        found = ", ".join(f"{count} {label}" for label, count in counts)
        raise RuntimeError(
            f"Cannot downgrade 0109: {found} exist. POINTS offers cannot be undone in place; "
            "restore the pre-0109 dump."
        )

    op.execute("DELETE FROM point_accounts WHERE account_type IN ('HELD', 'BURN')")
    op.drop_index(_BURN_INDEX, table_name="point_accounts")
    op.drop_constraint(_ACCOUNT_CHECK, "point_accounts", type_="check")
    op.create_check_constraint(_ACCOUNT_CHECK, "point_accounts", _OLD_ACCOUNT_CHECK)
    op.drop_constraint("uq_point_accounts_party_id_account_type", "point_accounts", type_="unique")
    op.create_unique_constraint("uq_point_accounts_party_id", "point_accounts", ["party_id"])

    op.drop_constraint(
        "ck_item_listing_preferences_points_price_positive",
        "item_listing_preferences",
        type_="check",
    )
    op.drop_constraint(
        "ck_item_listing_preferences_points_price", "item_listing_preferences", type_="check"
    )
    op.drop_column("item_listing_preferences", "points_price")

    for name, _, _ in reversed(_CONFIG_COLUMNS):
        op.drop_column("points_config", name)
