"""`GroupJoinRequest` use cases: an outsider asks for access to a `PRIVATE`
Circle, and whoever is its active organizer at action time decides.

Ownership checks (only the requester may withdraw their own request) live
here, raising `AccessDeniedException` — the matrix only gates the routes to
"authenticated", per `standards/backend/security.md`.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import cast

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import AuthenticationRequiredException, Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.users.service import get_profile_by_principal

from ..infrastructure import notifications_bridge, repository
from ..infrastructure.notifications_bridge import NotificationKind
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..models import Group, GroupJoinRequest, GroupJoinRequestStatus, GroupVisibility
from ..schemas import PendingJoinRequestResponse
from .circles import (
    _group_role_party_id,
    _is_active_organizer,
    _require_active_organizer,
    get_current_leadership,
    get_group,
    list_active_leaderships_for_party,
)
from .memberships import _is_active_member, add_active_membership

REQUEST_NOTIFICATION_COOLDOWN = timedelta(hours=24)


async def _requester_link_path(db: AsyncSession, group_id: int, term_id: int | None) -> str:
    if term_id is None:
        return "/panel"
    slug = await resolve_organizer_slug(db, group_id)
    return f"/{slug}/grupa/{group_id}/term/{term_id}"


async def _get_caller_party_id(db: AsyncSession, principal: Principal) -> tuple[int, str]:
    """A token whose account has no `UserProfile` is treated as not
    authenticated (401), not as a missing resource."""
    try:
        profile = await get_profile_by_principal(db, principal)
    except EntityNotFoundException:
        raise AuthenticationRequiredException from None
    return profile.party_id, profile.display_name


async def _get_join_request_in_group(
    db: AsyncSession, group_id: int, request_id: int
) -> GroupJoinRequest:
    join_request = await repository.get_join_request(db, request_id)
    if join_request is None or join_request.group_id != group_id:
        raise EntityNotFoundException("GroupJoinRequest", request_id)
    return join_request


async def _get_private_group(db: AsyncSession, group_id: int) -> Group:
    group = await get_group(db, group_id)
    if group.visibility != GroupVisibility.PRIVATE:
        raise EntityNotFoundException("Group", group_id)
    return group


async def create_join_request(
    db: AsyncSession, principal: Principal, group_id: int, term_id: int | None
) -> GroupJoinRequest:
    """Idempotent: an existing PENDING request for (caller, group) is
    returned as-is, with no second notification. A concurrent duplicate
    insert trips the partial unique index
    `uq_group_join_requests_pending_requester_group`; the `SAVEPOINT` keeps
    that from aborting the wider transaction and the winner's row is
    returned instead (same pattern as
    `circulation.application.inventory._get_or_create_inventory`)."""
    requester_party_id, requester_name = await _get_caller_party_id(db, principal)

    group = await _get_private_group(db, group_id)
    if term_id is not None:
        # An unknown or foreign term is dropped rather than rejected, so the
        # response never reveals whether a PRIVATE term id exists.
        term = await repository.get_term(db, term_id)
        if term is None or term.circle_group_id != group_id:
            term_id = None

    if await _is_active_organizer(db, group_id, requester_party_id) or await _is_active_member(
        db, group_id, requester_party_id
    ):
        raise BusinessConflictException("Masz już dostęp do tej grupy")

    leadership = await get_current_leadership(db, group_id)
    if leadership is None:
        raise BusinessConflictException("Ta grupa nie ma teraz organizatora")
    organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)

    existing = await repository.find_pending_join_request(db, requester_party_id, group_id)
    if existing is not None:
        return existing

    join_request = GroupJoinRequest(
        group_id=group_id,
        requester_party_id=requester_party_id,
        term_id=term_id,
        status=GroupJoinRequestStatus.PENDING,
    )
    try:
        async with db.begin_nested():
            db.add(join_request)
            await db.flush()
    except IntegrityError:
        winner = await repository.find_pending_join_request(db, requester_party_id, group_id)
        if winner is None:
            raise
        return winner

    # A re-request right after a withdraw/reject still lands in the
    # organizer's pending list, just without another bell entry.
    recently_closed = await repository.has_join_request_closed_since(
        db,
        requester_party_id,
        group_id,
        datetime.utcnow() - REQUEST_NOTIFICATION_COOLDOWN,
    )
    if not recently_closed:
        await notifications_bridge.create_notification(
            db,
            party_id=organizer_party_id,
            kind=NotificationKind.GROUP_JOIN_REQUESTED,
            message=f"{requester_name} prosi o dostęp do grupy „{group.name}”",
            link_path="/panel",
            join_request_id=cast(int, join_request.id),
        )
    await db.commit()
    await db.refresh(join_request)
    return join_request


async def withdraw_join_request(
    db: AsyncSession, principal: Principal, group_id: int, request_id: int
) -> GroupJoinRequest:
    party_id, _ = await _get_caller_party_id(db, principal)
    join_request = await _get_join_request_in_group(db, group_id, request_id)
    if join_request.requester_party_id != party_id:
        raise AccessDeniedException
    if join_request.status != GroupJoinRequestStatus.PENDING:
        raise BusinessConflictException("Ta prośba została już rozstrzygnięta")

    join_request.status = GroupJoinRequestStatus.WITHDRAWN
    await db.commit()
    await db.refresh(join_request)
    return join_request


async def _get_pending_join_request_for_organizer(
    db: AsyncSession, principal: Principal, group_id: int, request_id: int
) -> tuple[GroupJoinRequest, Group]:
    party_id, _ = await _get_caller_party_id(db, principal)
    join_request = await _get_join_request_in_group(db, group_id, request_id)
    await _require_active_organizer(db, group_id, party_id)
    if join_request.status != GroupJoinRequestStatus.PENDING:
        raise BusinessConflictException("Ta prośba została już rozstrzygnięta")
    return join_request, await get_group(db, group_id)


async def _decide_join_request(
    db: AsyncSession,
    join_request: GroupJoinRequest,
    group: Group,
    status: GroupJoinRequestStatus,
    kind: NotificationKind,
    verdict: str,
) -> GroupJoinRequest:
    """Visibility is deliberately not re-checked: a request stays decidable
    after the group switches to PUBLIC."""
    join_request.status = status
    await notifications_bridge.create_notification(
        db,
        party_id=join_request.requester_party_id,
        kind=kind,
        message=f"Twoja prośba o dostęp do grupy „{group.name}” została {verdict}",
        link_path=await _requester_link_path(db, join_request.group_id, join_request.term_id),
        join_request_id=cast(int, join_request.id),
    )
    await db.commit()
    await db.refresh(join_request)
    return join_request


async def approve_join_request(
    db: AsyncSession, principal: Principal, group_id: int, request_id: int
) -> GroupJoinRequest:
    join_request, group = await _get_pending_join_request_for_organizer(
        db, principal, group_id, request_id
    )
    if not await _is_active_member(db, group_id, join_request.requester_party_id):
        await add_active_membership(db, group_id, join_request.requester_party_id)
    return await _decide_join_request(
        db,
        join_request,
        group,
        GroupJoinRequestStatus.APPROVED,
        NotificationKind.GROUP_JOIN_APPROVED,
        "zatwierdzona",
    )


async def reject_join_request(
    db: AsyncSession, principal: Principal, group_id: int, request_id: int
) -> GroupJoinRequest:
    join_request, group = await _get_pending_join_request_for_organizer(
        db, principal, group_id, request_id
    )
    return await _decide_join_request(
        db,
        join_request,
        group,
        GroupJoinRequestStatus.REJECTED,
        NotificationKind.GROUP_JOIN_REJECTED,
        "odrzucona",
    )


async def _build_pending_join_request_responses(
    db: AsyncSession, group_ids: list[int]
) -> list[PendingJoinRequestResponse]:
    if not group_ids:
        return []
    rows = await repository.list_pending_join_requests_for_groups(db, group_ids)
    if not rows:
        return []
    profile_rows = await repository.list_profile_names_by_party_ids(
        db, list({join_request.requester_party_id for join_request, _ in rows})
    )
    names = {row.party_id: row.display_name for row in profile_rows}
    return [
        PendingJoinRequestResponse(
            id=cast(int, join_request.id),
            group_id=join_request.group_id,
            group_name=group_name,
            term_id=join_request.term_id,
            requester_party_id=join_request.requester_party_id,
            requester_display_name=names.get(join_request.requester_party_id, ""),
            created_at=join_request.created_at,
        )
        for join_request, group_name in rows
    ]


async def list_my_pending_join_requests(
    db: AsyncSession, principal: Principal
) -> list[PendingJoinRequestResponse]:
    """Every PENDING request in the Circles the caller actively organizes,
    oldest first."""
    party_id, _ = await _get_caller_party_id(db, principal)
    leaderships = await list_active_leaderships_for_party(db, party_id)
    return await _build_pending_join_request_responses(
        db, [leadership.to_group_id for leadership in leaderships]
    )


async def list_group_pending_join_requests(
    db: AsyncSession, principal: Principal, group_id: int
) -> list[PendingJoinRequestResponse]:
    party_id, _ = await _get_caller_party_id(db, principal)
    await get_group(db, group_id)
    await _require_active_organizer(db, group_id, party_id)
    return await _build_pending_join_request_responses(db, [group_id])
