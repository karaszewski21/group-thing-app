"""One-time cutover cleanup script: withdraws the term listings of items whose
product already has PENDING/NEEDS_REVIEW photos. One transaction per product
with a FOR SHARE re-check; a second run changes nothing."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.circulation.models import ReservationType
from app.config import settings
from app.groups.application import term_item_listings
from app.groups.infrastructure import product_bridge
from app.groups.models import SwapProposalStatus
from app.moderation.status import ModerationStatus
from app.product import service as product_service
from app.product.models import ProductPhoto
from scripts import withdraw_unmoderated_listings
from tests.fake_storage import FakeStorage
from tests.test_moderation import _png
from tests.test_photo_moderation_withdraw import (
    _add_item,
    _preference_item_ids,
    _proposal_status,
    _set_mode,
    _swap_setup,
)
from tests.test_term_item_listings import (
    _principal,
    _register,
    _register_personal_item,
    _resolve_product,
)


def _session_factory(db_session: AsyncSession) -> async_sessionmaker[AsyncSession]:
    """Sessions on the test's connection: each script commit releases a
    SAVEPOINT, and the outer test transaction still rolls everything back."""
    return async_sessionmaker(
        bind=db_session.bind,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )


async def _add_photo(
    db: AsyncSession,
    storage: FakeStorage,
    token: str,
    product_id: str,
    status: ModerationStatus,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A photo stored before the cutover (no withdraw hook), then forced to `status`."""
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    view = await product_service.add_product_photo(
        db, uuid.UUID(product_id), _png(7), _principal(token), storage
    )
    await db.execute(update(ProductPhoto).where(ProductPhoto.id == view.id).values(status=status))
    await db.commit()


async def test_run_productWithNeedsReviewPhoto_withdrawnUnrelatedProductUntouched(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_token, _ = await _register(client, "GUEST", "wus.a1@example.com")
    flagged_item = await _register_personal_item(client, owner_token, "Sprzątanie wózek")
    other_item = await _add_item(client, owner_token, "Sprzątanie rower")
    for item_id in (flagged_item, other_item):
        await _set_mode(db_session, owner_token, item_id, ReservationType.GIFT)
    flagged_product = await _resolve_product(client, owner_token, "Sprzątanie wózek")
    await _add_photo(
        db_session,
        fake_storage,
        owner_token,
        flagged_product,
        ModerationStatus.NEEDS_REVIEW,
        monkeypatch,
    )

    counts = await withdraw_unmoderated_listings.run(_session_factory(db_session))

    assert counts == withdraw_unmoderated_listings.WithdrawCounts(withdrawn=1, failed=0)
    assert await _preference_item_ids(db_session, [flagged_item, other_item]) == {other_item}


async def test_run_secondRun_changesNothing(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lister_token, _, _, listed_item, offered_item, proposal_id = await _swap_setup(
        client, db_session, "wus.b1"
    )
    await _add_photo(
        db_session,
        fake_storage,
        lister_token,
        await _resolve_product(client, lister_token, "Cel wus.b1"),
        ModerationStatus.PENDING,
        monkeypatch,
    )
    # Approved between the listing query and the per-product re-check: the
    # FOR SHARE re-check must skip it.
    approved_token, _ = await _register(client, "GUEST", "wus.b1.approved@example.com")
    approved_item = await _register_personal_item(client, approved_token, "Zatwierdzony wus")
    await _set_mode(db_session, approved_token, approved_item, ReservationType.GIFT)
    approved_product = uuid.UUID(await _resolve_product(client, approved_token, "Zatwierdzony wus"))
    real_list = product_bridge.list_product_ids_with_unmoderated_photos

    async def _list_with_approved(db: AsyncSession) -> list[uuid.UUID]:
        return [*await real_list(db), approved_product]

    monkeypatch.setattr(
        product_bridge, "list_product_ids_with_unmoderated_photos", _list_with_approved
    )
    session_factory = _session_factory(db_session)

    assert (await withdraw_unmoderated_listings.run(session_factory)).withdrawn == 1
    after_first = await _preference_item_ids(db_session, [listed_item, offered_item, approved_item])
    assert after_first == {offered_item, approved_item}
    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.REJECTED

    await withdraw_unmoderated_listings.run(session_factory)

    assert (
        await _preference_item_ids(db_session, [listed_item, offered_item, approved_item])
        == after_first
    )
    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.REJECTED


async def test_run_oneProductFails_othersStillWithdrawnAndFailureCounted(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, _ = await _register(client, "GUEST", "wus.f1@example.com")
    failing_item = await _register_personal_item(client, token, "Awaria wus.f1")
    healthy_item = await _add_item(client, token, "Zdrowy wus.f1")
    for item_id in (failing_item, healthy_item):
        await _set_mode(db_session, token, item_id, ReservationType.GIFT)
    failing_product = await _resolve_product(client, token, "Awaria wus.f1")
    healthy_product = await _resolve_product(client, token, "Zdrowy wus.f1")
    for product_id in (failing_product, healthy_product):
        await _add_photo(
            db_session, fake_storage, token, product_id, ModerationStatus.PENDING, monkeypatch
        )
    real_withdraw = term_item_listings.withdraw_product_listings

    async def _fail_one(db: AsyncSession, product_id: uuid.UUID) -> None:
        await real_withdraw(db, product_id)
        if product_id == uuid.UUID(failing_product):
            raise RuntimeError("withdraw failed")

    monkeypatch.setattr(term_item_listings, "withdraw_product_listings", _fail_one)
    real_list = product_bridge.list_product_ids_with_unmoderated_photos

    async def _only_these(db: AsyncSession) -> list[uuid.UUID]:
        ours = {uuid.UUID(failing_product), uuid.UUID(healthy_product)}
        return [p for p in await real_list(db) if p in ours]

    monkeypatch.setattr(product_bridge, "list_product_ids_with_unmoderated_photos", _only_these)

    counts = await withdraw_unmoderated_listings.run(_session_factory(db_session))

    assert counts == withdraw_unmoderated_listings.WithdrawCounts(withdrawn=1, failed=1)
    assert await _preference_item_ids(db_session, [failing_item, healthy_item]) == {failing_item}


@pytest.mark.parametrize(
    ("counts", "expected_exit"),
    [
        (withdraw_unmoderated_listings.WithdrawCounts(withdrawn=2, failed=0), None),
        (withdraw_unmoderated_listings.WithdrawCounts(withdrawn=1, failed=1), 1),
    ],
)
def test_main_exitCodeReflectsFailures(
    counts: withdraw_unmoderated_listings.WithdrawCounts,
    expected_exit: int | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_run(
        session_factory: async_sessionmaker[AsyncSession],
    ) -> withdraw_unmoderated_listings.WithdrawCounts:
        return counts

    monkeypatch.setattr(withdraw_unmoderated_listings, "run", _fake_run)

    if expected_exit is None:
        withdraw_unmoderated_listings.main()
    else:
        with pytest.raises(SystemExit) as exc_info:
            withdraw_unmoderated_listings.main()
        assert exc_info.value.code == expected_exit
