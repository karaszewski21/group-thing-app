"""`app.groups.application.term_end_scan` — the periodic worker that detects
a just-ended `Term`'s still-unresolved giveaway `Reservation`s and
`ACCEPTED` `SwapProposal`s, and emits an idempotent outbox event for each so
`app.notifications.outbox_listener` can prompt both parties to
`confirm_transaction`.

Setup (users, circle, term, products, inventory items, listing preferences)
goes through the real HTTP API plus `service.*` use cases, mirroring
`test_term_item_listings.py`'s style; `Term.occurs_on` is pushed into the
past directly via `db_session`, same precedent that file already uses."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import cast

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.circulation.models import ReservationType
from app.config import settings
from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.core.security import decode_token
from app.groups import service
from app.groups.application import term_end_scan
from app.groups.application.term_end_scan import scan_for_term_ended
from app.groups.domain import swap_events
from app.groups.models import GiveawayTermEndMarker, SwapProposal, SwapProposalStatus, Term
from app.groups.schemas import TakeTermItemListingRequest
from app.notifications.models import Notification, NotificationKind
from app.notifications.outbox_listener import register as register_outbox_handlers
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry
from tests.conftest import count_queries


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _principal(token: str) -> Principal:
    claims = decode_token(token, settings.jwt_secret)
    return Principal(username=claims["sub"], authorities=frozenset())


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str
) -> tuple[int, int]:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (clock.local_now().date() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return circle.json()["id"], term.json()["id"]


async def _rsvp(client: AsyncClient, token: str, group_id: int, term_id: int) -> int:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 201
    return r.json()["id"]


async def _category_id(client: AsyncClient, token: str) -> str:
    categories = await client.get("/api/categories", headers=_auth(token))
    assert categories.status_code == 200
    return str(categories.json()[0]["id"])


async def _resolve_product(client: AsyncClient, token: str, name: str) -> int:
    r = await client.post(
        "/api/products/resolve",
        json={"name": name, "category_id": await _category_id(client, token)},
        headers=_auth(token),
    )
    assert r.status_code == 200
    return r.json()["id"]


async def _register_personal_item(client: AsyncClient, token: str, product_name: str) -> int:
    product_id = await _resolve_product(client, token, product_name)
    inv = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inv.status_code == 201
    item = await client.post(
        "/api/inventory-items",
        json={"inventory_id": inv.json()["id"], "product_id": product_id, "condition": "GOOD"},
        headers=_auth(token),
    )
    assert item.status_code == 201
    return item.json()["id"]


async def _push_term_into_past(db_session: AsyncSession, term_id: int) -> None:
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = clock.local_now() - term_end_scan.TERM_END_GRACE - timedelta(hours=1)
    await db_session.commit()


async def _count_outbox_entries(db_session: AsyncSession, event_type: str) -> int:
    result = await db_session.execute(
        select(OutboxEntry).where(OutboxEntry.event_type == event_type)
    )
    return len(result.scalars().all())


async def test_scan_pendingGiveawayPastTermEnd_appendsOneEventAndCreatesMarker(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tes.org1@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tes1")

    lister_token, _ = await _register(client, "GUEST", "tes.lister1@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Rowerek1")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "tes.taker1@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    reservation_id = taken.resolved_reservation_id

    await _push_term_into_past(db_session, term_id)

    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 1
    marker = (
        await db_session.execute(
            select(GiveawayTermEndMarker).where(
                GiveawayTermEndMarker.reservation_id == reservation_id
            )
        )
    ).scalar_one_or_none()
    assert marker is not None


async def test_scan_secondRunOverSameWindow_isIdempotent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tes.org2@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tes2")

    lister_token, _ = await _register(client, "GUEST", "tes.lister2@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Rowerek2")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "tes.taker2@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )

    await _push_term_into_past(db_session, term_id)

    await scan_for_term_ended(db_session)
    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 1
    markers = (await db_session.execute(select(GiveawayTermEndMarker))).scalars().all()
    assert len(markers) == 1


async def test_scan_acceptedSwapProposalPastTermEnd_emitsTermEndedSwap(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tes.org3@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tes3")

    owner_token, _ = await _register(client, "GUEST", "tes.owner3@example.com")
    await _rsvp(client, owner_token, group_id, term_id)
    listing_item_id = await _register_personal_item(client, owner_token, "Kajak3")
    await service.set_item_listing_preference(
        db_session, _principal(owner_token), listing_item_id, ReservationType.SWAP
    )

    proposer_token, _ = await _register(client, "GUEST", "tes.proposer3@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Sanki3")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listing_item_id, offered_item_id, term_id
    )
    accepted = await service.accept_swap_proposal(db_session, _principal(owner_token), proposal.id)
    assert accepted.status == "ACCEPTED"

    await _push_term_into_past(db_session, term_id)

    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_SWAP) == 1
    refreshed = (
        await db_session.execute(select(SwapProposal).where(SwapProposal.id == proposal.id))
    ).scalar_one()
    assert refreshed.term_ended_notified_at is not None
    assert refreshed.status == SwapProposalStatus.ACCEPTED


async def test_scan_termInFuture_neverScanned(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tes.org4@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tes4")

    lister_token, _ = await _register(client, "GUEST", "tes.lister4@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Rowerek4")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "tes.taker4@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    # Term.occurs_on stays in the future (created 7 days ahead) — never pushed
    # into the past, unlike every other test in this module.

    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 0
    markers = (await db_session.execute(select(GiveawayTermEndMarker))).scalars().all()
    assert len(markers) == 0


async def test_scan_graceBoundary_emitsOnlyFromTwoHoursAfterTerm(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tes.org20@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tes20")

    lister_token, _ = await _register(client, "GUEST", "tes.lister20@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Rowerek20")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )

    taker_token, _ = await _register(client, "GUEST", "tes.taker20@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    grace_ends = term.occurs_on + term_end_scan.TERM_END_GRACE

    freeze_local_now(grace_ends - timedelta(minutes=1))
    await scan_for_term_ended(db_session)
    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 0

    freeze_local_now(grace_ends)
    await scan_for_term_ended(db_session)
    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 1


async def test_outboxListener_termEndedGiveaway_createsNotificationPerParty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Directly exercises the outbox handler (bypassing `scan_for_term_ended`)
    against a hand-built payload — real registered parties are required
    since `Notification.party_id` carries a real FK into `parties`."""
    _, owner_party_id = await _register(client, "GUEST", "tes.listenerowner1@example.com")
    _, taker_party_id = await _register(client, "GUEST", "tes.listenertaker1@example.com")

    register_outbox_handlers()
    from app.outbox import service as outbox_service

    await outbox_service.append(
        db_session,
        event_type=swap_events.TERM_ENDED_GIVEAWAY,
        payload={
            "owner_party_id": owner_party_id,
            "taker_party_id": taker_party_id,
            "reservation_id": str(uuid.uuid4()),
            "link_path": "/x/grupa/1/term/1",
        },
    )
    await db_session.commit()

    await dispatch_pending(db_session)

    notifs = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.party_id.in_((owner_party_id, taker_party_id)),
                    Notification.kind == NotificationKind.TERM_CONFIRMATION_NEEDED,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(notifs) == 2
    assert {str(n.party_id) for n in notifs} == {owner_party_id, taker_party_id}


