"""Keep-live paths for a soft-deleted Circle (spec Table B + audit L1):
reservations already locked in its Terms still resolve, the caller-scoped
listing reads that lead to them still answer, withdrawals still succeed and
the term-end scheduler still prompts. The Circle always has RSVPs here, so
`deleted_at` is set on the row instead of going through `DELETE`."""

from __future__ import annotations

import uuid
from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import ReservationType
from app.core import clock
from app.groups import service
from app.groups.application.term_end_scan import scan_for_term_ended
from app.groups.domain import swap_events
from app.groups.models import Term
from app.groups.schemas import TakeTermItemListingRequest
from tests.test_group_soft_delete_reads import _soft_delete_row
from tests.test_organizer_page import _needed_item
from tests.test_term_end_scan import _outbox_payloads, _push_term_into_past
from tests.test_term_item_listings import (
    _auth,
    _create_circle_and_term,
    _principal,
    _register,
    _register_personal_item,
    _rsvp,
)


async def _taken_gift(
    client: AsyncClient,
    db_session: AsyncSession,
    term_id: uuid.UUID,
    lister_token: str,
    taker_token: str,
    product_name: str,
) -> uuid.UUID:
    item_id = await _register_personal_item(client, lister_token, product_name)
    await service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )
    taken = await service.take_item_listing(
        db_session,
        _principal(taker_token),
        item_id,
        TakeTermItemListingRequest(term_id=term_id, reservation_type="GIFT"),
    )
    assert taken.resolved_reservation_id is not None
    return taken.resolved_reservation_id


async def _end_term(db_session: AsyncSession, term_id: uuid.UUID) -> None:
    term = await db_session.get(Term, term_id)
    assert term is not None
    term.occurs_on = clock.local_now() - timedelta(days=1)
    await db_session.commit()


