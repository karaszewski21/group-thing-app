"""The match statements: `INSERT … SELECT` into `want_matches`, one per tier
and direction, over the DB contract (`matchable_listings`,
`private_group_peers`, `wants.stem_words`/`stem_query`, `words_pl`).

A pair is a candidate when the shared predicates hold (FR-MR-01): an ACTIVE,
unexpired want with at least one want word, a matchable listing of another
party that the seeker may see, within the want's offer mode, category and
locality, and not stored yet. Its name is then checked word by word: a want
word hits when its stem prefix (a short word: its exact lexeme) is in weight A
of the listing's `search_vector`, or, for a long word, when its trigram word
similarity to the listing name reaches `WORD_SIMILARITY_MIN`. Every word
hitting makes a MATCH; at least three want words with exactly one missing make
a SUGGESTION, which names the missing word as the seeker wrote it. A SIMILAR
pair needs no word check: the want's and the listing's vectors, both of
`EMBEDDING_MODEL_ID`, lie within `SEMANTIC_SIMILARITY_MIN` cosine
similarity, and the lexical tiers would not claim it: SIMILAR never takes a
listing that qualifies for MATCH or SUGGESTION, whether or not that tier stores
it in the same run. It is born seen in both directions (no bell).

A stored pair is not stored again, with one exception: SIMILAR may be
upgraded to a lexical tier by a later run, never the reverse. When an owner
re-points an item to a product whose name the want now matches word by word,
the lexical statements take the stored SIMILAR row over in place as if it
were new, so a window MATCH lands unseen and rings its bell. MATCH and
SUGGESTION rows stay as stored.

Forward (one claimed want) reaches the listings through the text indexes on
the products: `search_vector @@` any of the want's stems, or `<%` on the
folded name. The window (every want, the listings of
`(listed_after, listed_until]`)
materialises the listings once and compares the plain columns before the
names. Both directions share every predicate, so they store the same pairs.
Every matcher constant is a bound parameter."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import NamedTuple

import asyncpg

from matcher import rules


class StoredPair(NamedTuple):
    want_id: uuid.UUID
    item_id: uuid.UUID
    tier: str


@dataclass(frozen=True)
class Statement:
    sql: str
    similar: bool


# Every statement: $1 now, $2 the want id (forward) or the window start
# (window), $3 SHORT_WORD_MAX_CHARS, $4 WORD_SIMILARITY_MIN (SIMILAR reads
# both for its lexical exclusion), $5 MATCH_TOP_N, SUGGESTION_CAP or
# SEMANTIC_CAP. SIMILAR only: $6 EMBEDDING_MODEL_ID, $7
# SEMANTIC_SIMILARITY_MIN. The window statements end with the window end (now,
# or the end of a capped run): $6 lexical, $8 SIMILAR. A statement is bound
# with exactly the parameters it reads: Postgres cannot type a parameter a
# statement never uses.

# `any_query` is `stem_query` with OR for AND: its lexemes are single
# `[:alnum:]` words (`words_pl`), so neither operator can occur inside one.
_WANTS = """
matchable_wants AS {materialized} (
    SELECT w.id, w.seeker_party_id, w.name, w.name_folded, w.stem_words,
           w.category_id, w.offer_mode, w.locality_id, w.radius_km,
           wl.lat AS want_lat, wl.lng AS want_lng,
           replace(w.stem_query::text, ' & ', ' | ')::tsquery AS any_query
    FROM wants w
    LEFT JOIN localities wl ON wl.id = w.locality_id
    WHERE w.status = 'ACTIVE'
      AND w.expires_at > $1::timestamp
      AND w.stem_query IS NOT NULL
      {want_filter}
)"""

_WINDOW_LISTINGS = """
window_listings AS MATERIALIZED (
    SELECT * FROM matchable_listings
    WHERE changed_at > $2::timestamp AND changed_at <= {end}::timestamp
)"""

_NARROWING = """
    (w.offer_mode IS NULL OR l.mode = w.offer_mode)
    AND (w.category_id IS NULL OR w.category_id = ANY (l.category_path))
    AND (
        w.locality_id IS NULL
        OR l.locality_id = w.locality_id
        OR 2 * 6371.0 * asin(least(1.0, sqrt(
            power(sin(radians(l.lat::float8 - w.want_lat::float8) / 2), 2)
            + cos(radians(w.want_lat::float8)) * cos(radians(l.lat::float8))
              * power(sin(radians(l.lng::float8 - w.want_lng::float8) / 2), 2)
        ))) <= w.radius_km
    )"""

# Forward: the one want's values as scalar subqueries (InitPlans), so the text
# candidate is a restriction on the products inside `matchable_listings`,
# served by `ix_products_search_vector` and `ix_products_name_trgm`. Written
# as join clauses on `w` they need a parameterised path into the view, which
# the planner does not build at the default `join_collapse_limit` (the view
# alone joins seven relations), and `products` is scanned whole. Plain ANDs
# keep it an index condition.
_FORWARD_TEXT = f"""{_NARROWING}
    AND (
        l.search_vector @@ (SELECT any_query FROM matchable_wants)
        OR (SELECT name_folded FROM matchable_wants) <% l.name_folded
    )"""

# Window: no index serves the pairs, and the planner prices a word similarity
# like a column comparison, so `CASE` compares the plain columns first.
_WINDOW_TEXT = f"""CASE WHEN {_NARROWING}
    THEN (l.search_vector @@ w.any_query OR w.name_folded <% l.name_folded)
    ELSE false END"""

# The seeker may see the listing: the SQL of `items_visible_to(ALL)`, pinned
# by `tests/test_constants_drift.py` against the backend's parity test.
_VISIBILITY = """(
            l.visibility = 'PUBLIC'
            OR EXISTS (
                SELECT 1 FROM private_group_peers p
                WHERE p.party_id = l.owner_party_id AND p.peer_party_id = w.seeker_party_id
            )
        )"""

# SIMILAR skips every stored pair; the lexical tiers skip only the lexical
# ones, so that they can upgrade a stored SIMILAR row (`_UPGRADE`).
_NOT_STORED = """NOT EXISTS (
            SELECT 1 FROM want_matches m WHERE m.want_id = w.id AND m.item_id = l.item_id{tiers}
        )"""

# One row per candidate pair: how many want words hit the listing name, and
# the want words (as written) that do not.
_WORD_COUNTS = """
    SELECT count(*) AS words,
           count(*) FILTER (WHERE hit) AS hits,
           array_agg(word ORDER BY pos) FILTER (WHERE NOT hit) AS missing
    FROM (
        SELECT t.word, t.pos,
               l.search_vector @@ to_tsquery(
                   'simple'::regconfig,
                   '''' || replace(t.stem, '''', '''''') || ''':'
                       || CASE WHEN char_length(t.folded) > $3::int OR t.stem <> t.folded
                          THEN '*A' ELSE 'A' END
               )
               OR (
                   char_length(t.folded) > $3::int
                   AND word_similarity(t.folded, l.name_folded) >= $4::real
               ) AS hit
        FROM (
            SELECT s.stem, s.word, s.pos, public.fold_pl(s.word) AS folded
            FROM unnest(w.stem_words, public.words_pl(w.name)) WITH ORDINALITY AS s(stem, word, pos)
        ) AS t
    ) AS checked"""

_WORD_CHECK = f"""
CROSS JOIN LATERAL ({_WORD_COUNTS}
) AS v"""

_TIERS = {
    "MATCH": "v.hits = v.words",
    "SUGGESTION": "v.words >= 3 AND v.hits >= 2 AND v.words - v.hits = 1",
}


# The pair is a lexical MATCH or SUGGESTION candidate: the text candidate,
# then the word check, which `CASE` runs only on a text hit.
_LEXICALLY_CLAIMED = f"""CASE WHEN l.search_vector @@ w.any_query OR w.name_folded <% l.name_folded
          THEN (SELECT ({_TIERS["MATCH"]}) OR ({_TIERS["SUGGESTION"]})
                FROM ({_WORD_COUNTS}) AS v)
          ELSE false END"""


# Forward: the want's vector as a scalar subquery (an InitPlan), so that, as
# in `_FORWARD_TEXT`, the distance and `l.model_id` are plain restrictions
# that reach the view's embedding join. The same `$6` pins the model on both
# sides, so a vector of another model on either side forms no pair; a want
# without a current vector yields no rows.
_FORWARD_WANT_VECTOR = (
    "(SELECT embedding FROM want_embeddings WHERE want_id = $2::uuid AND model_id = $6::text)"
)
# The lexical exclusion joins `w`
# and `l`, so it runs at the join, only on the listings the distance
# restriction let through. It keeps a pair the lexical tiers would claim for
# the window, which stores it unseen and rings its bell.
_FORWARD_SIMILAR_PAIRS = f"""
    SELECT w.id AS want_id, l.item_id, l.created_at,
           (1 - (l.embedding <=> {_FORWARD_WANT_VECTOR}))::real AS score,
           NULL::text[] AS missing
    FROM matchable_wants w
    JOIN matchable_listings l ON l.owner_party_id <> w.seeker_party_id
    WHERE {_VISIBILITY}
      AND {_NARROWING}
      AND l.model_id = $6::text
      AND (l.embedding <=> {_FORWARD_WANT_VECTOR}) <= 1 - $7::float8
      AND NOT {_LEXICALLY_CLAIMED}
      AND {_NOT_STORED.format(tiers="")}"""

# Window: as in `_WINDOW_TEXT`, `CASE` compares the plain columns before the
# vectors and the vectors before the names. A lexical candidate that
# `MATCH_TOP_N` or `SUGGESTION_CAP` left out of this run is not shown as
# SIMILAR either: it keeps its lexical tier for a later run.
_WINDOW_SIMILAR_PAIRS = f"""
    SELECT w.id AS want_id, l.item_id, l.created_at,
           (1 - (l.embedding <=> we.embedding))::real AS score,
           NULL::text[] AS missing
    FROM matchable_wants w
    JOIN want_embeddings we ON we.want_id = w.id AND we.model_id = $6::text
    JOIN window_listings l ON l.owner_party_id <> w.seeker_party_id
    WHERE {_VISIBILITY}
      AND CASE WHEN l.model_id = $6::text AND {_NARROWING}
          THEN CASE WHEN (l.embedding <=> we.embedding) <= 1 - $7::float8
                    THEN NOT {_LEXICALLY_CLAIMED}
                    ELSE false END
          ELSE false END
      AND {_NOT_STORED.format(tiers="")}"""

# MATCH: the best `MATCH_TOP_N` per want per run. SUGGESTION and SIMILAR: up
# to `SUGGESTION_CAP`/`SEMANTIC_CAP` per want in total, counting the stored
# ones of the tier whose item is still matchable (a taken or withdrawn item
# frees its place). Each counts only its own tier, so a SIMILAR row that a
# lexical tier upgraded leaves the SIMILAR count.
_CAPPED = (
    "r.position <= $5::bigint - (SELECT count(*) FROM want_matches s"
    " WHERE s.want_id = r.want_id AND s.tier = '{tier}'"
    " AND EXISTS (SELECT 1 FROM matchable_listings ml WHERE ml.item_id = s.item_id))"
)
_LIMITS = {
    "MATCH": "r.position <= $5::bigint",
    "SUGGESTION": _CAPPED.format(tier="SUGGESTION"),
    "SIMILAR": _CAPPED.format(tier="SIMILAR"),
}


def _lexical_pairs(*, window: bool, tier: str) -> str:
    return f"""
    SELECT w.id AS want_id, l.item_id, l.created_at,
           word_similarity(w.name_folded, l.name_folded) AS score,
           v.missing
    FROM matchable_wants w
    JOIN {"window_listings" if window else "matchable_listings"} l
      ON l.owner_party_id <> w.seeker_party_id
    {_WORD_CHECK}
    WHERE {_VISIBILITY}
      AND {_WINDOW_TEXT if window else _FORWARD_TEXT}
      AND {_NOT_STORED.format(tiers=" AND m.tier <> 'SIMILAR'")}
      AND {_TIERS[tier]}"""


# A lexical pair takes a stored SIMILAR row over as if it were new (tier,
# score, missing words, source and `seen_at` of this run), so a window MATCH
# lands unseen and `RETURNING` reports it for the bell. A stored MATCH or
# SUGGESTION is never touched, and SIMILAR never overwrites a row.
_UPGRADE = """DO UPDATE SET tier = EXCLUDED.tier, score = EXCLUDED.score,
    missing_words = EXCLUDED.missing_words, seen_at = EXCLUDED.seen_at,
    source = EXCLUDED.source, updated_at = EXCLUDED.updated_at
