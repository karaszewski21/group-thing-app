"""wants

Schema only. `wants` holds what a party is looking for ("Szukam"): a name,
optional category, offer mode and locality with a radius, and the lifecycle
columns (`status`, `expires_at`, `closed_at`, `reminded_at`). `want_matches`
stores each (want, listed item) pair found by the matcher; `item_id` is a
loose pointer without a foreign key. `want_scan_markers` keeps how far the
matcher's window run has read; its one row is written by the matcher's
first window run.

It is also the DB contract of the `matcher` service, which reads and writes
these tables in raw SQL:

- the text functions `words_pl` (the raw name split on runs of
  non-alphanumeric characters, stop-words dropped), `stem_word_pl` (one
  raw word folded and stemmed: words of at most 4 folded characters stay
  exact unless they end in `ę`/`ą` after 3 characters, longer ones lose the
  longest suffix of `_SUFFIXES` that leaves 3 characters, never `-ka`),
  `stem_pl` (the stems of `words_pl`, position by position) and
  `stem_query_pl` (their weight-A AND query, prefix for stems, exact for
  short words, `NULL` without a word). Every call to a non-`pg_catalog`
  function in their bodies is written `public.<fn>`, so a restore under
  an empty `search_path` can recompute the generated columns;
- `wants.match_requested_at`, set by every write that needs a matching run,
  and the trigger `trg_wants_match_requested` that NOTIFYs `wants_changed`
  with the want id whenever it is set;
- `want_matches.tier` (MATCH / SUGGESTION) and `missing_words`;
- the views `group_holdings` and `private_group_peers`, the SQL copy of
  "a party is in a group" (`app/groups/infrastructure/membership.py`) and
  of `visibility.parties_share_group(private_only=True)`, guarded by
  `tests/test_wants_visibility_parity.py`, and `matchable_listings`, every
  takeable listed item with what a want is compared with and `changed_at`,
  the time the window run reads (served by the new
  `ix_swap_proposals_listing_item_id`).

`wants.name_folded`, `name_query`, `stem_query` and `stem_words` are
GENERATED ALWAYS ... STORED, so changing `fold_pl`, `words_pl` (its
stop-list included) or `stem_word_pl` means DROP and ADD of them, as for the
`search_vector` columns. `plainto_tsquery` and `to_tsquery` are used in their
two-argument form because the one-argument form is not immutable. A revision
that alters a column the views read must drop and recreate the views.

The downgrade is lossy and unguarded: no ledger row depends on a want. It
first deletes the `notifications` rows of kinds `WANT_MATCH_FOUND` and
`WANT_EXPIRING`, which the old image cannot read. It also downgrades a
database at the first version of this revision (with `short_words_query`
and none of the contract objects): the views and functions are dropped with
`IF EXISTS`, everything else new goes with its table.

Revision ID: 0099
Revises: 0098
Create Date: 2026-11-15
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0099"
down_revision: str | None = "0098"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# Compared after `fold_pl`; changing it means DROP and ADD of the generated
# columns (see above).
STOP_WORDS = (
    "a", "albo", "ani", "bez", "dla", "do", "i", "ku", "lub", "na", "nad", "o",
    "od", "oraz", "po", "pod", "przez", "przy", "u", "w", "we", "z", "za", "ze",
)  # fmt: skip

# Longest first within the `CASE` of `stem_word_pl`: the first one that
# leaves at least 3 characters is stripped.
_SUFFIXES = (
    ("owych",),
    ("owej", "owym"),
    ("owa", "owy", "owe", "ego", "emu", "ych", "ymi", "ami", "ach"),
    ("ek",),
    ("a", "e", "i", "y", "o"),
)


def _stem_cases() -> str:
    return "\n".join(
        f"WHEN f ~ '^.{{3,}}({'|'.join(group)})$' THEN pg_catalog.left(f, -{len(group[0])})"
        for group in _SUFFIXES
    )


WORDS_PL = f"""
CREATE FUNCTION public.words_pl(text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT coalesce(array_agg(w ORDER BY n), '{{}}'::text[])
    FROM regexp_split_to_table($1, '[^[:alnum:]]+') WITH ORDINALITY AS t(w, n)
    WHERE w <> ''
      AND public.fold_pl(w) <> ALL ('{{{",".join(STOP_WORDS)}}}'::text[])
$$
"""

STEM_WORD_PL = f"""
CREATE FUNCTION public.stem_word_pl(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN char_length(f) <= 4 THEN
            CASE WHEN char_length(f) = 4 AND $1 ~ '[ęąĘĄ]$' THEN pg_catalog.left(f, -1)
            ELSE f END
        {_stem_cases()}
        ELSE f
    END
    FROM (SELECT public.fold_pl($1) AS f) AS folded
$$
"""

STEM_PL = """
CREATE FUNCTION public.stem_pl(text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT coalesce(array_agg(public.stem_word_pl(w) ORDER BY n), '{}'::text[])
    FROM unnest(public.words_pl($1)) WITH ORDINALITY AS t(w, n)
$$
"""

# A word is a prefix when it is long or `stem_word_pl` shortened it (the
# `ę`/`ą` exception), so the exception lives in `stem_word_pl` only.
STEM_QUERY_PL = """
CREATE FUNCTION public.stem_query_pl(text) RETURNS tsquery
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
        to_tsquery(
            'simple'::regconfig,
            string_agg(
                '''' || replace(stem, '''', '''''') || ''':'
                    || CASE WHEN char_length(folded) > 4 OR stem <> folded
                        THEN '*A' ELSE 'A' END,
                ' & ' ORDER BY n
            )
        )
    END
    FROM (
        SELECT n, public.stem_word_pl(w) AS stem, public.fold_pl(w) AS folded
        FROM unnest(public.words_pl($1)) WITH ORDINALITY AS t(w, n)
    ) AS words
$$
"""

NOTIFY_FUNCTION = """
CREATE FUNCTION public.wants_notify_match_requested() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_catalog.pg_notify('wants_changed', NEW.id::text);
    RETURN NEW;
END
$$
"""

NOTIFY_TRIGGER = """
CREATE TRIGGER trg_wants_match_requested
AFTER INSERT OR UPDATE OF match_requested_at ON wants
FOR EACH ROW WHEN (NEW.match_requested_at IS NOT NULL)
EXECUTE FUNCTION public.wants_notify_match_requested()
"""

# `membership.py`: a standing Membership through a live MEMBER GroupRole or
# the current Leadership through a live ORGANIZATOR GroupRole, in a live
# group. An RSVP or a family relation never counts.
GROUP_HOLDINGS = """
CREATE VIEW group_holdings AS
SELECT r.party_id, m.to_group_id AS group_id
FROM memberships m
JOIN group_roles r ON r.id = m.from_role_id
JOIN groups g ON g.id = m.to_group_id
WHERE m.valid_to IS NULL
  AND r.role_type = 'MEMBER'
  AND r.valid_to IS NULL
  AND g.deleted_at IS NULL
UNION ALL
SELECT r.party_id, l.to_group_id AS group_id
FROM leaderships l
JOIN group_roles r ON r.id = l.from_role_id
JOIN groups g ON g.id = l.to_group_id
WHERE l.valid_to IS NULL
  AND r.role_type = 'ORGANIZATOR'
  AND r.valid_to IS NULL
  AND g.deleted_at IS NULL
"""

# `visibility.parties_share_group(private_only=True)`.
PRIVATE_GROUP_PEERS = """
CREATE VIEW private_group_peers AS
SELECT a.party_id, b.party_id AS peer_party_id
FROM group_holdings a
JOIN group_holdings b ON b.group_id = a.group_id
JOIN groups g ON g.id = a.group_id AND g.visibility = 'PRIVATE'
"""

# `name_folded` is the expression of `ix_products_name_trgm`. `changed_at`
# is the time the window run reads: the latest write that can make a listing
# matchable or change what it is compared with — listed, the listing
# preference changed (mode, visibility), the item edited (a new name is a new
# `product_id`), the balance back to AVAILABLE, a swap proposal rejected. A
# place edit or a product renamed in place does not count.
MATCHABLE_LISTINGS = """
CREATE VIEW matchable_listings AS
SELECT
    p.item_id,
    p.owner_party_id,
    p.visibility,
    p.mode,
    p.created_at,
    fold_pl(pr.name) AS name_folded,
    pr.search_vector,
    category_path.ids AS category_path,
    lo.id AS locality_id,
    lo.lat,
    lo.lng,
    greatest(
        p.created_at, p.updated_at, i.updated_at, b.updated_at,
        (SELECT max(s.updated_at) FROM swap_proposals s WHERE s.listing_item_id = p.item_id)
    ) AS changed_at
FROM item_listing_preferences p
JOIN inventory_items i ON i.id = p.item_id AND i.deleted_at IS NULL
JOIN inventory_balances b ON b.item_id = i.id AND b.status = 'AVAILABLE'
JOIN products pr ON pr.id = i.product_id
JOIN locations loc ON loc.id = i.location_id AND loc.deleted_at IS NULL
JOIN localities lo ON lo.id = loc.locality_id
CROSS JOIN LATERAL (
    WITH RECURSIVE path AS (
        SELECT c.id, c.parent_id FROM categories c WHERE c.id = pr.category_id
        UNION ALL
        SELECT parent.id, parent.parent_id
        FROM categories parent
        JOIN path ON parent.id = path.parent_id
    )
    SELECT array_agg(path.id) AS ids FROM path
) AS category_path
WHERE NOT EXISTS (
    SELECT 1 FROM swap_proposals s
    WHERE s.listing_item_id = p.item_id AND s.status = 'PROPOSED'
)
"""

VIEWS = ("matchable_listings", "private_group_peers", "group_holdings")
FUNCTIONS = (
    "wants_notify_match_requested()",
    "stem_query_pl(text)",
    "stem_pl(text)",
    "stem_word_pl(text)",
    "words_pl(text)",
)


def _base_columns() -> list[sa.Column[object]]:
    return [
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
    ]


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    for function in (WORDS_PL, STEM_WORD_PL, STEM_PL, STEM_QUERY_PL, NOTIFY_FUNCTION):
        op.execute(function)
    op.create_table(
        "wants",
        *_base_columns(),
        sa.Column("seeker_party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("offer_mode", sa.String(20), nullable=True),
        sa.Column("locality_id", sa.String(7), nullable=True),
        sa.Column("radius_km", sa.SmallInteger(), nullable=True),
        sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("reminded_at", sa.DateTime(), nullable=True),
        sa.Column("match_requested_at", sa.DateTime(), nullable=True),
        sa.Column("match_notification_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("match_notification_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id", name="pk_wants"),
        sa.ForeignKeyConstraint(
            ["seeker_party_id"], ["parties.id"], name="fk_wants_seeker_party_id_parties"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_wants_category_id_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["locality_id"],
            ["localities.id"],
            name="fk_wants_locality_id_localities",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "radius_km IS NULL OR (locality_id IS NOT NULL AND radius_km BETWEEN 1 AND 100)",
            name="ck_wants_radius_requires_locality",
        ),
        sa.CheckConstraint(
            "(status = 'ACTIVE') = (closed_at IS NULL)",
            name="ck_wants_closed_at_matches_status",
        ),
    )
    op.execute(
        "ALTER TABLE wants ADD COLUMN name_folded text "
        "GENERATED ALWAYS AS (fold_pl(name)) STORED NOT NULL"
    )
    op.execute(
        "ALTER TABLE wants ADD COLUMN name_query tsquery "
        "GENERATED ALWAYS AS (plainto_tsquery('simple'::regconfig, fold_pl(name))) "
        "STORED NOT NULL"
    )
    op.execute(
        "ALTER TABLE wants ADD COLUMN stem_query tsquery "
        "GENERATED ALWAYS AS (public.stem_query_pl(name)) STORED"
    )
    op.execute(
        "ALTER TABLE wants ADD COLUMN stem_words text[] "
        "GENERATED ALWAYS AS (public.stem_pl(name)) STORED NOT NULL"
    )
    op.create_index("ix_wants_seeker_party_id_status", "wants", ["seeker_party_id", "status"])
    op.create_index(
        "ix_wants_active_expires_at",
        "wants",
        ["expires_at"],
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )
    op.create_index(
        "ix_wants_closed_at",
        "wants",
        ["closed_at"],
        postgresql_where=sa.text("status <> 'ACTIVE'"),
    )
    op.create_index(
        "ix_wants_match_requested_at",
        "wants",
        ["match_requested_at"],
        postgresql_where=sa.text("match_requested_at IS NOT NULL"),
    )
    op.execute(NOTIFY_TRIGGER)

    op.create_table(
        "want_matches",
        *_base_columns(),
        sa.Column("want_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("score", sa.REAL(), nullable=False),
        sa.Column("seen_at", sa.DateTime(), nullable=True),
        sa.Column("opened_at", sa.DateTime(), nullable=True),
        sa.Column("tier", sa.String(10), nullable=False, server_default="MATCH"),
        sa.Column("missing_words", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_want_matches"),
        sa.ForeignKeyConstraint(
            ["want_id"], ["wants.id"], name="fk_want_matches_want_id_wants", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("want_id", "item_id", name="uq_want_matches_want_id_item_id"),
        sa.CheckConstraint("tier IN ('MATCH', 'SUGGESTION')", name="ck_want_matches_tier"),
        sa.CheckConstraint(
            "(tier = 'MATCH' AND missing_words IS NULL) "
            "OR (tier = 'SUGGESTION' AND coalesce(cardinality(missing_words), 0) > 0)",
            name="ck_want_matches_missing_words",
        ),
    )
    op.create_index("ix_want_matches_item_id", "want_matches", ["item_id"])
    op.create_index("ix_want_matches_want_id_tier", "want_matches", ["want_id", "tier"])

    op.create_table(
        "want_scan_markers",
        *_base_columns(),
        sa.Column("scan_name", sa.String(30), nullable=False),
        sa.Column("scanned_through", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_want_scan_markers"),
        sa.UniqueConstraint("scan_name", name="uq_want_scan_markers_scan_name"),
    )

    # `matchable_listings.changed_at` reads the item's latest proposal of any
    # status; the 0077 index covers PROPOSED only.
    op.create_index(
        "ix_swap_proposals_listing_item_id", "swap_proposals", ["listing_item_id", "updated_at"]
    )
    for view in (GROUP_HOLDINGS, PRIVATE_GROUP_PEERS, MATCHABLE_LISTINGS):
        op.execute(view)


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("DELETE FROM notifications WHERE kind IN ('WANT_MATCH_FOUND', 'WANT_EXPIRING')")
    for view in VIEWS:
        op.execute(f"DROP VIEW IF EXISTS {view}")
    op.execute("DROP INDEX IF EXISTS ix_swap_proposals_listing_item_id")
    op.drop_index("ix_want_matches_item_id", table_name="want_matches")
    op.drop_constraint("fk_want_matches_want_id_wants", "want_matches", type_="foreignkey")
    op.drop_table("want_matches")
    op.drop_table("want_scan_markers")
    op.drop_index("ix_wants_closed_at", table_name="wants")
    op.drop_index("ix_wants_active_expires_at", table_name="wants")
    op.drop_index("ix_wants_seeker_party_id_status", table_name="wants")
    op.drop_constraint("fk_wants_locality_id_localities", "wants", type_="foreignkey")
    op.drop_constraint("fk_wants_category_id_categories", "wants", type_="foreignkey")
    op.drop_constraint("fk_wants_seeker_party_id_parties", "wants", type_="foreignkey")
    op.drop_table("wants")
    for function in FUNCTIONS:
        op.execute(f"DROP FUNCTION IF EXISTS {function}")
