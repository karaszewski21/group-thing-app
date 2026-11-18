"""Reads of the seeker's own wants and of a want's match cards. A want is
always selected by its id together with its seeker, and a withdrawn want is
never returned. The counters count, and the match list shows, the stored
MATCH pairs that pass `visible_matches`; the suggestion and related-items
lists show the SUGGESTION and SIMILAR pairs that pass it."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import (
    FromClause,
    Select,
    Subquery,
    and_,
    exists,
    false,
    func,
    literal,
    or_,
    select,
)
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.auth_deps import Principal
from app.storage.service import ObjectStorage

from ..domain import links
from ..domain.status import WantStatus
from ..infrastructure import (
    category_acl,
    groups_acl,
    inventory_acl,
    locations_acl,
    organizations_acl,
    product_acl,
    users_acl,
)
from ..models import Want, WantMatch, WantMatchTier
from ..schemas import (
    WantMatchMeta,
    WantMatchResponse,
    WantResponse,
    WantSimilarResponse,
    WantSuggestionResponse,
)
from .errors import WantNotFound

CATEGORY_PATH_SEPARATOR = " › "
SUGGESTIONS_LIMIT = 10
SIMILAR_LIMIT = 10


def visible_matches(seeker_party_id: uuid.UUID, listed: FromClause, *columns: Any) -> Select[Any]:
    """`columns` of the seeker's stored matches whose item is still listed,
    visible to the seeker and not the seeker's own. `listed` is the
    listed-items select as a subquery (reserved items included); the
    statement also exposes `Want`, `WantMatch` and the unaliased
    `ItemListingPreference`."""
    preference = groups_acl.ItemListingPreference
    return (
        select(*columns)
        .select_from(WantMatch)
        .join(Want, Want.id == WantMatch.want_id)
        .join(preference, preference.item_id == WantMatch.item_id)
        .join(listed, listed.c.item_id == WantMatch.item_id)
        .where(
            Want.seeker_party_id == seeker_party_id,
            groups_acl.items_visible_to(seeker_party_id, groups_acl.VisibilityScope.ALL),
            preference.owner_party_id != seeker_party_id,
        )
    )


def _match_counts(seeker_party_id: uuid.UUID) -> Subquery:
    listed = inventory_acl.listed_items_with_product_select().subquery("listed")
    return (
        visible_matches(
            seeker_party_id,
            listed,
            WantMatch.want_id.label("want_id"),
            func.count().label("match_count"),
            func.count().filter(WantMatch.seen_at.is_(None)).label("new_match_count"),
        )
        .where(WantMatch.tier == WantMatchTier.MATCH)
        .group_by(WantMatch.want_id)
        .subquery("match_counts")
    )


def _category_paths(seeker_party_id: uuid.UUID) -> Subquery:
    """`(category_id, name, path)` of every category the seeker's wants
    name; `path` runs from the root to the category."""
    category = category_acl.Category
    parent = aliased(category)
    named = (
        select(
            category.id.label("category_id"),
            category.parent_id.label("parent_id"),
            category.name.label("name"),
            literal(0).label("depth"),
        )
        .where(
            category.id.in_(select(Want.category_id).where(Want.seeker_party_id == seeker_party_id))
        )
        .cte("want_category_steps", recursive=True)
    )
    steps = named.union_all(
        select(named.c.category_id, parent.parent_id, parent.name, named.c.depth + 1).where(
            parent.id == named.c.parent_id
        )
    )
    return (
        select(
            steps.c.category_id,
            func.max(steps.c.name).filter(steps.c.depth == 0).label("name"),
            func.string_agg(
                steps.c.name,
                aggregate_order_by(literal(CATEGORY_PATH_SEPARATOR), steps.c.depth.desc()),
            ).label("path"),
        )
        .group_by(steps.c.category_id)
        .subquery("category_paths")
    )


def _wants_select(seeker_party_id: uuid.UUID, *, include_withdrawn: bool = False) -> Select[Any]:
    """The seeker's wants as `WantResponse` rows, ACTIVE first, then newest
    first."""
    locality = locations_acl.Locality
    paths = _category_paths(seeker_party_id)
    counts = _match_counts(seeker_party_id)
    statement = (
        select(
            Want.id,
            Want.name,
            Want.note,
            Want.category_id,
            paths.c.name.label("category_name"),
            paths.c.path.label("category_path"),
            Want.offer_mode,
            Want.locality_id,
            locality.name.label("locality_name"),
            Want.radius_km,
            Want.notifications_enabled,
            Want.status,
            Want.expires_at,
            Want.closed_at,
            Want.created_at,
            and_(Want.match_requested_at.is_not(None), Want.status == WantStatus.ACTIVE).label(
                "matching"
            ),
            func.coalesce(counts.c.match_count, 0).label("match_count"),
            func.coalesce(counts.c.new_match_count, 0).label("new_match_count"),
        )
        .outerjoin(paths, paths.c.category_id == Want.category_id)
        .outerjoin(locality, locality.id == Want.locality_id)
        .outerjoin(counts, counts.c.want_id == Want.id)
        .where(Want.seeker_party_id == seeker_party_id)
        .order_by(Want.status != WantStatus.ACTIVE, Want.created_at.desc(), Want.id)
    )
    if not include_withdrawn:
        statement = statement.where(Want.status != WantStatus.WITHDRAWN)
    return statement


async def load_want(
    db: AsyncSession,
    seeker_party_id: uuid.UUID,
    want_id: uuid.UUID,
    *,
    include_withdrawn: bool = False,
) -> WantResponse:
    """One statement. `include_withdrawn` is for the answer of the request
    that withdraws the want."""
    row = (
        await db.execute(
            _wants_select(seeker_party_id, include_withdrawn=include_withdrawn).where(
                Want.id == want_id
            )
        )
    ).one_or_none()
    if row is None:
        raise WantNotFound(want_id)
    return WantResponse.model_validate(row)


async def list_wants(
    db: AsyncSession, principal: Principal, *, matched_item_id: uuid.UUID | None = None
) -> list[WantResponse]:
    """With `matched_item_id` only the ACTIVE wants that hold the item as a
    stored MATCH or SUGGESTION pair; a SIMILAR pair does not count."""
    caller = await users_acl.get_caller_profile(db, principal)
    statement = _wants_select(caller.party_id)
    if matched_item_id is not None:
        statement = statement.where(
            Want.status == WantStatus.ACTIVE,
            exists().where(
                WantMatch.want_id == Want.id,
                WantMatch.item_id == matched_item_id,
                WantMatch.tier.in_((WantMatchTier.MATCH, WantMatchTier.SUGGESTION)),
            ),
        )
    rows = await db.execute(statement)
    return [WantResponse.model_validate(row) for row in rows]


async def get_want(db: AsyncSession, principal: Principal, want_id: uuid.UUID) -> WantResponse:
    caller = await users_acl.get_caller_profile(db, principal)
    return await load_want(db, caller.party_id, want_id)


def _cards_select(
    caller: users_acl.CallerProfile, want_id: uuid.UUID, tier: WantMatchTier, *columns: Any
) -> Select[Any]:
    """The want's cards of `tier` without their photo and owner slug,
    unordered; `columns` are added to the card columns."""
    preference = groups_acl.ItemListingPreference
    proposal = groups_acl.SwapProposal
    listed = groups_acl.with_pending_proposer(
        inventory_acl.listed_items_with_product_select()
    ).subquery("listed")
    reserved = or_(
        listed.c.balance_status != inventory_acl.BalanceStatus.AVAILABLE,
        listed.c.proposer_party_id.is_not(None),
    ).label("reserved")
    # `listed.c.proposer_party_id` is only the oldest pending proposer.
    proposed_by_me = (
        exists()
        .where(
            proposal.listing_item_id == WantMatch.item_id,
            proposal.proposer_party_id == caller.party_id,
            proposal.status == groups_acl.SwapProposalStatus.PROPOSED,
        )
        .label("proposed_by_me")
    )
    return visible_matches(
        caller.party_id,
        listed,
        WantMatch.item_id,
        preference.owner_party_id,
        preference.mode,
        listed.c.product_id,
        listed.c.product_name,
        listed.c.condition,
        reserved,
        inventory_acl.newest_open_reservation_starts_at(listed.c.item_id).label("reserved_until"),
        func.coalesce(listed.c.reserved_by_user_id == caller.account_user_id, false()).label(
            "reserved_by_me"
        ),
        proposed_by_me,
        *columns,
    ).where(WantMatch.want_id == want_id, WantMatch.tier == tier)


def _matches_select(caller: users_acl.CallerProfile, want_id: uuid.UUID) -> Select[Any]:
    """Available items first, then reserved ones; inside each, new matches
    first, then the best score."""
    is_new = WantMatch.seen_at.is_(None).label("is_new")
    statement = _cards_select(caller, want_id, WantMatchTier.MATCH, is_new)
    return statement.order_by(
        statement.selected_columns.reserved,
        is_new.desc(),
        WantMatch.score.desc(),
        WantMatch.item_id,
    )


def _suggestions_select(caller: users_acl.CallerProfile, want_id: uuid.UUID) -> Select[Any]:
    """The best `SUGGESTIONS_LIMIT` suggestions."""
    return (
        _cards_select(caller, want_id, WantMatchTier.SUGGESTION, WantMatch.missing_words)
        .order_by(WantMatch.score.desc(), WantMatch.item_id)
        .limit(SUGGESTIONS_LIMIT)
    )


def _similar_select(caller: users_acl.CallerProfile, want_id: uuid.UUID) -> Select[Any]:
    """The best `SIMILAR_LIMIT` related items."""
    return (
        _cards_select(caller, want_id, WantMatchTier.SIMILAR)
        .order_by(WantMatch.score.desc(), WantMatch.item_id)
        .limit(SIMILAR_LIMIT)
    )


async def _ensure_own_want(
    db: AsyncSession, caller: users_acl.CallerProfile, want_id: uuid.UUID
) -> None:
    known = await db.scalar(
        select(
            exists().where(
                Want.id == want_id,
                Want.seeker_party_id == caller.party_id,
                Want.status != WantStatus.WITHDRAWN,
            )
        )
    )
    if not known:
        raise WantNotFound(want_id)


async def _card_fields(
    db: AsyncSession, rows: list[Any], storage: ObjectStorage | None
) -> list[dict[str, Any]]:
    """The fields every card shares, one dict per row. The owners'
    Organizations and the photos are one batch each."""
    organizations = await organizations_acl.get_own_organizations_by_party_ids(
        db, {row.owner_party_id for row in rows}
    )
    photos = (
        await product_acl.first_approved_photo_by_product(db, {row.product_id for row in rows})
        if storage is not None
        else {}
    )
    cards: list[dict[str, Any]] = []
    for row in rows:
        organization = organizations.get(row.owner_party_id)
        slug = groups_acl.derive_party_slug(
            row.owner_party_id, organization.slug if organization is not None else None
        )
        photo = photos.get(row.product_id)
        cards.append(
            {
                "id": row.item_id,
                "title": row.product_name,
                "href": links.product_path(slug, row.item_id),
                "meta": WantMatchMeta(
                    mode=row.mode,
                    condition=row.condition,
                    thumb_url=(
                        storage.public_url(photo.thumb_key)
                        if photo is not None and storage is not None
                        else None
                    ),
                    reserved=row.reserved,
                    reserved_until=row.reserved_until if row.reserved else None,
                ),
                "reserved_by_me": row.reserved_by_me,
                "proposed_by_me": row.proposed_by_me,
            }
        )
    return cards


async def list_matches(
    db: AsyncSession,
    principal: Principal,
    want_id: uuid.UUID,
    storage: ObjectStorage | None,
) -> list[WantMatchResponse]:
    """Every MATCH card of the want, unpaged."""
    caller = await users_acl.get_caller_profile(db, principal)
    await _ensure_own_want(db, caller, want_id)
    rows = list((await db.execute(_matches_select(caller, want_id))).all())
    return [
        WantMatchResponse(**fields, is_new=row.is_new)
        for row, fields in zip(rows, await _card_fields(db, rows, storage), strict=True)
    ]


async def list_suggestions(
    db: AsyncSession,
    principal: Principal,
    want_id: uuid.UUID,
    storage: ObjectStorage | None,
) -> list[WantSuggestionResponse]:
    """At most `SUGGESTIONS_LIMIT` SUGGESTION cards, best score first."""
    caller = await users_acl.get_caller_profile(db, principal)
    await _ensure_own_want(db, caller, want_id)
    rows = list((await db.execute(_suggestions_select(caller, want_id))).all())
    return [
        WantSuggestionResponse(**fields, missing_words=row.missing_words)
        for row, fields in zip(rows, await _card_fields(db, rows, storage), strict=True)
    ]


async def list_similar(
    db: AsyncSession,
    principal: Principal,
    want_id: uuid.UUID,
    storage: ObjectStorage | None,
) -> list[WantSimilarResponse]:
    """At most `SIMILAR_LIMIT` SIMILAR cards, best score first."""
    caller = await users_acl.get_caller_profile(db, principal)
    await _ensure_own_want(db, caller, want_id)
    rows = list((await db.execute(_similar_select(caller, want_id))).all())
    return [WantSimilarResponse(**fields) for fields in await _card_fields(db, rows, storage)]