async def test_outboxListener_termEndedSwap_createsNotificationForBothParties(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, proposer_party_id = await _register(client, "GUEST", "tes.listenerproposer1@example.com")
    _, owner_party_id = await _register(client, "GUEST", "tes.listenerswapowner1@example.com")

    register_outbox_handlers()
    from app.outbox import service as outbox_service

    await outbox_service.append(
        db_session,
        event_type=swap_events.TERM_ENDED_SWAP,
        payload={
            "proposer_party_id": proposer_party_id,
            "owner_party_id": owner_party_id,
            "proposal_id": str(uuid.uuid4()),
            "link_path": "/x/grupa/1/term/1",
        },
    )
    await db_session.commit()

    await dispatch_pending(db_session)

    notifs = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.party_id.in_((proposer_party_id, owner_party_id)),
                    Notification.kind == NotificationKind.TERM_CONFIRMATION_NEEDED,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(notifs) == 2
    assert {str(n.party_id) for n in notifs} == {proposer_party_id, owner_party_id}


async def _outbox_payloads(db_session: AsyncSession, event_type: str) -> list[dict]:
    result = await db_session.execute(
        select(OutboxEntry).where(OutboxEntry.event_type == event_type)
    )
    return [entry.payload for entry in result.scalars().all()]


async def test_scan_giftReservationOfOtherTerm_isNotPrompted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The lister is eligible for the ended Term, but the GIFT was taken for
    a later Term of the same circle — only `Reservation.term_id` decides."""
    org_token, _ = await _register(client, "ORGANIZER", "tes.org5@example.com")
    group_id, ended_term_id = await _create_circle_and_term(client, org_token, "tes5")
    later_term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (clock.local_now().date() + timedelta(days=14)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert later_term.status_code == 201
    later_term_id = later_term.json()["id"]

    lister_token, _ = await _register(client, "GUEST", "tes.lister5@example.com")
    taker_token, _ = await _register(client, "GUEST", "tes.taker5@example.com")
    for token in (lister_token, taker_token):
        await _rsvp(client, token, group_id, ended_term_id)
        await _rsvp(client, token, group_id, later_term_id)
    item_id = await _register_personal_item(client, lister_token, "Rowerek5")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )
    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=later_term_id, reservation_type="GIFT"),
    )

    await _push_term_into_past(db_session, ended_term_id)

    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 0
    markers = (await db_session.execute(select(GiveawayTermEndMarker))).scalars().all()
    assert len(markers) == 0


async def test_scan_termWithoutEligibleListersOrPreferences_stillPromptsReservation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A Pledge-LEND lives on a Term with no `ItemListingPreference` at all —
    the reservation path must not be gated by the SWAP path's preference
    lookup. Parties come from the reservation: owner = giver (the pledger),
    taker = `reserved_by` (the organizer)."""
    org_token, org_party_id = await _register(client, "ORGANIZER", "tes.org6@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg tes6"}, headers=_auth(org_token)
    )
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (clock.local_now().date() + timedelta(days=1)).isoformat(),
        },
        headers=_auth(org_token),
    )
    term_id = term.json()["id"]
    product_id = await _resolve_product(client, org_token, "Skrzypce6")
    needed = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": product_id, "description": None},
        headers=_auth(org_token),
    )
    guest_token, guest_party_id = await _register(client, "GUEST", "tes.guest6@example.com")
    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": needed.json()["id"]}, headers=_auth(guest_token)
    )
    fulfilled = await client.post(
        f"/api/pledges/{pledge.json()['id']}/fulfill",
        json={"condition": "GOOD"},
        headers=_auth(guest_token),
    )
    assert fulfilled.status_code == 200
    reservation_id = fulfilled.json()["resolved_reservation_id"]

    await _push_term_into_past(db_session, term_id)

    await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_GIVEAWAY)
    assert len(payloads) == 1
    assert payloads[0]["reservation_id"] == reservation_id
    assert payloads[0]["owner_party_id"] == guest_party_id
    assert payloads[0]["taker_party_id"] == org_party_id


