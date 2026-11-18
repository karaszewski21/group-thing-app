"""Migrations `0100_pgvector` and `0101_want_similar`: the `vector`
extension, the `product_embeddings`/`want_embeddings` side tables,
`wants.similar_requested_at` with its NOTIFY trigger, the appended
`matchable_listings` columns and the SIMILAR tier CHECKs. The downgrade test
takes the shared session database to 0099 and always upgrades it back to
head, so later tests see the full schema."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from tests.test_inventory_location_migration import _alembic
from tests.test_search_location import KETY, _inventory, _listed_item
from tests.test_term_item_listings import _register
from tests.test_wants_migration import (
    CHANNEL,
    INSERT_WANT,
    MISSING_WORDS_CHECK,
    TIER_CHECK,
    _next_notification,
    _seeker,
    _upgrade_head,
    _want_values,
)

SIDE_TABLES = ("product_embeddings", "want_embeddings")
VIEW_COLUMNS_0099 = [
    "item_id",
    "owner_party_id",
    "visibility",
    "mode",
    "created_at",
    "name_folded",
    "search_vector",
    "category_path",
    "locality_id",
    "lat",
    "lng",
    "changed_at",
]
CHECKS_0099 = {
    TIER_CHECK: "CHECK (((tier)::text = ANY ((ARRAY['MATCH'::character varying, "
    "'SUGGESTION'::character varying])::text[])))",
    MISSING_WORDS_CHECK: "CHECK (((((tier)::text = 'MATCH'::text) AND (missing_words IS NULL)) "
    "OR (((tier)::text = 'SUGGESTION'::text) "
    "AND (COALESCE(cardinality(missing_words), 0) > 0))))",
}
INSERT_MATCH = (
    "INSERT INTO want_matches (created_at, updated_at, want_id, item_id, source, score, "
    "tier, missing_words) VALUES (now(), now(), :want_id, gen_random_uuid(), 'FORWARD', 0.9, "
    ":tier, :missing_words)"
)


def _vector_literal(first: float = 1.0) -> str:
    return "[" + ",".join([str(first)] + ["0"] * 767) + "]"


async def _view_columns(conn: Any) -> list[str]:
    rows = await conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'matchable_listings' ORDER BY ordinal_position"
        )
    )
    return list(rows.scalars())


async def _contract_objects(conn: Any) -> dict[str, Any]:
    return {
        "extension": await conn.scalar(
            text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
        ),
        "tables": {
            name: await conn.scalar(text(f"SELECT to_regclass('public.{name}') IS NOT NULL"))
            for name in SIDE_TABLES
        },
        "column": await conn.scalar(
            text(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_name = 'wants' AND column_name = 'similar_requested_at'"
            )
        ),
        "index": await conn.scalar(
            text("SELECT to_regclass('public.ix_wants_similar_requested_at') IS NOT NULL")
        ),
        "trigger": await conn.scalar(
            text("SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_wants_similar_requested'")
        ),
        "checks": dict(
            (
                await conn.execute(
                    text(
                        "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                        "WHERE conrelid = 'want_matches'::regclass AND conname = ANY(:names)"
                    ),
                    {"names": [TIER_CHECK, MISSING_WORDS_CHECK]},
                )
            )
            .tuples()
            .all()
        ),
        "view": await _view_columns(conn),
    }


async def _listing(client: AsyncClient, email: str, name: str) -> uuid.UUID:
    token, _ = await _register(client, "GUEST", email)
    return uuid.UUID(await _listed_item(client, token, await _inventory(client, token), name, KETY))


async def test_migration0101_atHead_contractObjectsPresent(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        objects = await _contract_objects(conn)
        side_columns = {
            table: (
                await conn.execute(
                    text(
                        "SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull "
                        "FROM pg_attribute a WHERE a.attrelid = CAST(:t AS regclass) "
                        "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum"
                    ),
                    {"t": table},
                )
            )
            .tuples()
            .all()
            for table in SIDE_TABLES
        }

    assert objects["extension"] == "0.8.7"
    assert objects["tables"] == dict.fromkeys(SIDE_TABLES, True)
    assert (objects["column"], objects["index"], objects["trigger"]) == (1, True, 1)
    assert objects["view"] == [*VIEW_COLUMNS_0099, "embedding", "model_id"]
    for table, owner in (("product_embeddings", "product_id"), ("want_embeddings", "want_id")):
        assert side_columns[table] == [
            (owner, "uuid", True),
            ("model_id", "character varying(200)", True),
            ("embedding", "halfvec(768)", True),
            ("updated_at", "timestamp without time zone", True),
        ]


async def test_matchableListings_listingWithoutVector_rowWithNullEmbedding(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    item_id = await _listing(client, "similar.novector@example.com", "Kurtka zimowa")

    row = (
        await db_session.execute(
            text("SELECT embedding, model_id FROM matchable_listings WHERE item_id = :id"),
            {"id": item_id},
        )
    ).one()

    assert tuple(row) == (None, None)


async def test_matchableListings_laterProductVector_movesChangedAt(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    item_id = await _listing(client, "similar.changed@example.com", "Samochód zabawka")
    select_row = text(
        "SELECT changed_at, model_id, embedding IS NOT NULL AS has_vector "
        "FROM matchable_listings WHERE item_id = :id"
    )
    before = (await db_session.execute(select_row, {"id": item_id})).one()
    embedded_at = before.changed_at + timedelta(hours=1)

    await db_session.execute(
        text(
            "INSERT INTO product_embeddings (product_id, model_id, embedding, updated_at) "
            "SELECT product_id, 'test-model', CAST(:embedding AS halfvec), :updated_at "
            "FROM inventory_items WHERE id = :id"
        ),
        {"id": item_id, "embedding": _vector_literal(), "updated_at": embedded_at},
    )
    after = (await db_session.execute(select_row, {"id": item_id})).one()

    assert before.has_vector is False
    assert tuple(after) == (embedded_at, "test-model", True)


async def test_tierChecks_similarWithoutWords_acceptedWithWordsRejected(
    db_session: AsyncSession,
) -> None:
    want_id = await db_session.scalar(text(INSERT_WANT), _want_values(await _seeker(db_session)))

    with pytest.raises(IntegrityError, match=MISSING_WORDS_CHECK):
        async with db_session.begin_nested():
            await db_session.execute(
                text(INSERT_MATCH),
                {"want_id": want_id, "tier": "SIMILAR", "missing_words": ["auto"]},
            )
    async with db_session.begin_nested():
        await db_session.execute(
            text(INSERT_MATCH), {"want_id": want_id, "tier": "SIMILAR", "missing_words": None}
        )

    tiers = await db_session.scalar(
        text("SELECT array_agg(tier) FROM want_matches WHERE want_id = :id"), {"id": want_id}
    )
    assert tiers == ["SIMILAR"]


async def test_similarRequestedTrigger_setOnUpdate_notifiesUnlessCleared(
    engine: AsyncEngine,
) -> None:
    queue: asyncio.Queue[str] = asyncio.Queue()

    def received(_conn: Any, _pid: int, _channel: str, payload: str) -> None:
        queue.put_nowait(payload)

    async with AsyncSession(engine) as db:
        seeker = await _seeker(db)
        await db.commit()

    async def committed(statement: str, **params: Any) -> Any:
        async with engine.begin() as conn:
            result = await conn.execute(text(statement), params)
            return result.scalar() if result.returns_rows else None

    want_id = await committed(INSERT_WANT, **_want_values(seeker))
    async with engine.connect() as listen_conn:
        raw = await listen_conn.get_raw_connection()
        listener = raw.driver_connection
        assert listener is not None
        await listener.add_listener(CHANNEL, received)
        try:
            await committed(
                "UPDATE wants SET similar_requested_at = :now WHERE id = :id",
                now=datetime.utcnow(),
                id=want_id,
            )
            assert await _next_notification(queue, 5) == str(want_id)

            await committed(
                "UPDATE wants SET similar_requested_at = NULL WHERE id = :id", id=want_id
            )
            assert await _next_notification(queue, 1) is None
        finally:
            await listener.remove_listener(CHANNEL, received)
            async with engine.begin() as conn:
                await conn.execute(text("DELETE FROM wants WHERE id = :id"), {"id": want_id})
                await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": seeker})


async def test_migration0101_downgradeTo0099_dropsSimilarObjectsAndRows(
    engine: AsyncEngine, database_url: str
) -> None:
    async with AsyncSession(engine) as db:
        seeker = await _seeker(db)
        await db.commit()
    async with engine.begin() as conn:
        want_id = await conn.scalar(text(INSERT_WANT), _want_values(seeker))
        for tier in ("MATCH", "SIMILAR"):
            await conn.execute(
                text(INSERT_MATCH), {"want_id": want_id, "tier": tier, "missing_words": None}
            )
    try:
        result = _alembic(database_url, "downgrade", "0099")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        async with engine.connect() as conn:
            objects = await _contract_objects(conn)
            tiers = await conn.scalar(
                text("SELECT array_agg(tier) FROM want_matches WHERE want_id = :id"),
                {"id": want_id},
            )
            version = await conn.scalar(text("SELECT version_num FROM alembic_version"))

        assert version == "0099"
        assert tiers == ["MATCH"]
        assert objects == {
            "extension": None,
            "tables": dict.fromkeys(SIDE_TABLES, False),
            "column": 0,
            "index": False,
            "trigger": 0,
            "checks": CHECKS_0099,
            "view": VIEW_COLUMNS_0099,
        }
    finally:
        await _upgrade_head(engine, database_url)
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM wants WHERE id = :id"), {"id": want_id})
            await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": seeker})

    async with engine.connect() as conn:
        assert (await _contract_objects(conn))["view"] == [
            *VIEW_COLUMNS_0099,
            "embedding",
            "model_id",
        ]
