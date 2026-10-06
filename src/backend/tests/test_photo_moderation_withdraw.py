"""Withdraw on photo upload: with moderation on, a PENDING upload removes every
item of the product from term listings and auto-rejects the PROPOSED swaps on
them, in the upload's single transaction. A failure anywhere leaves no photo
row, no stored files and no partial withdraw; active takes stay listed for
the taker and confirmable."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import ReservationStatus, ReservationType
from app.config import settings
from app.core.errors import BusinessConflictException
from app.groups import service
from app.groups.application import term_item_listings
from app.groups.infrastructure import notifications_bridge
from app.groups.models import ItemListingPreference, SwapProposal, SwapProposalStatus, Term
from app.groups.schemas import TakeTermItemListingRequest
from app.product import service as product_service
from app.product.models import ProductPhoto
from tests.fake_storage import FakeStorage
from tests.test_moderation import _png
from tests.test_term_item_listings import (
    _auth,
    _create_circle_and_term,
    _fresh_balance_status,
    _fresh_reservation,
    _notifications,
    _principal,
    _register,
    _register_personal_item,
    _resolve_product,
    _rsvp,
)

TARGET_WORDING = (
    'Twoja propozycja zamiany za „{name}" została odrzucona — zdjęcia tej rzeczy '
    "czekają na moderację i zniknęła ona z terminu"
)
COUNTER_OFFER_WORDING = (
    'Twoja propozycja zamiany za „{name}" została odrzucona — zdjęcia rzeczy '
    "zaproponowanej w zamian czekają na moderację. Możesz zaproponować ją ponownie "
    "po ich zatwierdzeniu"
)


@pytest.fixture
def moderation_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", True)


async def _add_item(client: AsyncClient, token: str, product_name: str) -> uuid.UUID:
    """A further item in the caller's existing PERSONAL inventory."""
    mine = await client.get("/api/inventory-items/mine", headers=_auth(token))
    response = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": mine.json()[0]["inventory_id"],
            "product_id": await _resolve_product(client, token, product_name),
            "condition": "GOOD",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def _set_mode(
    db: AsyncSession, token: str, item_id: uuid.UUID, mode: ReservationType
) -> None:
    await service.set_item_listing_preference(db, _principal(token), item_id, mode)


async def _upload(
    db: AsyncSession,
    storage: FakeStorage,
    token: str,
    product_id: str,
    seed: int,
    hook: Callable[[AsyncSession, uuid.UUID], Awaitable[None]] | None = (
        term_item_listings.withdraw_product_listings
    ),
) -> product_service.PhotoView:
    return await product_service.add_product_photo(
        db,
        uuid.UUID(product_id),
        _png(seed),
        _principal(token),
        storage,
        on_pending_photo=hook,
    )


