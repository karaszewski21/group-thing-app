"""`app.groups.models.GroupJoinRequest` DB-layer round trips (no HTTP client)
plus the join-request notification kinds and `Notification.join_request_id`
pointer. The one-PENDING-per-(requester, group) partial unique index lives
only in migration 0037, so these tests exercise the real schema."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import Group, GroupJoinRequest, GroupJoinRequestStatus
from app.notifications import service as notifications_service
from app.notifications.models import Notification, NotificationKind
from app.party.models import Party, PartyType


async def _create_party(db_session: AsyncSession) -> int:
    party = Party(party_type=PartyType.PERSON)
    db_session.add(party)
    await db_session.flush()
    return party.id


async def _create_group(db_session: AsyncSession) -> int:
    group_party = Party(party_type=PartyType.ORGANIZATION)
    db_session.add(group_party)
    await db_session.flush()
    group = Group(party_id=group_party.id, name="Krąg testowy")
    db_session.add(group)
    await db_session.flush()
    return group.id


async def test_groupJoinRequest_roundTripsAllColumns_withNullableTermId(
    db_session: AsyncSession,
) -> None:
    requester_party_id = await _create_party(db_session)
    group_id = await _create_group(db_session)

    request = GroupJoinRequest(
        group_id=group_id,
        requester_party_id=requester_party_id,
        term_id=None,
        status=GroupJoinRequestStatus.PENDING,
    )
    db_session.add(request)
    await db_session.commit()

    row = (
        await db_session.execute(select(GroupJoinRequest).where(GroupJoinRequest.id == request.id))
    ).scalar_one()
    assert row.group_id == group_id
    assert row.requester_party_id == requester_party_id
    assert row.term_id is None
    assert row.status == GroupJoinRequestStatus.PENDING
    assert isinstance(row.status, str)


async def test_groupJoinRequest_secondPendingForSameRequesterAndGroup_violatesPartialUniqueIndex(
    db_session: AsyncSession,
) -> None:
    requester_party_id = await _create_party(db_session)
    group_id = await _create_group(db_session)

    db_session.add(
        GroupJoinRequest(
            group_id=group_id,
            requester_party_id=requester_party_id,
            status=GroupJoinRequestStatus.PENDING,
        )
    )
    await db_session.flush()

    db_session.add(
        GroupJoinRequest(
            group_id=group_id,
            requester_party_id=requester_party_id,
            status=GroupJoinRequestStatus.PENDING,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()


@pytest.mark.parametrize(
    "terminal_status",
    [GroupJoinRequestStatus.REJECTED, GroupJoinRequestStatus.WITHDRAWN],
)
async def test_groupJoinRequest_newPendingAfterTerminalStatus_isAllowed(
    db_session: AsyncSession, terminal_status: GroupJoinRequestStatus
) -> None:
    requester_party_id = await _create_party(db_session)
    group_id = await _create_group(db_session)

    db_session.add(
        GroupJoinRequest(
            group_id=group_id,
            requester_party_id=requester_party_id,
            status=terminal_status,
        )
    )
    await db_session.flush()
    db_session.add(
        GroupJoinRequest(
            group_id=group_id,
            requester_party_id=requester_party_id,
            status=GroupJoinRequestStatus.PENDING,
        )
    )
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(GroupJoinRequest).where(
                    GroupJoinRequest.requester_party_id == requester_party_id,
                    GroupJoinRequest.group_id == group_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert sorted(row.status for row in rows) == sorted(
        [terminal_status, GroupJoinRequestStatus.PENDING]
    )


def test_notificationKindValues_areAtMostThirtyChars_includingJoinRequestKinds() -> None:
    for member in NotificationKind:
        assert len(member.value) <= 30
    for value in ("GROUP_JOIN_REQUESTED", "GROUP_JOIN_APPROVED", "GROUP_JOIN_REJECTED"):
        assert NotificationKind(value).value == value


async def test_createNotification_storesJoinRequestIdPointer(
    db_session: AsyncSession,
) -> None:
    recipient_party_id = await _create_party(db_session)

    await notifications_service.create_notification(
        db_session,
        party_id=recipient_party_id,
        kind=NotificationKind.GROUP_JOIN_REQUESTED,
        message="Anna prosi o dostęp do grupy „Krąg testowy”",
        link_path="/panel",
        join_request_id=987_654_321,
    )
    await db_session.commit()

    row = (
        await db_session.execute(
            select(Notification).where(Notification.party_id == recipient_party_id)
        )
    ).scalar_one()
    assert row.kind == NotificationKind.GROUP_JOIN_REQUESTED
    assert row.join_request_id == 987_654_321
    assert row.proposal_id is None
