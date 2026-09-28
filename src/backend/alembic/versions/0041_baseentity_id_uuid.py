"""BaseEntity id: bigint+sequence -> uuid

Switches the primary key of every `BaseEntity`-derived table (and every FK/
loose-pointer column referencing one) from a sequential `BIGINT` to a
non-enumerable `UUID`. `oauth2_registered_client` (already UUID) and
`plugins` (string PK) are untouched.

Pre-production app, local/dev data only — this migration clears every
affected table's rows instead of remapping old bigint ids to new uuids (see
`standards/backend/models.md`). Irreversible; restore from a pre-migration
snapshot if you need the old data back.

Revision ID: 0041
Revises: 0040
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# Every table whose `id` column is a `BaseEntity`-generated bigint+sequence PK.
PK_TABLES = [
    "parties",
    "users",
    "user_profiles",
    "user_roles",
    "accounts",
    "inventories",
    "inventory_items",
    "inventory_balances",
    "reservations",
    "circulation_transactions",
    "circulation_entries",
    "organizations",
    "organization_roles",
    "organization_memberships",
    "outbox_entries",
    "families",
    "family_roles",
    "family_memberships",
    "plugin_objects",
    "notifications",
    "groups",
    "group_roles",
    "leaderships",
    "memberships",
    "group_join_requests",
    "terms",
    "needed_items",
    "pledges",
    "term_attendances",
    "item_listing_preferences",
    "swap_proposals",
    "giveaway_term_end_markers",
    "products",
    "categories",
]

# `user_permissions` has no own `id` (plain association Table, not a
# BaseEntity), but its `user_id` FK column still needs the type change and
# the table still needs clearing first (it FKs into `users`).
CLEAR_ONLY_TABLES = ["user_permissions"]

# (table, column) pairs for every FK / loose cross-BC pointer column that
# references one of the PK_TABLES ids above.
FK_COLUMNS = [
    ("user_permissions", "user_id"),
    ("accounts", "owner_user_id"),
    ("inventories", "owner_user_id"),
    ("inventory_items", "inventory_id"),
    ("inventory_items", "product_id"),
    ("inventory_items", "home_inventory_id"),
    ("inventory_balances", "item_id"),
    ("reservations", "item_id"),
    ("reservations", "reserved_by_user_id"),
    ("reservations", "giver_user_id"),
    ("reservations", "term_id"),
    ("reservations", "paired_reservation_id"),
    ("circulation_entries", "transaction_id"),
    ("circulation_entries", "account_id"),
    ("user_profiles", "party_id"),
    ("user_profiles", "account_user_id"),
    ("user_roles", "party_id"),
    ("organizations", "party_id"),
    ("organization_roles", "party_id"),
    ("organization_memberships", "from_role_id"),
    ("organization_memberships", "to_organization_id"),
    ("families", "party_id"),
    ("family_roles", "party_id"),
    ("family_memberships", "from_role_id"),
    ("family_memberships", "to_family_id"),
    ("groups", "party_id"),
    ("group_roles", "party_id"),
    ("leaderships", "from_role_id"),
    ("leaderships", "to_group_id"),
    ("memberships", "from_role_id"),
    ("memberships", "to_group_id"),
    ("group_join_requests", "group_id"),
    ("group_join_requests", "requester_party_id"),
    ("group_join_requests", "term_id"),
    ("terms", "circle_group_id"),
    ("needed_items", "term_id"),
    ("needed_items", "product_id"),
    ("pledges", "needed_item_id"),
    ("pledges", "pledged_by_party_id"),
    ("pledges", "resolved_reservation_id"),
    ("term_attendances", "term_id"),
    ("term_attendances", "party_id"),
    ("item_listing_preferences", "item_id"),
    ("item_listing_preferences", "owner_party_id"),
    ("swap_proposals", "proposer_party_id"),
    ("swap_proposals", "listing_item_id"),
    ("swap_proposals", "offered_item_id"),
    ("swap_proposals", "proposer_reservation_id"),
    ("giveaway_term_end_markers", "reservation_id"),
    ("notifications", "party_id"),
    ("notifications", "proposal_id"),
    ("notifications", "join_request_id"),
    ("notifications", "reservation_id"),
    ("products", "category_id"),
    ("plugin_objects", "entity_id"),
]

# Every real FK constraint touching a column in FK_COLUMNS (the rest of
# FK_COLUMNS are loose cross-BC pointers with no `ForeignKeyConstraint`).
# Postgres refuses `ALTER COLUMN ... TYPE uuid` on either side of a live FK
# whose other side is still bigint, so these must be dropped before the
# type changes below and recreated after — same names as each model's
# `ForeignKey(..., name="...")` (or, for the one column missing an explicit
# `name=` in `app/product/models.py`, the name Postgres already assigned).
FK_CONSTRAINTS = [
    ("fk_accounts_owner_user_id_users", "accounts", "owner_user_id", "users"),
    ("fk_circulation_entries_account_id_accounts", "circulation_entries", "account_id", "accounts"),
    (
        "fk_circulation_entries_transaction_id_circulation_transactions",
        "circulation_entries",
        "transaction_id",
        "circulation_transactions",
    ),
    ("fk_families_party_id_parties", "families", "party_id", "parties"),
    (
        "fk_family_memberships_from_role_id_family_roles",
        "family_memberships",
        "from_role_id",
        "family_roles",
    ),
    (
        "fk_family_memberships_to_family_id_families",
        "family_memberships",
        "to_family_id",
        "families",
    ),
    ("fk_family_roles_party_id_parties", "family_roles", "party_id", "parties"),
    ("fk_group_join_requests_group_id_groups", "group_join_requests", "group_id", "groups"),
    (
        "fk_group_join_requests_requester_party_id_parties",
        "group_join_requests",
        "requester_party_id",
        "parties",
    ),
    ("fk_group_join_requests_term_id_terms", "group_join_requests", "term_id", "terms"),
    ("fk_group_roles_party_id_parties", "group_roles", "party_id", "parties"),
    ("fk_groups_party_id_parties", "groups", "party_id", "parties"),
    ("fk_inventories_owner_user_id_users", "inventories", "owner_user_id", "users"),
    (
        "fk_inventory_balances_item_id_inventory_items",
        "inventory_balances",
        "item_id",
        "inventory_items",
    ),
    (
        "fk_inventory_items_home_inventory_id_inventories",
        "inventory_items",
        "home_inventory_id",
        "inventories",
    ),
    (
        "fk_inventory_items_inventory_id_inventories",
        "inventory_items",
        "inventory_id",
        "inventories",
    ),
    ("fk_inventory_items_product_id_products", "inventory_items", "product_id", "products"),
    (
        "fk_item_listing_preferences_owner_party_id_parties",
        "item_listing_preferences",
        "owner_party_id",
        "parties",
    ),
    ("fk_leaderships_from_role_id_group_roles", "leaderships", "from_role_id", "group_roles"),
    ("fk_leaderships_to_group_id_groups", "leaderships", "to_group_id", "groups"),
    ("fk_memberships_from_role_id_group_roles", "memberships", "from_role_id", "group_roles"),
    ("fk_memberships_to_group_id_groups", "memberships", "to_group_id", "groups"),
    ("fk_needed_items_product_id_products", "needed_items", "product_id", "products"),
    ("fk_needed_items_term_id_terms", "needed_items", "term_id", "terms"),
    ("fk_notifications_party_id_parties", "notifications", "party_id", "parties"),
    (
        "fk_organization_memberships_from_role_id_organization_roles",
        "organization_memberships",
        "from_role_id",
        "organization_roles",
    ),
    (
        "fk_organization_memberships_to_organization_id_organizations",
        "organization_memberships",
        "to_organization_id",
        "organizations",
    ),
    ("fk_organization_roles_party_id_parties", "organization_roles", "party_id", "parties"),
    ("fk_organizations_party_id_parties", "organizations", "party_id", "parties"),
    ("fk_pledges_needed_item_id_needed_items", "pledges", "needed_item_id", "needed_items"),
    ("fk_pledges_pledged_by_party_id_parties", "pledges", "pledged_by_party_id", "parties"),
    ("fk_products_category_id_categories", "products", "category_id", "categories"),
    ("fk_reservations_giver_user_id_users", "reservations", "giver_user_id", "users"),
    ("fk_reservations_item_id_inventory_items", "reservations", "item_id", "inventory_items"),
    (
        "fk_reservations_paired_reservation_id_reservations",
        "reservations",
        "paired_reservation_id",
        "reservations",
    ),
    (
        "fk_reservations_reserved_by_user_id_users",
        "reservations",
        "reserved_by_user_id",
        "users",
    ),
    ("fk_reservations_term_id_terms", "reservations", "term_id", "terms"),
    ("fk_swap_proposals_proposer_party_id_parties", "swap_proposals", "proposer_party_id", "parties"),
    ("fk_term_attendances_party_id_parties", "term_attendances", "party_id", "parties"),
    ("fk_term_attendances_term_id_terms", "term_attendances", "term_id", "terms"),
    ("fk_terms_circle_group_id_groups", "terms", "circle_group_id", "groups"),
    ("fk_user_permissions_user_id_users", "user_permissions", "user_id", "users"),
    ("fk_user_profiles_account_user_id_users", "user_profiles", "account_user_id", "users"),
    ("fk_user_profiles_party_id_parties", "user_profiles", "party_id", "parties"),
    ("fk_user_roles_party_id_parties", "user_roles", "party_id", "parties"),
]

# Every `__sequence_name__` value the old `BaseEntity.id` referenced, one per
# `PK_TABLES` entry — now unused.
OBSOLETE_SEQUENCES = [
    "party_seq",
    "user_seq",
    "user_profile_seq",
    "user_role_seq",
    "account_seq",
    "inventory_seq",
    "inventory_item_seq",
    "inventory_balance_seq",
    "reservation_seq",
    "circulation_transaction_seq",
    "circulation_entry_seq",
    "organization_seq",
    "organization_role_seq",
    "organization_membership_seq",
    "outbox_entry_seq",
    "family_seq",
    "family_role_seq",
    "family_membership_seq",
    "plugin_object_seq",
    "notification_seq",
    "group_seq",
    "group_role_seq",
    "leadership_seq",
    "membership_seq",
    "group_join_request_seq",
    "term_seq",
    "needed_item_seq",
    "pledge_seq",
    "term_attendance_seq",
    "item_listing_preference_seq",
    "swap_proposal_seq",
    "giveaway_term_end_marker_seq",
    "product_seq",
    "category_seq",
]


def _clear_table(table: str) -> None:
    """Wipe every pre-migration record in `table`. Not a bulk multi-table
    statement — kept to one table per call so each op is a plain, auditable
    `DELETE FROM <table>` with no cross-table fan-out."""
    op.execute(f"DELETE FROM {table}")  # noqa: S608 - table name is a hardcoded constant above


# Explicit child-before-parent delete order honoring every real FK
# constraint in FK_COLUMNS (a plain `reversed(PK_TABLES)` doesn't respect
# the actual dependency graph — e.g. `products` must clear before
# `categories`, but sorts after it alphabetically-by-declaration).
DELETE_ORDER = [
    "circulation_entries",
    "inventory_balances",
    "reservations",
    "pledges",
    "term_attendances",
    "group_join_requests",
    "needed_items",
    "leaderships",
    "memberships",
    "terms",
    "groups",
    "group_roles",
    "organization_memberships",
    "organizations",
    "organization_roles",
    "family_memberships",
    "families",
    "family_roles",
    "inventory_items",
    "accounts",
    "circulation_transactions",
    "inventories",
    "products",
    "categories",
    "user_profiles",
    "user_roles",
    "notifications",
    "item_listing_preferences",
    "swap_proposals",
    "plugin_objects",
    "outbox_entries",
    "giveaway_term_end_markers",
    "parties",
    "user_permissions",
    "users",
]


def upgrade() -> None:
    for table in DELETE_ORDER:
        _clear_table(table)

    # Drop every live FK constraint first — Postgres refuses to retype
    # either side of one while the other side is still bigint.
    for name, table, _column, _ref_table in FK_CONSTRAINTS:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT {name}")

    for table in PK_TABLES:
        # The old bigint `id` carries a `nextval('<table>_seq')` default that
        # Postgres cannot auto-cast to uuid — drop it before changing type.
        op.execute(f"ALTER TABLE {table} ALTER COLUMN id DROP DEFAULT")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN id TYPE uuid USING gen_random_uuid()")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN id SET DEFAULT gen_random_uuid()")

    for table, column in FK_COLUMNS:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE uuid USING gen_random_uuid()")

    for name, table, column, ref_table in FK_CONSTRAINTS:
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {name} "
            f"FOREIGN KEY ({column}) REFERENCES {ref_table} (id)"
        )

    for seq in OBSOLETE_SEQUENCES:
        op.execute(f"DROP SEQUENCE IF EXISTS {seq}")

    _reseed_dev_users()
    _reseed_categories()


# Re-inserts what `0002_seed_dev_users.py` and `0025_category_reintroduction.py`
# originally seeded, since the wipe above deletes it along with the disposable
# transactional data. Fixed reference/seed content (dev login accounts, the 5
# standard product categories), not user data — the app and this test suite's
# fixtures both assume it exists, so it must survive the id-type conversion,
# just under fresh (uuid, not 1/2/3) ids.
_DEV_USERS: list[tuple[str, str, list[str]]] = [
    ("viewer", "$2b$12$JoTjBGCQy1Ic7.vSmohyBela3Y5ke.qgRzNUWWYzF.Aa8ZEFEI1au", ["READ"]),
    ("editor", "$2b$12$AtydIUDGCRBrtNVbHy.v0.CJ9qU8IS4JthndcVetGZ7WthI8RPYlS", ["READ", "EDIT"]),
    (
        "admin",
        "$2b$12$2mbgr6RbRaM1xB5Rx809Se1TrtyHk6aVIYdb.yafhZlSCzxcBOYoe",
        ["READ", "EDIT", "PLUGIN_MANAGEMENT"],
    ),
]

_CATEGORIES: list[tuple[str, int]] = [
    ("Zabawka", 0),
    ("Książka", 1),
    ("Gra", 2),
    ("Ubranie", 3),
    ("Inne", 4),
]


def _reseed_dev_users() -> None:
    for username, password_hash, permissions in _DEV_USERS:
        op.execute(
            f"INSERT INTO users (id, username, password_hash, created_at, updated_at) "
            f"VALUES (gen_random_uuid(), '{username}', '{password_hash}', now(), now())"
        )
        for permission in permissions:
            op.execute(
                f"INSERT INTO user_permissions (user_id, permission) "
                f"SELECT id, '{permission}' FROM users WHERE username = '{username}'"
            )


def _reseed_categories() -> None:
    for name, sort_order in _CATEGORIES:
        op.execute(
            f"INSERT INTO categories (id, name, sort_order, created_at, updated_at) "
            f"VALUES (gen_random_uuid(), '{name}', {sort_order}, now(), now())"
        )


def downgrade() -> None:
    raise NotImplementedError(
        "Irreversible: uuid -> bigint would require id remapping, not "
        "supported for pre-production disposable data. Restore from a "
        "pre-migration DB snapshot instead."
    )
