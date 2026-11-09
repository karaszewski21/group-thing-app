"""The public organizer directory behind `/:slug`: the owner's PUBLIC
circles, their upcoming terms, the exchange items and needed items of each
circle's next term, aggregate stats, the owner's upcoming public dates
(terms and events, `upcoming_dates`) and newest listed items with their
nearest public date (`owner_items`), the last two shown even with no circles.
Reserved items stay listed with their badge, whose reserver name only a
logged-in viewer gets, so the router never lets a shared cache keep a
personalised response.

Every read is batched over the circles or their next terms (a constant
number of statements however many circles or items there are), and every
list is capped in SQL. Lister identity is used only to decide eligibility and never leaves
the repository's exchange query. The per-item helpers of
`term_item_listings.py` are not used, because they run several queries per
item.

`list_organizer_terms` backs the paginated `/terms` agenda (at most 5
statements, constant)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.pagination import Page, PageParams
from app.storage.service import ObjectStorage

from ..infrastructure import circulation_bridge, product_bridge, repository
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
    OwnerItemCardResponse,
    OwnerNearestDateResponse,
)
from . import owner_items
from .reserved_by import load_reserved_by_names, resolve_viewer_party_id

UPCOMING_WINDOW = timedelta(days=60)
EXCHANGE_ITEMS_LIMIT = 12
NEEDED_ITEMS_LIMIT = 5
RECENT_ITEMS_LIMIT = 6
UPCOMING_DATES_LIMIT = 6
# Below this, a family count could single out the families in a small group.
MIN_REPORTED_FAMILY_COUNT = 3


async def _resolve_owner(db: AsyncSession, slug: str) -> uuid.UUID:
    _, owner_party_id = await owner_items.resolve_organization_owner(db, slug)
    return owner_party_id


def _empty_exchange() -> OrganizerExchangeResponse:
    return OrganizerExchangeResponse(
        counts=OrganizerExchangeCounts(GIFT=0, SWAP=0, RESERVED=0), items=[]
    )


def _empty_page(
    upcoming_dates: list[OwnerNearestDateResponse],
    recent_items: list[OwnerItemCardResponse],
    owner_nearest: OwnerNearestDateResponse | None,
) -> OrganizerPageResponse:
    return OrganizerPageResponse(
        circles=[],
        upcoming_terms=[],
        exchange=_empty_exchange(),
        needed_items=[],
        stats=OrganizerStatsResponse(circle_count=0, upcoming_term_count=0, family_count=None),
        upcoming_dates=upcoming_dates,
        recent_items=recent_items,
        owner_nearest=owner_nearest,
    )


async def get_organizer_page(
    db: AsyncSession,
    slug: str,
    storage: ObjectStorage | None,
    principal: Principal | None = None,
) -> OrganizerPageResponse:
    owner_party_id = await _resolve_owner(db, slug)
    viewer_party_id = await resolve_viewer_party_id(db, principal)
    # Warsaw wall clock, the same clock the naive `occurs_on` values use.
    now = clock.local_now()
    window_end = now + UPCOMING_WINDOW

    recent_items = await owner_items.list_owner_recent_items(
        db, owner_party_id, RECENT_ITEMS_LIMIT, storage, viewer_party_id
    )
    upcoming_dates = await owner_items.list_owner_dates(db, owner_party_id, UPCOMING_DATES_LIMIT)
    owner_nearest = upcoming_dates[0] if recent_items and upcoming_dates else None

    circle_rows = await repository.list_owner_public_circles(db, owner_party_id, now, window_end)
    if not circle_rows:
        return _empty_page(upcoming_dates, recent_items, owner_nearest)
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
                name=name,
                claimed=claimed,
            )
            for needed_id, term_id, group_id, name, claimed in (
                await repository.list_needed_items_for_terms(db, next_term_ids, NEEDED_ITEMS_LIMIT)
            )
        ]
        exchange = await _build_exchange(
            db, owner_party_id, next_term_ids, storage, viewer_party_id
        )

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
        upcoming_dates=upcoming_dates,
        recent_items=recent_items,
        owner_nearest=owner_nearest,
    )


async def list_organizer_terms(
    db: AsyncSession, slug: str, params: PageParams, group_id: uuid.UUID | None
) -> Page[OrganizerTermResponse]:
    """Every upcoming term of the owner's qualifying PUBLIC circles, with no
    window. A `group_id` outside those circles gives an empty page, not a 404."""
    owner_party_id = await _resolve_owner(db, slug)
    now = clock.local_now()
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
    viewer_party_id: uuid.UUID | None,
) -> OrganizerExchangeResponse:
    """Mirrors the public term listing: on each next term the eligible
    listers are its active attendees plus the circle's leader (the owner),
    and every live listed item counts, reserved ones included. Each item is
    placed on the nearest next term its lister is eligible for. GIFT/SWAP
    count the available items and RESERVED the reserved ones, matching the
    page's tabs. Counting and ranking both run in SQL, so only the top
    `EXCHANGE_ITEMS_LIMIT` rows are loaded."""
    listed_items = repository.with_pending_proposer(
        circulation_bridge.listed_items_with_product_select()
    )
    counts = await repository.count_exchange_items(db, owner_party_id, next_term_ids, listed_items)
    if not counts:
        return _empty_exchange()
    ranked = await repository.list_nearest_exchange_items(
        db, owner_party_id, next_term_ids, listed_items, EXCHANGE_ITEMS_LIMIT
    )
    names = await load_reserved_by_names(db, ranked, viewer_party_id)

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
            GIFT=counts.get("GIFT", 0),
            SWAP=counts.get("SWAP", 0),
            RESERVED=counts.get("RESERVED", 0),
        ),
        items=[
            OrganizerExchangeItemResponse(
                item_id=row.item_id,
                product_name=row.product_name,
                condition=row.condition,
                mode=cast(ExchangeMode, row.mode),
                thumb_url=thumb_url(row.product_id),
                term_id=row.term_id,
                group_id=row.group_id,
                occurs_on=row.occurs_on,
                reservation=names.row_reservation(row),
            )
            for row in ranked
        ],
    )
