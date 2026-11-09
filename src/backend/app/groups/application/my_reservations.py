"""`GET /api/reservations/mine`: the items the caller is about to receive —
their open GIFT reservations and accepted swap legs, plus their swap offers
still awaiting the owner. An unpaired SWAP leg reserved by the caller is an
offer made TO them on their own listing, so it is left out.

The statement count does not depend on the number of rows: reservations,
proposals with their proposer legs, products, owners, terms, circles,
events and thumbnails are one statement each, plus one organization lookup
per distinct owner (as `slug_resolver.resolve_organizer_slugs`)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.storage.service import ObjectStorage
from app.users.service import get_profile_by_principal

from ..domain.organizer_slug import derive_party_slug
from ..infrastructure import (
    circulation_bridge,
    events_acl,
    organizations_acl,
    product_bridge,
    repository,
)
from ..schemas import ExchangeMode, MyReservationResponse

_MODES: dict[circulation_bridge.ReservationType, ExchangeMode] = {
    circulation_bridge.ReservationType.GIFT: "GIFT",
    circulation_bridge.ReservationType.SWAP: "SWAP",
}


@dataclass(frozen=True)
class _Row:
    item_id: uuid.UUID
    owner_party_id: uuid.UUID | None
    owner_user_id: uuid.UUID | None
    mode: ExchangeMode
    status: Literal["PROPOSED", "PENDING", "CONFIRMED"]
    reservation_id: uuid.UUID | None
    term_id: uuid.UUID | None
    event_id: uuid.UUID | None
    reserved_at: datetime


def _is_incoming_offer(reservation: circulation_bridge.Reservation) -> bool:
    return (
        reservation.reservation_type == circulation_bridge.ReservationType.SWAP
        and reservation.paired_reservation_id is None
    )


async def list_my_reservations(
    db: AsyncSession, principal: Principal, storage: ObjectStorage | None
) -> list[MyReservationResponse]:
    profile = await get_profile_by_principal(db, principal)
    rows = [
        _Row(
            item_id=reservation.item_id,
            owner_party_id=None,
            owner_user_id=reservation.giver_user_id,
            mode=_MODES[reservation.reservation_type],
            status=cast(Literal["PENDING", "CONFIRMED"], reservation.status.value),
            reservation_id=cast(uuid.UUID, reservation.id),
            term_id=reservation.term_id,
            event_id=reservation.event_id,
            reserved_at=reservation.reserved_at,
        )
        for reservation in await circulation_bridge.list_active_reservations_for_taker(
            db, cast(uuid.UUID, profile.account_user_id)
        )
        if reservation.reservation_type in _MODES and not _is_incoming_offer(reservation)
    ]

    proposals = await repository.list_pending_swap_proposals_by_proposer(db, profile.party_id)
    proposer_legs = {
        cast(uuid.UUID, leg.id): leg
        for leg in await circulation_bridge.list_reservations_by_ids(
            db, {proposal.proposer_reservation_id for proposal, _ in proposals}
        )
    }
    for proposal, owner_party_id in proposals:
        leg = proposer_legs.get(proposal.proposer_reservation_id)
        rows.append(
            _Row(
                item_id=proposal.listing_item_id,
                owner_party_id=owner_party_id,
                owner_user_id=None,
                mode="SWAP",
                status="PROPOSED",
                reservation_id=None,
                term_id=leg.term_id if leg is not None else None,
                event_id=leg.event_id if leg is not None else None,
                reserved_at=proposal.created_at,
            )
        )
    if not rows:
        return []
    return await _build_responses(db, rows, storage)


async def _build_responses(
    db: AsyncSession, rows: list[_Row], storage: ObjectStorage | None
) -> list[MyReservationResponse]:
    products = await circulation_bridge.list_item_products(db, {row.item_id for row in rows})

    user_rows = await repository.list_profile_names_by_account_user_ids(
        db, {row.owner_user_id for row in rows if row.owner_user_id is not None}
    )
    by_user = {
        account_user_id: (party_id, name)
        for account_user_id, party_id, name in user_rows
        if account_user_id is not None
    }
    party_ids = {row.owner_party_id for row in rows if row.owner_party_id is not None}
    by_party: dict[uuid.UUID, str] = (
        {
            party_id: name
            for party_id, name in await repository.list_profile_names_by_party_ids(
                db, list(party_ids)
            )
        }
        if party_ids
        else {}
    )

    def owner(row: _Row) -> tuple[uuid.UUID, str]:
        if row.owner_user_id is not None:
            return by_user[row.owner_user_id]
        party_id = cast(uuid.UUID, row.owner_party_id)
        return party_id, by_party[party_id]

    prefixes: dict[uuid.UUID, str] = {}
    for party_id in {owner(row)[0] for row in rows}:
        organization = await organizations_acl.get_own_organization(db, party_id)
        prefixes[party_id] = derive_party_slug(
            party_id, organization.slug if organization is not None else None
        )

    terms = await repository.list_chat_term_refs(
        db, {row.term_id for row in rows if row.term_id is not None}
    )
    circle_names = await repository.list_group_names(
        db, {group_id for group_id, _ in terms.values()}
    )
    events = await events_acl.get_events_by_ids(
        db, {row.event_id for row in rows if row.event_id is not None}
    )

    photos = (
        await product_bridge.first_approved_photo_by_product(
            db, {product_id for product_id, _ in products.values()}
        )
        if storage is not None
        else {}
    )

    def thumb_url(product_id: uuid.UUID) -> str | None:
        photo = photos.get(product_id)
        return None if photo is None or storage is None else storage.public_url(photo.thumb_key)

    responses = []
    for row in rows:
        product_id, product_name = products[row.item_id]
        owner_party_id, owner_name = owner(row)
        context_kind: Literal["TERM", "EVENT", "PERSONAL"] = "PERSONAL"
        context_name: str | None = None
        occurs_at: datetime | None = None
        if row.term_id is not None and row.term_id in terms:
            group_id, occurs_at = terms[row.term_id]
            context_kind, context_name = "TERM", circle_names.get(group_id)
        elif row.event_id is not None and row.event_id in events:
            event = events[row.event_id]
            context_kind, context_name, occurs_at = "EVENT", event.name, event.starts_at
        responses.append(
            MyReservationResponse(
                item_id=row.item_id,
                product_name=product_name,
                thumb_url=thumb_url(product_id),
                item_path=f"/{prefixes[owner_party_id]}/product/{row.item_id}",
                owner_name=owner_name,
                mode=row.mode,
                status=row.status,
                reservation_id=row.reservation_id,
                context_kind=context_kind,
                context_name=context_name,
                occurs_at=occurs_at,
                reserved_at=row.reserved_at,
            )
        )
    responses.sort(key=lambda response: response.reserved_at, reverse=True)
    return responses