async def test_scan_confirmedPledgeLend_secondRun_oneEventAndTwoNotificationsWithReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, org_party_id = await _register(client, "ORGANIZER", "tes.org7@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg tes7"}, headers=_auth(org_token)
    )
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (clock.local_now().date() + timedelta(days=1)).isoformat(),
        },
        headers=_auth(org_token),
    )
    term_id = term.json()["id"]
    product_id = await _resolve_product(client, org_token, "Skrzypce7")
    needed = await client.post(
        "/api/needed-items",
        json={"term_id": term_id, "product_id": product_id, "description": None},
        headers=_auth(org_token),
    )
    guest_token, guest_party_id = await _register(client, "GUEST", "tes.guest7@example.com")
    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": needed.json()["id"]}, headers=_auth(guest_token)
    )
    fulfilled = await client.post(
        f"/api/pledges/{pledge.json()['id']}/fulfill",
        json={"condition": "GOOD"},
        headers=_auth(guest_token),
    )
    assert fulfilled.status_code == 200
    reservation_id = fulfilled.json()["resolved_reservation_id"]
    await _push_term_into_past(db_session, term_id)

    await scan_for_term_ended(db_session)
    await scan_for_term_ended(db_session)

    assert await _count_outbox_entries(db_session, swap_events.TERM_ENDED_GIVEAWAY) == 1
    markers = (await db_session.execute(select(GiveawayTermEndMarker))).scalars().all()
    assert len(markers) == 1
    register_outbox_handlers()
    await dispatch_pending(db_session)
    notifications = (
        (
            await db_session.execute(
                select(Notification).where(
                    Notification.kind == NotificationKind.TERM_CONFIRMATION_NEEDED
                )
            )
        )
        .scalars()
        .all()
    )
    assert {str(n.party_id) for n in notifications} == {guest_party_id, org_party_id}
    assert len(notifications) == 2
    assert {str(n.reservation_id) for n in notifications} == {reservation_id}


