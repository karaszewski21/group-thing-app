"""want SIMILAR tier

Schema only. Adds the embedding-based SIMILAR tier to the matcher's DB
contract:

- `product_embeddings` and `want_embeddings`, one `halfvec(768)` per product
  or want with the `model_id` that produced it. They are plain tables keyed
  by the owner's id (PK + FK ON DELETE CASCADE), not ORM-mapped, and written
  in raw SQL by the owning module. No vector index: the matcher compares by
  exact scan;
- `wants.similar_requested_at`, set by background re-triggers that need a
  SIMILAR-only run, with the partial index `ix_wants_similar_requested_at`
  and the trigger `trg_wants_similar_requested`, which reuses 0099's
  `wants_notify_match_requested()` to NOTIFY `wants_changed`. There is no
  INSERT branch: a new want always sets `match_requested_at`;
- `matchable_listings` gains `embedding` and `model_id` after `changed_at`,
  and a product vector written later moves `changed_at`. Every 0099 column
  keeps its position and expression, so `CREATE OR REPLACE VIEW` suffices;
- `want_matches.tier` admits `SIMILAR`, which has no `missing_words`.

The downgrade is lossy for derived data only: it deletes the SIMILAR rows,
restores the 0099 CHECKs and view (from the verbatim copy below, never
imported from 0099), and drops the trigger, index, column and both tables.
Pending SIMILAR-only requests are lost with the column.

Revision ID: 0101
Revises: 0100
Create Date: 2026-11-18
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0101"
down_revision: str | None = "0100"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

PRODUCT_EMBEDDINGS = """
CREATE TABLE product_embeddings (
    product_id uuid NOT NULL,
    model_id varchar(200) NOT NULL,
    embedding halfvec(768) NOT NULL,
    updated_at timestamp NOT NULL,
    CONSTRAINT pk_product_embeddings PRIMARY KEY (product_id),
    CONSTRAINT fk_product_embeddings_product_id_products FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE CASCADE
)
"""

WANT_EMBEDDINGS = """
CREATE TABLE want_embeddings (
    want_id uuid NOT NULL,
    model_id varchar(200) NOT NULL,
    embedding halfvec(768) NOT NULL,
    updated_at timestamp NOT NULL,
    CONSTRAINT pk_want_embeddings PRIMARY KEY (want_id),
    CONSTRAINT fk_want_embeddings_want_id_wants FOREIGN KEY (want_id)
        REFERENCES wants (id) ON DELETE CASCADE
)
"""

SIMILAR_TRIGGER = """
CREATE TRIGGER trg_wants_similar_requested
AFTER UPDATE OF similar_requested_at ON wants
FOR EACH ROW WHEN (NEW.similar_requested_at IS NOT NULL)
EXECUTE FUNCTION public.wants_notify_match_requested()
"""

TIER_CHECK = "ck_want_matches_tier"
MISSING_WORDS_CHECK = "ck_want_matches_missing_words"

TIER_SIMILAR = "tier IN ('MATCH', 'SUGGESTION', 'SIMILAR')"
MISSING_WORDS_SIMILAR = (
    "(tier IN ('MATCH', 'SIMILAR') AND missing_words IS NULL) "
    "OR (tier = 'SUGGESTION' AND coalesce(cardinality(missing_words), 0) > 0)"
)
TIER_0099 = "tier IN ('MATCH', 'SUGGESTION')"
MISSING_WORDS_0099 = (
    "(tier = 'MATCH' AND missing_words IS NULL) "
    "OR (tier = 'SUGGESTION' AND coalesce(cardinality(missing_words), 0) > 0)"
)

# `name_folded` is the expression of `ix_products_name_trgm`. `changed_at`
# is the time the window run reads: the latest write that can make a listing
# matchable or change what it is compared with — listed, the listing
# preference changed (mode, visibility), the item edited (a new name is a new
# `product_id`), the balance back to AVAILABLE, a swap proposal rejected, the
# product's vector written. A place edit does not count; a product renamed in
# place is read again once it is re-embedded.
MATCHABLE_LISTINGS = """
CREATE OR REPLACE VIEW matchable_listings AS
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
        (SELECT max(s.updated_at) FROM swap_proposals s WHERE s.listing_item_id = p.item_id),
        e.updated_at
    ) AS changed_at,
    e.embedding AS embedding,
    e.model_id AS model_id
FROM item_listing_preferences p
JOIN inventory_items i ON i.id = p.item_id AND i.deleted_at IS NULL
JOIN inventory_balances b ON b.item_id = i.id AND b.status = 'AVAILABLE'
JOIN products pr ON pr.id = i.product_id
LEFT JOIN product_embeddings e ON e.product_id = pr.id
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

# Verbatim copy of 0099's `MATCHABLE_LISTINGS`, restored by the downgrade.
MATCHABLE_LISTINGS_0099 = """
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


def _replace_checks(tier: str, missing_words: str) -> None:
    op.drop_constraint(TIER_CHECK, "want_matches", type_="check")
    op.drop_constraint(MISSING_WORDS_CHECK, "want_matches", type_="check")
    op.create_check_constraint(TIER_CHECK, "want_matches", tier)
    op.create_check_constraint(MISSING_WORDS_CHECK, "want_matches", missing_words)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(PRODUCT_EMBEDDINGS)
    op.execute(WANT_EMBEDDINGS)
    op.execute("ALTER TABLE wants ADD COLUMN similar_requested_at timestamp NULL")
    op.execute(
        "CREATE INDEX ix_wants_similar_requested_at ON wants (similar_requested_at) "
        "WHERE similar_requested_at IS NOT NULL"
    )
    op.execute(SIMILAR_TRIGGER)
    op.execute(MATCHABLE_LISTINGS)
    _replace_checks(TIER_SIMILAR, MISSING_WORDS_SIMILAR)


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("DELETE FROM want_matches WHERE tier = 'SIMILAR'")
    _replace_checks(TIER_0099, MISSING_WORDS_0099)
    op.execute("DROP VIEW matchable_listings")
    op.execute(MATCHABLE_LISTINGS_0099)
    op.execute("DROP TRIGGER trg_wants_similar_requested ON wants")
    op.execute("DROP INDEX ix_wants_similar_requested_at")
    op.execute("ALTER TABLE wants DROP COLUMN similar_requested_at")
    op.execute("DROP TABLE want_embeddings")
    op.execute("DROP TABLE product_embeddings")
