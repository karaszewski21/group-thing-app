"""Per-request access to a conversation: there is no participant table, so
who may read a chat is computed from current groups data, soft-deleted
Circles included. Lookups raise 404 before any 403."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import NamedTuple, cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AccessDeniedException

from ..infrastructure import groups_acl
from ..models import Conversation, ConversationKind
from ..schemas import ReadOnlyReason


class Access(NamedTuple):
    read_only_reason: ReadOnlyReason | None
    organizer_party_id: uuid.UUID | None
    group: groups_acl.Group | None
    term: groups_acl.Term | None


def read_only_reason(
    kind: ConversationKind,
    group_deleted_at: datetime | None,
    group_visibility: groups_acl.GroupVisibility,
) -> ReadOnlyReason | None:
    """Shared by `GET /{id}`, the send path and the inbox, so they agree."""
    if group_deleted_at is not None:
        return "GROUP_DELETED"
    if kind == ConversationKind.GROUP and group_visibility == groups_acl.GroupVisibility.PUBLIC:
        return "GROUP_PUBLIC"
    return None


async def _organizer_party_id(db: AsyncSession, group_id: uuid.UUID) -> uuid.UUID | None:
    organizers = await groups_acl.list_current_organizer_party_ids(db, [group_id])
    return organizers.get(group_id)


async def group_access(db: AsyncSession, group: groups_acl.Group, party_id: uuid.UUID) -> Access:
    """The Circle's active organizer or an active member; otherwise 403."""
    group_id = cast(uuid.UUID, group.id)
    allowed = await groups_acl.is_active_group_organizer(
        db, group_id, party_id
    ) or await groups_acl.has_active_membership(db, group_id, party_id)
    if not allowed:
        raise AccessDeniedException
    return Access(
        read_only_reason(ConversationKind.GROUP, group.deleted_at, group.visibility),
        await _organizer_party_id(db, group_id),
        group,
        None,
    )


async def term_access(db: AsyncSession, term: groups_acl.Term, party_id: uuid.UUID) -> Access:
    """The active organizer of the Term's Circle or a non-withdrawn
    attendee, whatever the Term's date; otherwise 403."""
    group = await groups_acl.get_group_including_deleted(db, term.circle_group_id)
    allowed = await groups_acl.is_active_group_organizer(
        db, term.circle_group_id, party_id
    ) or await groups_acl.has_active_attendance(db, cast(uuid.UUID, term.id), party_id)
    if not allowed:
        raise AccessDeniedException
    return Access(
        read_only_reason(ConversationKind.TERM, group.deleted_at, group.visibility),
        await _organizer_party_id(db, term.circle_group_id),
        group,
        term,
    )


async def resolve_access(
    db: AsyncSession, conversation: Conversation, party_id: uuid.UUID
) -> Access:
    """Shared by every `/{id}` endpoint. An ITEM thread belongs to its asker
    and the owner it was opened with, even after an ownership change."""
    if conversation.kind == ConversationKind.ITEM:
        if party_id not in (conversation.asker_party_id, conversation.owner_party_id):
            raise AccessDeniedException
        return Access(None, None, None, None)
    if conversation.kind == ConversationKind.GROUP:
        assert conversation.group_id is not None
        group = await groups_acl.get_group_including_deleted(db, conversation.group_id)
        return await group_access(db, group, party_id)
    assert conversation.term_id is not None
    term = await groups_acl.get_term_any(db, conversation.term_id)
    return await term_access(db, term, party_id)
