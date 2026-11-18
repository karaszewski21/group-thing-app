"""The seeker's writes: create, edit, extend, close and resume a want, and
the "seen" and "opened" marks of its matches. Each runs in one transaction;
all but "opened" answer with the want as `reads.load_want` returns it. A
write that needs a matching run sets `match_requested_at`; the matcher
service does the matching. A deadlock or serialization failure rolls the
write back and is answered with the shared "try again" 409."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import cast

from sqlalchemy import bindparam, delete, exists, func, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.types import Text

from app.core.auth_deps import Principal
from app.db import TRANSACTION_CONFLICTS

from ..domain import messages
from ..domain.lifecycle import WantAction, auto_extension_due, new_expiry, refusal
from ..domain.limits import MAX_ACTIVE_WANTS
from ..domain.status import WantStatus
from ..domain.validation import clean_name, clean_note, clean_radius
from ..infrastructure import (
    category_acl,
    embeddings_acl,
    locations_acl,
    moderation_acl,
    notifications_acl,
    users_acl,
)
from ..models import Want, WantMatch
from ..schemas import CreateWantRequest, UpdateWantRequest, WantResponse
from . import embeddings, reads
from .errors import ActiveWantCapReached, WantActionRefused, WantMatchNotFound, WantNotFound


async def _check_texts(name: str, note: str | None, *, stored: Want | None = None) -> None:
    """Contact details, then the classifier, name before note. On an edit
    only a changed text is checked."""
    current_name = stored.name if stored else None
    current_note = stored.note if stored else None
    moderation_acl.ensure_no_contact_info(
        name if name != current_name else None, note if note != current_note else None
    )
    await moderation_acl.check_text(moderation_acl.TextField.WANT_NAME, name, current_name)
    await moderation_acl.check_text(moderation_acl.TextField.WANT_NOTE, note, current_note)


@asynccontextmanager
async def _mapped_database_errors(db: AsyncSession) -> AsyncIterator[None]:
    """A deadlock or serialization failure in the block rolls the
    transaction back and becomes the shared `StaleDataError` 409 ("try
    again"). Any other database error propagates unchanged."""
    try:
        yield
    except DBAPIError as exc:
        sqlstate = getattr(exc.orig, "sqlstate", None)
        if sqlstate in TRANSACTION_CONFLICTS:
            await db.rollback()
            raise StaleDataError(f"want write lost to a concurrent one ({sqlstate})") from exc
        raise


async def _ensure_name_has_word(db: AsyncSession, name: str) -> None:
    """The name must keep a word once the stop-words are skipped. The stop
    list lives only in the SQL function `public.words_pl`."""
    words = await db.scalar(
        select(func.cardinality(func.public.words_pl(bindparam("name", name, type_=Text))))
    )
    if not words:
        raise ValueError(messages.NAME_NEEDS_A_WORD_MESSAGE)


async def _ensure_below_cap(db: AsyncSession, seeker_party_id: uuid.UUID) -> None:
    active = await db.scalar(
        select(func.count())
        .select_from(Want)
        .where(Want.seeker_party_id == seeker_party_id, Want.status == WantStatus.ACTIVE)
    )
    if (active or 0) >= MAX_ACTIVE_WANTS:
        raise ActiveWantCapReached


async def _ensure_category_exists(db: AsyncSession, category_id: uuid.UUID | None) -> None:
    if category_id is None:
        return
    if not await db.scalar(select(exists().where(category_acl.Category.id == category_id))):
        raise ValueError(messages.UNKNOWN_CATEGORY_MESSAGE)


async def _ensure_locality_exists(db: AsyncSession, locality_id: str | None) -> None:
    if locality_id is None:
        return
    if not await db.scalar(select(exists().where(locations_acl.Locality.id == locality_id))):
        raise ValueError(messages.UNKNOWN_LOCALITY_MESSAGE)


async def _own_want(
    db: AsyncSession,
    seeker_party_id: uuid.UUID,
    want_id: uuid.UUID,
    *,
    for_update: bool = False,
) -> Want:
    """`for_update` locks the row `FOR NO KEY UPDATE`, the lock the matcher
    service takes on the want for a run."""
    statement = select(Want).where(
        Want.id == want_id,
        Want.seeker_party_id == seeker_party_id,
        Want.status != WantStatus.WITHDRAWN,
    )
    if for_update:
        statement = statement.with_for_update(key_share=True).execution_options(
            populate_existing=True
        )
    want = await db.scalar(statement)
    if want is None:
        raise WantNotFound(want_id)
    return want


def _ensure_allowed(action: WantAction, want: Want) -> None:
    message = refusal(action, want.status)
    if message is not None:
        raise WantActionRefused(message)


def _start_new_period(want: Want, now: datetime) -> None:
    want.expires_at = new_expiry(now)
    want.reminded_at = None


async def _drop_unread_match_row(db: AsyncSession, want: Want) -> None:
    """Deletes the want's match bell row while it is unread and resets the
    pointer and its count either way."""
    if want.match_notification_id is not None:
        await notifications_acl.delete_unread_notifications(db, [want.match_notification_id])
    want.match_notification_id = None
    want.match_notification_count = 0


async def create_want(
    db: AsyncSession, principal: Principal, data: CreateWantRequest, *, now: datetime
) -> WantResponse:
    """No database statement runs before the text checks and the embed of
    the name. The new want is flagged for a matching run, and its vector,
    or on a miss a retry, is written in the same commit."""
    name = clean_name(data.name)
    note = clean_note(data.note)
    radius_km = clean_radius(data.radius_km, has_locality=data.locality_id is not None)
    await _check_texts(name, note)
    vectors = await embeddings_acl.embed_queries([name])
    caller = await users_acl.get_caller_profile(db, principal)
    async with _mapped_database_errors(db):
        await _ensure_name_has_word(db, name)
        await _ensure_below_cap(db, caller.party_id)
        await _ensure_category_exists(db, data.category_id)
        await _ensure_locality_exists(db, data.locality_id)
        want = Want(
            seeker_party_id=caller.party_id,
            name=name,
            note=note,
            category_id=data.category_id,
            offer_mode=data.offer_mode,
            locality_id=data.locality_id,
            radius_km=radius_km,
            notifications_enabled=data.notifications_enabled,
            status=WantStatus.ACTIVE,
            expires_at=new_expiry(now),
            match_requested_at=now,
        )
        db.add(want)
        await db.flush()
        want_id = cast(uuid.UUID, want.id)
        await embeddings.store_or_stage(db, want_id, vectors, now=now)
        response = await reads.load_want(db, caller.party_id, want_id)
        await db.commit()
    return response


async def update_want(
    db: AsyncSession,
    principal: Principal,
    want_id: uuid.UUID,
    data: UpdateWantRequest,
    *,
    now: datetime,
) -> WantResponse:
    """The rules apply to the state after the edit. Clearing the locality
    clears the radius; an unchanged category or locality is not looked up
    again. A changed name, category, offer mode, locality or radius drops
    the stored matches of every tier and the unread match bell row and flags
    the want for a new matching run; the note and the notification switch
    do not.

    The text checks and lookups run on an unlocked read, so the classifier
    never holds the row lock. The want is then locked, so a matcher run in
    progress is waited for and the pairs it stored are deleted too; a seeker
    write committed in between (a changed `updated_at`) is the shared 409.
    A changed name is embedded on the unlocked read too; its vector, or on a
    miss the deletion of the old one, is written under the lock. Other edits
    keep the vector."""
    caller = await users_acl.get_caller_profile(db, principal)
    async with _mapped_database_errors(db):
        want = await _own_want(db, caller.party_id, want_id)
        _ensure_allowed(WantAction.EDIT, want)
        read_version = want.updated_at
        sent = data.model_fields_set

        name = clean_name(data.name or "") if "name" in sent else want.name
        note = clean_note(data.note) if "note" in sent else want.note
        category_id = data.category_id if "category_id" in sent else want.category_id
        offer_mode = data.offer_mode if "offer_mode" in sent else want.offer_mode
        locality_id = data.locality_id if "locality_id" in sent else want.locality_id
        radius_km = clean_radius(
            data.radius_km if "radius_km" in sent else want.radius_km,
            has_locality=locality_id is not None,
            locality_cleared=want.locality_id is not None and locality_id is None,
        )
        await _check_texts(name, note, stored=want)
        renamed = name != want.name
        if renamed:
            await _ensure_name_has_word(db, name)
        if category_id != want.category_id:
            await _ensure_category_exists(db, category_id)
        if locality_id != want.locality_id:
            await _ensure_locality_exists(db, locality_id)
        vectors = await embeddings_acl.embed_queries([name]) if renamed else None

        want = await _own_want(db, caller.party_id, want_id, for_update=True)
        if want.updated_at != read_version:
            await db.rollback()
            raise StaleDataError("want changed while its edit was checked")
        # Matcher expiry/reminder bump `updated_at` (caught above); its match flag does not.
        _ensure_allowed(WantAction.EDIT, want)
        matches_differently = (name, category_id, offer_mode, locality_id, radius_km) != (
            want.name,
            want.category_id,
            want.offer_mode,
            want.locality_id,
            want.radius_km,
        )
        if matches_differently:
            await db.execute(delete(WantMatch).where(WantMatch.want_id == want_id))
            await _drop_unread_match_row(db, want)
            want.match_requested_at = now
        if renamed:
            await embeddings.store_or_stage(db, want_id, vectors, now=now, replaces=True)
        want.name = name
        want.note = note
        want.category_id = category_id
        want.offer_mode = offer_mode
        want.locality_id = locality_id
        want.radius_km = radius_km
        if "notifications_enabled" in sent:
            want.notifications_enabled = data.notifications_enabled
        await db.flush()
        response = await reads.load_want(db, caller.party_id, want_id)
        await db.commit()
    return response


async def extend_want(
    db: AsyncSession, principal: Principal, want_id: uuid.UUID, *, now: datetime
) -> WantResponse:
    """A new validity period from `now`; the stored matches stay."""
    caller = await users_acl.get_caller_profile(db, principal)
    want = await _own_want(db, caller.party_id, want_id)
    _ensure_allowed(WantAction.EXTEND, want)
    _start_new_period(want, now)
    async with _mapped_database_errors(db):
        response = await reads.load_want(db, caller.party_id, want_id)
        await db.commit()
    return response


async def close_want(
    db: AsyncSession,
    principal: Principal,
    want_id: uuid.UUID,
    outcome: WantStatus,
    *,
    now: datetime,
) -> WantResponse:
    """`outcome` is FULFILLED or WITHDRAWN. Withdrawing also deletes the
    want's unread match bell row; later requests for the want are 404."""
    caller = await users_acl.get_caller_profile(db, principal)
    want = await _own_want(db, caller.party_id, want_id)
    _ensure_allowed(WantAction.CLOSE, want)
    want.status = outcome
    want.closed_at = now
    async with _mapped_database_errors(db):
        if outcome == WantStatus.WITHDRAWN:
            await _drop_unread_match_row(db, want)
        response = await reads.load_want(db, caller.party_id, want_id, include_withdrawn=True)
        await db.commit()
    return response


async def resume_want(
    db: AsyncSession, principal: Principal, want_id: uuid.UUID, *, now: datetime
) -> WantResponse:
    """An EXPIRED or FULFILLED want becomes ACTIVE for a new period, keeps
    its stored matches and is flagged for a matching run."""
    caller = await users_acl.get_caller_profile(db, principal)
    want = await _own_want(db, caller.party_id, want_id)
    _ensure_allowed(WantAction.RESUME, want)
    async with _mapped_database_errors(db):
        await _ensure_below_cap(db, caller.party_id)
        want.status = WantStatus.ACTIVE
        want.closed_at = None
        want.match_requested_at = now
        _start_new_period(want, now)
        await db.flush()
        response = await reads.load_want(db, caller.party_id, want_id)
        await db.commit()
    return response


async def mark_matches_seen(
    db: AsyncSession, principal: Principal, want_id: uuid.UUID, *, now: datetime
) -> WantResponse:
    """Every unseen stored match of the want becomes seen. An ACTIVE want
    close to its end also starts a new validity period."""
    caller = await users_acl.get_caller_profile(db, principal)
    want = await _own_want(db, caller.party_id, want_id)
    async with _mapped_database_errors(db):
        await db.execute(
            update(WantMatch)
            .where(WantMatch.want_id == want_id, WantMatch.seen_at.is_(None))
            .values(seen_at=now)
        )
        if want.status == WantStatus.ACTIVE and auto_extension_due(want.expires_at, now):
            _start_new_period(want, now)
        response = await reads.load_want(db, caller.party_id, want_id)
        await db.commit()
    return response


async def mark_match_opened(
    db: AsyncSession,
    principal: Principal,
    want_id: uuid.UUID,
    item_id: uuid.UUID,
    *,
    now: datetime,
) -> None:
    """Only the first open is recorded."""
    caller = await users_acl.get_caller_profile(db, principal)
    await _own_want(db, caller.party_id, want_id)
    match = await db.scalar(
        select(WantMatch).where(WantMatch.want_id == want_id, WantMatch.item_id == item_id)
    )
    if match is None:
        raise WantMatchNotFound(item_id)
    if match.opened_at is None:
        match.opened_at = now
    await db.commit()
