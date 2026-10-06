"""Withdraw on re-point: PATCHing an item onto a product with a PENDING or
NEEDS_REVIEW photo takes it out of every Term (preference gone, PROPOSED
swaps on it rejected) in the re-point's single transaction; a failing hook
leaves the re-point uncommitted."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation import service as circulation_service
from app.circulation.models import InventoryItem, ReservationType
from app.circulation.schemas import UpdateInventoryItemRequest
from app.config import settings
from app.groups.models import SwapProposalStatus
from app.moderation.status import ModerationStatus
from app.product.models import ProductPhoto
from tests.test_photo_moderation_gate import _set_status, _upload_photo
from tests.test_photo_moderation_withdraw import (
    COUNTER_OFFER_WORDING,
    _add_item,
    _preference_item_ids,
    _proposal_status,
    _set_mode,
    _swap_setup,
)
from tests.test_term_item_listings import (
    _auth,
    _notifications,
    _principal,
    _register,
    _register_personal_item,
    _resolve_product,
)


@pytest.fixture
def moderation_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)


async def _fresh_product_id(db: AsyncSession, item_id: uuid.UUID) -> uuid.UUID:
    result = await db.execute(
        select(InventoryItem.product_id)
        .where(InventoryItem.id == item_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def test_patchItem_repointToProductWithPendingPhoto_preferenceGoneProposalRejectedProductChanged(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    lister_token, proposer_token, _, listed_item, offered_item, proposal_id = await _swap_setup(
        client, db_session, "rp.p1"
    )
    await _add_item(client, proposer_token, "Docelowy rp.p1")
    target_product = await _resolve_product(client, proposer_token, "Docelowy rp.p1")
    await _upload_photo(client, proposer_token, target_product, 11)

    response = await client.patch(
        f"/api/inventory-items/{offered_item}",
        json={"product_id": target_product},
        headers=_auth(proposer_token),
    )

    assert response.status_code == 200, response.text
    assert await _fresh_product_id(db_session, offered_item) == uuid.UUID(target_product)
    assert await _preference_item_ids(db_session, [listed_item, offered_item]) == {listed_item}
    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.REJECTED
    rejected = await _notifications(client, proposer_token, "SWAP_REJECTED")
    assert [n["message"] for n in rejected] == [COUNTER_OFFER_WORDING.format(name="Cel rp.p1")]
    assert await _notifications(client, lister_token, "SWAP_REJECTED") == []


async def test_patchItem_repointToApprovedOnlyProduct_preferenceKept(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    lister_token, proposer_token, _, listed_item, offered_item, proposal_id = await _swap_setup(
        client, db_session, "rp.a1"
    )
    await _add_item(client, proposer_token, "Docelowy rp.a1")
    target_product = await _resolve_product(client, proposer_token, "Docelowy rp.a1")
    photo_id = await _upload_photo(client, proposer_token, target_product, 12)
    await db_session.execute(
        update(ProductPhoto)
        .where(ProductPhoto.id == photo_id)
        .values(status=ModerationStatus.APPROVED)
    )
    await db_session.commit()

    response = await client.patch(
        f"/api/inventory-items/{offered_item}",
        json={"product_id": target_product},
        headers=_auth(proposer_token),
    )

    assert response.status_code == 200, response.text
    assert await _fresh_product_id(db_session, offered_item) == uuid.UUID(target_product)
    assert await _preference_item_ids(db_session, [listed_item, offered_item]) == {
        listed_item,
        offered_item,
    }
    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.PROPOSED


async def test_patchItem_hookRaises_productIdUnchanged(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "GUEST", "rp.h1@example.com")
    item_id = await _register_personal_item(client, token, "Źródłowy rp.h1")
    original_product = await _fresh_product_id(db_session, item_id)
    target_product = uuid.UUID(await _resolve_product(client, token, "Docelowy rp.h1"))
    await _set_mode(db_session, token, item_id, ReservationType.GIFT)

    async def _failing_hook(db: AsyncSession, item: uuid.UUID, product: uuid.UUID) -> None:
        raise RuntimeError("hook failed")

    with pytest.raises(RuntimeError, match="hook failed"):
        await circulation_service.update_item(
            db_session,
            item_id,
            _principal(token),
            UpdateInventoryItemRequest(product_id=target_product),
            on_product_changed=_failing_hook,
        )
    await db_session.rollback()

    assert await _fresh_product_id(db_session, item_id) == original_product
    assert await _preference_item_ids(db_session, [item_id]) == {item_id}


async def test_patchItem_repointToNeedsReviewOnlyProduct_preferenceGone(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "rp.n1@example.com")
    item_id = await _register_personal_item(client, token, "Źródłowy rp.n1")
    await _set_mode(db_session, token, item_id, ReservationType.LEND)
    await _add_item(client, token, "Docelowy rp.n1")
    target_product = await _resolve_product(client, token, "Docelowy rp.n1")
    photo_id = await _upload_photo(client, token, target_product, 13)
    await _set_status(db_session, photo_id, ModerationStatus.NEEDS_REVIEW)

    response = await client.patch(
        f"/api/inventory-items/{item_id}",
        json={"product_id": target_product},
        headers=_auth(token),
    )

    assert response.status_code == 200, response.text
    assert await _fresh_product_id(db_session, item_id) == uuid.UUID(target_product)
    assert await _preference_item_ids(db_session, [item_id]) == set()


async def test_patchItem_sameProductOrConditionOnly_listingKeptDespitePendingPhoto(
    client: AsyncClient, db_session: AsyncSession, moderation_on: None
) -> None:
    """Only a real re-point runs the withdraw: re-sending the current
    `product_id` (the edit page does) or changing the condition never clears
    a listing, even while the item's own product has a photo in moderation."""
    token, _ = await _register(client, "GUEST", "rp.s1@example.com")
    item_id = await _register_personal_item(client, token, "Źródłowy rp.s1")
    product_id = await _fresh_product_id(db_session, item_id)
    photo_id = await _upload_photo(client, token, str(product_id), 14)
    await _set_status(db_session, photo_id, ModerationStatus.APPROVED)
    await _set_mode(db_session, token, item_id, ReservationType.GIFT)
    await _set_status(db_session, photo_id, ModerationStatus.PENDING)

    for body in ({"product_id": str(product_id)}, {"condition": "FAIR"}):
        response = await client.patch(
            f"/api/inventory-items/{item_id}", json=body, headers=_auth(token)
        )
        assert response.status_code == 200, response.text

    assert await _fresh_product_id(db_session, item_id) == product_id
    assert await _preference_item_ids(db_session, [item_id]) == {item_id}
