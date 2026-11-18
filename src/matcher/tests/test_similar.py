"""The SIMILAR tier (R13–R15): pairs whose two vectors, both of the pinned
`EMBEDDING_MODEL_ID`, lie within `SEMANTIC_SIMILARITY_MIN` cosine
similarity, stored last and born seen, capped per want across runs, under
the same visibility rule, upgraded in place to a lexical tier when a
re-pointed item now matches by its words, and the contract gate on revision
0101."""

import asyncio
import math
import uuid
from datetime import datetime, timedelta

import asyncpg

from matcher import clock, rules, statements, window
from matcher import db as matcher_db
from matcher.settings import Settings
from tests import conftest

_DIMENSIONS = 768
_WANT = "Rower górski"
_LISTING = "Kurtka zimowa"
_OTHER_MODEL = "other/model@0000000000000000000000000000000000000000+int8"


def _vector(similarity: float) -> str:
    """`cos θ·e1 + sin θ·e2` as a halfvec text literal: its cosine similarity
    with `e1` (`_vector(1.0)`) is `similarity`."""
    values = [similarity, math.sqrt(1 - similarity**2)] + [0.0] * (_DIMENSIONS - 2)
    return "[" + ",".join(f"{value:.7g}" for value in values) + "]"


async def _embed_want(
    db: conftest.Db, want_id: uuid.UUID, *, model_id: str = rules.EMBEDDING_MODEL_ID
) -> None:
    await db.execute(
        "INSERT INTO want_embeddings (want_id, model_id, embedding, updated_at)"
        " VALUES ($1, $2, CAST($3 AS halfvec), $4)",
        want_id,
        model_id,
        _vector(1.0),
        clock.utcnow(),
    )


async def _embed_item(
    db: conftest.Db,
    item_id: uuid.UUID,
    similarity: float,
    *,
    model_id: str = rules.EMBEDDING_MODEL_ID,
    at: datetime | None = None,
) -> None:
    """The vector of the item's product, written at `at` (default now), which
    moves the listing's `changed_at` there."""
    await db.execute(
        "INSERT INTO product_embeddings (product_id, model_id, embedding, updated_at)"
        " SELECT product_id, $2, CAST($3 AS halfvec), $4 FROM inventory_items WHERE id = $1",
        item_id,
        model_id,
        _vector(similarity),
        at or clock.utcnow(),
    )


async def _listed(
    db: conftest.Db,
    lister: conftest.Owner,
    similarity: float,
    *,
    name: str = _LISTING,
    model_id: str = rules.EMBEDDING_MODEL_ID,
    listed_at: datetime | None = None,
    visibility: str = "PUBLIC",
) -> uuid.UUID:
    item_id = await conftest.lists(db, lister, name, listed_at=listed_at, visibility=visibility)
    await _embed_item(db, item_id, similarity, model_id=model_id, at=listed_at)
    return item_id


async def _embedded_want(
    db: conftest.Db,
    seeker: conftest.Person,
    *,
    name: str = _WANT,
    model_id: str = rules.EMBEDDING_MODEL_ID,
) -> uuid.UUID:
    want_id = await conftest.want(db, seeker.party_id, name)
    await _embed_want(db, want_id, model_id=model_id)
    return want_id


