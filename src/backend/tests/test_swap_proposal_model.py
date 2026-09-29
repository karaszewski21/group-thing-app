"""`app.groups.models.SwapProposal` and `GiveawayTermEndMarker` (idempotency
marker for the giveaway/GIFT term-end case) — DB-layer round trips only, no
HTTP client, no `relationship()` traversal (none declared on either model,
per `standards/backend/models.md`). Also covers the new `NotificationKind`
members added alongside these entities."""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import GiveawayTermEndMarker, SwapProposal, SwapProposalStatus
from app.notifications.models import NotificationKind
from app.party.models import Party, PartyType


async def _create_party(db_session: AsyncSession) -> uuid.UUID:
    party = Party(party_type=PartyType.PERSON)
    db_session.add(party)
    await db_session.flush()
    return party.id


async def test_swapProposal_roundTripsAllColumns_withExplicitProposedStatus(
    db_session: AsyncSession,
) -> None:
    proposer_party_id = await _create_party(db_session)

    listing_item_id, offered_item_id, proposer_reservation_id = (
        uuid.uuid4(),
        uuid.uuid4(),
        uuid.uuid4(),
    )
    proposal = SwapProposal(
        proposer_party_id=proposer_party_id,
        listing_item_id=listing_item_id,
        offered_item_id=offered_item_id,
        proposer_reservation_id=proposer_reservation_id,
        status=SwapProposalStatus.PROPOSED,
    )
    db_session.add(proposal)
    await db_session.commit()

    row = (
        await db_session.execute(select(SwapProposal).where(SwapProposal.id == proposal.id))
    ).scalar_one()

    assert row.proposer_party_id == proposer_party_id
    assert row.listing_item_id == listing_item_id
    assert row.offered_item_id == offered_item_id
    assert row.proposer_reservation_id == proposer_reservation_id
    assert row.status == SwapProposalStatus.PROPOSED
    assert isinstance(row.status, str)
    assert row.term_ended_notified_at is None


async def test_swapProposal_unknownProposerPartyId_violatesForeignKeyConstraint(
    db_session: AsyncSession,
) -> None:
    db_session.add(
        SwapProposal(
            proposer_party_id=uuid.uuid4(),
            listing_item_id=uuid.uuid4(),
            offered_item_id=uuid.uuid4(),
            proposer_reservation_id=uuid.uuid4(),
            status=SwapProposalStatus.PROPOSED,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_swapProposal_looseItemAndReservationPointers_acceptArbitraryIds_noFk(
    db_session: AsyncSession,
) -> None:
    proposer_party_id = await _create_party(db_session)

    # Arbitrary ids with no corresponding circulation rows must succeed
    # — these fields are deliberate loose cross-BC pointers, no FK
    # constraint, matching `ItemListingPreference`'s convention.
    listing_item_id, offered_item_id, proposer_reservation_id = (
        uuid.uuid4(),
        uuid.uuid4(),
        uuid.uuid4(),
    )
    proposal = SwapProposal(
        proposer_party_id=proposer_party_id,
        listing_item_id=listing_item_id,
        offered_item_id=offered_item_id,
        proposer_reservation_id=proposer_reservation_id,
        status=SwapProposalStatus.ACCEPTED,
    )
    db_session.add(proposal)
    await db_session.commit()

    row = (
        await db_session.execute(select(SwapProposal).where(SwapProposal.id == proposal.id))
    ).scalar_one()
    assert row.listing_item_id == listing_item_id
    assert row.offered_item_id == offered_item_id
    assert row.proposer_reservation_id == proposer_reservation_id


async def test_giveawayTermEndMarker_roundTrips_andEnforcesUniqueReservationId(
    db_session: AsyncSession,
) -> None:
    notified_at = datetime.utcnow().replace(microsecond=0)
    reservation_id = uuid.uuid4()

    marker = GiveawayTermEndMarker(reservation_id=reservation_id, notified_at=notified_at)
    db_session.add(marker)
    await db_session.commit()

    row = (
        await db_session.execute(
            select(GiveawayTermEndMarker).where(
                GiveawayTermEndMarker.reservation_id == reservation_id
            )
        )
    ).scalar_one()
    assert row.notified_at == notified_at

    db_session.add(GiveawayTermEndMarker(reservation_id=reservation_id, notified_at=notified_at))
    with pytest.raises(IntegrityError):
        await db_session.flush()


def test_newNotificationKindMembers_areAtMostThirtyChars_andRoundTripAsString() -> None:
    new_members = [
        NotificationKind.SWAP_PROPOSED,
        NotificationKind.SWAP_ACCEPTED,
        NotificationKind.SWAP_REJECTED,
        NotificationKind.TERM_CONFIRMATION_NEEDED,
        NotificationKind.TERM_ALREADY_RESOLVED,
    ]
    for member in new_members:
        assert len(member.value) <= 30
        assert NotificationKind(member.value) is member
