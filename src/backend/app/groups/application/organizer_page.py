"""The anonymous organizer directory behind `/:slug`: the owner's PUBLIC
circles, their upcoming terms, the exchange items and needed items of each
circle's next term, and aggregate stats.

Every read is batched over the circles or their next terms (at most 10
statements however many circles there are), and every list is capped in
SQL. Lister identity is used only to decide eligibility and never leaves
the repository's exchange query. The per-item helpers of
`term_item_listings.py` are not used, because they run several queries per
item.

`list_organizer_terms` backs the paginated `/terms` agenda (at most 5
statements, constant)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFoundException
from app.core.pagination import Page, PageParams
from app.storage.service import ObjectStorage

from ..infrastructure import circulation_bridge, organizations_acl, product_bridge, repository
from ..schemas import (
    ExchangeMode,
    OrganizerCircleResponse,
    OrganizerExchangeCounts,
    OrganizerExchangeItemResponse,
    OrganizerExchangeResponse,
    OrganizerNeededItemResponse,
    OrganizerNextTermResponse,
    OrganizerPageResponse,
    OrganizerStatsResponse,
    OrganizerTermResponse,
)

UPCOMING_WINDOW = timedelta(days=60)
EXCHANGE_ITEMS_LIMIT = 12
NEEDED_ITEMS_LIMIT = 12
# Below this, a family count could single out the families in a small group.
MIN_REPORTED_FAMILY_COUNT = 3


async def _resolve_owner(db: AsyncSession, slug: str) -> uuid.UUID:
    """The slug's Organization owner party. A 404 comes only from these two
    lookups, so a `k-…` pseudo-slug is a 404 because no Organization has it."""
    organization = await organizations_acl.get_organization_by_slug(db, slug)
    if organization is None:
        raise EntityNotFoundException("Organization", slug)
    owner_party_id = await organizations_acl.get_owner_party_id(
        db, cast(uuid.UUID, organization.id)
    )
    if owner_party_id is None:
        raise EntityNotFoundException("Organization", slug)
    return owner_party_id


def _empty_exchange() -> OrganizerExchangeResponse:
    return OrganizerExchangeResponse(
        counts=OrganizerExchangeCounts(GIFT=0, SWAP=0, LEND=0), items=[]
    )


def _empty_page() -> OrganizerPageResponse:
    return OrganizerPageResponse(
        circles=[],
        upcoming_terms=[],
        exchange=_empty_exchange(),
        needed_items=[],
        stats=OrganizerStatsResponse(circle_count=0, upcoming_term_count=0, family_count=None),
    )


async def get_organizer_page(
    db: AsyncSession, slug: str, storage: ObjectStorage | None
) -> OrganizerPageResponse:
    owner_party_id = await _resolve_owner(db, slug)
    # Server-local naive time, the same clock the naive `occurs_on` values use.
    now = datetime.now()
    window_end = now + UPCOMING_WINDOW

    circle_rows = await repository.list_owner_public_circles(db, owner_party_id, now, window_end)
    if not circle_rows:
        return _empty_page()
    group_ids = [row[0] for row in circle_rows]
    next_term_ids = [row[3] for row in circle_rows if row[3] is not None]

    term_rows = await repository.list_upcoming_terms_for_groups(db, group_ids, now, window_end)
    attendance = await repository.count_active_attendances_by_term(
        db, list({*next_term_ids, *(row[0] for row in term_rows)})
    )
    family_count = await repository.count_member_families_for_groups(db, group_ids, owner_party_id)

    def attendee_count(term_id: uuid.UUID) -> int:
        return attendance.get(term_id, (0, 0))[0]

    circles = [
        OrganizerCircleResponse(
            id=group_id,
            name=name,
            layout_mode=layout_mode,
            next_term=None
            if next_term_id is None or next_occurs_on is None
            else OrganizerNextTermResponse(
                id=next_term_id,
                occurs_on=next_occurs_on,
                attendee_count=attendee_count(next_term_id),
            ),
            upcoming_term_count=window_count,
        )
        for group_id, name, layout_mode, next_term_id, next_occurs_on, window_count in circle_rows
    ]
    upcoming_terms = [
        OrganizerTermResponse(
            term_id=term_id,
            group_id=group_id,
            group_name=group_name,
            occurs_on=occurs_on,
            description=description,
            attendee_count=attendee_count(term_id),
        )
        for term_id, group_id, group_name, occurs_on, description in term_rows
    ]

    needed_items: list[OrganizerNeededItemResponse] = []
    exchange = _empty_exchange()
    if next_term_ids:
        needed_items = [
            OrganizerNeededItemResponse(
                id=needed_id,
                term_id=term_id,
                group_id=group_id,
                product_name=product_name,
                claimed=claimed,
            )
            for needed_id, term_id, group_id, product_name, claimed in (
                await repository.list_needed_items_with_product_for_terms(
                    db, next_term_ids, NEEDED_ITEMS_LIMIT
                )
            )
        ]
        exchange = await _build_exchange(db, owner_party_id, next_term_ids, storage)

    return OrganizerPageResponse(
        circles=circles,
        upcoming_terms=upcoming_terms,
        exchange=exchange,
        needed_items=needed_items,
        stats=OrganizerStatsResponse(
            circle_count=len(circles),
            upcoming_term_count=sum(circle.upcoming_term_count for circle in circles),
            family_count=family_count if family_count >= MIN_REPORTED_FAMILY_COUNT else None,
        ),
    )


async def list_organizer_terms(
    db: AsyncSession, slug: str, params: PageParams, group_id: uuid.UUID | None
) -> Page[OrganizerTermResponse]:
    """Every upcoming term of the owner's qualifying PUBLIC circles, with no
    window. A `group_id` outside those circles gives an empty page, not a 404."""
    owner_party_id = await _resolve_owner(db, slug)
    now = datetime.now()
    total = await repository.count_owner_public_terms(db, owner_party_id, now, group_id)
    rows = await repository.list_owner_public_terms_page(
        db, owner_party_id, now, group_id, params.offset, params.size
    )
    attendance = await repository.count_active_attendances_by_term(db, [row[0] for row in rows])
    return Page(
        items=[
            OrganizerTermResponse(
                term_id=term_id,
                group_id=term_group_id,
                group_name=group_name,
                occurs_on=occurs_on,
                description=description,
                attendee_count=attendance.get(term_id, (0, 0))[0],
            )
            for term_id, term_group_id, group_name, occurs_on, description in rows
        ],
        total=total,
        page=params.page,
        size=params.size,
    )


async def _build_exchange(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    next_term_ids: list[uuid.UUID],
    storage: ObjectStorage | None,
) -> OrganizerExchangeResponse:
    """Mirrors the public term listing: on each next term the eligible
    listers are its active attendees plus the circle's leader (the owner),
    and only live AVAILABLE items count. Each item is placed on the nearest
    next term its lister is eligible for. Counting and ranking both run in
    SQL, so only the top `EXCHANGE_ITEMS_LIMIT` rows are loaded."""
    available_items = circulation_bridge.available_items_with_product_select()
    counts = await repository.count_exchange_items_by_mode(
        db, owner_party_id, next_term_ids, available_items
    )
    if not counts:
        return _empty_exchange()
    ranked = await repository.list_nearest_exchange_items(
        db, owner_party_id, next_term_ids, available_items, EXCHANGE_ITEMS_LIMIT
    )

    photos = (
        await product_bridge.first_approved_photo_by_product(db, {row.product_id for row in ranked})
        if storage is not None
        else {}
    )

    def thumb_url(product_id: uuid.UUID) -> str | None:
        photo = photos.get(product_id)
        return None if photo is None or storage is None else storage.public_url(photo.thumb_key)

    return OrganizerExchangeResponse(
        counts=OrganizerExchangeCounts(
            GIFT=counts.get("GIFT", 0), SWAP=counts.get("SWAP", 0), LEND=counts.get("LEND", 0)
        ),
        items=[
            OrganizerExchangeItemResponse(
                item_id=item_id,
                product_name=product_name,
                condition=condition,
                mode=cast(ExchangeMode, mode),
                thumb_url=thumb_url(product_id),
                term_id=term_id,
                group_id=group_id,
                occurs_on=occurs_on,
            )
            for (
                item_id,
                mode,
                product_id,
                product_name,
                condition,
                occurs_on,
                term_id,
                group_id,
            ) in ranked
        ],
    )
