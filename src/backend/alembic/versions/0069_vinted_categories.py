"""vinted categories

Data only. Replaces the 5 legacy categories (seeded by `0025`) with the
Vinted category tree from `alembic/data/vinted_categories_pl.json`.

Upgrade:
1. Loads and validates the fixture (shape, trimmed names of 1-100
   characters, unique sibling names, globally unique non-null
   `external_id`s); a violation raises with the path of the offending node.
2. Wipes the legacy catalog: every pre-existing category, all products in
   them (P) and all inventory items of those products (I), with their
   dependents deleted in FK-safe order. Loose pointers without an FK
   (swap proposals, term-end markers, notifications, listing preferences,
   moderation decisions) are deleted explicitly, as are PENDING term-end
   outbox events, so the listener cannot recreate prompts for wiped
   reservations. Each wiped photo stages a `storage.objects_delete` outbox
   event for its files, so the storage listener removes them from object
   storage. The working-set sizes are logged.
3. Inserts the tree in one batched insert with app-generated UUIDs;
   `sort_order` is the 0-based position within each sibling list.

Downgrade fails if any product exists, then deletes every category
(including admin-added ones, leaves first) and re-inserts the 5 legacy rows. Products are
not restored. It must run before `0066`'s downgrade re-adds
`uq_categories_name`, which Alembic guarantees.

Revision ID: 0069
Revises: 0068
Create Date: 2026-10-27
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0069"
down_revision: str | None = "0068"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "data" / "vinted_categories_pl.json"

_NODE_KEYS = {"name", "external_id", "children"}
_LEGACY_NAMES = ["Zabawka", "Książka", "Gra", "Ubranie", "Inne"]
_TERM_END_EVENTS = ("groups.term_ended_giveaway", "groups.term_ended_swap")
_OBJECTS_DELETE = "storage.objects_delete"

log = logging.getLogger("alembic.runtime.migration")

_INSERT_CATEGORY = sa.text(
    "INSERT INTO categories "
    "(id, parent_id, name, sort_order, external_id, created_at, updated_at) "
    "VALUES (:id, :parent_id, :name, :sort_order, :external_id, "
    "timezone('utc', now()), timezone('utc', now()))"
)

# Working sets, captured before anything is deleted: categories, their
# products (P), those products' items (I) and everything hanging off I.
_WIPE_SETS = {
    "wipe_categories": "SELECT id FROM categories",
    "wipe_products": "SELECT id FROM products "
    "WHERE category_id IN (SELECT id FROM wipe_categories)",
    "wipe_items": "SELECT id FROM inventory_items "
    "WHERE product_id IN (SELECT id FROM wipe_products)",
    "wipe_reservations": "SELECT id FROM reservations WHERE item_id IN (SELECT id FROM wipe_items)",
    "wipe_proposals": "SELECT id FROM swap_proposals "
    "WHERE listing_item_id IN (SELECT id FROM wipe_items) "
    "OR offered_item_id IN (SELECT id FROM wipe_items) "
    "OR proposer_reservation_id IN (SELECT id FROM wipe_reservations)",
    "wipe_conversations": "SELECT id FROM conversations "
    "WHERE item_id IN (SELECT id FROM wipe_items)",
    "wipe_transactions": "SELECT DISTINCT transaction_id AS id FROM circulation_entries "
    "WHERE item_id IN (SELECT id FROM wipe_items) "
    "OR reservation_id IN (SELECT id FROM wipe_reservations)",
    "wipe_photos": "SELECT id FROM product_photos "
    "WHERE product_id IN (SELECT id FROM wipe_products)",
}

# One event per photo (its large and thumb file, as `_stage_photo_files_delete`
# in `app/product/service.py` names them), so no `DeleteObjects` call exceeds
# its 1000-key limit.
_STAGE_PHOTO_FILES_DELETE = sa.text(
    "INSERT INTO outbox_entries "
    "(id, event_type, payload, status, attempts, created_at, updated_at) "
    "SELECT gen_random_uuid(), :event_type, "
    "jsonb_build_object('keys', jsonb_build_array("
    "p.storage_key || '/w1600.webp', p.storage_key || '/w400.webp')), "
    ":status, 0, timezone('utc', now()), timezone('utc', now()) "
    "FROM product_photos p WHERE p.id IN (SELECT id FROM wipe_photos)"
)

# Steps 1-11 of the spec's legacy-wipe order; each dependent before its referent.
_WIPE_DELETES = [
    # 1. Item conversations.
    "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM wipe_conversations)",
    "DELETE FROM conversation_reads WHERE conversation_id IN (SELECT id FROM wipe_conversations)",
    "DELETE FROM conversations WHERE id IN (SELECT id FROM wipe_conversations)",
    # 2. Swap proposals.
    "DELETE FROM swap_proposals WHERE id IN (SELECT id FROM wipe_proposals)",
    # 3. Term-end markers and notifications pointing at wiped rows.
    "DELETE FROM giveaway_term_end_markers "
    "WHERE reservation_id IN (SELECT id FROM wipe_reservations)",
    "DELETE FROM notifications "
    "WHERE reservation_id IN (SELECT id FROM wipe_reservations) "
    "OR proposal_id IN (SELECT id FROM wipe_proposals) "
    "OR link_path IN (SELECT '/product/' || id::text FROM wipe_items)",
    # 4. Ledger entries, then the transactions they leave empty.
    "DELETE FROM circulation_entries "
    "WHERE item_id IN (SELECT id FROM wipe_items) "
    "OR reservation_id IN (SELECT id FROM wipe_reservations)",
    "DELETE FROM circulation_transactions t "
    "WHERE t.id IN (SELECT id FROM wipe_transactions) "
    "AND NOT EXISTS (SELECT 1 FROM circulation_entries e WHERE e.transaction_id = t.id)",
    # 5. Reservations, swap pairing links first.
    "UPDATE reservations SET paired_reservation_id = NULL "
    "WHERE paired_reservation_id IN (SELECT id FROM wipe_reservations)",
    "DELETE FROM reservations WHERE id IN (SELECT id FROM wipe_reservations)",
    # 6-8. Balances, listing preferences (loose pointer), items.
    "DELETE FROM inventory_balances WHERE item_id IN (SELECT id FROM wipe_items)",
    "DELETE FROM item_listing_preferences WHERE item_id IN (SELECT id FROM wipe_items)",
    "DELETE FROM inventory_items WHERE id IN (SELECT id FROM wipe_items)",
    # 9. Moderation log of the photos and texts of P, then the photos.
    "DELETE FROM moderation_decisions "
    "WHERE (subject_type = 'PHOTO' AND subject_id IN (SELECT id FROM wipe_photos)) "
    "OR (subject_type = 'PRODUCT_TEXT' AND subject_id IN (SELECT id FROM wipe_products))",
    "DELETE FROM product_photos WHERE id IN (SELECT id FROM wipe_photos)",
    # 10. Products; step 11 (the categories) is `_delete_categories_leaves_first`.
    "DELETE FROM products WHERE id IN (SELECT id FROM wipe_products)",
]

# Leaves first instead of clearing `parent_id`: nulled parents would turn
# repeated leaf names such as "Inne" into colliding roots
# (`uq_categories_root_name`).
_DELETE_LEAF_CATEGORIES = (
    "DELETE FROM categories c WHERE {scope}"
    "NOT EXISTS (SELECT 1 FROM categories k WHERE k.parent_id = c.id)"
)


def validate_fixture(nodes: Any) -> None:
    """Raises `ValueError` naming the offending node's path (`A > B > C`)."""
    seen_external_ids: dict[int, str] = {}

    def _walk(siblings: Any, path: str) -> None:
        if not isinstance(siblings, list):
            raise ValueError(f"{path or '<root>'}: children must be a list")
        sibling_names: set[str] = set()
        for index, node in enumerate(siblings):
            position = f"{path} > [{index}]" if path else f"[{index}]"
            if not isinstance(node, dict) or not set(node) <= _NODE_KEYS:
                raise ValueError(f"{position}: node must be an object with keys {_NODE_KEYS}")
            name = node.get("name")
            if not isinstance(name, str) or name != name.strip() or not 1 <= len(name) <= 100:
                raise ValueError(f"{position}: name must be a trimmed string of 1-100 characters")
            node_path = f"{path} > {name}" if path else name
            if name in sibling_names:
                raise ValueError(f"{node_path}: duplicate sibling name")
            sibling_names.add(name)
            external_id = node.get("external_id")
            if external_id is not None:
                if type(external_id) is not int:
                    raise ValueError(f"{node_path}: external_id must be an integer or null")
                if external_id in seen_external_ids:
                    raise ValueError(
                        f"{node_path}: external_id {external_id} already used by "
                        f"{seen_external_ids[external_id]}"
                    )
                seen_external_ids[external_id] = node_path
            _walk(node.get("children", []), node_path)

    _walk(nodes, "")


