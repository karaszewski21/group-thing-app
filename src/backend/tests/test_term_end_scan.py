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

from datetime import date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import ReservationType
from app.core.auth_deps import Principal
from app.config import settings
from app.core.security import decode_token
from app.groups import service
from app.groups.application.term_end_scan import scan_for_term_ended
from app.groups.domain import swap_events
from app.groups.models import GiveawayTermEndMarker, SwapProposal, SwapProposalStatus, Term
from app.groups.schemas import TakeTermItemListingRequest
from app.notifications.models import Notification, NotificationKind
from app.notifications.outbox_listener import register as register_outbox_handlers
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry


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
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
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
    return int(r.json()["id"])


async def _resolve_product(client: AsyncClient, token: str, name: str) -> int:
    r = await client.post(
        "/api/products/resolve", json={"name": name, "category_id": 5}, headers=_auth(token)
    )
    assert r.status_code == 200
    return int(r.json()["id"])


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
    return int(item.json()["id"])


async def _push_term_into_past(db_session: AsyncSession, term_id: int) -> None:
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    term.occurs_on = datetime.utcnow() - timedelta(hours=1)
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
    markers = (
        await db_session.execute(
            select(GiveawayTermEndMarker)
        )
    ).scalars().all()
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

    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listing_item_id, offered_item_id, term_id
    )
    accepted = await service.accept_swap_proposal(
        db_session, _principal(owner_token), proposal.id
    )
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
            "reservation_id": 999,
            "link_path": "/x/grupa/1/term/1",
        },
    )
    await db_session.commit()

    await dispatch_pending(db_session)

    notifs = (
        await db_session.execute(
            select(Notification).where(
                Notification.party_id.in_((owner_party_id, taker_party_id)),
                Notification.kind == NotificationKind.TERM_CONFIRMATION_NEEDED,
            )
        )
    ).scalars().all()
    assert len(notifs) == 2
    assert {n.party_id for n in notifs} == {owner_party_id, taker_party_id}


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
            "proposal_id": 999,
            "link_path": "/x/grupa/1/term/1",
        },
    )
    await db_session.commit()

    await dispatch_pending(db_session)

    notifs = (
        await db_session.execute(
            select(Notification).where(
                Notification.party_id.in_((proposer_party_id, owner_party_id)),
                Notification.kind == NotificationKind.TERM_CONFIRMATION_NEEDED,
            )
        )
    ).scalars().all()
    assert len(notifs) == 2
    assert {n.party_id for n in notifs} == {proposer_party_id, owner_party_id}
