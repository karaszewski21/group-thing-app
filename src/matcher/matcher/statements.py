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
a SUGGESTION, which names the missing word as the seeker wrote it.

Forward (one claimed want) reaches the listings through the text indexes on
the products: `search_vector @@` any of the want's stems, or `<%` on the
folded name. The window (every want, the listings of
`(listed_after, listed_until]`)
materialises the listings once and compares the plain columns before the
names. Both directions share every predicate, so they store the same pairs.
Every matcher constant is a bound parameter."""

import uuid
from datetime import datetime
from typing import NamedTuple

import asyncpg

from matcher import rules


class StoredPair(NamedTuple):
    want_id: uuid.UUID
    item_id: uuid.UUID
    tier: str


# $1 now, $2 the want id (forward) or the window start (window), $3
# SHORT_WORD_MAX_CHARS, $4 WORD_SIMILARITY_MIN, $5 MATCH_TOP_N or
# SUGGESTION_CAP, and for the window only $6 the window end (now, or the
# end of a capped run).

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
    WHERE changed_at > $2::timestamp AND changed_at <= $6::timestamp
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

# One row per candidate pair: how many want words hit the listing name, and
# the want words (as written) that do not.
_WORD_CHECK = """
CROSS JOIN LATERAL (
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
    ) AS checked
) AS v"""

_TIERS = {
    "MATCH": "v.hits = v.words",
    "SUGGESTION": "v.words >= 3 AND v.hits >= 2 AND v.words - v.hits = 1",
}

# MATCH: the best `MATCH_TOP_N` per want per run. SUGGESTION: up to
# `SUGGESTION_CAP` per want in total, counting the stored ones whose item is
# still matchable (a taken or withdrawn item frees its place).
_LIMITS = {
    "MATCH": "r.position <= $5::bigint",
    "SUGGESTION": (
        "r.position <= $5::bigint - (SELECT count(*) FROM want_matches s"
        " WHERE s.want_id = r.want_id AND s.tier = 'SUGGESTION'"
        " AND EXISTS (SELECT 1 FROM matchable_listings ml WHERE ml.item_id = s.item_id))"
    ),
}


def _statement(*, window: bool, tier: str) -> str:
    source, listings = ("SCAN", "window_listings") if window else ("FORWARD", "matchable_listings")
    # Forward pairs are born seen; window pairs are unseen so they ring the
    # bell, except suggestions, which never do.
    seen_at = "NULL" if window and tier == "MATCH" else "$1::timestamp"
    ctes = [
        _WANTS.format(
            materialized="MATERIALIZED" if window else "",
            want_filter="" if window else "AND w.id = $2::uuid",
        )
    ]
    if window:
        ctes.append(_WINDOW_LISTINGS)
    return f"""
WITH {",".join(ctes)},
pairs AS (
    SELECT w.id AS want_id, l.item_id, l.created_at,
           word_similarity(w.name_folded, l.name_folded) AS score,
           v.missing
    FROM matchable_wants w
    JOIN {listings} l ON l.owner_party_id <> w.seeker_party_id
    {_WORD_CHECK}
    WHERE (
            l.visibility = 'PUBLIC'
            OR EXISTS (
                SELECT 1 FROM private_group_peers p
                WHERE p.party_id = l.owner_party_id AND p.peer_party_id = w.seeker_party_id
            )
        )
      AND {_WINDOW_TEXT if window else _FORWARD_TEXT}
      AND NOT EXISTS (
            SELECT 1 FROM want_matches m WHERE m.want_id = w.id AND m.item_id = l.item_id
        )
      AND {_TIERS[tier]}
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
ON CONFLICT (want_id, item_id) DO NOTHING
RETURNING want_id, item_id, tier
"""


FORWARD_MATCH = _statement(window=False, tier="MATCH")
FORWARD_SUGGESTION = _statement(window=False, tier="SUGGESTION")
WINDOW_MATCH = _statement(window=True, tier="MATCH")
WINDOW_SUGGESTION = _statement(window=True, tier="SUGGESTION")


async def _store(
    connection: asyncpg.Connection,
    statement: str,
    now: datetime,
    scope: uuid.UUID | datetime,
    limit: int,
    *window_end: datetime,
) -> list[StoredPair]:
    rows = await connection.fetch(
        statement,
        now,
        scope,
        rules.SHORT_WORD_MAX_CHARS,
        rules.WORD_SIMILARITY_MIN,
        limit,
        *window_end,
    )
    return [StoredPair(row["want_id"], row["item_id"], row["tier"]) for row in rows]


async def match_forward(
    connection: asyncpg.Connection, want_id: uuid.UUID, *, now: datetime
) -> list[StoredPair]:
    """Stores the MATCH, then the SUGGESTION pairs not stored yet for
    `want_id`, born seen, and returns them. The caller owns the transaction."""
    return [
        *await _store(connection, FORWARD_MATCH, now, want_id, rules.MATCH_TOP_N),
        *await _store(connection, FORWARD_SUGGESTION, now, want_id, rules.SUGGESTION_CAP),
    ]


async def match_window(
    connection: asyncpg.Connection,
    *,
    listed_after: datetime,
    now: datetime,
    listed_until: datetime | None = None,
) -> list[StoredPair]:
    """Stores, for every matchable want, the MATCH pairs (unseen) and then the
    SUGGESTION pairs (seen) not stored yet with the listings whose
    `changed_at` lies in `(listed_after, listed_until]` (`listed_until` defaults to `now`), and
    returns them; only the MATCH pairs ring a bell. The caller owns the
    transaction."""
    end = now if listed_until is None else listed_until
    return [
        *await _store(connection, WINDOW_MATCH, now, listed_after, rules.MATCH_TOP_N, end),
        *await _store(connection, WINDOW_SUGGESTION, now, listed_after, rules.SUGGESTION_CAP, end),
    ]
