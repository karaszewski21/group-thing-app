"""The single membership definition: `group_ids_for` (an unexecuted select
of group ids) and `holds_active_leadership` built on the shared
`active_membership_clause()` / `active_leadership_clause()`, which the ORM
row reads (`list_memberships_for_party`) reuse (U4)."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import literal, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.groups import service
from app.groups.models import Group, ItemListingPreference, Membership
from tests.test_event_item_reservations import _listed_items
from tests.test_organizer_page import _circle
from tests.test_term_item_listings import _register


async def _group_ids(
    db: AsyncSession, parties: uuid.UUID | Collection[uuid.UUID], **flags: bool
) -> set[uuid.UUID]:
    return set((await db.scalars(service.group_ids_for(parties, **flags))).all())


async def _add_member(db: AsyncSession, group_id: uuid.UUID, party_id: uuid.UUID) -> None:
    await service.add_active_membership(db, group_id, party_id)
    await db.commit()


async def _soft_delete(db: AsyncSession, group_id: uuid.UUID) -> None:
    await db.execute(update(Group).where(Group.id == group_id).values(deleted_at=datetime.utcnow()))
    await db.commit()


async def _two_circles(
    client: AsyncClient, db: AsyncSession, prefix: str
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, str]:
    """`party` leads `led` and is a standing member of `joined` (led by
    someone else). Returns `(party, led, joined, party_token)`."""
    token, party = await _register(client, "ORGANIZER", f"{prefix}.party@example.com")
    other, _ = await _register(client, "ORGANIZER", f"{prefix}.other@example.com")
    led = await _circle(client, token, f"Prowadzony {prefix}")
    joined = await _circle(client, other, f"Cudzy {prefix}")
    await _add_member(db, joined, party)
    return party, led, joined, token


async def test_groupIdsFor_flags_selectMembershipsAndLeaderships(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    party, led, joined, _ = await _two_circles(client, db_session, "prim.flags")

    every = await _group_ids(db_session, party)
    organized = await _group_ids(db_session, party, organizer_only=True)
    member_of = await _group_ids(db_session, party, memberships_only=True)

    assert {led, joined} <= every
    assert led in organized and joined not in organized
    assert joined in member_of and led not in member_of


def test_groupIdsFor_bothFlags_raisesValueError() -> None:
    with pytest.raises(ValueError):
        service.group_ids_for(uuid.uuid4(), organizer_only=True, memberships_only=True)


async def test_groupIdsFor_softDeletedGroup_excludedUnlessIncludeDeleted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    party, led, joined, _ = await _two_circles(client, db_session, "prim.deleted")
    await _soft_delete(db_session, led)
    await _soft_delete(db_session, joined)

    live = await _group_ids(db_session, party)
    with_deleted = await _group_ids(db_session, party, include_deleted=True)

    assert led not in live and joined not in live
    assert {led, joined} <= with_deleted


async def test_groupIdsFor_partyCollection_unionsEveryParty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    party, led, _, _ = await _two_circles(client, db_session, "prim.many")
    _, second = await _register(client, "ORGANIZER", "prim.many.second@example.com")
    third_token, _ = await _register(client, "ORGANIZER", "prim.many.third@example.com")
    third_circle = await _circle(client, third_token, "Trzeci prim.many")
    await _add_member(db_session, third_circle, second)

    assert {led, third_circle} <= await _group_ids(db_session, {party, second})
    assert third_circle not in await _group_ids(db_session, [party])


async def test_groupIdsFor_correlatedOwnerColumn_matchesPerRow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, _, joined, token = await _two_circles(client, db_session, "prim.corr")
    outsider_token, _ = await _register(client, "GUEST", "prim.corr.outsider@example.com")
    (inside_item,) = await _listed_items(client, token, ("Sanki prim.corr", "GIFT"))
    (outside_item,) = await _listed_items(client, outsider_token, ("Narty prim.corr", "GIFT"))

    rows = await db_session.scalars(
        select(ItemListingPreference.item_id).where(
            ItemListingPreference.item_id.in_({inside_item, outside_item}),
            literal(joined).in_(service.group_ids_for(ItemListingPreference.owner_party_id)),
        )
    )

    assert set(rows.all()) == {inside_item}


async def test_holdsActiveLeadership_softDeletedCircle_trueForLeaderOnly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    party, led, joined, _ = await _two_circles(client, db_session, "prim.holds")
    await _soft_delete(db_session, led)

    assert await db_session.scalar(select(service.holds_active_leadership(party, led))) is True
    assert await db_session.scalar(select(service.holds_active_leadership(party, joined))) is False


async def test_endedOrDeletedMembership_absentFromGroupIdsAndMembershipRows(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """U4: one definition of "active" in both result shapes."""
    party, _, ended, _ = await _two_circles(client, db_session, "prim.u4")
    other, _ = await _register(client, "ORGANIZER", "prim.u4.third@example.com")
    deleted = await _circle(client, other, "Usunięty prim.u4")
    await _add_member(db_session, deleted, party)
    await db_session.execute(
        update(Membership)
        .where(Membership.to_group_id == ended)
        .values(valid_to=clock.local_now().date())
    )
    await db_session.commit()
    await _soft_delete(db_session, deleted)

    group_ids = await _group_ids(db_session, party)
    rows = await service.list_memberships_for_party(db_session, party)

    assert ended not in group_ids and deleted not in group_ids
    assert {row.to_group_id for row in rows}.isdisjoint({ended, deleted})
