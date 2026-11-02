"""Where a GIFT/SWAP reservation happens: a term, an event, or a personal
pickup at the owner's place. One code path in `term_item_listings` serves
all three: the context decides eligibility, the take/propose/accept window
(open until the date), the confirm/cancel window (from the date on), the
notification wording and the reservation's context column.

A personal reservation has neither `term_id` nor `event_id`, so it has no
window: it is open for take/propose and settles at once. An open
reservation without a context is personal; a terminal one lost its event.

Both dates are naive Europe/Warsaw wall clock, compared with
`clock.local_now()` only. Events are read through `events_acl` alone."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.users.service import get_profile_by_party

from ..infrastructure import circulation_bridge, events_acl, repository
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..models import GroupVisibility, ItemListingPreference, ItemVisibility, Term
from ..schemas import ItemContextResponse, ReservationContextRef
from .attendance import _require_term_eligibility
from .circles import get_group_including_deleted
from .terms import get_term, get_term_any

_OPEN_STATUSES = (
    circulation_bridge.ReservationStatus.PENDING,
    circulation_bridge.ReservationStatus.CONFIRMED,
)


_UNPLACEABLE_MESSAGE = "Tej rzeczy nie można zarezerwować w tym miejscu"


async def require_placeable(
    db: AsyncSession,
    context: ReservationContext,
    preference: ItemListingPreference,
    taker_party_id: uuid.UUID,
) -> None:
    """409 for a PRIVATE item in an event, in a PUBLIC circle's term or in a
    private circle's term its owner only RSVPs to. Checked again on the
    locked preference row, so an item turned PRIVATE meanwhile is seen."""
    if not await context.allows(db, preference, taker_party_id):
        raise BusinessConflictException(_UNPLACEABLE_MESSAGE)


@dataclass(frozen=True)
class TermContext:
    term: Term
    display_name: str
    circle_visibility: GroupVisibility
    kind: Literal["TERM"] = "TERM"

    @property
    def id(self) -> uuid.UUID:
        return cast(uuid.UUID, self.term.id)

    @property
    def starts_at(self) -> datetime:
        return self.term.occurs_on

    def has_started(self) -> bool:
        return self.term.occurs_on < clock.local_now()

    def require_open(self) -> None:
        if self.has_started():
            raise BusinessConflictException("Termin już się odbył")

    def require_ended(self) -> None:
        if self.term.occurs_on > clock.local_now():
            raise BusinessConflictException("Termin jeszcze się nie odbył")

    async def require_eligibility(self, db: AsyncSession, party_id: uuid.UUID) -> None:
        await _require_term_eligibility(db, self.id, self.term.circle_group_id, party_id)

    async def allows(
        self, db: AsyncSession, preference: ItemListingPreference, taker_party_id: uuid.UUID
    ) -> bool:
        """A PRIVATE item only in a PRIVATE circle its owner is a standing
        member or organizer of: an RSVP is not membership (`can_view_item`)."""
        if preference.visibility != ItemVisibility.PRIVATE:
            return True
        return self.circle_visibility == GroupVisibility.PRIVATE and await repository.is_in_circle(
            db, self.term.circle_group_id, preference.owner_party_id
        )

    def reservation_kwargs(self) -> dict[str, uuid.UUID]:
        return {"term_id": self.id}

    def pickup_phrase(self) -> str:
        return f"{clock.format_term_when(self.starts_at)} — {self.display_name}"

    async def link_path(self, db: AsyncSession) -> str:
        group_id = self.term.circle_group_id
        slug = await resolve_organizer_slug(db, group_id)
        return f"/{slug}/group/{group_id}/term/{self.id}"

    async def accepted_swap_fields(self, db: AsyncSession) -> dict[str, Any]:
        return {
            "term_id": self.id,
            "term_occurs_on": self.term.occurs_on,
            "group_id": self.term.circle_group_id,
            "group_name": self.display_name,
        }

    async def to_response(self, db: AsyncSession) -> ItemContextResponse:
        return _response(self, await self.link_path(db))


@dataclass(frozen=True)
class EventContext:
    event: events_acl.Event
    kind: Literal["EVENT"] = "EVENT"

    @property
    def id(self) -> uuid.UUID:
        return cast(uuid.UUID, self.event.id)

    @property
    def starts_at(self) -> datetime:
        return self.event.starts_at

    @property
    def display_name(self) -> str:
        return self.event.name

    def has_started(self) -> bool:
        return clock.local_now() >= self.event.starts_at

    def require_open(self) -> None:
        if self.has_started():
            raise BusinessConflictException("Wydarzenie już się rozpoczęło")

    def require_ended(self) -> None:
        if not self.has_started():
            raise BusinessConflictException("Wydarzenie jeszcze się nie rozpoczęło")

    async def require_eligibility(self, db: AsyncSession, party_id: uuid.UUID) -> None:
        if not await events_acl.is_event_eligible(db, self.event, party_id):
            raise AccessDeniedException

    async def allows(
        self, db: AsyncSession, preference: ItemListingPreference, taker_party_id: uuid.UUID
    ) -> bool:
        return preference.visibility != ItemVisibility.PRIVATE

    def reservation_kwargs(self) -> dict[str, uuid.UUID]:
        return {"event_id": self.id}

    def pickup_phrase(self) -> str:
        return f"{clock.format_term_when(self.starts_at)} — {self.display_name}"

    async def slug(self, db: AsyncSession) -> str:
        return (await events_acl.author_slugs(db, [self.event]))[self.id]

    async def link_path(self, db: AsyncSession) -> str:
        return f"/{await self.slug(db)}/event/{self.id}"

    async def accepted_swap_fields(self, db: AsyncSession) -> dict[str, Any]:
        return {
            "term_id": None,
            "term_occurs_on": self.event.starts_at,
            "group_id": None,
            "group_name": self.event.name,
            "event_id": self.id,
            "event_slug": await self.slug(db),
        }

    async def to_response(self, db: AsyncSession) -> ItemContextResponse:
        return _response(self, await self.link_path(db))


@dataclass(frozen=True)
class PersonalContext:
    """A pickup arranged in chat at the owner's place. Built with the owner
    by `load_personal_context` at take/propose time, or field-free by
    `for_reservation` from an existing reservation, where only the
    lifecycle methods are called."""

    owner_party_id: uuid.UUID | None = None
    owner_display_name: str | None = None
    item_visibility: ItemVisibility = ItemVisibility.PUBLIC
    kind: Literal["PERSONAL"] = "PERSONAL"

    @classmethod
    def for_reservation(cls) -> PersonalContext:
        return cls()

    def require_open(self) -> None:
        pass

    def require_ended(self) -> None:
        pass

    async def require_eligibility(self, db: AsyncSession, party_id: uuid.UUID) -> None:
        if self.owner_party_id is None:
            raise RuntimeError("Eligibility is checked only when reserving")
        if (
            party_id != self.owner_party_id
            and self.item_visibility == ItemVisibility.PRIVATE
            and not await repository.shares_private_circle(db, self.owner_party_id, party_id)
        ):
            raise AccessDeniedException

    async def allows(
        self, db: AsyncSession, preference: ItemListingPreference, taker_party_id: uuid.UUID
    ) -> bool:
        """PRIVATE is enforced by `require_eligibility`; checked here only
        for an item that turned PRIVATE after it ran on the PUBLIC one."""
        if (
            preference.visibility != ItemVisibility.PRIVATE
            or self.item_visibility == ItemVisibility.PRIVATE
        ):
            return True
        return await repository.shares_private_circle(db, preference.owner_party_id, taker_party_id)

    def reservation_kwargs(self) -> dict[str, uuid.UUID]:
        return {}

    def pickup_phrase(self) -> str:
        return "odbiór osobisty"

    async def accepted_swap_fields(self, db: AsyncSession) -> dict[str, Any]:
        return {"term_id": None, "term_occurs_on": None, "group_id": None, "group_name": None}

    async def to_response(self, db: AsyncSession) -> None:
        return None


ReservationContext = TermContext | EventContext | PersonalContext


def _response(context: TermContext | EventContext, path: str) -> ItemContextResponse:
    return ItemContextResponse(
        kind=context.kind,
        id=context.id,
        name=context.display_name,
        starts_at=context.starts_at,
        path=path,
        has_started=context.has_started(),
    )


async def load_term_context(
    db: AsyncSession, term_id: uuid.UUID, *, include_deleted: bool = False
) -> TermContext:
    """404 for an unknown term; `include_deleted` also accepts a term of a
    soft-deleted circle."""
    term = await (get_term_any if include_deleted else get_term)(db, term_id)
    group = await get_group_including_deleted(db, term.circle_group_id)
    return TermContext(term=term, display_name=group.name, circle_visibility=group.visibility)


async def lock_event_context(db: AsyncSession, event_id: uuid.UUID) -> EventContext:
    """The event held `FOR SHARE` until the caller's next commit, so a
    concurrent delete cannot remove it before the reservation is written."""
    event = await events_acl.lock_event_for_share(db, event_id)
    if event is None:
        raise EntityNotFoundException("Event", event_id)
    return EventContext(event=event)


async def load_personal_context(db: AsyncSession, item_id: uuid.UUID) -> PersonalContext:
    """404 when the item is not listed; 409 while its owner has no live
    pickup place on their PERSONAL inventory."""
    preference = await repository.get_item_listing_preference(db, item_id)
    if preference is None:
        raise EntityNotFoundException("ItemListingPreference", item_id)
    owner_party_id = preference.owner_party_id
    if await circulation_bridge.get_personal_inventory_live_location_id(db, owner_party_id) is None:
        raise BusinessConflictException("Właściciel nie ustawił miejsca odbioru")
    owner = await get_profile_by_party(db, owner_party_id)
    return PersonalContext(
        owner_party_id=owner_party_id,
        owner_display_name=owner.display_name,
        item_visibility=preference.visibility,
    )


async def load_requested_context(
    db: AsyncSession, ref: ReservationContextRef, item_id: uuid.UUID
) -> ReservationContext:
    """The context a take/propose names; the schema guarantees `ref.id` for
    a term or event."""
    if ref.kind == "PERSONAL":
        return await load_personal_context(db, item_id)
    context_id = cast(uuid.UUID, ref.id)
    if ref.kind == "TERM":
        return await load_term_context(db, context_id)
    return await lock_event_context(db, context_id)


async def load_for_reservation(
    db: AsyncSession, reservation: circulation_bridge.Reservation, *, for_write: bool
) -> ReservationContext | None:
    """The reservation's own context: personal for an open reservation with
    neither column, None for a terminal one (its event was deleted).
    `for_write` reads a live term and locks the event; otherwise a term of a
    soft-deleted circle still resolves."""
    if reservation.term_id is not None:
        return await load_term_context(db, reservation.term_id, include_deleted=not for_write)
    if reservation.event_id is None:
        if reservation.status in _OPEN_STATUSES:
            return PersonalContext.for_reservation()
        return None
    event = await (
        events_acl.lock_event_for_share if for_write else events_acl.get_event
    )(db, reservation.event_id)
    return EventContext(event=event) if event is not None else None
