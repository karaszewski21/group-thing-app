"""Migration `0069_vinted_categories`: the legacy wipe and the Vinted tree
seed. Tests that move the shared session database down always upgrade it
back to head in a `finally` block, so later tests see the seeded tree."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime
from types import ModuleType
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from tests.conftest import BACKEND_ROOT

MIGRATION_PATH = BACKEND_ROOT / "alembic" / "versions" / "0069_vinted_categories.py"
FIXTURE_PATH = BACKEND_ROOT / "alembic" / "data" / "vinted_categories_pl.json"
EXPECTED_ROOTS = [
    "Kobiety",
    "Mężczyźni",
    "Dzieci",
    "Dom",
    "Elektronika",
    "Rozrywka",
    "Hobby i kolekcje",
    "Sport",
    "Zwierzęta",
]
LEGACY_NAMES = ["Zabawka", "Książka", "Gra", "Ubranie", "Inne"]


def _alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def _migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_0069", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _count_nodes(nodes: list[dict[str, Any]]) -> int:
    return sum(1 + _count_nodes(node.get("children", [])) for node in nodes)


async def _category_ids(engine: AsyncEngine) -> set[uuid.UUID]:
    async with engine.connect() as conn:
        return set((await conn.execute(text("SELECT id FROM categories"))).scalars())


async def test_migration_downgradeTo0068AndUpgradeHead_replacesLegacyCategoriesWithTree(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0068")
        await engine.dispose()
        async with engine.connect() as conn:
            legacy = (
                (await conn.execute(text("SELECT name FROM categories ORDER BY sort_order")))
                .scalars()
                .all()
            )
        legacy_ids = await _category_ids(engine)
        await engine.dispose()
        assert legacy == LEGACY_NAMES
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    seeded_ids = await _category_ids(engine)
    with FIXTURE_PATH.open(encoding="utf-8") as fixture:
        assert len(seeded_ids) == _count_nodes(json.load(fixture))
    assert legacy_ids.isdisjoint(seeded_ids)


async def test_seededTree_roots_areNineVintedRootsInFixtureOrder(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT name, sort_order FROM categories WHERE parent_id IS NULL "
                    "ORDER BY sort_order"
                )
            )
        ).all()

    assert [(row.name, row.sort_order) for row in rows] == [
        (name, index) for index, name in enumerate(EXPECTED_ROOTS)
    ]


async def test_seededTree_legacyNames_areNotRoots(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        legacy_roots = (
            (
                await conn.execute(
                    text(
                        "SELECT name FROM categories WHERE parent_id IS NULL AND name = ANY(:names)"
                    ),
                    {"names": LEGACY_NAMES},
                )
            )
            .scalars()
            .all()
        )
        # "Inne" is a legitimate Vinted leaf name; the other four never occur.
        legacy_anywhere = (
            (
                await conn.execute(
                    text("SELECT name FROM categories WHERE name = ANY(:names)"),
                    {"names": LEGACY_NAMES[:4]},
                )
            )
            .scalars()
            .all()
        )

    assert legacy_roots == []
    assert legacy_anywhere == []


async def test_seededTree_everyNonRoot_hasExistingParent(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        orphans = (
            (
                await conn.execute(
                    text(
                        "SELECT c.name FROM categories c "
                        "LEFT JOIN categories p ON p.id = c.parent_id "
                        "WHERE c.parent_id IS NOT NULL AND p.id IS NULL"
                    )
                )
            )
            .scalars()
            .all()
        )
        non_roots = (
            await conn.execute(text("SELECT count(*) FROM categories WHERE parent_id IS NOT NULL"))
        ).scalar_one()

    assert orphans == []
    assert non_roots > 0


async def test_seededTree_externalIds_areUnique(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        duplicates = (
            (
                await conn.execute(
                    text(
                        "SELECT external_id FROM categories WHERE external_id IS NOT NULL "
                        "GROUP BY external_id HAVING count(*) > 1"
                    )
                )
            )
            .scalars()
            .all()
        )

    assert duplicates == []


def test_fixtureValidator_duplicateSiblings_raisesWithNodePath() -> None:
    module = _migration_module()
    bad = [
        {
            "name": "Kobiety",
            "external_id": 1,
            "children": [
                {"name": "Sukienki", "external_id": 2, "children": []},
                {"name": "Sukienki", "external_id": 3},
            ],
        }
    ]

    with pytest.raises(ValueError, match="Kobiety > Sukienki"):
        module.validate_fixture(bad)

    module.validate_fixture(json.loads(FIXTURE_PATH.read_text(encoding="utf-8")))


async def _seed_legacy_graph(conn: AsyncConnection, ids: dict[str, uuid.UUID]) -> None:
    tag = ids["user"].hex[:12]
    params: dict[str, Any] = {**ids, "tag": f"m0069-{tag}"}
    statements = [
        "INSERT INTO users (id, username, password_hash, created_at, updated_at) "
        "VALUES (:user, :tag, 'x', now(), now())",
        "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
        "VALUES (:party, 'PERSON', true, now(), now())",
        "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
        "VALUES (:org_party, 'ORGANIZATION', true, now(), now())",
        "INSERT INTO groups (id, party_id, name, layout_mode, visibility, created_at, updated_at) "
        "VALUES (:group, :org_party, :tag, 'CIRCLE', 'PUBLIC', now(), now())",
        "INSERT INTO terms (id, circle_group_id, occurs_on, created_at, updated_at) "
        "VALUES (:term, :group, :occurs_on, now(), now())",
        "INSERT INTO inventories (id, owner_user_id, inventory_type, created_at, updated_at) "
        "VALUES (:inventory, :user, 'PERSONAL', now(), now())",
        "INSERT INTO products (id, name, sku, category_id, created_at, updated_at) "
        "SELECT :product, 'm0069', :tag, c.id, now(), now() "
        "FROM categories c WHERE c.name = 'Zabawka'",
        "INSERT INTO product_photos (id, product_id, storage_key, width, height, size_bytes, "
        "content_sha256, status, uploaded_by_user_id, sort_order, created_at, updated_at) "
        "VALUES (:photo, :product, :tag, 10, 10, 100, :tag, 'APPROVED', :user, 0, now(), now())",
        "INSERT INTO inventory_items (id, inventory_id, product_id, condition, added_at, "
        "created_at, updated_at) "
        "VALUES (:item, :inventory, :product, 'GOOD', now(), now(), now())",
        "INSERT INTO item_listing_preferences "
        "(item_id, owner_party_id, mode, created_at, updated_at) "
        "VALUES (:item, :party, 'SWAP', now(), now())",
        "INSERT INTO reservations (id, item_id, reservation_type, reserved_by_user_id, "
        "giver_user_id, term_id, reserved_at, status, created_at, updated_at) "
        "VALUES (:reservation, :item, 'SWAP', :user, :user, :term, now(), 'PENDING', "
        "now(), now())",
        "INSERT INTO swap_proposals (id, proposer_party_id, listing_item_id, offered_item_id, "
        "proposer_reservation_id, status, created_at, updated_at) "
        "VALUES (:proposal, :party, :item, :item, :reservation, 'PROPOSED', now(), now())",
        "INSERT INTO giveaway_term_end_markers (id, reservation_id, notified_at, "
        "created_at, updated_at) VALUES (:marker, :reservation, now(), now(), now())",
        "INSERT INTO notifications (id, party_id, kind, message, reservation_id, "
        "created_at, updated_at) "
        "VALUES (:n_reservation, :party, 'TERM_CONFIRMATION_NEEDED', 'm', :reservation, "
        "now(), now())",
        "INSERT INTO notifications (id, party_id, kind, message, proposal_id, "
        "created_at, updated_at) "
        "VALUES (:n_proposal, :party, 'SWAP_PROPOSED', 'm', :proposal, now(), now())",
        "INSERT INTO notifications (id, party_id, kind, message, link_path, "
        "created_at, updated_at) "
        "VALUES (:n_link, :party, 'TERM_ITEM_LISTING_TAKEN', 'm', '/product/' || :item_text, "
        "now(), now())",
        "INSERT INTO outbox_entries (id, event_type, payload, status, attempts, "
        "created_at, updated_at) "
        "VALUES (:outbox, 'groups.term_ended_giveaway', '{}'::jsonb, 'PENDING', 0, "
        "now(), now())",
        "INSERT INTO moderation_decisions (id, subject_type, subject_id, source, automated, "
        "outcome, created_at, updated_at) "
        "VALUES (:decision, 'PRODUCT_TEXT', :product, 'AI', true, 'APPROVED', now(), now())",
        "INSERT INTO moderation_decisions (id, subject_type, subject_id, source, automated, "
        "outcome, created_at, updated_at) "
        "VALUES (:photo_decision, 'PHOTO', :photo, 'AI', true, 'APPROVED', now(), now())",
    ]
    params["occurs_on"] = datetime(2026, 11, 2, 18, 0)
    params["item_text"] = str(ids["item"])
    for statement in statements:
        await conn.execute(text(statement), params)


_GRAPH_KEYS = [
    *("user", "party", "org_party", "group", "term", "inventory", "product", "photo", "item"),
    *("reservation", "proposal", "marker", "n_reservation", "n_proposal", "n_link"),
    *("outbox", "decision", "photo_decision"),
]

_LEFTOVER_CHECKS = {
    "products": "SELECT count(*) FROM products WHERE id = :product",
    "product_photos": "SELECT count(*) FROM product_photos WHERE id = :photo",
    "inventory_items": "SELECT count(*) FROM inventory_items WHERE id = :item",
    "item_listing_preferences": "SELECT count(*) FROM item_listing_preferences "
    "WHERE item_id = :item",
    "reservations": "SELECT count(*) FROM reservations WHERE id = :reservation",
    "swap_proposals": "SELECT count(*) FROM swap_proposals WHERE id = :proposal",
    "giveaway_term_end_markers": "SELECT count(*) FROM giveaway_term_end_markers "
    "WHERE id = :marker",
    "notifications": "SELECT count(*) FROM notifications "
    "WHERE id IN (:n_reservation, :n_proposal, :n_link)",
    "outbox_entries": "SELECT count(*) FROM outbox_entries WHERE id = :outbox",
    "moderation_decisions": "SELECT count(*) FROM moderation_decisions "
    "WHERE id IN (:decision, :photo_decision)",
}

_PHOTO_FILES_DELETE = (
    "SELECT payload FROM outbox_entries "
    "WHERE event_type = 'storage.objects_delete' AND status = 'PENDING' "
    "AND payload->'keys' @> jsonb_build_array(CAST(:tag AS text) || '/w1600.webp')"
)

_CLEANUP = [
    "DELETE FROM moderation_decisions WHERE id IN (:decision, :photo_decision)",
    "DELETE FROM outbox_entries WHERE event_type = 'storage.objects_delete' "
    "AND payload->'keys' @> jsonb_build_array(CAST(:tag AS text) || '/w1600.webp')",
    "DELETE FROM outbox_entries WHERE id = :outbox",
    "DELETE FROM notifications WHERE party_id = :party",
    "DELETE FROM giveaway_term_end_markers WHERE id = :marker",
    "DELETE FROM swap_proposals WHERE id = :proposal",
    "DELETE FROM reservations WHERE id = :reservation",
    "DELETE FROM item_listing_preferences WHERE item_id = :item",
    "DELETE FROM inventory_items WHERE id = :item",
    "DELETE FROM product_photos WHERE id = :photo",
    "DELETE FROM products WHERE id = :product",
    "DELETE FROM inventories WHERE id = :inventory",
    "DELETE FROM terms WHERE id = :term",
    "DELETE FROM groups WHERE id = :group",
    "DELETE FROM parties WHERE id IN (:party, :org_party)",
    "DELETE FROM users WHERE id = :user",
]


async def test_upgrade0069_legacyProductGraph_isWipedWithLooseDependents(
    engine: AsyncEngine, database_url: str
) -> None:
    ids = {key: uuid.uuid4() for key in _GRAPH_KEYS}
    params: dict[str, Any] = {**ids, "tag": f"m0069-{ids['user'].hex[:12]}"}
    leftovers: dict[str, int] = {}
    photo_files_deletes: list[Any] = []
    try:
        _alembic(database_url, "downgrade", "0068")
        await engine.dispose()
        async with engine.begin() as conn:
            await _seed_legacy_graph(conn, ids)
        await engine.dispose()

        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
        async with engine.connect() as conn:
            for table, query in _LEFTOVER_CHECKS.items():
                leftovers[table] = (await conn.execute(text(query), ids)).scalar_one()
            photo_files_deletes = list(
                (await conn.execute(text(_PHOTO_FILES_DELETE), params)).scalars()
            )
        await engine.dispose()
    finally:
        async with engine.begin() as conn:
            current = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar()
            if current != "0068":
                for statement in _CLEANUP:
                    await conn.execute(text(statement), params)
        await engine.dispose()
        if current == "0068":
            # The upgrade failed, so the graph still holds a product: drop it
            # at 0068 before returning the database to head.
            async with engine.begin() as conn:
                for statement in _CLEANUP:
                    await conn.execute(text(statement), params)
            await engine.dispose()
            _alembic(database_url, "upgrade", "head")
            await engine.dispose()

    assert leftovers == {table: 0 for table in _LEFTOVER_CHECKS}
    assert photo_files_deletes == [
        {"keys": [f"{params['tag']}/w1600.webp", f"{params['tag']}/w400.webp"]}
    ]


async def test_downgrade0069_withProductPresent_raisesAndKeepsTree(
    engine: AsyncEngine, database_url: str
) -> None:
    product_id = uuid.uuid4()
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO products (id, name, sku, category_id, created_at, updated_at) "
                "SELECT :product, 'm0069-down', :sku, c.id, now(), now() FROM categories c "
                "WHERE NOT EXISTS (SELECT 1 FROM categories k WHERE k.parent_id = c.id) "
                "ORDER BY c.name LIMIT 1"
            ),
            {"product": product_id, "sku": f"m0069-{product_id.hex[:12]}"},
        )
    await engine.dispose()
    try:
        with pytest.raises(subprocess.CalledProcessError) as raised:
            _alembic(database_url, "downgrade", "0068")
        assert "remove products before downgrading 0069" in raised.value.stderr
        await engine.dispose()
        async with engine.connect() as conn:
            version = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar()
            roots = (
                await conn.execute(text("SELECT count(*) FROM categories WHERE parent_id IS NULL"))
            ).scalar_one()
        assert version == "0069"
        assert roots == len(EXPECTED_ROOTS)
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM products WHERE id = :id"), {"id": product_id})
        await engine.dispose()
