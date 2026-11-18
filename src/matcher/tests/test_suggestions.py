"""The SUGGESTION tier (FR-MR-03): wants of at least three want words, pairs
with exactly one word missing, the cap per want across runs, the original
spelling in `missing_words`, and no bell."""

import uuid
from datetime import timedelta

import asyncpg
import pytest

from matcher import clock, rules, statements
from tests import conftest

_TRACTOR = "Traktor bruder Deutz"


async def _stored(db: asyncpg.Pool, want_name: str) -> tuple[str, list[str] | None] | None:
    """`(tier, missing_words)` of the want's pair with the tractor, if stored."""
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    item_id = await conftest.lists(db, lister, _TRACTOR)
    want_id = await conftest.want(db, seeker.party_id, want_name)

    await conftest.match_forward(db, want_id, now=clock.utcnow())

    row = (await conftest.stored(db, want_id)).get(item_id)
    return (row["tier"], row["missing_words"]) if row else None


@pytest.mark.parametrize(
    ("want_name", "expected"),
    [
        ("Traktor Bruder Claas", ("SUGGESTION", ["Claas"])),
        ("Traktor Claas", None),
        ("Traktor na Claas i z", None),
        ("Traktor Claas Fendt", None),
        ("Traktor Bruder Claas Fendt", None),
        ("Traktor Bruder Deutz", ("MATCH", None)),
    ],
)
async def test_matchForward_suggestion_threeWantWordsExactlyOneMissing(
    db: asyncpg.Pool, want_name: str, expected: tuple[str, list[str] | None] | None
) -> None:
    assert await _stored(db, want_name) == expected


@pytest.mark.parametrize(
    ("want_name", "missing_words"),
    [
        ("Traktor Bruder CLAAS", ["CLAAS"]),
        ("traktor ŻÓŁTY bruder", ["ŻÓŁTY"]),
    ],
)
async def test_matchForward_suggestion_missingWordInItsOriginalSpelling(
    db: asyncpg.Pool, want_name: str, missing_words: list[str]
) -> None:
    assert await _stored(db, want_name) == ("SUGGESTION", missing_words)


async def test_matchForward_suggestionCap_heldInTotalAcrossRuns(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    start = clock.utcnow() - timedelta(hours=1)
    first_batch = [
        await conftest.lists(db, lister, _TRACTOR, listed_at=start + timedelta(minutes=n))
        for n in range(rules.SUGGESTION_CAP - 3)
    ]
    want_id = await conftest.want(db, seeker.party_id, "Traktor Bruder Claas")

    first = await conftest.match_forward(db, want_id, now=clock.utcnow())
    second_batch = [
        await conftest.lists(db, lister, _TRACTOR, listed_at=start + timedelta(minutes=30 + n))
        for n in range(5)
    ]
    second = await conftest.match_window(
        db, listed_after=start + timedelta(minutes=29), now=clock.utcnow()
    )
    third = await conftest.match_forward(db, want_id, now=clock.utcnow())
    rows = await conftest.stored(db, want_id)

    assert {pair.item_id for pair in first} == set(first_batch)
    assert {pair.item_id for pair in second} == set(second_batch[-3:])
    assert third == []
    assert len(rows) == rules.SUGGESTION_CAP
    assert {row["tier"] for row in rows.values()} == {"SUGGESTION"}


async def test_matchForward_suggestion_bornSeenWithoutOutboxRow(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    item_id = await conftest.lists(db, lister, _TRACTOR)
    want_id = await conftest.want(db, seeker.party_id, "Traktor Bruder Claas")
    now = clock.utcnow()

    pairs = await conftest.match_forward(db, want_id, now=now)
    row = (await conftest.stored(db, want_id))[item_id]

    assert pairs == [statements.StoredPair(want_id, item_id, "SUGGESTION")]
    assert (row["source"], row["seen_at"], row["created_at"], row["updated_at"]) == (
        "FORWARD",
        now,
        now,
        now,
    )
    assert row["score"] < 1.0
    assert await db.fetchval("SELECT count(*) FROM outbox_entries") == 0


async def test_matchWindow_matchAndSuggestion_neverBothForOnePair(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    item_id = await conftest.lists(db, lister, _TRACTOR, listed_at=now - timedelta(minutes=1))
    exact: uuid.UUID = await conftest.want(db, seeker.party_id, "Traktor Bruder Deutz")
    near: uuid.UUID = await conftest.want(db, seeker.party_id, "Traktor Bruder Claas")

    pairs = await conftest.match_window(db, listed_after=now - timedelta(minutes=2), now=now)

    assert sorted(pairs) == sorted(
        [
            statements.StoredPair(exact, item_id, "MATCH"),
            statements.StoredPair(near, item_id, "SUGGESTION"),
        ]
    )


async def test_suggestionCap_storedSuggestionsNoLongerMatchable_freeTheirPlaces(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    start = clock.utcnow() - timedelta(hours=1)
    stale = [
        await conftest.lists(db, lister, _TRACTOR, listed_at=start + timedelta(minutes=n))
        for n in range(rules.SUGGESTION_CAP)
    ]
    want_id = await conftest.want(db, seeker.party_id, "Traktor Bruder Claas")
    assert len(await conftest.match_forward(db, want_id, now=clock.utcnow())) == len(stale)
    half = len(stale) // 2
    await db.execute(
        "UPDATE inventory_balances SET status = 'RESERVED' WHERE item_id = ANY($1::uuid[])",
        stale[:half],
    )
    await db.execute(
        "UPDATE inventory_items SET deleted_at = $1 WHERE id = ANY($2::uuid[])",
        clock.utcnow(),
        stale[half:],
    )
    in_window = await conftest.lists(db, lister, _TRACTOR, listed_at=start + timedelta(minutes=30))

    window = await conftest.match_window(
        db, listed_after=start + timedelta(minutes=29), now=clock.utcnow()
    )
    later = await conftest.lists(db, lister, _TRACTOR, listed_at=start + timedelta(minutes=40))
    forward = await conftest.match_forward(db, want_id, now=clock.utcnow())

    assert window == [statements.StoredPair(want_id, in_window, "SUGGESTION")]
    assert forward == [statements.StoredPair(want_id, later, "SUGGESTION")]
    assert len(await conftest.stored(db, want_id)) == rules.SUGGESTION_CAP + 2
