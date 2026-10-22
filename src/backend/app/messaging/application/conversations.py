"""Get-or-create for ITEM, GROUP and TERM conversations (checks run in a
fixed order) and `GET /{id}`, plus the title and counterpart rules the
inbox shares.

Each open function returns `(response, created)` so the router answers 201
for a new row and 200 for an existing one. Inserts run in a savepoint; a
loser of the unique-index race re-selects the winner and returns 200. Only
a newly created ITEM thread is recorded by the rate limiter."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Collection
from datetime import datetime
from typing import cast

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import BusinessConflictException, EntityNotFoundException

from ..infrastructure import circulation_acl, groups_acl, repository, users_acl
from ..models import Conversation, ConversationKind
from ..schemas import ConversationItemRef, ConversationResponse
from .access import Access, group_access, resolve_access, term_access
from .send_limiter import limiter


def term_title(occurs_on: datetime) -> str:
    return f"Termin: {clock.format_term_day(occurs_on)} {occurs_on:%H:%M}"


def item_counterpart(conversation: Conversation, me: uuid.UUID) -> uuid.UUID:
    """The other party of an ITEM thread."""
    counterpart = (
        conversation.owner_party_id
        if me == conversation.asker_party_id
        else conversation.asker_party_id
    )
    assert counterpart is not None
    return counterpart


class OwnItemConversationException(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__("Nie możesz zapytać o własną rzecz")


class PublicGroupChatException(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__("Czat grupy jest dostępny tylko w grupach prywatnych")


async def open_item_conversation(
    db: AsyncSession, principal: Principal, item_id: uuid.UUID
) -> tuple[ConversationResponse, bool]:
    me = await users_acl.get_caller_party_id(db, principal)
    item = await circulation_acl.find_item_including_deleted(db, item_id)
    if item is None:
        raise EntityNotFoundException("InventoryItem", item_id)
    owner_party_id = await circulation_acl.get_owner_party_id(db, item)
    if owner_party_id == me:
        raise OwnItemConversationException

    def find() -> Awaitable[Conversation | None]:
        return repository.find_item_conversation(db, item_id, me, owner_party_id)

    existing = await find()
    created = False
    if existing is None:
        if item.deleted_at is not None:
            raise EntityNotFoundException("InventoryItem", item_id)
        limiter.check_new_conversation(me)
        conversation = Conversation(
            kind=ConversationKind.ITEM,
            item_id=item_id,
            asker_party_id=me,
            owner_party_id=owner_party_id,
        )
        existing, created = await _insert_or_reselect(db, conversation, find)
        if created:
            limiter.record_new_conversation(me)
    return await _to_response(db, existing, me, Access(None, None, None, None)), created


async def open_group_conversation(
    db: AsyncSession, principal: Principal, group_id: uuid.UUID
) -> tuple[ConversationResponse, bool]:
    me = await users_acl.get_caller_party_id(db, principal)
    group = await groups_acl.get_group_including_deleted(db, group_id)
    access = await group_access(db, group, me)

    def find() -> Awaitable[Conversation | None]:
        return repository.find_group_conversation(db, group_id)

    existing = await find()
    created = False
    if existing is None:
        if group.deleted_at is not None:
            raise EntityNotFoundException("Group", group_id)
        if group.visibility == groups_acl.GroupVisibility.PUBLIC:
            raise PublicGroupChatException
        conversation = Conversation(kind=ConversationKind.GROUP, group_id=group_id)
        existing, created = await _insert_or_reselect(db, conversation, find)
    return await _to_response(db, existing, me, access), created


async def open_term_conversation(
    db: AsyncSession, principal: Principal, term_id: uuid.UUID
) -> tuple[ConversationResponse, bool]:
    me = await users_acl.get_caller_party_id(db, principal)
    term = await groups_acl.get_term_any(db, term_id)
    access = await term_access(db, term, me)

    def find() -> Awaitable[Conversation | None]:
        return repository.find_term_conversation(db, term_id)

    existing = await find()
    created = False
    if existing is None:
        assert access.group is not None
        if access.group.deleted_at is not None:
            raise EntityNotFoundException("Term", term_id)
        conversation = Conversation(
            kind=ConversationKind.TERM, term_id=term_id, group_id=term.circle_group_id
        )
        existing, created = await _insert_or_reselect(db, conversation, find)
    return await _to_response(db, existing, me, access), created


async def get_conversation(
    db: AsyncSession, principal: Principal, conversation_id: uuid.UUID
) -> ConversationResponse:
    me = await users_acl.get_caller_party_id(db, principal)
    conversation = await repository.get_conversation(db, conversation_id)
    if conversation is None:
        raise EntityNotFoundException("Conversation", conversation_id)
    access = await resolve_access(db, conversation, me)
    return await _to_response(db, conversation, me, access)


async def _insert_or_reselect(
    db: AsyncSession,
    conversation: Conversation,
    find: Callable[[], Awaitable[Conversation | None]],
) -> tuple[Conversation, bool]:
    try:
        async with db.begin_nested():
            db.add(conversation)
            await db.flush()
    except IntegrityError:
        winner = await find()
        if winner is None:
            raise
        await db.commit()
        return winner, False
    await db.commit()
    return conversation, True


async def _participant_count(
    db: AsyncSession, organizer_party_id: uuid.UUID | None, party_ids: Collection[uuid.UUID]
) -> int:
    """Distinct account-backed parties among the organizer and `party_ids`;
    guest profiles are not counted."""
    parties = set(party_ids)
    if organizer_party_id is not None:
        parties.add(organizer_party_id)
    profiles = await users_acl.list_chat_profiles_by_party_ids(db, parties)
    return sum(1 for _, has_account in profiles.values() if has_account)


async def _to_response(
    db: AsyncSession, conversation: Conversation, me: uuid.UUID, access: Access
) -> ConversationResponse:
    item: ConversationItemRef | None = None
    counterpart_name: str | None = None
    group_name: str | None = None
    term_occurs_on: datetime | None = None
    participant_count: int | None = None
    if conversation.kind == ConversationKind.ITEM:
        assert conversation.item_id is not None
        name, deleted_at = (await circulation_acl.list_item_refs(db, [conversation.item_id]))[
            conversation.item_id
        ]
        item = ConversationItemRef(
            id=conversation.item_id, name=name, deleted=deleted_at is not None
        )
        title = name
        counterpart = item_counterpart(conversation, me)
        profiles = await users_acl.list_chat_profiles_by_party_ids(db, [counterpart])
        counterpart_name = profiles[counterpart][0] if counterpart in profiles else None
    else:
        assert access.group is not None
        group_name = access.group.name
        if access.term is None:
            title = group_name
            members = await groups_acl.list_group_member_party_ids(
                db, cast(uuid.UUID, access.group.id)
            )
        else:
            term_occurs_on = access.term.occurs_on
            title = term_title(term_occurs_on)
            members = await groups_acl.list_active_attendee_party_ids(
                db, cast(uuid.UUID, access.term.id)
            )
        participant_count = await _participant_count(db, access.organizer_party_id, members)
    conversation_id = cast(uuid.UUID, conversation.id)
    return ConversationResponse(
        id=conversation_id,
        kind=conversation.kind,
        title=title,
        item=item,
        counterpart_name=counterpart_name,
        group_name=group_name,
        term_occurs_on=term_occurs_on,
        unread_count=await repository.count_unread(db, conversation_id, me),
        read_only_reason=access.read_only_reason,
        participant_count=participant_count,
    )
