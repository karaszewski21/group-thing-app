"""Query and bridge layer behind the photo-moderation publish gate and
withdraw: the flush-only `release_reservation`, the unmoderated-photo
lookups, the item ids of a product and the pending swap proposals that
involve given items."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import (
    BalanceStatus,
    InventoryBalance,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.groups.infrastructure import circulation_bridge, product_bridge
from app.groups.infrastructure import repository as groups_repository
from app.groups.models import SwapProposal, SwapProposalStatus
from app.moderation.status import ModerationStatus
from app.party.models import Party, PartyType
from app.product.models import ProductPhoto
from tests.test_circulation_ledger import (
    _create_item,
    _create_product,
    _create_user,
    _id,
    _personal_inventories,
    _register_item_via_api,
    _register_user,
    _reserve,
)


async def _add_photo(db: AsyncSession, product_id: uuid.UUID, status: ModerationStatus) -> None:
    db.add(
        ProductPhoto(
            product_id=product_id,
            storage_key=f"products/{product_id}/{uuid.uuid4().hex}",
            width=1600,
            height=1200,
            size_bytes=1000,
            content_sha256=uuid.uuid4().hex * 2,
            status=status,
            uploaded_by_user_id=await _create_user(db),
            sort_order=0,
        )
    )
    await db.flush()


async def test_releaseReservation_cancelsAndFlushes_rollbackRestores(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner_headers, owner_id = await _register_user(client, "pmq.owner1@example.com")
    _, taker_id = await _register_user(client, "pmq.taker1@example.com")
    _, item_id = await _register_item_via_api(client, db_session, owner_headers)
    reservation_id = await _reserve(
        client,
        db_session,
        headers=owner_headers,
        item_id=item_id,
        reservation_type=ReservationType.GIFT,
        reserved_by_user_id=taker_id,
    )
    commits: list[None] = []
    original_commit = db_session.commit

    async def _counting_commit() -> None:
        commits.append(None)
        await original_commit()

    monkeypatch.setattr(db_session, "commit", _counting_commit)

    released = await circulation_bridge.release_reservation(db_session, reservation_id, owner_id)

    assert released.status == ReservationStatus.CANCELLED
    flushed_status = (
        await db_session.execute(
            select(Reservation.status)
            .where(Reservation.id == reservation_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert flushed_status == ReservationStatus.CANCELLED
    balance = (
        await db_session.execute(
            select(InventoryBalance).where(InventoryBalance.item_id == item_id)
        )
    ).scalar_one()
    assert balance.status == BalanceStatus.AVAILABLE
    assert commits == []

    await db_session.rollback()

    restored = (
        await db_session.execute(select(Reservation.status).where(Reservation.id == reservation_id))
    ).scalar_one()
    assert restored == ReservationStatus.PENDING
    assert commits == []


async def test_productIdsWithUnmoderatedPhotos_pendingAndNeedsReviewOnly(
    db_session: AsyncSession,
) -> None:
    by_status = {}
    for status in ModerationStatus:
        product_id = await _create_product(db_session)
        await _add_photo(db_session, product_id, status)
        by_status[status] = product_id
    no_photos = await _create_product(db_session)

    result = await product_bridge.product_ids_with_unmoderated_photos(
        db_session, [*by_status.values(), no_photos]
    )

    assert result == {
        by_status[ModerationStatus.PENDING],
        by_status[ModerationStatus.NEEDS_REVIEW],
    }
    assert await product_bridge.product_ids_with_unmoderated_photos(db_session, []) == set()


async def test_hasUnmoderatedPhotos_trueForPendingFalseForApproved(
    db_session: AsyncSession,
) -> None:
    pending = await _create_product(db_session)
    await _add_photo(db_session, pending, ModerationStatus.APPROVED)
    await _add_photo(db_session, pending, ModerationStatus.PENDING)
    approved = await _create_product(db_session)
    await _add_photo(db_session, approved, ModerationStatus.APPROVED)

    assert await product_bridge.has_unmoderated_photos(db_session, pending) is True
    assert await product_bridge.has_unmoderated_photos(db_session, approved) is False


async def test_listProductIdsWithUnmoderatedPhotos_orderedById(db_session: AsyncSession) -> None:
    created = []
    statuses = (ModerationStatus.PENDING, ModerationStatus.NEEDS_REVIEW, ModerationStatus.PENDING)
    for status in statuses:
        product_id = await _create_product(db_session)
        await _add_photo(db_session, product_id, status)
        await _add_photo(db_session, product_id, status)
        created.append(product_id)
    approved = await _create_product(db_session)
    await _add_photo(db_session, approved, ModerationStatus.APPROVED)

    result = await product_bridge.list_product_ids_with_unmoderated_photos(db_session)

    assert result == sorted(result)
    assert len(result) == len(set(result))
    assert set(created) <= set(result)
    assert approved not in result


async def test_listItemIdsForProduct_includesSoftDeleted(db_session: AsyncSession) -> None:
    product_id = await _create_product(db_session)
    other_product_id = await _create_product(db_session)
    first, second = [_id(inv) for inv in await _personal_inventories(db_session, 2)]
    live = await _create_item(db_session, product_id, first)
    deleted = await _create_item(db_session, product_id, second)
    deleted.deleted_at = datetime.utcnow()
    await _create_item(db_session, other_product_id, first)
    await db_session.flush()

    result = await circulation_bridge.list_item_ids_for_product(db_session, product_id)

    assert set(result) == {live.id, deleted.id}


async def test_listPendingSwapProposalsInvolvingItems_targetAndCounterOfferProposedOnly(
    db_session: AsyncSession,
) -> None:
    party = Party(party_type=PartyType.PERSON)
    db_session.add(party)
    await db_session.flush()
    withdrawn_a, withdrawn_b = uuid.uuid4(), uuid.uuid4()
    base = datetime.utcnow()

    def _proposal(
        listing: uuid.UUID, offered: uuid.UUID, status: SwapProposalStatus, minutes: int
    ) -> SwapProposal:
        proposal = SwapProposal(
            proposer_party_id=party.id,
            listing_item_id=listing,
            offered_item_id=offered,
            proposer_reservation_id=uuid.uuid4(),
            status=status,
        )
        proposal.created_at = base + timedelta(minutes=minutes)
        return proposal

    as_counter_offer = _proposal(uuid.uuid4(), withdrawn_b, SwapProposalStatus.PROPOSED, 1)
    as_listing = _proposal(withdrawn_a, uuid.uuid4(), SwapProposalStatus.PROPOSED, 2)
    accepted = _proposal(withdrawn_a, uuid.uuid4(), SwapProposalStatus.ACCEPTED, 3)
    rejected = _proposal(uuid.uuid4(), withdrawn_b, SwapProposalStatus.REJECTED, 4)
    unrelated = _proposal(uuid.uuid4(), uuid.uuid4(), SwapProposalStatus.PROPOSED, 5)
    db_session.add_all([as_listing, as_counter_offer, accepted, rejected, unrelated])
    await db_session.flush()

    result = await groups_repository.list_pending_swap_proposals_involving_items(
        db_session, [withdrawn_a, withdrawn_b]
    )

    assert [p.id for p in result] == [as_counter_offer.id, as_listing.id]
    assert await groups_repository.list_pending_swap_proposals_involving_items(db_session, []) == []
