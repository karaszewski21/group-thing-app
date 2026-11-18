"""Migration `0099_wants`: the `wants`, `want_matches` and `want_scan_markers`
tables, their generated columns and CHECKs, and the matcher's DB contract
(text functions, `match_requested_at` with its NOTIFY trigger, the tier
columns and the three views). The downgrade tests take the shared session
database to 0098 and always upgrade it back to head, so later tests see the
full schema; one of them first goes down to 0099 and rebuilds the shape of
the first version of 0099, which the same downgrade must also undo.

Wants are inserted in SQL, not through the ORM, so these tests pin the
schema alone."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

import app.main  # noqa: F401 - registers every model's table for FK resolution
from app.notifications.models import Notification, NotificationKind
from app.party.models import Party, PartyType
from tests.test_inventory_location_migration import _alembic
from tests.test_locality_coordinates_migration import WARSAW_SIMC_ID
from tests.test_search_location import KETY, _inventory, _listed_item
from tests.test_term_item_listings import _register

TABLES = {"wants", "want_matches", "want_scan_markers"}
VIEWS = {"group_holdings", "private_group_peers", "matchable_listings"}
TEXT_FUNCTIONS = {"words_pl", "stem_word_pl", "stem_pl", "stem_query_pl"}
FUNCTIONS = TEXT_FUNCTIONS | {"wants_notify_match_requested"}
RADIUS_CHECK = "ck_wants_radius_requires_locality"
CLOSED_AT_CHECK = "ck_wants_closed_at_matches_status"
TIER_CHECK = "ck_want_matches_tier"
MISSING_WORDS_CHECK = "ck_want_matches_missing_words"
CHANNEL = "wants_changed"

INSERT_WANT = (
    "INSERT INTO public.wants (created_at, updated_at, seeker_party_id, name, status, "
    "expires_at, closed_at, locality_id, radius_km, match_requested_at) "
    "VALUES (:now, :now, :seeker, :name, :status, :expires_at, :closed_at, :locality_id, "
    ":radius_km, :match_requested_at) RETURNING id"
)

OLD_SHAPE = (
    "DROP VIEW matchable_listings",
    "DROP VIEW private_group_peers",
    "DROP VIEW group_holdings",
    "DROP TRIGGER trg_wants_match_requested ON wants",
    "DROP FUNCTION wants_notify_match_requested()",
    "ALTER TABLE wants DROP COLUMN stem_query, DROP COLUMN stem_words, "
    "DROP COLUMN match_requested_at",
    "ALTER TABLE want_matches DROP COLUMN tier, DROP COLUMN missing_words",
    "DROP FUNCTION stem_query_pl(text)",
    "DROP FUNCTION stem_pl(text)",
    "DROP FUNCTION stem_word_pl(text)",
    "DROP FUNCTION words_pl(text)",
    "ALTER TABLE wants ADD COLUMN short_words_query tsquery",
)


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    present = TABLES & set(inspector.get_table_names())
    schema: dict[str, Any] = {
        "tables": present,
        "views": VIEWS & set(inspector.get_view_names()),
    }
    for table in present:
        schema[table] = {
            "pk": inspector.get_pk_constraint(table)["name"],
            "columns": {column["name"] for column in inspector.get_columns(table)},
            "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys(table)},
            "uniques": {
                uq["name"]: uq["column_names"] for uq in inspector.get_unique_constraints(table)
            },
            "checks": {ck["name"] for ck in inspector.get_check_constraints(table)},
            "indexes": {
                ix["name"]: ix for ix in inspector.get_indexes(table) if not ix.get("unique")
            },
        }
    return schema


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def _functions(engine: AsyncEngine) -> set[str]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace "
                "AND proname = ANY(:names)"
            ),
            {"names": sorted(FUNCTIONS)},
        )
        return set(rows.scalars().all())


async def _seeker(db: AsyncSession) -> uuid.UUID:
    party = Party(party_type=PartyType.PERSON)
    db.add(party)
    await db.flush()
    return party.id


def _want_values(seeker: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    now = datetime.utcnow()
    values: dict[str, Any] = {
        "now": now,
        "seeker": seeker,
        "name": "Wózek dziecięcy",
        "status": "ACTIVE",
        "expires_at": now + timedelta(days=90),
        "closed_at": None,
        "locality_id": None,
        "radius_km": None,
        "match_requested_at": None,
    }
    return values | overrides


async def _insert_want(db: AsyncSession, seeker: uuid.UUID, **overrides: Any) -> uuid.UUID:
    """Inserts inside a savepoint, so a rejected row leaves the session usable."""
    async with db.begin_nested():
        want_id = await db.scalar(text(INSERT_WANT), _want_values(seeker, **overrides))
    assert isinstance(want_id, uuid.UUID)
    return want_id


async def _kinds_of(engine: AsyncEngine, party_id: uuid.UUID) -> set[str]:
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT kind FROM notifications WHERE party_id = :party_id"),
            {"party_id": party_id},
        )
        return set(result.scalars().all())


async def _upgrade_head(engine: AsyncEngine, database_url: str) -> None:
    result = _alembic(database_url, "upgrade", "head")
    await engine.dispose()
    assert result.returncode == 0, result.stderr


async def test_migration0099_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    async with AsyncSession(engine) as db:
        party_id = await _seeker(db)
        for kind in (
            NotificationKind.WANT_MATCH_FOUND,
            NotificationKind.WANT_EXPIRING,
            NotificationKind.SWAP_PROPOSED,
        ):
            db.add(Notification(party_id=party_id, kind=kind, message=kind.value))
        await db.commit()
    try:
        result = _alembic(database_url, "downgrade", "0098")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        downgraded = await _read_schema(engine)
        assert (downgraded["tables"], downgraded["views"]) == (set(), set())
        assert await _functions(engine) == set()
        assert await _kinds_of(engine, party_id) == {NotificationKind.SWAP_PROPOSED.value}
    finally:
        await _upgrade_head(engine, database_url)
        async with engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM notifications WHERE party_id = :id"), {"id": party_id}
            )
            await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": party_id})

    schema = await _read_schema(engine)
    assert (schema["tables"], schema["views"]) == (TABLES, VIEWS)
    assert await _functions(engine) == FUNCTIONS
    wants = schema["wants"]
    assert wants["pk"] == "pk_wants"
    assert {"stem_query", "stem_words", "match_requested_at"} <= wants["columns"]
    assert "short_words_query" not in wants["columns"]
    assert {name: fk["options"].get("ondelete") for name, fk in wants["fks"].items()} == {
        "fk_wants_seeker_party_id_parties": None,
        "fk_wants_category_id_categories": "SET NULL",
        "fk_wants_locality_id_localities": "RESTRICT",
    }
    assert wants["checks"] == {RADIUS_CHECK, CLOSED_AT_CHECK}
    assert {name: ix["column_names"] for name, ix in wants["indexes"].items()} == {
        "ix_wants_seeker_party_id_status": ["seeker_party_id", "status"],
        "ix_wants_active_expires_at": ["expires_at"],
        "ix_wants_closed_at": ["closed_at"],
        "ix_wants_match_requested_at": ["match_requested_at"],
        "ix_wants_similar_requested_at": ["similar_requested_at"],
    }
    partial = {
        name: ix["dialect_options"].get("postgresql_where") for name, ix in wants["indexes"].items()
    }
    assert partial["ix_wants_seeker_party_id_status"] is None
    assert "status" in partial["ix_wants_active_expires_at"]
    assert "<>" in partial["ix_wants_closed_at"]
    assert "IS NOT NULL" in partial["ix_wants_match_requested_at"]

    matches = schema["want_matches"]
    assert matches["pk"] == "pk_want_matches"
    assert {"tier", "missing_words"} <= matches["columns"]
    assert matches["fks"]["fk_want_matches_want_id_wants"]["options"]["ondelete"] == "CASCADE"
    assert matches["uniques"] == {"uq_want_matches_want_id_item_id": ["want_id", "item_id"]}
    assert matches["checks"] == {TIER_CHECK, MISSING_WORDS_CHECK}
    assert {name: ix["column_names"] for name, ix in matches["indexes"].items()} == {
        "ix_want_matches_item_id": ["item_id"],
        "ix_want_matches_want_id_tier": ["want_id", "tier"],
    }
    assert schema["want_scan_markers"]["uniques"] == {
        "uq_want_scan_markers_scan_name": ["scan_name"]
    }


async def test_migration0099_downgradeFromOldShape_succeeds(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0099")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        async with engine.begin() as conn:
            for statement in OLD_SHAPE:
                await conn.execute(text(statement))
        assert await _functions(engine) == set()
        old = await _read_schema(engine)
        assert old["views"] == set()
        assert "short_words_query" in old["wants"]["columns"]

        result = _alembic(database_url, "downgrade", "0098")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        downgraded = await _read_schema(engine)
        assert (downgraded["tables"], downgraded["views"]) == (set(), set())
        async with engine.connect() as conn:
            version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
        assert version == "0098"
    finally:
        await _upgrade_head(engine, database_url)

    assert (await _read_schema(engine))["views"] == VIEWS
    assert await _functions(engine) == FUNCTIONS


async def test_contractFunctions_bodies_immutableAndPublicQualified(
    db_session: AsyncSession,
) -> None:
    rows = (
        await db_session.execute(
            text(
                "SELECT proname, CAST(provolatile AS text) AS volatility, "
                "CAST(proparallel AS text) AS parallel, proconfig, prosrc, l.lanname "
                "FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang "
                "WHERE pronamespace = 'public'::regnamespace AND proname = ANY(:names)"
            ),
            {"names": sorted(FUNCTIONS | {"can_see_listing"})},
        )
    ).all()
    by_name = {row.proname: row for row in rows}

    assert set(by_name) == FUNCTIONS
    for name in TEXT_FUNCTIONS:
        row = by_name[name]
        assert (row.volatility, row.parallel, row.proconfig, row.lanname) == (
            "i",
            "s",
            None,
            "sql",
        )
        for called in ("fold_pl", *TEXT_FUNCTIONS):
            assert row.prosrc.count(f"{called}(") == row.prosrc.count(f"public.{called}("), (
                name,
                called,
            )
    assert by_name["wants_notify_match_requested"].lanname == "plpgsql"
    assert "pg_catalog.pg_notify('wants_changed'" in by_name["wants_notify_match_requested"].prosrc

    trigger = (
        await db_session.execute(
            text(
                "SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t "
                "WHERE t.tgrelid = 'wants'::regclass AND t.tgname = 'trg_wants_match_requested'"
            )
        )
    ).scalar_one()
    assert "AFTER INSERT OR UPDATE OF match_requested_at ON public.wants" in trigger
    assert "FOR EACH ROW WHEN ((new.match_requested_at IS NOT NULL))" in trigger

    columns = (
        await db_session.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'matchable_listings' ORDER BY ordinal_position"
            )
        )
    ).scalars()
    assert list(columns) == [
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
        "embedding",
        "model_id",
    ]


async def test_matchableListings_listedItem_rowUntilItsPlaceIsDeleted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, owner = await _register(client, "GUEST", "wants.matchable@example.com")
    item_id = uuid.UUID(
        await _listed_item(client, token, await _inventory(client, token), "Kurtka zimowa", KETY)
    )
    select_row = text(
        "SELECT owner_party_id, visibility, mode, name_folded, locality_id, "
        "cardinality(category_path) > 0 AS has_path, "
        "search_vector @@ to_tsquery('simple', 'kurtka') AS has_vector "
        "FROM matchable_listings WHERE item_id = :id"
    )

    row = (await db_session.execute(select_row, {"id": item_id})).one()
    await db_session.execute(
        text(
            "UPDATE locations SET deleted_at = now() "
            "WHERE id = (SELECT location_id FROM inventory_items WHERE id = :id)"
        ),
        {"id": item_id},
    )
    gone = (await db_session.execute(select_row, {"id": item_id})).all()

    assert tuple(row) == (owner, "PUBLIC", "GIFT", "kurtka zimowa", KETY, True, True)
    assert gone == []


@pytest.mark.parametrize(
    ("expression", "argument", "expected"),
    [
        ("public.stem_word_pl(:a)", "zimowa", "zim"),
        ("public.stem_word_pl(:a)", "zimę", "zim"),
        ("public.stem_word_pl(:a)", "ZIMĄ", "zim"),
        ("public.stem_word_pl(:a)", "grę", "gre"),
        ("public.stem_word_pl(:a)", "kurtka", "kurtk"),
        ("public.stem_word_pl(:a)", "rowerek", "rower"),
        ("public.stem_word_pl(:a)", "biegowy", "bieg"),
        ("public.stem_word_pl(:a)", "Zimowej", "zim"),
        ("public.stem_word_pl(:a)", "lego", "lego"),
        ("public.stem_word_pl(:a)", "Łódź", "lodz"),
        ("public.stem_word_pl(:a)", "nowej", "nowej"),
        ("public.words_pl(:a)", "kurtka na zimę", ["kurtka", "zimę"]),
        (
            "public.words_pl(:a)",
            "Rower-biegowy 2w1 dla 3-latka",
            ["Rower", "biegowy", "2w1", "3", "latka"],
        ),
        ("public.words_pl(:a)", "na i z", []),
        ("public.words_pl(:a)", "NA Zimę, ZA  Żółtą", ["Zimę", "Żółtą"]),
        ("public.words_pl(:a)", "Rock'n'roll", ["Rock", "n", "roll"]),
        ("public.words_pl(:a)", "İstanbul", ["İstanbul"]),
        ("public.stem_pl(:a)", "kurtka na zimę", ["kurtk", "zim"]),
        (
            "public.stem_pl(:a)",
            "Rower-biegowy 2w1 dla 3-latka",
            ["rower", "bieg", "2w1", "3", "latk"],
        ),
        ("public.stem_pl(:a)", "na i z", []),
        ("CAST(public.stem_query_pl(:a) AS text)", "kurtka na zimę", "'kurtk':*A & 'zim':*A"),
        ("CAST(public.stem_query_pl(:a) AS text)", "Lego Technic", "'lego':A & 'technic':*A"),
        (
            "CAST(public.stem_query_pl(:a) AS text)",
            "Rock'n'roll",
            "'rock':A & 'n':A & 'roll':A",
        ),
        ("CAST(public.stem_query_pl(:a) AS text)", "İstanbul", "'istanbul':*A"),
        ("CAST(public.stem_query_pl(:a) AS text)", "grę zimą", "'gre':A & 'zim':*A"),
        ("CAST(public.stem_query_pl(:a) AS text)", "na i z", None),
    ],
)
async def test_textFunctions_pinnedExamples_match(
    db_session: AsyncSession, expression: str, argument: str, expected: Any
) -> None:
    result = await db_session.scalar(text(f"SELECT {expression}"), {"a": argument})

    assert result == expected


async def test_stemQuery_productSearchVector_prefixAndExactWeightA(
    db_session: AsyncSession,
) -> None:
    def matches(want: str, name: str) -> Any:
        return db_session.scalar(
            text(
                "SELECT setweight(to_tsvector('simple', fold_pl(:name)), 'A') "
                "@@ public.stem_query_pl(:want)"
            ),
            {"want": want, "name": name},
        )

    assert await matches("kurtka zimowa", "Kurtka na zimę") is True
    assert await matches("kurtka na zimę", "Kurtka zimowa") is True
    assert await matches("lego", "Legowisko dla psa") is False
    assert await matches("lego", "Klocki Lego") is True


async def test_generatedColumns_nameUpdated_followName(db_session: AsyncSession) -> None:
    want_id = await _insert_want(db_session, await _seeker(db_session), name="kurtka na zimę")

    generated = dict(
        (
            await db_session.execute(
                text(
                    "SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute "
                    "WHERE attrelid = 'wants'::regclass AND attgenerated = 's'"
                )
            )
        )
        .tuples()
        .all()
    )
    select_generated = text(
        "SELECT name_folded, CAST(name_query AS text), CAST(stem_query AS text), stem_words "
        "FROM wants WHERE id = :id"
    )
    before = (await db_session.execute(select_generated, {"id": want_id})).one()
    await db_session.execute(
        text("UPDATE wants SET name = 'Rowerek biegowy' WHERE id = :id"), {"id": want_id}
    )
    after = (await db_session.execute(select_generated, {"id": want_id})).one()

    assert generated == {
        "name_folded": "text",
        "name_query": "tsquery",
        "stem_query": "tsquery",
        "stem_words": "text[]",
    }
    assert tuple(before) == (
        "kurtka na zime",
        "'kurtka' & 'na' & 'zime'",
        "'kurtk':*A & 'zim':*A",
        ["kurtk", "zim"],
    )
    assert tuple(after) == (
        "rowerek biegowy",
        "'rowerek' & 'biegowy'",
        "'rower':*A & 'bieg':*A",
        ["rower", "bieg"],
    )


async def test_generatedColumns_emptySearchPath_insertAndUpdateSucceed(
    db_session: AsyncSession,
) -> None:
    seeker = await _seeker(db_session)
    await db_session.execute(text("SET LOCAL search_path = ''"))

    want_id = await _insert_want(db_session, seeker, name="Kurtka zimowa")
    await db_session.execute(
        text("UPDATE public.wants SET name = 'Lego dla dziecka' WHERE id = :id"), {"id": want_id}
    )
    row = (
        await db_session.execute(
            text(
                "SELECT CAST(stem_query AS pg_catalog.text), stem_words FROM public.wants "
                "WHERE id = :id"
            ),
            {"id": want_id},
        )
    ).one()
    await db_session.execute(text("SET LOCAL search_path = DEFAULT"))

    assert tuple(row) == ("'lego':A & 'dzieck':*A", ["lego", "dzieck"])


async def test_radiusCheck_zeroAbove100OrWithoutLocality_rejected(
    db_session: AsyncSession,
) -> None:
    seeker = await _seeker(db_session)

    for locality_id, radius_km in ((WARSAW_SIMC_ID, 0), (WARSAW_SIMC_ID, 101), (None, 10)):
        with pytest.raises(IntegrityError, match=RADIUS_CHECK):
            await _insert_want(db_session, seeker, locality_id=locality_id, radius_km=radius_km)

    for radius_km in (None, 1, 100):
        await _insert_want(db_session, seeker, locality_id=WARSAW_SIMC_ID, radius_km=radius_km)


async def test_closedAtCheck_notMatchingStatus_rejectedBothDirections(
    db_session: AsyncSession,
) -> None:
    seeker = await _seeker(db_session)
    now = datetime.utcnow()

    with pytest.raises(IntegrityError, match=CLOSED_AT_CHECK):
        await _insert_want(db_session, seeker, status="ACTIVE", closed_at=now)
    with pytest.raises(IntegrityError, match=CLOSED_AT_CHECK):
        await _insert_want(db_session, seeker, status="WITHDRAWN", closed_at=None)

    await _insert_want(db_session, seeker, status="FULFILLED", closed_at=now)


async def test_tierChecks_matchWithWordsOrSuggestionWithout_rejected(
    db_session: AsyncSession,
) -> None:
    want_id = await _insert_want(db_session, await _seeker(db_session))
    insert_match = text(
        "INSERT INTO want_matches (created_at, updated_at, want_id, item_id, source, score, "
        "tier, missing_words) VALUES (now(), now(), :want_id, gen_random_uuid(), 'FORWARD', 1, "
        ":tier, :missing_words)"
    )

    async def insert(tier: str, missing_words: list[str] | None) -> None:
        async with db_session.begin_nested():
            await db_session.execute(
                insert_match, {"want_id": want_id, "tier": tier, "missing_words": missing_words}
            )

    for tier, missing_words, check in (
        ("OTHER", None, f"{TIER_CHECK}|{MISSING_WORDS_CHECK}"),
        ("MATCH", ["Claas"], MISSING_WORDS_CHECK),
        ("SUGGESTION", None, MISSING_WORDS_CHECK),
        ("SUGGESTION", [], MISSING_WORDS_CHECK),
    ):
        with pytest.raises(IntegrityError, match=check):
            await insert(tier, missing_words)

    await insert("MATCH", None)
    await insert("SUGGESTION", ["Claas"])
    default_tier = await db_session.scalar(
        text(
            "INSERT INTO want_matches (created_at, updated_at, want_id, item_id, source, score) "
            "VALUES (now(), now(), :want_id, gen_random_uuid(), 'SCAN', 1) RETURNING tier"
        ),
        {"want_id": want_id},
    )
    tier_check = await db_session.scalar(
        text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = :name AND conrelid = 'want_matches'::regclass"
        ),
        {"name": TIER_CHECK},
    )
    assert default_tier == "MATCH"
    assert "'MATCH'" in tier_check and "'SUGGESTION'" in tier_check


async def _next_notification(queue: asyncio.Queue[str], timeout: float) -> str | None:
    try:
        return await asyncio.wait_for(queue.get(), timeout)
    except TimeoutError:
        return None


async def test_matchRequestedTrigger_setOnInsertOrUpdate_notifiesUnlessCleared(
    engine: AsyncEngine,
) -> None:
    queue: asyncio.Queue[str] = asyncio.Queue()

    def received(_conn: Any, _pid: int, _channel: str, payload: str) -> None:
        queue.put_nowait(payload)

    async with AsyncSession(engine) as db:
        seeker = await _seeker(db)
        await db.commit()
    want_ids: list[uuid.UUID] = []
    async with engine.connect() as listen_conn:
        raw = await listen_conn.get_raw_connection()
        listener = raw.driver_connection
        assert listener is not None
        await listener.add_listener(CHANNEL, received)
        try:

            async def committed(statement: str, **params: Any) -> Any:
                async with engine.begin() as conn:
                    result = await conn.execute(text(statement), params)
                    return result.scalar() if result.returns_rows else None

            flagged = await committed(
                INSERT_WANT, **_want_values(seeker, match_requested_at=datetime.utcnow())
            )
            want_ids.append(flagged)
            assert await _next_notification(queue, 5) == str(flagged)

            unflagged = await committed(INSERT_WANT, **_want_values(seeker))
            want_ids.append(unflagged)
            assert await _next_notification(queue, 1) is None

            await committed(
                "UPDATE wants SET match_requested_at = :now WHERE id = :id",
                now=datetime.utcnow(),
                id=unflagged,
            )
            assert await _next_notification(queue, 5) == str(unflagged)

            await committed(
                "UPDATE wants SET match_requested_at = NULL WHERE id = :id", id=unflagged
            )
            await committed("UPDATE wants SET note = 'x' WHERE id = :id", id=flagged)
            assert await _next_notification(queue, 1) is None
        finally:
            await listener.remove_listener(CHANNEL, received)
            async with engine.begin() as conn:
                await conn.execute(
                    text("DELETE FROM wants WHERE id = ANY(:ids)"), {"ids": want_ids}
                )
                await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": seeker})
