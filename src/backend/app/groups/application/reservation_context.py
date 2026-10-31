"""The term or event a GIFT/SWAP reservation happens in. One code path in
`term_item_listings` serves both: the context decides eligibility, the
take/propose/accept window (open until the date), the confirm/cancel window
(from the date on), the notification wording and the reservation's context
column.

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

from ..infrastructure import circulation_bridge, events_acl
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..models import Term
from ..schemas import ItemContextResponse
from .attendance import _require_term_eligibility
from .circles import get_group_including_deleted
from .terms import get_term, get_term_any


@dataclass(frozen=True)
class TermContext:
    term: Term
    display_name: str
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

    def reservation_kwargs(self) -> dict[str, uuid.UUID]:
        return {"term_id": self.id}
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

    def reservation_kwargs(self) -> dict[str, uuid.UUID]:
        return {"event_id": self.id}
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


ReservationContext = TermContext | EventContext


def _response(context: ReservationContext, path: str) -> ItemContextResponse:
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
    return TermContext(term=term, display_name=group.name)


async def lock_event_context(db: AsyncSession, event_id: uuid.UUID) -> EventContext:
    """The event held `FOR SHARE` until the caller's next commit, so a
    concurrent delete cannot remove it before the reservation is written."""
    event = await events_acl.lock_event_for_share(db, event_id)
    if event is None:
        raise EntityNotFoundException("Event", event_id)
    return EventContext(event=event)


async def load_for_reservation(
    db: AsyncSession, reservation: circulation_bridge.Reservation, *, for_write: bool
) -> ReservationContext | None:
    """The reservation's own context, or None when it has none (its event
    was deleted). `for_write` reads a live term and locks the event; otherwise
    a term of a soft-deleted circle still resolves."""
    if reservation.term_id is not None:
        return await load_term_context(db, reservation.term_id, include_deleted=not for_write)
    if reservation.event_id is None:
        return None
    event = await (
        events_acl.lock_event_for_share if for_write else events_acl.get_event
    )(db, reservation.event_id)
    return EventContext(event=event) if event is not None else None
