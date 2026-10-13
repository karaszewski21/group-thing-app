"""Regression tests for the Term clock: `Term.occurs_on` is a naive
Europe/Warsaw wall-clock value, so every comparison against "now" must use
Warsaw local time regardless of the server's own timezone (production
containers run in UTC).

"Server in UTC" is simulated by swapping the `datetime` name inside the
module under test for a subclass whose naive `now()` returns UTC — exactly
what `datetime.now()` returns in a UTC container. Code that reads the clock
through `app.core.clock` is unaffected by that swap, which is the point."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import ReservationType
from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import BusinessConflictException
from app.core.security import decode_token
from app.groups import service
from app.groups.application import term_end_scan, term_item_listings
from app.groups.application.term_end_scan import scan_for_term_ended
from app.groups.domain import swap_events
from app.groups.models import Term
from app.groups.schemas import TakeTermItemListingRequest
from app.outbox.models import OutboxEntry

WARSAW = ZoneInfo("Europe/Warsaw")


def _warsaw_now() -> datetime:
    return datetime.now(WARSAW).replace(tzinfo=None)


class _UtcServerDatetime(datetime):
    """`datetime` as seen in a container running in UTC."""

    @classmethod
    def now(cls, tz: tzinfo | None = None) -> datetime:  # type: ignore[override]
        if tz is None:
            return datetime.now(timezone.utc).replace(tzinfo=None)
        return datetime.now(tz)


class _WarsawServerDatetime(datetime):
    """`datetime` as seen on a server correctly configured for Warsaw."""

    @classmethod
    def now(cls, tz: tzinfo | None = None) -> datetime:  # type: ignore[override]
        if tz is None:
            return _warsaw_now()
        return datetime.now(tz)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _principal(token: str) -> Principal:
    claims = decode_token(token, settings.jwt_secret)
    return Principal(username=claims["sub"], authorities=frozenset())


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, uuid.UUID]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], uuid.UUID(r.json()["party_id"])


async def _create_circle(client: AsyncClient, org_token: str, prefix: str) -> uuid.UUID:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    return uuid.UUID(circle.json()["id"])


async def _add_term(client: AsyncClient, org_token: str, group_id: uuid.UUID) -> uuid.UUID:
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": str(group_id),
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return uuid.UUID(term.json()["id"])


async def _rsvp(
    client: AsyncClient, token: str, group_id: uuid.UUID, term_id: uuid.UUID
) -> None:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": str(term_id), "guardian_name": "ignored", "child_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 201


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> uuid.UUID:
    categories = await client.get("/api/categories", headers=_auth(token))
    product = await client.post(
        "/api/products/resolve",
        json={"name": product_name, "category_id": str(categories.json()[0]["id"])},
        headers=_auth(token),
    )
    assert product.status_code == 200
    inv = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inv.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inv.json()["id"],
            "product_id": product.json()["id"],
            "condition": "GOOD",
        },
        headers=_auth(token),
    )
    assert item.status_code == 201
    return uuid.UUID(item.json()["id"])


async def _set_occurs_on(db_session: AsyncSession, term_id: uuid.UUID, value: datetime) -> None:
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = value
    await db_session.commit()


async def _count_outbox_entries(db_session: AsyncSession, event_type: str) -> int:
    result = await db_session.execute(
        select(OutboxEntry).where(OutboxEntry.event_type == event_type)
    )
    return len(result.scalars().all())


async def _listing_with_taker(
    client: AsyncClient, db_session: AsyncSession, suffix: str, mode: ReservationType
) -> tuple[str, str, uuid.UUID, uuid.UUID]:
    """Lister + taker attending one Term; the lister's item is listed with `mode`."""
    org_token, _ = await _register(client, "ORGANIZER", f"tcr.org{suffix}@example.com")
    group_id = await _create_circle(client, org_token, f"tcr{suffix}")
    term_id = await _add_term(client, org_token, group_id)

    lister_token, _ = await _register(client, "GUEST", f"tcr.lister{suffix}@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, f"Rzecz{suffix}")
    await service.set_item_listing_preference(db_session, _principal(lister_token), item_id, mode)

    taker_token, _ = await _register(client, "GUEST", f"tcr.taker{suffix}@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    return lister_token, taker_token, item_id, term_id


async def test_takeListing_termStartedInWarsaw_serverClockUtc_raisesTermAlreadyHappened(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, taker_token, item_id, term_id = await _listing_with_taker(
        client, db_session, "1", ReservationType.GIFT
    )
    await _set_occurs_on(db_session, term_id, _warsaw_now() - timedelta(minutes=30))
    monkeypatch.setattr(term_item_listings, "datetime", _UtcServerDatetime, raising=False)

    with pytest.raises(BusinessConflictException, match="Termin już się odbył"):
        await service.take_item_listing(
            db_session,
            _principal(taker_token),
            item_id,
            TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
        )


async def test_confirmTransaction_termStartedInWarsaw_serverClockUtc_fulfills(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    lister_token, taker_token, item_id, term_id = await _listing_with_taker(
        client, db_session, "2", ReservationType.GIFT
    )
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    assert taken.resolved_reservation_id is not None
    await _set_occurs_on(db_session, term_id, _warsaw_now() - timedelta(minutes=30))
    monkeypatch.setattr(term_item_listings, "datetime", _UtcServerDatetime, raising=False)

    outcome = await service.confirm_transaction(
        db_session, _principal(lister_token), taken.resolved_reservation_id
    )

    assert outcome.status == "FULFILLED"


async def test_acceptSwapProposal_afterTermStarted_raisesTermAlreadyHappened(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    lister_token, proposer_token, listed_item_id, term_id = await _listing_with_taker(
        client, db_session, "3", ReservationType.SWAP
    )
    offered_item_id = await _register_personal_item(client, proposer_token, "Oferta3")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )
    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    await _set_occurs_on(db_session, term_id, _warsaw_now() - timedelta(minutes=30))

    with pytest.raises(BusinessConflictException, match="Termin już się odbył"):
        await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)


async def test_scan_termEndedWithinGracePeriod_emitsNothingYet(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, taker_token, item_id, term_id = await _listing_with_taker(
        client, db_session, "4", ReservationType.GIFT
    )
    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    await _set_occurs_on(db_session, term_id, _warsaw_now() - timedelta(hours=1))
    monkeypatch.setattr(term_end_scan, "datetime", _WarsawServerDatetime, raising=False)

    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 0


async def test_scan_termEndedPastGracePeriod_emitsGiveawayEvent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, taker_token, item_id, term_id = await _listing_with_taker(
        client, db_session, "5", ReservationType.GIFT
    )
    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    await _set_occurs_on(db_session, term_id, _warsaw_now() - timedelta(hours=3))

    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 1


async def test_scan_acceptedSwapForLaterTerm_notPromptedWhenEarlierTermEnds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tcr.org6@example.com")
    group_id = await _create_circle(client, org_token, "tcr6")
    earlier_term_id = await _add_term(client, org_token, group_id)
    later_term_id = await _add_term(client, org_token, group_id)

    lister_token, _ = await _register(client, "GUEST", "tcr.lister6@example.com")
    proposer_token, _ = await _register(client, "GUEST", "tcr.proposer6@example.com")
    for token in (lister_token, proposer_token):
        await _rsvp(client, token, group_id, earlier_term_id)
        await _rsvp(client, token, group_id, later_term_id)

    listed_item_id = await _register_personal_item(client, lister_token, "Kask6")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), listed_item_id, ReservationType.SWAP
    )
    offered_item_id = await _register_personal_item(client, proposer_token, "Rowerek6")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )
    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, later_term_id
    )
    await service.accept_swap_proposal(db_session, _principal(lister_token), proposal.id)

    await _set_occurs_on(db_session, earlier_term_id, _warsaw_now() - timedelta(hours=3))

    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_SWAP) == 0
