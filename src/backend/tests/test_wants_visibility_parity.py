"""Parity of the SQL copy of the PRIVATE visibility rule with its Python
definition: the view `private_group_peers` (migration 0099, over
`group_holdings`) against `visibility.parties_share_group(private_only=True)`
for every case of membership, leadership, role and group state, and the
matcher's call-site rule (`visibility = 'PUBLIC' OR EXISTS
private_group_peers`) against `items_visible_to(ALL)` for listings that are
neither the seeker's own nor reserved or proposed on by them."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import date, datetime

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.main  # noqa: F401 - registers every model's table for FK resolution
from app.groups.infrastructure.visibility import (
    VisibilityScope,
    items_visible_to,
    parties_share_group,
)
from app.groups.models import (
    Group,
    GroupRole,
    GroupRoleType,
    GroupVisibility,
    ItemListingPreference,
    ItemVisibility,
    Leadership,
    Membership,
)
from app.party.models import Party, PartyType

PRIVATE = GroupVisibility.PRIVATE
PUBLIC = GroupVisibility.PUBLIC
SINCE = date(2026, 1, 1)
ENDED = date(2026, 6, 1)

CALL_SITE_RULE = text(
    "SELECT l.item_id FROM item_listing_preferences l "
    "WHERE l.item_id = ANY(:item_ids) AND (l.visibility = 'PUBLIC' OR EXISTS ("
    "SELECT 1 FROM private_group_peers p "
    "WHERE p.party_id = l.owner_party_id AND p.peer_party_id = :seeker))"
)


async def _party(db: AsyncSession) -> uuid.UUID:
    party = Party(party_type=PartyType.PERSON)
    db.add(party)
    await db.flush()
    return party.id


async def _group(
    db: AsyncSession, visibility: GroupVisibility, *, deleted: bool = False
) -> uuid.UUID:
    group = Group(
        party_id=await _party(db),
        name="Krąg",
        visibility=visibility,
        deleted_at=datetime.utcnow() if deleted else None,
    )
    db.add(group)
    await db.flush()
    return group.id


async def _role(
    db: AsyncSession, party: uuid.UUID, role_type: GroupRoleType, *, ended: bool
) -> uuid.UUID:
    role = GroupRole(
        party_id=party, role_type=role_type, valid_from=SINCE, valid_to=ENDED if ended else None
    )
    db.add(role)
    await db.flush()
    return role.id


async def _member(
    db: AsyncSession,
    party: uuid.UUID,
    group: uuid.UUID,
    *,
    ended: bool = False,
    role_ended: bool = False,
    role_type: GroupRoleType = GroupRoleType.MEMBER,
) -> None:
    role = await _role(db, party, role_type, ended=role_ended)
    db.add(
        Membership(
            from_role_id=role,
            to_group_id=group,
            valid_from=SINCE,
            valid_to=ENDED if ended else None,
        )
    )
    await db.flush()


async def _leader(
    db: AsyncSession,
    party: uuid.UUID,
    group: uuid.UUID,
    *,
    ended: bool = False,
    role_ended: bool = False,
    role_type: GroupRoleType = GroupRoleType.ORGANIZATOR,
) -> None:
    role = await _role(db, party, role_type, ended=role_ended)
    db.add(
        Leadership(
            from_role_id=role,
            to_group_id=group,
            valid_from=SINCE,
            valid_to=ENDED if ended else None,
        )
    )
    await db.flush()


Setup = Callable[[AsyncSession, uuid.UUID, uuid.UUID], Awaitable[None]]


async def _both_members(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PRIVATE)
    await _member(db, owner, group)
    await _member(db, seeker, group)


async def _seeker_membership_ended(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PRIVATE)
    await _member(db, owner, group)
    await _member(db, seeker, group, ended=True)


async def _owner_leads(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PRIVATE)
    await _leader(db, owner, group)
    await _member(db, seeker, group)


async def _seeker_leads(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PRIVATE)
    await _member(db, owner, group)
    await _leader(db, seeker, group)


async def _owner_leadership_ended(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PRIVATE)
    await _leader(db, owner, group, ended=True)
    await _member(db, seeker, group)


async def _member_role_ended(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PRIVATE)
    await _member(db, owner, group, role_ended=True)
    await _member(db, seeker, group)


async def _leader_role_ended(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PRIVATE)
    await _leader(db, owner, group, role_ended=True)
    await _member(db, seeker, group)


async def _member_role_behind_leadership(
    db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID
) -> None:
    group = await _group(db, PRIVATE)
    await _leader(db, owner, group, role_type=GroupRoleType.MEMBER)
    await _member(db, seeker, group)


async def _organizer_role_behind_membership(
    db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID
) -> None:
    group = await _group(db, PRIVATE)
    await _member(db, owner, group)
    await _member(db, seeker, group, role_type=GroupRoleType.ORGANIZATOR)


async def _deleted_private_group(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PRIVATE, deleted=True)
    await _member(db, owner, group)
    await _member(db, seeker, group)


async def _shared_public_unshared_private(
    db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID
) -> None:
    public = await _group(db, PUBLIC)
    await _member(db, owner, public)
    await _member(db, seeker, public)
    private = await _group(db, PRIVATE)
    await _member(db, owner, private)


async def _public_only(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    group = await _group(db, PUBLIC)
    await _leader(db, owner, group)
    await _member(db, seeker, group)


async def _no_shared_group(db: AsyncSession, owner: uuid.UUID, seeker: uuid.UUID) -> None:
    for party in (owner, seeker):
        await _member(db, party, await _group(db, PRIVATE))


CASES: list[tuple[str, Setup, bool]] = [
    ("standingMembershipBothSides", _both_members, True),
    ("standingAndEndedMembership", _seeker_membership_ended, False),
    ("ownerCurrentLeadershipSeekerMember", _owner_leads, True),
    ("ownerMemberSeekerLeader", _seeker_leads, True),
    ("endedLeadership", _owner_leadership_ended, False),
    ("endedGroupRoleStandingMembership", _member_role_ended, False),
    ("endedGroupRoleCurrentLeadership", _leader_role_ended, False),
    ("memberRoleBehindLeadership", _member_role_behind_leadership, False),
    ("organizerRoleBehindMembership", _organizer_role_behind_membership, False),
    ("softDeletedPrivateGroup", _deleted_private_group, False),
    ("sharedPublicUnsharedPrivate", _shared_public_unshared_private, False),
    ("publicGroupOnly", _public_only, False),
    ("noSharedGroup", _no_shared_group, False),
]


@pytest.mark.parametrize(
    ("setup", "expected"),
    [(setup, expected) for _, setup, expected in CASES],
    ids=[name for name, _, _ in CASES],
)
async def test_privateGroupPeers_eachCase_equalsPartiesShareGroup(
    db_session: AsyncSession, setup: Setup, expected: bool
) -> None:
    owner, seeker = await _party(db_session), await _party(db_session)
    await setup(db_session, owner, seeker)

    in_view = await db_session.scalar(
        text(
            "SELECT EXISTS (SELECT 1 FROM private_group_peers p "
            "WHERE p.party_id = :owner AND p.peer_party_id = :seeker)"
        ),
        {"owner": owner, "seeker": seeker},
    )
    in_python = await db_session.scalar(
        select(parties_share_group(owner, seeker, private_only=True))
    )

    assert (in_view, in_python) == (expected, expected)


@pytest.mark.parametrize(
    "setup",
    [_both_members, _owner_leads, _seeker_leads, _shared_public_unshared_private, _no_shared_group],
)
async def test_callSiteRule_publicAndPrivateListing_equalsItemsVisibleToAll(
    db_session: AsyncSession, setup: Setup
) -> None:
    owner, seeker = await _party(db_session), await _party(db_session)
    await setup(db_session, owner, seeker)
    listings = {visibility: uuid.uuid4() for visibility in ItemVisibility}
    for visibility, item_id in listings.items():
        db_session.add(
            ItemListingPreference(
                item_id=item_id, owner_party_id=owner, mode="GIFT", visibility=visibility
            )
        )
    await db_session.flush()
    item_ids = list(listings.values())

    by_rule = set(
        (await db_session.scalars(CALL_SITE_RULE, {"item_ids": item_ids, "seeker": seeker})).all()
    )
    by_python = set(
        (
            await db_session.scalars(
                select(ItemListingPreference.item_id).where(
                    ItemListingPreference.item_id.in_(item_ids),
                    items_visible_to(seeker, VisibilityScope.ALL),
                )
            )
        ).all()
    )

    assert by_rule == by_python
    assert listings[ItemVisibility.PUBLIC] in by_rule


async def test_groupHoldings_leaderAndMember_oneRowEach(db_session: AsyncSession) -> None:
    owner, seeker = await _party(db_session), await _party(db_session)
    group = await _group(db_session, PUBLIC)
    await _leader(db_session, owner, group)
    await _member(db_session, seeker, group)
    await _member(db_session, seeker, await _group(db_session, PRIVATE), ended=True)

    rows = (
        await db_session.execute(
            text(
                "SELECT party_id, group_id FROM group_holdings WHERE party_id IN (:owner, :seeker)"
            ),
            {"owner": owner, "seeker": seeker},
        )
    ).all()

    assert sorted(map(tuple, rows)) == sorted([(owner, group), (seeker, group)])