def _load_fixture() -> list[dict[str, Any]]:
    with FIXTURE_PATH.open(encoding="utf-8") as fixture:
        nodes: list[dict[str, Any]] = json.load(fixture)
    validate_fixture(nodes)
    return nodes


def _category_rows(
    nodes: list[dict[str, Any]], parent_id: uuid.UUID | None = None
) -> Iterator[dict[str, Any]]:
    """Pre-order, so every parent row precedes its children in the insert."""
    for sort_order, node in enumerate(nodes):
        node_id = uuid.uuid4()
        yield {
            "id": node_id,
            "parent_id": parent_id,
            "name": node["name"],
            "sort_order": sort_order,
            "external_id": node.get("external_id"),
        }
        yield from _category_rows(node.get("children", []), node_id)


def _delete_categories_leaves_first(scope: str = "") -> None:
    bind = op.get_bind()
    statement = sa.text(_DELETE_LEAF_CATEGORIES.format(scope=scope))
    while bind.execute(statement).rowcount:
        pass


def upgrade() -> None:
    rows = list(_category_rows(_load_fixture()))
    bind = op.get_bind()
    for table, select in _WIPE_SETS.items():
        bind.execute(sa.text(f"DROP TABLE IF EXISTS pg_temp.{table}"))
        bind.execute(sa.text(f"CREATE TEMP TABLE {table} ON COMMIT DROP AS {select}"))
        size = bind.execute(sa.text(f"SELECT count(*) FROM {table}")).scalar_one()
        log.info("0069 legacy wipe: %s holds %d rows", table, size)
    bind.execute(
        sa.text(
            "DELETE FROM outbox_entries WHERE status = :status AND event_type IN (:giveaway, :swap)"
        ),
        {"status": "PENDING", "giveaway": _TERM_END_EVENTS[0], "swap": _TERM_END_EVENTS[1]},
    )
    bind.execute(_STAGE_PHOTO_FILES_DELETE, {"event_type": _OBJECTS_DELETE, "status": "PENDING"})
    for statement in _WIPE_DELETES:
        bind.execute(sa.text(statement))
    _delete_categories_leaves_first("c.id IN (SELECT id FROM wipe_categories) AND ")
    bind.execute(_INSERT_CATEGORY, rows)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT EXISTS (SELECT 1 FROM products)")).scalar():
        raise RuntimeError("remove products before downgrading 0069")
    _delete_categories_leaves_first()
    bind.execute(
        _INSERT_CATEGORY,
        [
            {
                "id": uuid.uuid4(),
                "parent_id": None,
                "name": name,
                "sort_order": sort_order,
                "external_id": None,
            }
            for sort_order, name in enumerate(_LEGACY_NAMES)
        ],
    )