async def _preference_item_ids(db: AsyncSession, item_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    result = await db.execute(
        select(ItemListingPreference.item_id)
        .where(ItemListingPreference.item_id.in_(item_ids))
        .execution_options(populate_existing=True)
    )
    return set(result.scalars().all())


async def _proposal_status(db: AsyncSession, proposal_id: uuid.UUID) -> SwapProposalStatus:
    result = await db.execute(
        select(SwapProposal.status)
        .where(SwapProposal.id == proposal_id)
        .execution_options(populate_existing=True)
    )
    return SwapProposalStatus(result.scalar_one())


async def _photo_count(db: AsyncSession, product_id: str) -> int:
    count = await db.scalar(
        select(func.count())
        .select_from(ProductPhoto)
        .where(ProductPhoto.product_id == uuid.UUID(product_id))
    )
    return int(count or 0)


async def _swap_setup(
    client: AsyncClient, db: AsyncSession, prefix: str
) -> tuple[str, str, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    """A SWAP listing plus one attendee's SWAP counter-offer, proposed. Returns
    `(lister_token, proposer_token, term_id, listed_item_id, offered_item_id,
    proposal_id)`."""
    org_token, _ = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, prefix)
    lister_token, _ = await _register(client, "GUEST", f"{prefix}.lister@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, lister_token, f"Cel {prefix}")
    await _set_mode(db, lister_token, listed_item_id, ReservationType.SWAP)
    proposer_token, _ = await _register(client, "GUEST", f"{prefix}.proposer@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, f"Oferta {prefix}")
    await _set_mode(db, proposer_token, offered_item_id, ReservationType.SWAP)
    proposal = await service.propose_swap(
        db, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    return (
        lister_token,
        proposer_token,
        term_id,
        listed_item_id,
        offered_item_id,
        uuid.UUID(str(proposal.id)),
    )


async def test_addPhoto_moderationOn_clearsPreferencesOfAllOwnersItemsOfProductOnly(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage, moderation_on: None
) -> None:
    owner_token, _ = await _register(client, "GUEST", "wd.c1@example.com")
    co_owner_token, _ = await _register(client, "GUEST", "wd.c2@example.com")
    owner_item = await _register_personal_item(client, owner_token, "Wycofanie wózek")
    co_owner_item = await _register_personal_item(client, co_owner_token, "Wycofanie wózek")
    other_item = await _add_item(client, owner_token, "Wycofanie rower")
    for token, item_id in (
        (owner_token, owner_item),
        (co_owner_token, co_owner_item),
        (owner_token, other_item),
    ):
        await _set_mode(db_session, token, item_id, ReservationType.GIFT)
    product_id = await _resolve_product(client, owner_token, "Wycofanie wózek")

    response = await client.post(
        f"/api/products/{product_id}/photos",
        files={"file": ("p.png", _png(1), "image/png")},
        headers=_auth(owner_token),
    )

    assert response.status_code == 201, response.text
    assert await _preference_item_ids(db_session, [owner_item, co_owner_item, other_item]) == {
        other_item
    }


async def test_addPhoto_proposedSwapOnTarget_rejectedProposerReleasedNotifiedWithTargetWording(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    moderation_on: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lister_token, proposer_token, _, listed_item, offered_item, proposal_id = await _swap_setup(
        client, db_session, "wd.t1"
    )
    proposal = await db_session.get(SwapProposal, proposal_id)
    assert proposal is not None
    proposer_reservation_id = proposal.proposer_reservation_id
    product_id = await _resolve_product(client, lister_token, "Cel wd.t1")
    commits = 0
    real_commit = db_session.commit

    async def _counting_commit() -> None:
        nonlocal commits
        commits += 1
        await real_commit()

    monkeypatch.setattr(db_session, "commit", _counting_commit)
    await _upload(db_session, fake_storage, lister_token, product_id, 2)
    monkeypatch.undo()

    assert commits == 1
    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.REJECTED
    reservation = await _fresh_reservation(db_session, proposer_reservation_id)
    assert reservation.status == ReservationStatus.CANCELLED
    assert (await _fresh_balance_status(db_session, offered_item)).value == "AVAILABLE"
    rejected = await _notifications(client, proposer_token, "SWAP_REJECTED")
    assert [n["message"] for n in rejected] == [TARGET_WORDING.format(name="Cel wd.t1")]
    assert rejected[0]["link_path"] == f"/product/{listed_item}"
    assert await _notifications(client, lister_token, "SWAP_REJECTED") == []


async def test_addPhoto_proposedSwapWithCounterOffer_rejectedWithCounterOfferWording(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage, moderation_on: None
) -> None:
    lister_token, proposer_token, _, listed_item, offered_item, proposal_id = await _swap_setup(
        client, db_session, "wd.o1"
    )
    product_id = await _resolve_product(client, proposer_token, "Oferta wd.o1")

    await _upload(db_session, fake_storage, proposer_token, product_id, 3)

    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.REJECTED
    assert (await _fresh_balance_status(db_session, offered_item)).value == "AVAILABLE"
    rejected = await _notifications(client, proposer_token, "SWAP_REJECTED")
    assert [n["message"] for n in rejected] == [COUNTER_OFFER_WORDING.format(name="Cel wd.o1")]
    assert await _notifications(client, lister_token, "SWAP_REJECTED") == []
    assert await _preference_item_ids(db_session, [listed_item, offered_item]) == {listed_item}


async def test_addPhoto_activeTakeAndAcceptedSwap_untouchedAndTakerStillSeesListing(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage, moderation_on: None
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "wd.a1.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "wd.a1")
    lister_token, _ = await _register(client, "GUEST", "wd.a1.lister@example.com")
    co_owner_token, _ = await _register(client, "GUEST", "wd.a1.co@example.com")
    taker_token, taker_party = await _register(client, "GUEST", "wd.a1.taker@example.com")
    proposer_token, proposer_party = await _register(client, "GUEST", "wd.a1.prop@example.com")
    for token in (lister_token, co_owner_token, taker_token, proposer_token):
        await _rsvp(client, token, group_id, term_id)
    gift_item = await _register_personal_item(client, lister_token, "Aktywne sanki")
    swap_item = await _register_personal_item(client, co_owner_token, "Aktywne sanki")
    offered_item = await _register_personal_item(client, proposer_token, "Aktywna piłka")
    await _set_mode(db_session, lister_token, gift_item, ReservationType.GIFT)
    await _set_mode(db_session, co_owner_token, swap_item, ReservationType.SWAP)
    await _set_mode(db_session, proposer_token, offered_item, ReservationType.SWAP)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        gift_item,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), swap_item, offered_item, term_id
    )
    proposal_id = uuid.UUID(str(proposal.id))
    await service.accept_swap_proposal(db_session, _principal(co_owner_token), proposal_id)
    product_id = await _resolve_product(client, lister_token, "Aktywne sanki")

    await _upload(db_session, fake_storage, lister_token, product_id, 4)

    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.ACCEPTED
    assert taken.resolved_reservation_id is not None
    take = await _fresh_reservation(db_session, taken.resolved_reservation_id)
    assert take.status == ReservationStatus.PENDING
    assert await _preference_item_ids(db_session, [gift_item, swap_item]) == set()
    as_taker = await service.list_my_active_taken_term_item_listings(
        db_session, term_id, taker_party
    )
    assert [(v.item_id, v.offered_types, v.resolved_reservation_id) for v in as_taker] == [
        (gift_item, ["GIFT"], taken.resolved_reservation_id)
    ]
    as_proposer = await service.list_my_active_taken_term_item_listings(
        db_session, term_id, proposer_party
    )
    assert [(v.item_id, v.offered_types) for v in as_proposer] == [(swap_item, ["SWAP"])]

    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()
    confirmed = await service.confirm_transaction(
        db_session, _principal(taker_token), taken.resolved_reservation_id
    )
    assert confirmed.status == ReservationStatus.FULFILLED


async def test_addPhoto_moderationOff_nothingCleared(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    lister_token, _, _, listed_item, offered_item, proposal_id = await _swap_setup(
        client, db_session, "wd.f1"
    )
    product_id = await _resolve_product(client, lister_token, "Cel wd.f1")

    response = await client.post(
        f"/api/products/{product_id}/photos",
        files={"file": ("p.png", _png(5), "image/png")},
        headers=_auth(lister_token),
    )

    assert response.status_code == 201, response.text
    assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.PROPOSED
    assert await _preference_item_ids(db_session, [listed_item, offered_item]) == {
        listed_item,
        offered_item,
    }


async def test_addPhoto_secondNotificationFails_nothingCommitted(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    moderation_on: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Premature-commit guard: if any step inside the withdraw committed, the
    first rejection would survive the second notification's failure."""
    lister_token, _, term_id, listed_item, first_offered, first_id = await _swap_setup(
        client, db_session, "wd.p1"
    )
    second_token, _ = await _register(client, "GUEST", "wd.p1.second@example.com")
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    await _rsvp(client, second_token, term.circle_group_id, term_id)
    second_offered = await _register_personal_item(client, second_token, "Druga oferta wd.p1")
    await _set_mode(db_session, second_token, second_offered, ReservationType.SWAP)
    second = await service.propose_swap(
        db_session, _principal(second_token), listed_item, second_offered, term_id
    )
    proposals = [p for p in [await db_session.get(SwapProposal, first_id), second] if p is not None]
    reservation_ids = [p.proposer_reservation_id for p in proposals]
    second_id = uuid.UUID(str(second.id))
    product_id = await _resolve_product(client, lister_token, "Cel wd.p1")
    real_create = notifications_bridge.create_notification
    calls = 0

    async def _second_fails(db: AsyncSession, **kwargs: object) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("notification store down")
        await real_create(db, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(notifications_bridge, "create_notification", _second_fails)

    with pytest.raises(RuntimeError):
        await _upload(db_session, fake_storage, lister_token, product_id, 6)

    assert calls == 2
    assert await _photo_count(db_session, product_id) == 0
    assert fake_storage.objects == {}
    for proposal_id in (first_id, second_id):
        assert await _proposal_status(db_session, proposal_id) == SwapProposalStatus.PROPOSED
    for reservation_id in reservation_ids:
        reservation = await _fresh_reservation(db_session, reservation_id)
        assert reservation.status == ReservationStatus.CONFIRMED
    assert await _preference_item_ids(db_session, [listed_item, first_offered, second_offered]) == {
        listed_item,
        first_offered,
        second_offered,
    }


async def test_addPhoto_hookRaises_noPhotoRowAndSpacesObjectsDeleted(
    client: AsyncClient, db_session: AsyncSession, fake_storage: FakeStorage, moderation_on: None
) -> None:
    token, _ = await _register(client, "GUEST", "wd.h1@example.com")
    await _register_personal_item(client, token, "Hak lalka")
    product_id = await _resolve_product(client, token, "Hak lalka")

    async def _failing_hook(db: AsyncSession, _product_id: uuid.UUID) -> None:
        await db.flush()
        raise RuntimeError("withdraw failed")

    with pytest.raises(RuntimeError):
        await _upload(db_session, fake_storage, token, product_id, 7, hook=_failing_hook)

    assert await _photo_count(db_session, product_id) == 0
    assert fake_storage.objects == {}


async def test_addPhoto_staleOrConflictInHook_returns409(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    moderation_on: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, _ = await _register(client, "GUEST", "wd.k1@example.com")
    await _register_personal_item(client, token, "Konflikt klocki")
    product_id = await _resolve_product(client, token, "Konflikt klocki")

    async def _conflict(db: AsyncSession, _product_id: uuid.UUID) -> None:
        raise BusinessConflictException("Konflikt podczas wycofywania")

    monkeypatch.setattr(term_item_listings, "withdraw_product_listings", _conflict)

    response = await client.post(
        f"/api/products/{product_id}/photos",
        files={"file": ("p.png", _png(8), "image/png")},
        headers=_auth(token),
    )

    assert response.status_code == 409, response.text
    assert await _photo_count(db_session, product_id) == 0
    assert fake_storage.objects == {}
