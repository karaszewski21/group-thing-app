"""Matching wants to listed items: one `INSERT ... SELECT` into
`want_matches`, built by `match_statement` and run for one want
(`match_want`) or for the listings of a time window (`match_new_listings`).

A pair is stored for an ACTIVE, unexpired want and a listed item of another
party that is takeable (AVAILABLE, no pending swap proposal, a live pickup
place), visible to the seeker, within the want's offer mode, category and
locality, and matches the want's name by full text or by word similarity.
Pairs already stored for the want are left out before the ranking, so each
run stores up to `MATCH_TOP_N` further pairs per want.

The two directions share every predicate and differ in how the listings are
reached. For one want the text indexes on the products lead to them. For a
window no index can: every want is compared with every listing of the
window, so what is derived from a listing alone is materialised once and
the plain columns are compared before the names (measured in the task
folder of the wants feature, `implementation/measurement/results.md`)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, fields
from datetime import datetime
from typing import Any

from sqlalchemy import (
    ColumnElement,
    DateTime,
    Float,
    FromClause,
    Select,
    SQLColumnExpression,
    and_,
    any_,
    case,
    exists,
    func,
    literal,
    or_,
    select,
    true,
)
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.sql.dml import ReturningInsert

from ..domain.limits import (
    MATCH_TOP_N,
    SIMILARITY_THRESHOLD_WITH_CATEGORY,
    SIMILARITY_THRESHOLD_WITHOUT_CATEGORY,
)
from ..domain.status import WantMatchSource, WantStatus
from ..infrastructure import category_acl, groups_acl, inventory_acl, locations_acl, product_acl
from ..models import Want, WantMatch

EARTH_RADIUS_KM = 6371.0

MatchedPair = tuple[uuid.UUID, uuid.UUID]
"""`(want_id, item_id)`."""


def _matchable_wants(now: datetime, want_id: uuid.UUID | None) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = [
        Want.status == WantStatus.ACTIVE,
        Want.expires_at > now,
    ]
    if want_id is not None:
        conditions.append(Want.id == want_id)
    return conditions


def _product_category_path() -> FromClause:
    """One row per product of the enclosing query: `ids`, the array of its
    category and each ancestor of it."""
    category = category_acl.Category
    product = product_acl.Product
    path = (
        select(category.id, category.parent_id)
        .where(category.id == product.category_id)
        .correlate(product)
        .cte("category_path", recursive=True, nesting=True)
    )
    parent = aliased(category)
    path = path.union_all(
        select(parent.id, parent.parent_id).join_from(parent, path, parent.id == path.c.parent_id)
    )
    return select(func.array_agg(path.c.id).label("ids")).lateral("product_category")


def _within_radius(
    want_locality: Any, listing: _Listing, radius_km: SQLColumnExpression[int | None]
) -> ColumnElement[bool]:
    """The haversine distance between the two locality points is at most
    `radius_km`. `NULL` (so not true) when the radius or a point is missing."""
    want_lat = sql_cast(want_locality.lat, Float)
    item_lat = sql_cast(listing.lat, Float)
    half_lat = func.radians(item_lat - want_lat) / 2
    half_lng = func.radians(sql_cast(listing.lng, Float) - sql_cast(want_locality.lng, Float)) / 2
    haversine = func.pow(func.sin(half_lat), 2) + func.cos(func.radians(want_lat)) * func.cos(
        func.radians(item_lat)
    ) * func.pow(func.sin(half_lng), 2)
    distance_km = 2 * EARTH_RADIUS_KM * func.asin(func.least(1.0, func.sqrt(haversine)))
    return distance_km <= radius_km


@dataclass(frozen=True)
class _Listing:
    """What a want is compared with, per takeable listing: straight from
    the tables, or from `window_listings`."""

    name_folded: Any
    search_vector: Any
    category_path: Any
    mode: Any
    locality_id: Any
    lat: Any
    lng: Any


def match_statement(
    *,
    now: datetime,
    source: WantMatchSource,
    seen_at: datetime | None,
    want_id: uuid.UUID | None = None,
    listed_after: datetime | None = None,
) -> ReturningInsert[tuple[uuid.UUID, uuid.UUID]]:
    """The insert of the pairs not stored yet, for `want_id` or for every
    matchable want, over all listings or those created after `listed_after`
    and not after `now`. Returns the inserted `(want_id, item_id)` rows."""
    preference = groups_acl.ItemListingPreference
    product = product_acl.Product
    item = inventory_acl.InventoryItem
    location = locations_acl.Location
    item_locality = locations_acl.Locality
    want_locality = aliased(locations_acl.Locality)
    listed = groups_acl.with_pending_proposer(
        inventory_acl.listed_items_with_product_select()
    ).subquery("listed")
    product_category = _product_category_path()
    matchable_wants = _matchable_wants(now, want_id)

    def takeable(listings: Select[Any]) -> Select[Any]:
        """`listings`, which select from the preferences, narrowed to the
        takeable ones and joined to what `_Listing` reads."""
        return (
            listings.join(listed, listed.c.item_id == preference.item_id)
            .join(product, product.id == listed.c.product_id)
            .join(item, item.id == preference.item_id)
            .join(location, and_(location.id == item.location_id, location.deleted_at.is_(None)))
            .join(item_locality, item_locality.id == location.locality_id)
            .join(product_category, true())
            .where(
                listed.c.balance_status == inventory_acl.BalanceStatus.AVAILABLE,
                listed.c.proposer_party_id.is_(None),
            )
        )

    listing = _Listing(
        name_folded=func.fold_pl(product.name),
        search_vector=product.search_vector,
        category_path=product_category.c.ids,
        mode=preference.mode,
        locality_id=item_locality.id,
        lat=item_locality.lat,
        lng=item_locality.lng,
    )
    pairs = select().select_from(Want).join(preference, true())
    if listed_after is None:
        # One want: the text indexes on the products lead to its listings.
        pairs = takeable(pairs)
    else:
        # Every want meets every listing of the window, so what is derived
        # from a listing alone is computed once, not once per pair.
        derived = [getattr(listing, field.name).label(field.name) for field in fields(_Listing)]
        window = (
            takeable(select(preference.item_id, *derived).select_from(preference))
            .where(preference.created_at > listed_after, preference.created_at <= now)
            .cte("window_listings")
            .prefix_with("MATERIALIZED")
        )
        listing = _Listing(**{field.name: window.c[field.name] for field in fields(_Listing)})
        pairs = pairs.join(window, window.c.item_id == preference.item_id)

    score = func.word_similarity(Want.name_folded, listing.name_folded)
    visible = or_(
        preference.visibility == groups_acl.ItemVisibility.PUBLIC,
        and_(
            preference.visibility == groups_acl.ItemVisibility.PRIVATE,
            groups_acl.owner_shares_group_with(Want.seeker_party_id, private_only=True),
        ),
    )
    in_offer_mode = or_(Want.offer_mode.is_(None), listing.mode == Want.offer_mode)
    in_category = or_(Want.category_id.is_(None), Want.category_id == any_(listing.category_path))
    in_locality = or_(
        Want.locality_id.is_(None),
        listing.locality_id == Want.locality_id,
        _within_radius(want_locality, listing, Want.radius_km),
    )
    # In this order: the short words are the cheapest of the three to check.
    similar = and_(
        or_(
            Want.short_words_query.is_(None),
            listing.search_vector.bool_op("@@")(Want.short_words_query),
        ),
        # `<%` is what the trigram index on the folded product name serves.
        Want.name_folded.bool_op("<%")(listing.name_folded),
        score
        >= case(
            (Want.category_id.is_(None), SIMILARITY_THRESHOLD_WITHOUT_CATEGORY),
            else_=SIMILARITY_THRESHOLD_WITH_CATEGORY,
        ),
    )
    text_match = or_(listing.search_vector.bool_op("@@")(Want.name_query), similar)
    narrowing = and_(in_offer_mode, in_category, in_locality)
    if listed_after is None:
        narrowed_text_match = and_(narrowing, text_match)
    else:
        # No index serves the pairs of a window, and the planner prices a
        # word similarity like a column comparison; `CASE` makes it compare
        # the plain columns first.
        narrowed_text_match = case((narrowing, text_match), else_=False)
    already_stored = exists().where(
        WantMatch.want_id == Want.id, WantMatch.item_id == preference.item_id
    )

    candidates = (
        pairs.add_columns(
            Want.id.label("want_id"),
            preference.item_id.label("item_id"),
            score.label("score"),
            func.row_number()
            .over(
                partition_by=Want.id,
                order_by=(score.desc(), preference.created_at.desc(), preference.item_id),
            )
            .label("position"),
        )
        .outerjoin(want_locality, want_locality.id == Want.locality_id)
        .where(
            *matchable_wants,
            preference.owner_party_id != Want.seeker_party_id,
            visible,
            narrowed_text_match,
            ~already_stored,
        )
    )
    ranked = candidates.subquery("ranked")

    # Every value comes from the select: a Python-side column default would
    # be evaluated once and shared by all rows.
    rows = select(
        func.gen_random_uuid(),
        literal(now, DateTime()),
        literal(now, DateTime()),
        ranked.c.want_id,
        ranked.c.item_id,
        literal(source, WantMatch.source.type),
        ranked.c.score,
        literal(seen_at, DateTime()),
    ).where(ranked.c.position <= MATCH_TOP_N)
    return (
        postgresql.insert(WantMatch)
        .from_select(
            ["id", "created_at", "updated_at", "want_id", "item_id", "source", "score", "seen_at"],
            rows,
            include_defaults=False,
        )
        .on_conflict_do_nothing(index_elements=[WantMatch.want_id, WantMatch.item_id])
        .returning(WantMatch.want_id, WantMatch.item_id)
    )


async def _store(
    db: AsyncSession, statement: ReturningInsert[tuple[uuid.UUID, uuid.UUID]]
) -> list[MatchedPair]:
    return [(row.want_id, row.item_id) for row in await db.execute(statement)]


async def match_want(db: AsyncSession, want_id: uuid.UUID, *, now: datetime) -> list[MatchedPair]:
    """Stores up to `MATCH_TOP_N` pairs not stored yet for `want_id`, born
    seen, and returns them. One statement; the caller commits."""
    return await _store(
        db,
        match_statement(now=now, source=WantMatchSource.FORWARD, seen_at=now, want_id=want_id),
    )


async def match_new_listings(
    db: AsyncSession, *, listed_after: datetime, now: datetime
) -> list[MatchedPair]:
    """Stores, for every matchable want, up to `MATCH_TOP_N` pairs not
    stored yet with the items listed after `listed_after` and not after
    `now`, unseen, and returns them. One statement; the caller commits."""
    return await _store(
        db,
        match_statement(
            now=now, source=WantMatchSource.SCAN, seen_at=None, listed_after=listed_after
        ),
    )
