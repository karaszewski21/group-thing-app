"""The per-word text rules of both tiers (FR-MR-02..04): the fixed acceptance
cases, the 4-char exact rule, stop-words and description words, and the
trigram GUC the `<%` candidate relies on (M2)."""

import asyncpg
import pytest

from matcher import clock
from tests import conftest


async def _forward(
    db: asyncpg.Pool, want_name: str, item_name: str, *, description: str | None = None
) -> asyncpg.Record | None:
    """The stored row for one want and one listed item after a forward run."""
    lister = await conftest.owner(db)
    seeker = await conftest.person(db, "Szukający")
    item_id = await conftest.lists(db, lister, item_name, description=description)
    want_id = await conftest.want(db, seeker.party_id, want_name)

    await conftest.match_forward(db, want_id, now=clock.utcnow())

    return (await conftest.stored(db, want_id)).get(item_id)


@pytest.mark.parametrize(
    ("want_name", "item_name", "tier", "missing_words"),
    [
        ("kurtka zimowa", "Kurtka na zimę", "MATCH", None),
        ("kurtka na zimę", "Kurtka zimowa", "MATCH", None),
        ("rower dla dziecka", "Rower biegowy dla dziecka", "MATCH", None),
        ("Traktor Bruder Claas", "Traktor bruder Deutz", "SUGGESTION", ["Claas"]),
        ("Traktor na Bruder", "Traktor bruder Deutz", "MATCH", None),
        ("rowerek biegowy", "Rower biegowy dla dziecka", "MATCH", None),
        ("kurtka zimowa", "Kurtka przejściowa", None, None),
        ("traktor bruder", "Koparka Bruder", None, None),
        ("kurtka", "Kurtyna prysznicowa", None, None),
        ("lego", "Legowisko dla psa", None, None),
        ("kurtka zimowq", "Kurtka zimowa", "MATCH", None),
        ("kurtka zimowq", "Kurtka na zimę", None, None),
    ],
)
async def test_matchForward_acceptanceCases_expectedTier(
    db: asyncpg.Pool,
    want_name: str,
    item_name: str,
    tier: str | None,
    missing_words: list[str] | None,
) -> None:
    row = await _forward(db, want_name, item_name)

    assert (row and row["tier"], row and row["missing_words"]) == (tier, missing_words)


async def test_typoPath_pinnedSimilarities_eitherSideOfTheThreshold(db: asyncpg.Pool) -> None:
    similarities = await db.fetchrow(
        "SELECT word_similarity('zimowq', fold_pl('Kurtka zimowa')) AS close,"
        " word_similarity('zimowq', fold_pl('Kurtka na zimę')) AS far"
    )

    assert similarities is not None
    assert similarities["close"] == pytest.approx(0.714, abs=0.001)
    assert similarities["far"] == pytest.approx(0.429, abs=0.001)


@pytest.mark.parametrize(
    ("want_name", "item_name", "tier"),
    [
        ("lego", "Klocki Lego duplo", "MATCH"),
        ("auto", "Autobus z klocków", None),
        ("auta", "Auto zabawka", None),
        ("lega", "Klocki Lego", None),
        ("zimą", "Sanki na zimę", "MATCH"),
        ("grę", "Gra planszowa", None),
    ],
)
async def test_matchForward_shortWords_exactLexemeOnlyNoTypoPath(
    db: asyncpg.Pool, want_name: str, item_name: str, tier: str | None
) -> None:
    row = await _forward(db, want_name, item_name)

    assert (row and row["tier"]) == tier


@pytest.mark.parametrize(
    ("want_name", "tier", "missing_words"),
    [
        ("Traktor dla Bruder Claas", "SUGGESTION", ["Claas"]),
        ("Traktor z Claas", None, None),
        ("Traktor Bruder i Deutz", "MATCH", None),
    ],
)
async def test_matchForward_stopWords_neverCountedNorMissing(
    db: asyncpg.Pool, want_name: str, tier: str | None, missing_words: list[str] | None
) -> None:
    row = await _forward(db, want_name, "Traktor bruder Deutz")

    assert (row and row["tier"], row and row["missing_words"]) == (tier, missing_words)


@pytest.mark.parametrize(
    ("want_name", "item_name", "description", "tier", "missing_words"),
    [
        ("kurtka zimowa", "Kurtka", "zimowa, ciepła", None, None),
        ("Traktor Bruder Claas", "Traktor bruder Deutz", "jak Claas", "SUGGESTION", ["Claas"]),
        ("narty zjazdowe", "Narty", "zjazdowe, zjazdowy, zjazdówki", None, None),
    ],
)
async def test_matchForward_descriptionWords_ignored(
    db: asyncpg.Pool,
    want_name: str,
    item_name: str,
    description: str,
    tier: str | None,
    missing_words: list[str] | None,
) -> None:
    row = await _forward(db, want_name, item_name, description=description)

    assert (row and row["tier"], row and row["missing_words"]) == (tier, missing_words)


async def test_matcherConnection_wordSimilarityThreshold_isTheDefault(
    db: asyncpg.Pool,
) -> None:
    async with db.acquire() as connection:
        await connection.execute("SELECT 'a' <% 'a'")
        threshold = await connection.fetchval("SHOW pg_trgm.word_similarity_threshold")

    assert threshold == "0.6"