async def test_scan_candidateWithMissingGiverProfile_isSkippedWhileOthersStillPrompted(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One reservation whose party has no profile must not abort the whole
    scan (and so roll back every other Term's events)."""
    org_token, _ = await _register(client, "ORGANIZER", "tes.org40@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tes40")
    taker_token, _ = await _register(client, "GUEST", "tes.taker40@example.com")
    await _rsvp(client, taker_token, group_id, term_id)

    reservation_ids: list[uuid.UUID] = []
    lister_user_ids: list[uuid.UUID] = []
    for suffix in ("a", "b"):
        lister_token, _ = await _register(client, "GUEST", f"tes.lister40{suffix}@example.com")
        await _rsvp(client, lister_token, group_id, term_id)
        item_id = await _register_personal_item(client, lister_token, f"Klocki40{suffix}")
        await service.set_item_listing_preference(
            db_session, _principal(lister_token), item_id, ReservationType.GIFT
        )
        taken = await service.take_item_listing(
            db_session,
            _principal(taker_token),
            item_id,
            TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
        )
        reservation_ids.append(cast(uuid.UUID, taken.resolved_reservation_id))
        me = await client.get("/api/people/me", headers=_auth(lister_token))
        lister_user_ids.append(uuid.UUID(me.json()["account_user_id"]))
    await _push_term_into_past(db_session, term_id)

    real_lookup = term_end_scan.get_profile_by_account_user_id
    broken_user_id = lister_user_ids[0]

    async def _lookup_with_one_missing(db: AsyncSession, account_user_id: uuid.UUID) -> object:
        if account_user_id == broken_user_id:
            raise EntityNotFoundException("UserProfile", account_user_id)
        return await real_lookup(db, account_user_id)

    monkeypatch.setattr(term_end_scan, "get_profile_by_account_user_id", _lookup_with_one_missing)

    await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_GIVEAWAY)
    assert [p["reservation_id"] for p in payloads] == [str(reservation_ids[1])]
    marked = (
        (
            await db_session.execute(
                select(GiveawayTermEndMarker.reservation_id).where(
                    GiveawayTermEndMarker.reservation_id.in_(reservation_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    assert list(marked) == [reservation_ids[1]]


# --- Question copy: grace window, enriched payload and listener rendering ---


async def test_scan_giveawayPastGrace_payloadCarriesItemDateAndGroup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tes.org50@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tes50")
    lister_token, _ = await _register(client, "GUEST", "tes.lister50@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Rowerek50")
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )
    taker_token, _ = await _register(client, "GUEST", "tes.taker50@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    await _push_term_into_past(db_session, term_id)
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()

    await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_GIVEAWAY)
    assert len(payloads) == 1
    assert payloads[0]["item_name"] == "Rowerek50"
    assert payloads[0]["occurs_on"] == term.occurs_on.isoformat()
    assert payloads[0]["group_name"] == "Krąg tes50"


async def test_scan_swapPastGrace_payloadCarriesBothItemsDateAndGroup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "tes.org51@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "tes51")
    owner_token, _ = await _register(client, "GUEST", "tes.owner51@example.com")
    await _rsvp(client, owner_token, group_id, term_id)
    listing_item_id = await _register_personal_item(client, owner_token, "Kajak51")
    await service.set_item_listing_preference(
        db_session, _principal(owner_token), listing_item_id, ReservationType.SWAP
    )
    proposer_token, _ = await _register(client, "GUEST", "tes.proposer51@example.com")
    await _rsvp(client, proposer_token, group_id, term_id)
    offered_item_id = await _register_personal_item(client, proposer_token, "Sanki51")
    await service.set_item_listing_preference(
        db_session, _principal(proposer_token), offered_item_id, ReservationType.SWAP
    )
    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listing_item_id, offered_item_id, term_id
    )
    await service.accept_swap_proposal(db_session, _principal(owner_token), proposal.id)
    await _push_term_into_past(db_session, term_id)
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()

    await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_SWAP)
    assert len(payloads) == 1
    assert payloads[0]["listing_item_name"] == "Kajak51"
    assert payloads[0]["offered_item_name"] == "Sanki51"
    assert payloads[0]["occurs_on"] == term.occurs_on.isoformat()
    assert payloads[0]["group_name"] == "Krąg tes51"


async def _dispatch_term_ended(
    db_session: AsyncSession, event_type: str, payload: dict[str, object]
) -> list[Notification]:
    register_outbox_handlers()
    from app.outbox import service as outbox_service

    await outbox_service.append(db_session, event_type=event_type, payload=payload)
    await db_session.commit()
    await dispatch_pending(db_session)
    result = await db_session.execute(
        select(Notification).where(Notification.kind == NotificationKind.TERM_CONFIRMATION_NEEDED)
    )
    return list(result.scalars().all())


async def test_outboxListener_giveawayWithDetails_rendersQuestionAndKeepsReservationId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, owner_party_id = await _register(client, "GUEST", "tes.qowner52@example.com")
    _, taker_party_id = await _register(client, "GUEST", "tes.qtaker52@example.com")
    reservation_id = uuid.uuid4()

    notifs = await _dispatch_term_ended(
        db_session,
        swap_events.TERM_ENDED_GIVEAWAY,
        {
            "owner_party_id": owner_party_id,
            "taker_party_id": taker_party_id,
            "reservation_id": str(reservation_id),
            "link_path": "/x/grupa/1/term/1",
            "item_name": "Rowerek",
            "occurs_on": "2026-10-14T16:30:00",
            "group_name": "Krąg Słoneczko",
        },
    )

    assert len(notifs) == 2
    for n in notifs:
        assert n.message == (
            "Czy przekazanie „Rowerek” doszło do skutku? (śr 14.10, Krąg Słoneczko)"
        )
        assert n.reservation_id == reservation_id
        assert n.proposal_id is None


async def test_outboxListener_swapWithDetails_rendersQuestionAndSetsProposalId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, proposer_party_id = await _register(client, "GUEST", "tes.qproposer53@example.com")
    _, owner_party_id = await _register(client, "GUEST", "tes.qowner53@example.com")
    proposal_id = uuid.uuid4()

    notifs = await _dispatch_term_ended(
        db_session,
        swap_events.TERM_ENDED_SWAP,
        {
            "proposer_party_id": proposer_party_id,
            "owner_party_id": owner_party_id,
            "proposal_id": str(proposal_id),
            "link_path": "/x/grupa/1/term/1",
            "listing_item_name": "Kajak",
            "offered_item_name": "Sanki",
            "occurs_on": "2026-10-14T16:30:00",
            "group_name": "Krąg Słoneczko",
        },
    )

    assert len(notifs) == 2
    for n in notifs:
        assert n.message == (
            "Czy zamiana „Kajak” ↔ „Sanki” doszła do skutku? (śr 14.10, Krąg Słoneczko)"
        )
        assert n.proposal_id == proposal_id


async def test_outboxListener_payloadsWithoutDetails_fallBackToGenericQuestions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, party_a = await _register(client, "GUEST", "tes.qold54a@example.com")
    _, party_b = await _register(client, "GUEST", "tes.qold54b@example.com")

    giveaway = await _dispatch_term_ended(
        db_session,
        swap_events.TERM_ENDED_GIVEAWAY,
        {
            "owner_party_id": party_a,
            "taker_party_id": party_b,
            "reservation_id": str(uuid.uuid4()),
            "link_path": "/x/grupa/1/term/1",
        },
    )
    assert {n.message for n in giveaway} == {"Czy przekazanie rzeczy doszło do skutku?"}

    all_notifs = await _dispatch_term_ended(
        db_session,
        swap_events.TERM_ENDED_SWAP,
        {
            "proposer_party_id": party_a,
            "owner_party_id": party_b,
            "proposal_id": str(uuid.uuid4()),
            "link_path": "/x/grupa/1/term/1",
        },
    )
    swap = [n for n in all_notifs if n.proposal_id is not None]
    assert len(swap) == 2
    assert {n.message for n in swap} == {"Czy zamiana doszła do skutku?"}


async def test_outboxListener_maxLengthNames_messageCappedAt500Characters(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, owner_party_id = await _register(client, "GUEST", "tes.qlong55a@example.com")
    _, taker_party_id = await _register(client, "GUEST", "tes.qlong55b@example.com")

    notifs = await _dispatch_term_ended(
        db_session,
        swap_events.TERM_ENDED_GIVEAWAY,
        {
            "owner_party_id": owner_party_id,
            "taker_party_id": taker_party_id,
            "reservation_id": str(uuid.uuid4()),
            "link_path": "/x/grupa/1/term/1",
            "item_name": "p" * 255,
            "occurs_on": "2026-10-14T16:30:00",
            "group_name": "g" * 255,
        },
    )

    assert len(notifs) == 2
    for n in notifs:
        assert len(n.message) == 500
        assert n.message.endswith("…")


async def test_outboxListener_swapMaxLengthNames_messageCappedAt500AndKeepsProposalId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, proposer_party_id = await _register(client, "GUEST", "tes.qlong56a@example.com")
    _, owner_party_id = await _register(client, "GUEST", "tes.qlong56b@example.com")
    proposal_id = uuid.uuid4()

    notifs = await _dispatch_term_ended(
        db_session,
        swap_events.TERM_ENDED_SWAP,
        {
            "proposer_party_id": proposer_party_id,
            "owner_party_id": owner_party_id,
            "proposal_id": str(proposal_id),
            "link_path": "/x/grupa/1/term/1",
            "listing_item_name": "k" * 255,
            "offered_item_name": "s" * 255,
            "occurs_on": "2026-10-14T16:30:00",
            "group_name": "g" * 255,
        },
    )

    assert len(notifs) == 2
    for n in notifs:
        assert len(n.message) == 500
        assert n.message.endswith("…")
        assert n.proposal_id == proposal_id


# --- Query budget ---


async def _term_with_gifts(
    client: AsyncClient, db_session: AsyncSession, prefix: str, gift_count: int
) -> int:
    org_token, _ = await _register(client, "ORGANIZER", f"tes.org{prefix}@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, f"tes{prefix}")
    taker_token, _ = await _register(client, "GUEST", f"tes.taker{prefix}@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    for n in range(gift_count):
        lister_token, _ = await _register(client, "GUEST", f"tes.lister{prefix}n{n}@example.com")
        await _rsvp(client, lister_token, group_id, term_id)
        item_id = await _register_personal_item(client, lister_token, f"Klocki{prefix}n{n}")
        await service.set_item_listing_preference(
            db_session, _principal(lister_token), item_id, ReservationType.GIFT
        )
        await service.take_item_listing(
            db_session,
            _principal(taker_token),
            item_id,
            TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
        )
    return term_id


async def test_scan_threeHandOversVersusOne_itemProductAndGroupReadsDoNotGrow(
    client: AsyncClient, engine: AsyncEngine, db_session: AsyncSession
) -> None:
    """Item names, products and groups are resolved in batch reads, so the
    scan issues the same reads for three emitted events as for one — only
    the per-party profile lookups (and the staged rows they autoflush) scale
    with the events."""
    one_term_id = await _term_with_gifts(client, db_session, "60a", 1)
    three_term_id = await _term_with_gifts(client, db_session, "60b", 3)

    await _push_term_into_past(db_session, one_term_id)
    with count_queries(engine) as one_event:
        await scan_for_term_ended(db_session)

    one_term = (await db_session.execute(select(Term).where(Term.id == one_term_id))).scalar_one()
    one_term.occurs_on -= term_end_scan.DEFAULT_WINDOW + timedelta(days=1)
    await _push_term_into_past(db_session, three_term_id)
    with count_queries(engine) as three_events:
        await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_GIVEAWAY)
    assert len(payloads) == 4
    assert all(p["item_name"] and p["group_name"] for p in payloads)

    def _reads_without_profile_lookups(statements: list[str]) -> list[str]:
        return [s for s in statements if s.startswith("SELECT") and "user_profiles" not in s]

    assert len(_reads_without_profile_lookups(three_events)) == len(
        _reads_without_profile_lookups(one_event)
    )