async def test_confirmOrCancelTransaction_onDeletedGroupTerm_stillResolves(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdk.tx.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "sdk-tx")
    giver_token, _ = await _register(client, "GUEST", "sdk.tx.giver@example.com")
    lister_token, _ = await _register(client, "GUEST", "sdk.tx.lister@example.com")
    taker_token, _ = await _register(client, "GUEST", "sdk.tx.taker@example.com")
    for token in (giver_token, lister_token, taker_token):
        await _rsvp(client, token, group_id, term_id)
    to_confirm = await _taken_gift(
        client, db_session, term_id, giver_token, taker_token, "Sdk namiot"
    )
    to_cancel = await _taken_gift(
        client, db_session, term_id, lister_token, taker_token, "Sdk śpiwór"
    )
    await _end_term(db_session, term_id)

    await _soft_delete_row(db_session, group_id)

    confirmed = await client.post(
        f"/api/reservations/{to_confirm}/confirm-transaction", headers=_auth(taker_token)
    )
    cancelled = await client.post(
        f"/api/reservations/{to_cancel}/cancel-transaction", headers=_auth(lister_token)
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "FULFILLED"
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "CANCELLED"


async def test_mineAsTakerAndMineListings_onDeletedGroupTerm_stillAnswer(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdk.mine.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "sdk-mine")
    lister_token, _ = await _register(client, "GUEST", "sdk.mine.lister@example.com")
    taker_token, _ = await _register(client, "GUEST", "sdk.mine.taker@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    await _rsvp(client, taker_token, group_id, term_id)
    reservation_id = await _taken_gift(
        client, db_session, term_id, lister_token, taker_token, "Sdk hulajnoga"
    )

    await _soft_delete_row(db_session, group_id)

    as_taker = await client.get(
        f"/api/term-item-listings/mine-as-taker?term_id={term_id}", headers=_auth(taker_token)
    )
    mine = await client.get(
        f"/api/term-item-listings/mine?term_id={term_id}", headers=_auth(lister_token)
    )
    assert as_taker.status_code == 200, as_taker.text
    assert [row["resolved_reservation_id"] for row in as_taker.json()] == [str(reservation_id)]
    assert mine.status_code == 200, mine.text
    assert [row["resolved_reservation_id"] for row in mine.json()] == [str(reservation_id)]


async def test_withdrawAttendance_onDeletedGroup_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdk.wd.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "sdk-wd")
    need_id = await _needed_item(client, org_token, term_id, "Sdk trąbka")
    guest_token, _ = await _register(client, "GUEST", "sdk.wd.guest@example.com")
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    pledge = await client.post(
        "/api/pledges", json={"needed_item_id": str(need_id)}, headers=_auth(guest_token)
    )
    assert pledge.status_code == 201
    pledge_id = pledge.json()["id"]

    await _soft_delete_row(db_session, group_id)

    withdrawn = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(guest_token)
    )
    fetched = await client.get(f"/api/pledges/{pledge_id}", headers=_auth(guest_token))
    pledge_withdrawn = await client.post(
        f"/api/pledges/{pledge_id}/withdraw", headers=_auth(guest_token)
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["withdrawn_at"] is not None
    assert fetched.status_code == 200, fetched.text
    assert pledge_withdrawn.status_code == 200, pledge_withdrawn.text
    assert pledge_withdrawn.json()["status"] == "WITHDRAWN"


async def test_scanForTermEnded_deletedGroupTerm_stillProcessed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdk.scan.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "sdk-scan")
    lister_token, _ = await _register(client, "GUEST", "sdk.scan.lister@example.com")
    taker_token, _ = await _register(client, "GUEST", "sdk.scan.taker@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    await _rsvp(client, taker_token, group_id, term_id)
    await _taken_gift(client, db_session, term_id, lister_token, taker_token, "Sdk rowerek")
    await _push_term_into_past(db_session, term_id)  # type: ignore[arg-type]

    await _soft_delete_row(db_session, group_id)
    await scan_for_term_ended(db_session)

    payloads = await _outbox_payloads(db_session, swap_events.TERM_ENDED_GIVEAWAY)
    assert [payload["item_name"] for payload in payloads] == ["Sdk rowerek"]
    assert payloads[0]["group_name"] == "Krąg sdk-scan"


async def test_listSwapProposalsForMyItem_onDeletedGroup_stillAnswers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdk.swap.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "sdk-swap")
    owner_token, _ = await _register(client, "GUEST", "sdk.swap.owner@example.com")
    proposer_token, _ = await _register(client, "GUEST", "sdk.swap.proposer@example.com")
    await _rsvp(client, owner_token, group_id, term_id)
    await _rsvp(client, proposer_token, group_id, term_id)
    listed_item_id = await _register_personal_item(client, owner_token, "Sdk gra")
    offered_item_id = await _register_personal_item(client, proposer_token, "Sdk puzzle")
    for token, item_id in ((owner_token, listed_item_id), (proposer_token, offered_item_id)):
        await service.set_item_listing_preference(
            db_session, _principal(token), item_id, ReservationType.SWAP
        )
    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )

    await _soft_delete_row(db_session, group_id)

    offers = await client.get(
        f"/api/term-item-listings/{listed_item_id}/swap-proposals", headers=_auth(owner_token)
    )
    rejected = await client.post(
        f"/api/swap-proposals/{proposal.id}/reject", headers=_auth(owner_token)
    )
    assert offers.status_code == 200, offers.text
    assert [offer["id"] for offer in offers.json()] == [str(proposal.id)]
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "REJECTED"


async def test_getReservation_onDeletedGroupTerm_returnsTermOccursOn(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "sdk.res.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "sdk-res")
    lister_token, _ = await _register(client, "GUEST", "sdk.res.lister@example.com")
    taker_token, _ = await _register(client, "GUEST", "sdk.res.taker@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    await _rsvp(client, taker_token, group_id, term_id)
    reservation_id = await _taken_gift(
        client, db_session, term_id, lister_token, taker_token, "Sdk rowerek"
    )
    await _end_term(db_session, term_id)
    term = await db_session.get(Term, term_id)
    assert term is not None
    occurs_on = term.occurs_on

    await _soft_delete_row(db_session, group_id)

    response = await client.get(f"/api/reservations/{reservation_id}", headers=_auth(lister_token))
    assert response.status_code == 200, response.text
    assert response.json()["term_id"] == str(term_id)
    assert response.json()["term_occurs_on"] == occurs_on.isoformat()
    hidden_term = await client.get(f"/api/terms/{term_id}", headers=_auth(lister_token))
    assert hidden_term.status_code == 404
