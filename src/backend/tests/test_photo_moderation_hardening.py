"""Publish-gate and withdraw hardening: a concurrent re-point serializes
against the set-mode gate on the item row (two real sessions on their own
committed database), and the withdraw tolerates a soft-deleted listing item
and an already-terminal proposer reservation."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.circulation import service as circulation_service
from app.circulation.models import Reservation, ReservationStatus, ReservationType
from app.circulation.schemas import UpdateInventoryItemRequest
from app.config import settings
from app.core.errors import BusinessConflictException
from app.groups import service
from app.groups.application import term_item_listings
from app.groups.models import ItemListingPreference, SwapProposal, SwapProposalStatus
from tests.conftest import BACKEND_ROOT
from tests.fake_storage import FakeStorage
from tests.test_photo_moderation_gate import _upload_photo
from tests.test_photo_moderation_withdraw import (
    TARGET_WORDING,
    _add_item,
    _proposal_status,
    _swap_setup,
    _upload,
)
from tests.test_term_item_listings import (
    _auth,
    _fresh_balance_status,
    _notifications,
    _principal,
    _register,
    _register_personal_item,
    _resolve_product,
)


@pytest.fixture
def moderation_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)


@pytest.fixture
async def committed_engine(
    engine: AsyncEngine, database_url: str
) -> AsyncGenerator[AsyncEngine, None]:
    """A throwaway migrated database whose sessions really commit, so two
    independent sessions can race on the same rows. Dropped afterwards."""
    name = f"race_{uuid.uuid4().hex[:12]}"
    async with engine.connect() as connection:
        autocommit = await connection.execution_options(isolation_level="AUTOCOMMIT")
        await autocommit.execute(text(f'CREATE DATABASE "{name}"'))
    url = f"{database_url.rsplit('/', 1)[0]}/{name}"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_ROOT),
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )
    race_engine = create_async_engine(url)
    try:
        yield race_engine
    finally:
        await race_engine.dispose()
        async with engine.connect() as connection:
            autocommit = await connection.execution_options(isolation_level="AUTOCOMMIT")
            await autocommit.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))


@pytest.fixture
async def committed_client(
    committed_engine: AsyncEngine,
) -> AsyncGenerator[AsyncClient, None]:
    from app.db import get_db
    from app.main import app
    from app.storage.service import get_storage

    factory = async_sessionmaker(committed_engine, expire_on_commit=False)

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            yield session

    storage = FakeStorage()
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_storage] = lambda: storage
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_storage, None)


async def test_setMode_concurrentRepointToPendingProduct_waitsForItemLockThenRefused(
    committed_engine: AsyncEngine, committed_client: AsyncClient, moderation_on: None
) -> None:
    """Re-point (session A) has flushed the item's new `product_id` and run
    its withdraw, but not committed. Set-mode (session B) must block on the
    item row and, once A commits, gate on the new product — not insert a
    listing for the stale one."""
    token, _ = await _register(committed_client, "GUEST", "race.r1@example.com")
    item_id = await _register_personal_item(committed_client, token, "Stary race")
    await _add_item(committed_client, token, "Nowy race")
    pending_product = await _resolve_product(committed_client, token, "Nowy race")
    await _upload_photo(committed_client, token, pending_product, 21)
    factory = async_sessionmaker(committed_engine, expire_on_commit=False)
    repoint_flushed = asyncio.Event()
    release_repoint = asyncio.Event()

    async def _withdraw_then_pause(db: AsyncSession, item: uuid.UUID, product: uuid.UUID) -> None:
        await term_item_listings.withdraw_item_listing_if_photos_pending(db, item, product)
        repoint_flushed.set()
        await release_repoint.wait()

    async def _repoint() -> None:
        async with factory() as db:
            await circulation_service.update_item(
                db,
                item_id,
                _principal(token),
                UpdateInventoryItemRequest(product_id=uuid.UUID(pending_product)),
                on_product_changed=_withdraw_then_pause,
            )

    async def _set_mode() -> None:
        async with factory() as db:
            await service.set_item_listing_preference(
                db, _principal(token), item_id, ReservationType.GIFT
            )

    repoint = asyncio.create_task(_repoint())
    await asyncio.wait_for(repoint_flushed.wait(), timeout=10)
    set_mode = asyncio.create_task(_set_mode())
    await asyncio.sleep(0.5)
    blocked = not set_mode.done()
    release_repoint.set()
    await asyncio.wait_for(repoint, timeout=10)

    assert blocked, "set-mode did not wait for the re-point's item row lock"
    with pytest.raises(BusinessConflictException):
        await asyncio.wait_for(set_mode, timeout=10)
    async with factory() as db:
        preference = await db.scalar(
            select(ItemListingPreference.item_id).where(ItemListingPreference.item_id == item_id)
        )
    assert preference is None


async def test_addPhoto_softDeletedListingItemWithStaleProposal_uploadSucceedsProposalRejected(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage, moderation_on: None
) -> None:
    lister_token, proposer_token, _, listed_item, offered_item, proposal_id = await _swap_setup(
        client, db_session, "hd.s1"
    )
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item, None
    )
    deleted = await client.delete(
        f"/api/inventory-items/{listed_item}", headers=_auth(lister_token)
    )
    assert deleted.status_code == 204, deleted.text
    co_owner_token, _ = await _register(client, "GUEST", "hd.s1.co@example.com")
    await _register_personal_item(client, co_owner_token, "Cel hd.s1")
    product_id = await _resolve_product(client, co_owner_token, "Cel hd.s1")

    await _upload(db_session, fake_storage, co_owner_token, product_id, 22)

    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.REJECTED
    assert (await _fresh_balance_status(db_session, offered_item)).value == "AVAILABLE"
    rejected = await _notifications(client, proposer_token, "SWAP_REJECTED")
    assert [n["message"] for n in rejected] == [TARGET_WORDING.format(name="Cel hd.s1")]


async def test_addPhoto_proposerReservationAlreadyTerminal_proposalRejectedWithoutError(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage, moderation_on: None
) -> None:
    lister_token, _, _, _, _, proposal_id = await _swap_setup(client, db_session, "hd.t1")
    proposal = await db_session.get(SwapProposal, proposal_id)
    assert proposal is not None
    await db_session.execute(
        update(Reservation)
        .where(Reservation.id == proposal.proposer_reservation_id)
        .values(status=ReservationStatus.CANCELLED)
    )
    await db_session.commit()
    product_id = await _resolve_product(client, lister_token, "Cel hd.t1")

    await _upload(db_session, fake_storage, lister_token, product_id, 23)

    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.REJECTED