async def test_matchForward_similar_bornSeenScoredByCosine_belowTheThresholdNotStored(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    near = await _listed(db, lister, 0.95)
    await _listed(db, lister, 0.85)
    want_id = await _embedded_want(db, seeker)
    now = clock.utcnow()

    pairs = await conftest.match_forward(db, want_id, now=now)
    rows = await conftest.stored(db, want_id)

    assert pairs == [statements.StoredPair(want_id, near, "SIMILAR")]
    row = rows[near]
    assert (row["source"], row["seen_at"], row["missing_words"]) == ("FORWARD", now, None)
    assert math.isclose(row["score"], 0.95, abs_tol=0.005)
    assert set(rows) == {near}


async def test_similar_wantVectorOfAnotherModel_noPairForwardOrWindow(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    await _listed(db, lister, 1.0, listed_at=now - timedelta(minutes=1))
    want_id = await _embedded_want(db, seeker, model_id=_OTHER_MODEL)

    forward = await conftest.match_forward(db, want_id, now=now)
    scanned = await conftest.match_window(db, listed_after=now - timedelta(minutes=2), now=now)

    assert (forward, scanned) == ([], [])


async def test_similar_listingVectorOfAnotherModel_noPairForwardOrWindow(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    await _listed(db, lister, 1.0, model_id=_OTHER_MODEL, listed_at=now - timedelta(minutes=1))
    want_id = await _embedded_want(db, seeker)

    forward = await conftest.match_forward(db, want_id, now=now)
    scanned = await conftest.match_window(db, listed_after=now - timedelta(minutes=2), now=now)

    assert (forward, scanned) == ([], [])


async def test_similar_lexicalMatchFirst_neverAlsoSimilar(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    item_id = await _listed(
        db, lister, 1.0, name="Rower górski czerwony", listed_at=now - timedelta(minutes=1)
    )
    forward_want = await _embedded_want(db, seeker)

    forward = await conftest.match_forward(db, forward_want, now=now)
    window_want = await _embedded_want(db, seeker)
    scanned = await conftest.match_window(db, listed_after=now - timedelta(minutes=2), now=now)

    assert forward == [statements.StoredPair(forward_want, item_id, "MATCH")]
    assert scanned == [statements.StoredPair(window_want, item_id, "MATCH")]
    assert await db.fetchval("SELECT count(*) FROM want_matches WHERE tier = 'SIMILAR'") == 0


async def test_matchWindow_matchCappedOut_lexicalCandidateNotStoredAsSimilar(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    items = [
        await _listed(
            db, lister, 1.0, name="Rower górski czerwony", listed_at=now - timedelta(minutes=1)
        )
        for _ in range(rules.MATCH_TOP_N + 1)
    ]
    want_id = await _embedded_want(db, seeker)

    scanned = await conftest.match_window(db, listed_after=now - timedelta(minutes=2), now=now)
    rows = await conftest.stored(db, want_id)

    assert len(scanned) == rules.MATCH_TOP_N
    assert set(rows) < set(items)
    assert {row["tier"] for row in rows.values()} == {"MATCH"}


async def test_matchSimilarForward_suggestionQualifyingListing_skipped(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    await _listed(db, lister, 0.95, name="Traktor bruder Deutz")
    semantic = await _listed(db, lister, 0.95)
    want_id = await _embedded_want(db, seeker, name="Traktor Bruder Claas")

    async with matcher_db.acquire(db) as connection:
        pairs = await statements.match_similar_forward(connection, want_id, now=clock.utcnow())

    assert pairs == [statements.StoredPair(want_id, semantic, "SIMILAR")]


async def test_similarCap_heldAcrossRuns_nonMatchableStoredRowFreesItsPlace(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    first_batch = [await _listed(db, lister, 0.95) for _ in range(rules.SEMANTIC_CAP - 3)]
    want_id = await _embedded_want(db, seeker)

    first = await conftest.match_forward(db, want_id, now=clock.utcnow())
    second_batch = [await _listed(db, lister, 0.95) for _ in range(5)]
    second = await conftest.match_forward(db, want_id, now=clock.utcnow())
    third = await conftest.match_forward(db, want_id, now=clock.utcnow())
    await db.execute(
        "UPDATE inventory_balances SET status = 'RESERVED' WHERE item_id = ANY($1::uuid[])",
        first_batch[:2],
    )
    fourth = await conftest.match_forward(db, want_id, now=clock.utcnow())
    rows = await conftest.stored(db, want_id)

    assert {pair.item_id for pair in first} == set(first_batch)
    assert len(second) == 3 and {pair.item_id for pair in second} < set(second_batch)
    assert third == []
    assert {pair.item_id for pair in fourth} == set(second_batch) - {p.item_id for p in second}
    assert len(rows) == rules.SEMANTIC_CAP + 2
    assert {row["tier"] for row in rows.values()} == {"SIMILAR"}


async def test_similar_privateListingOutsideSharedGroups_excluded(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    member = await conftest.person(db, "Członek")
    stranger = await conftest.person(db, "Obcy")
    private_group = await conftest.group(db, lister.party_id)
    await conftest.join_group(db, lister.party_id, private_group)
    await conftest.join_group(db, member.party_id, private_group)
    private = await _listed(db, lister, 0.95, visibility="PRIVATE")

    for_member = await _embedded_want(db, member)
    for_stranger = await _embedded_want(db, stranger)

    assert await conftest.match_forward(db, for_member, now=clock.utcnow()) == [
        statements.StoredPair(for_member, private, "SIMILAR")
    ]
    assert await conftest.match_forward(db, for_stranger, now=clock.utcnow()) == []


async def test_runWindow_similarBornSeen_noBell_countedApartFromSuggestions(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    listed_at = now - timedelta(minutes=1)
    similar_item = await _listed(db, lister, 0.95, listed_at=listed_at)
    tractor = await conftest.lists(db, lister, "Traktor bruder Deutz", listed_at=listed_at)
    similar_want = await _embedded_want(db, seeker)
    near_want = await conftest.want(db, seeker.party_id, "Traktor Bruder Claas")

    run = await window.run_window(db, now=now)
    rows = await db.fetch("SELECT want_id, item_id, tier, source, seen_at FROM want_matches")

    assert run is not None
    assert (run.matches, run.suggestions, run.similar, run.outbox_rows) == (0, 1, 1, 0)
    assert {tuple(row) for row in rows} == {
        (similar_want, similar_item, "SIMILAR", "SCAN", now),
        (near_want, tractor, "SUGGESTION", "SCAN", now),
    }
    assert await conftest.bells_due(db) == []


async def _repoint(
    db: conftest.Db, lister: conftest.Owner, item_id: uuid.UUID, name: str, at: datetime
) -> None:
    """The owner's rename: a new embedded product, the same item re-pointed at `at`."""
    product_id = await conftest.product(db, name, lister.category_id)
    await db.execute(
        "INSERT INTO product_embeddings (product_id, model_id, embedding, updated_at)"
        " VALUES ($1, $2, CAST($3 AS halfvec), $4)",
        product_id,
        rules.EMBEDDING_MODEL_ID,
        _vector(0.95),
        at,
    )
    await db.execute(
        "UPDATE inventory_items SET product_id = $2, updated_at = $3 WHERE id = $1",
        item_id,
        product_id,
        at,
    )


async def _stored_similar(
    db: asyncpg.Pool, lister: conftest.Owner, seeker: conftest.Person, want_name: str
) -> tuple[uuid.UUID, uuid.UUID]:
    item_id = await _listed(db, lister, 0.95, listed_at=clock.utcnow() - timedelta(minutes=10))
    want_id = await _embedded_want(db, seeker, name=want_name)
    assert await conftest.match_forward(db, want_id, now=clock.utcnow()) == [
        statements.StoredPair(want_id, item_id, "SIMILAR")
    ]
    return want_id, item_id


async def test_runWindow_repointedToLexicalMatch_similarUpgradedToUnseenMatch_oneBell(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id, item_id = await _stored_similar(db, lister, seeker, _WANT)
    await _repoint(db, lister, item_id, "Rower górski czerwony", clock.utcnow())
    now = clock.utcnow()

    run = await window.run_window(db, now=now)
    row = (await conftest.stored(db, want_id))[item_id]

    assert run is not None and (run.matches, run.similar) == (1, 0)
    assert (row["tier"], row["source"], row["seen_at"], row["missing_words"]) == (
        "MATCH",
        "SCAN",
        None,
        None,
    )
    assert await conftest.bells_due(db) == [
        {"pairs": [[str(want_id), str(item_id)]], "expiring": []}
    ]


async def test_matchForward_repointedToLexicalMatch_similarUpgradedToSeenMatch(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id, item_id = await _stored_similar(db, lister, seeker, _WANT)
    await _repoint(db, lister, item_id, "Rower górski czerwony", clock.utcnow())
    now = clock.utcnow()

    pairs = await conftest.match_forward(db, want_id, now=now)
    again = await conftest.match_forward(db, want_id, now=clock.utcnow())
    row = (await conftest.stored(db, want_id))[item_id]

    assert pairs == [statements.StoredPair(want_id, item_id, "MATCH")]
    assert again == []
    assert (row["tier"], row["source"], row["seen_at"]) == ("MATCH", "FORWARD", now)


async def test_runWindow_repointedToSuggestion_similarUpgradedToSeenSuggestion_noBell(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id, item_id = await _stored_similar(db, lister, seeker, "Traktor Bruder Claas")
    await _repoint(db, lister, item_id, "Traktor bruder Deutz", clock.utcnow())
    now = clock.utcnow()

    run = await window.run_window(db, now=now)
    row = (await conftest.stored(db, want_id))[item_id]

    assert run is not None and (run.matches, run.suggestions, run.similar) == (0, 1, 0)
    assert (row["tier"], row["source"], row["seen_at"], row["missing_words"]) == (
        "SUGGESTION",
        "SCAN",
        now,
        ["Claas"],
    )
    assert await conftest.bells_due(db) == []


async def test_runWindow_storedSuggestionRepointedToMatch_rowUnchanged_noBell(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    item_id = await conftest.lists(
        db, lister, "Traktor bruder Deutz", listed_at=clock.utcnow() - timedelta(minutes=10)
    )
    want_id = await conftest.want(db, seeker.party_id, "Traktor Bruder Claas")
    assert await conftest.match_forward(db, want_id, now=clock.utcnow()) == [
        statements.StoredPair(want_id, item_id, "SUGGESTION")
    ]
    before = dict((await conftest.stored(db, want_id))[item_id])
    await _repoint(db, lister, item_id, "Traktor bruder Claas", clock.utcnow())

    run = await window.run_window(db, now=clock.utcnow())
    after = dict((await conftest.stored(db, want_id))[item_id])

    assert run is not None and (run.matches, run.suggestions, run.similar) == (0, 0, 0)
    assert after == before
    assert await conftest.bells_due(db) == []


async def test_matchForward_lexicalRowCommittedDuringTheInsert_conflictLeavesItUnreturned(
    db: asyncpg.Pool,
) -> None:
    """The race the `WHERE want_matches.tier = 'SIMILAR'` guard covers: a
    MATCH row committed after the forward statement's snapshot, so its
    "not stored yet" check passes and the insert meets the row on conflict."""
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    item_id = await conftest.lists(db, lister, "Rower górski czerwony")
    want_id = await conftest.want(db, seeker.party_id, _WANT)
    stored_at = clock.utcnow() - timedelta(minutes=5)

    async with matcher_db.acquire(db) as holder, matcher_db.acquire(db) as forward:
        transaction = holder.transaction()
        await transaction.start()
        try:
            await holder.execute(
                "INSERT INTO want_matches (id, created_at, updated_at, want_id, item_id, source,"
                " score, seen_at, tier, missing_words)"
                " VALUES (gen_random_uuid(), $1, $1, $2, $3, 'SCAN', 0.5, NULL, 'MATCH', NULL)",
                stored_at,
                want_id,
                item_id,
            )
            pending = asyncio.create_task(
                statements.match_forward(forward, want_id, now=clock.utcnow())
            )
            pid = forward.get_server_pid()
            async with asyncio.timeout(5):
                while not await db.fetchval(
                    "SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = $1", pid
                ):
                    await asyncio.sleep(0.01)
        except BaseException:
            await transaction.rollback()
            raise
        await transaction.commit()
        pairs = await asyncio.wait_for(pending, timeout=5)
    row = (await conftest.stored(db, want_id))[item_id]

    assert pairs == []
    assert (row["tier"], row["source"], row["score"], row["seen_at"], row["updated_at"]) == (
        "MATCH",
        "SCAN",
        0.5,
        None,
        stored_at,
    )


async def test_missingContract_revision0100AndMissingWantEmbeddings_reported(
    db: asyncpg.Pool, settings: Settings
) -> None:
    name = f"gate_{uuid.uuid4().hex[:12]}"
    await db.execute(f"CREATE DATABASE {name}")
    try:
        connection = await asyncpg.connect(f"{settings.dsn.rsplit('/', 1)[0]}/{name}")
        try:
            await connection.execute(
                "CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY);"
                "INSERT INTO alembic_version VALUES ('0100');"
                "CREATE VIEW matchable_listings AS SELECT 1 AS item_id;"
                "CREATE TABLE product_embeddings (product_id uuid)"
            )
            at_0100 = await matcher_db.missing_contract(connection)
            await connection.execute("UPDATE alembic_version SET version_num = '0101'")
            at_0101 = await matcher_db.missing_contract(connection)
            await connection.execute("CREATE TABLE want_embeddings (want_id uuid)")
            complete = await matcher_db.missing_contract(connection)
        finally:
            await connection.close()
    finally:
        await db.execute(f"DROP DATABASE {name} WITH (FORCE)")

    assert at_0100 == "revision 0100 is before 0101"
    assert at_0101 == "no public.want_embeddings table"
    assert complete is None


async def test_missingContract_revision0101WithoutProductEmbeddings_reported(
    db: asyncpg.Pool, settings: Settings
) -> None:
    name = f"gate_{uuid.uuid4().hex[:12]}"
    await db.execute(f"CREATE DATABASE {name}")
    try:
        connection = await asyncpg.connect(f"{settings.dsn.rsplit('/', 1)[0]}/{name}")
        try:
            await connection.execute(
                "CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY);"
                "INSERT INTO alembic_version VALUES ('0101');"
                "CREATE VIEW matchable_listings AS SELECT 1 AS item_id;"
                "CREATE TABLE want_embeddings (want_id uuid)"
            )
            missing = await matcher_db.missing_contract(connection)
        finally:
            await connection.close()
    finally:
        await db.execute(f"DROP DATABASE {name} WITH (FORCE)")

    assert missing == "no public.product_embeddings table"