WHERE want_matches.tier = 'SIMILAR'"""


def _statement(*, window: bool, tier: str) -> Statement:
    source = "SCAN" if window else "FORWARD"
    if tier == "SIMILAR":
        pairs = _WINDOW_SIMILAR_PAIRS if window else _FORWARD_SIMILAR_PAIRS
    else:
        pairs = _lexical_pairs(window=window, tier=tier)
    # Forward pairs are born seen; window pairs are unseen so they ring the
    # bell, except suggestions and similar pairs, which never do.
    seen_at = "NULL" if window and tier == "MATCH" else "$1::timestamp"
    ctes = [
        _WANTS.format(
            materialized="MATERIALIZED" if window else "",
            want_filter="" if window else "AND w.id = $2::uuid",
        )
    ]
    if window:
        ctes.append(_WINDOW_LISTINGS.format(end="$8" if tier == "SIMILAR" else "$6"))
    sql = f"""
WITH {",".join(ctes)},
pairs AS ({pairs}
),
ranked AS (
    SELECT pairs.*,
           row_number() OVER (
               PARTITION BY want_id ORDER BY score DESC, created_at DESC, item_id
           ) AS position
    FROM pairs
)
INSERT INTO want_matches (id, created_at, updated_at, want_id, item_id, source, score,
                          seen_at, tier, missing_words)
