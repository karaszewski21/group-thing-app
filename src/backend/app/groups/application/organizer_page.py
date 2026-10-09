"""The anonymous organizer directory behind `/:slug`: the owner's PUBLIC
circles, their upcoming terms, the exchange items and needed items of each
circle's next term, and aggregate stats.

Every read is batched over the circles or their next terms (at most 11
statements however many circles there are), and assembly happens here in
Python. Lister identity is used only to decide eligibility and never leaves
this module. The per-item helpers of `term_item_listings.py` are not used,
because they run several queries per item.

`list_organizer_terms` backs the paginated `/terms` agenda (at most 5
statements, constant)."""

from __future__ import annotations

import uuid
from collections import Counter
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
    # (occurs_on, term_id, group_id) of every circle's next term; the tuple
    # order makes `min` pick the nearest term, ties broken by term id.
    next_terms = [(row[4], row[3], row[0]) for row in circle_rows if row[3] is not None]
    next_term_ids = [term_id for _, term_id, _ in next_terms]

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
    if next_terms:
        needed_items = [
            OrganizerNeededItemResponse(
                id=needed_id,
                term_id=term_id,
                group_id=group_id,
                product_name=product_name,
                claimed=claimed,
            )
            for needed_id, term_id, group_id, product_name, claimed in (
                await repository.list_needed_items_with_product_for_terms(db, next_term_ids)
            )
        ]
        exchange = await _build_exchange(db, owner_party_id, next_terms, storage)

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
    next_terms: list[tuple[datetime, uuid.UUID, uuid.UUID]],
    storage: ObjectStorage | None,
) -> OrganizerExchangeResponse:
    """Mirrors the public term listing: on each next term the eligible
    listers are its active attendees plus the circle's leader (the owner),
    and only live AVAILABLE items count. Each item is placed on the nearest
    next term its lister is eligible for."""
    terms_by_id = {term[1]: term for term in next_terms}
    terms_by_party: dict[uuid.UUID, list[tuple[datetime, uuid.UUID, uuid.UUID]]] = {
        owner_party_id: list(next_terms)
    }
    for term_id, party_id in await repository.list_active_attendee_parties_for_terms(
        db, list(terms_by_id)
    ):
        terms_by_party.setdefault(party_id, []).append(terms_by_id[term_id])

    preferences = await repository.list_item_listing_preferences_for_parties(
        db, set(terms_by_party)
    )
    available = await circulation_bridge.list_available_items_with_product(
        db, [preference.item_id for preference in preferences]
    )

    candidates: dict[uuid.UUID, tuple[tuple[datetime, uuid.UUID, uuid.UUID], str]] = {}
    for preference in preferences:
        if preference.item_id not in available:
            continue
        nearest = min(terms_by_party[preference.owner_party_id])
        current = candidates.get(preference.item_id)
        if current is None or nearest < current[0]:
            candidates[preference.item_id] = (nearest, preference.mode)

    counts = Counter(mode for _, mode in candidates.values())
    ranked = sorted(
        candidates.items(),
        key=lambda entry: (entry[1][0][0], available[entry[0]].product_name, entry[0]),
    )[:EXCHANGE_ITEMS_LIMIT]

    photos = (
        await product_bridge.first_approved_photo_by_product(
            db, {available[item_id].product_id for item_id, _ in ranked}
        )
        if storage is not None and ranked
        else {}
    )

    def thumb_url(product_id: uuid.UUID) -> str | None:
        photo = photos.get(product_id)
        return None if photo is None or storage is None else storage.public_url(photo.thumb_key)

    return OrganizerExchangeResponse(
        counts=OrganizerExchangeCounts(
            GIFT=counts["GIFT"], SWAP=counts["SWAP"], LEND=counts["LEND"]
        ),
        items=[
            OrganizerExchangeItemResponse(
                item_id=item_id,
                product_name=available[item_id].product_name,
                condition=available[item_id].condition,
                mode=cast(ExchangeMode, mode),
                thumb_url=thumb_url(available[item_id].product_id),
                term_id=term_id,
                group_id=group_id,
                occurs_on=occurs_on,
            )
            for item_id, ((occurs_on, term_id, group_id), mode) in ranked
        ],
    )