SELECT gen_random_uuid(), $1::timestamp, $1::timestamp, r.want_id, r.item_id, '{source}',
       r.score, {seen_at}, '{tier}', {"r.missing" if tier == "SUGGESTION" else "NULL"}
FROM ranked r
WHERE {_LIMITS[tier]}
ON CONFLICT (want_id, item_id) {"DO NOTHING" if tier == "SIMILAR" else _UPGRADE}
RETURNING want_id, item_id, tier
"""
    return Statement(sql=sql, similar=tier == "SIMILAR")


FORWARD_MATCH = _statement(window=False, tier="MATCH")
FORWARD_SUGGESTION = _statement(window=False, tier="SUGGESTION")
WINDOW_MATCH = _statement(window=True, tier="MATCH")
WINDOW_SUGGESTION = _statement(window=True, tier="SUGGESTION")
FORWARD_SIMILAR = _statement(window=False, tier="SIMILAR")
WINDOW_SIMILAR = _statement(window=True, tier="SIMILAR")

_SIMILAR = (rules.EMBEDDING_MODEL_ID, rules.SEMANTIC_SIMILARITY_MIN)


async def _store(
    connection: asyncpg.Connection,
    statement: Statement,
    *,
    now: datetime,
    scope: uuid.UUID | datetime,
    cap: int,
    window_end: datetime | None = None,
) -> list[StoredPair]:
    """Binds the layout above: `$1`–`$5`, then `$6`/`$7` for a SIMILAR
    statement, then the window end for a window statement."""
    rows = await connection.fetch(
        statement.sql,
        now,
        scope,
        rules.SHORT_WORD_MAX_CHARS,
        rules.WORD_SIMILARITY_MIN,
        cap,
        *(_SIMILAR if statement.similar else ()),
        *(() if window_end is None else (window_end,)),
    )
    return [StoredPair(row["want_id"], row["item_id"], row["tier"]) for row in rows]


async def match_forward(
    connection: asyncpg.Connection, want_id: uuid.UUID, *, now: datetime
) -> list[StoredPair]:
    """Stores the MATCH, the SUGGESTION, then the SIMILAR pairs not stored yet
    for `want_id` (a lexical pair upgrading a stored SIMILAR one), born seen,
    and returns them. The caller owns the transaction."""
    return [
        *await _store(connection, FORWARD_MATCH, now=now, scope=want_id, cap=rules.MATCH_TOP_N),
        *await _store(
            connection, FORWARD_SUGGESTION, now=now, scope=want_id, cap=rules.SUGGESTION_CAP
        ),
        *await match_similar_forward(connection, want_id, now=now),
    ]


async def match_similar_forward(
    connection: asyncpg.Connection, want_id: uuid.UUID, *, now: datetime
) -> list[StoredPair]:
    """Stores only the SIMILAR pairs not stored yet for `want_id`, born seen,
    and returns them. The caller owns the transaction."""
    return await _store(connection, FORWARD_SIMILAR, now=now, scope=want_id, cap=rules.SEMANTIC_CAP)


async def match_window(
    connection: asyncpg.Connection,
    *,
    listed_after: datetime,
    now: datetime,
    listed_until: datetime | None = None,
) -> list[StoredPair]:
    """Stores, for every matchable want, the MATCH pairs (unseen), then the
    SUGGESTION and the SIMILAR pairs (seen) not stored yet with the listings whose
    `changed_at` lies in `(listed_after, listed_until]` (`listed_until` defaults to `now`), a
    lexical pair upgrading a stored SIMILAR one, and returns them; only the MATCH
    pairs ring a bell. The caller owns the transaction."""
    end = now if listed_until is None else listed_until
    return [
        *await _store(
            connection,
            WINDOW_MATCH,
            now=now,
            scope=listed_after,
            cap=rules.MATCH_TOP_N,
            window_end=end,
        ),
        *await _store(
            connection,
            WINDOW_SUGGESTION,
            now=now,
            scope=listed_after,
            cap=rules.SUGGESTION_CAP,
            window_end=end,
        ),
        *await _store(
            connection,
            WINDOW_SIMILAR,
            now=now,
            scope=listed_after,
            cap=rules.SEMANTIC_CAP,
            window_end=end,
        ),
    ]
