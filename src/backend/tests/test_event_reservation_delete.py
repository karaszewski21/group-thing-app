"""`DELETE /api/events/{id}` with open reservations: before the start it
cancels every gift and swap atomically and notifies both sides
(`RESERVATION_CANCELLED`); from the start on it is refused while anything
is open. The author's page carries the counts for the delete dialog."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import BalanceStatus, InventoryBalance, Reservation
from app.events.infrastructure import groups_acl
from app.events.models import Event
from app.groups.application import term_item_listings
from app.groups.application.reservation_context import load_for_reservation
from app.groups.infrastructure import repository as groups_repository
from app.groups.models import SwapProposal, SwapProposalStatus
from tests.test_event_item_reservations import (
    _attendees,
    _create_event,
    _listed_items,
    _notifications,
    _sign_up,
    _take,
)
from tests.test_term_item_listings import _auth, _register

OPEN_STATUSES = {"PENDING", "CONFIRMED"}
STARTED_MESSAGE = (
    "Wydarzenie już się rozpoczęło i ma otwarte rezerwacje — potwierdźcie lub anulujcie przekazania"
)


@dataclass(frozen=True)
class _Scenario:
    event_id: uuid.UUID
    starts_at: datetime
    author: str
    owner: str
    taker: str
    proposer: str
    item_ids: list[uuid.UUID]


async def _propose(
    client: AsyncClient, event_id: uuid.UUID, listed: uuid.UUID, offered: uuid.UUID, token: str
) -> dict[str, Any]:
    response = await client.post(
        f"/api/events/{event_id}/items/{listed}/propose",
        json={"offered_item_id": str(offered)},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def _scenario(client: AsyncClient, prefix: str, *, withdraw: bool = True) -> _Scenario:
    """An event with one GIFT reservation, one ACCEPTED swap (two legs) and
    one PROPOSED swap; every attendee withdrawn unless asked otherwise."""
    author, _ = await _register(client, "GUEST", f"{prefix}.author@example.com")
    event_id, starts_at = await _create_event(client, author)
    tokens = []
    for name in ("owner", "taker", "proposer"):
        token, _ = await _register(client, "GUEST", f"{prefix}.{name}@example.com")
        await _sign_up(client, event_id, token)
        tokens.append(token)
    owner, taker, proposer = tokens
    gift, listed_a, listed_c = await _listed_items(
        client,
        owner,
        (f"Rower {prefix}", "GIFT"),
        (f"Gra {prefix}", "SWAP"),
        (f"Lalka {prefix}", "SWAP"),
    )
    offered_b, offered_d = await _listed_items(
        client, proposer, (f"Puzzle {prefix}", "SWAP"), (f"Klocki {prefix}", "SWAP")
    )
    status, body = await _take(client, event_id, gift, taker)
    assert status == 200, body
    accepted = await _propose(client, event_id, listed_a, offered_b, proposer)
    accept = await client.post(f"/api/swap-proposals/{accepted['id']}/accept", headers=_auth(owner))
    assert accept.status_code == 200, accept.text
    await _propose(client, event_id, listed_c, offered_d, proposer)
    if withdraw:
        for token in tokens:
            response = await client.post(
                f"/api/events/{event_id}/attendances/withdraw", headers=_auth(token)
            )
            assert response.status_code == 204, response.text
    return _Scenario(
        event_id,
        starts_at,
        author,
        owner,
        taker,
        proposer,
        [gift, listed_a, offered_b, listed_c, offered_d],
    )


async def _reservations(db: AsyncSession, item_ids: list[uuid.UUID]) -> list[Reservation]:
    rows = await db.scalars(
        select(Reservation)
        .where(Reservation.item_id.in_(item_ids))
        .execution_options(populate_existing=True)
    )
    return list(rows.all())


async def _proposal_statuses(db: AsyncSession, item_ids: list[uuid.UUID]) -> list[str]:
    rows = await db.scalars(
        select(SwapProposal.status)
        .where(SwapProposal.listing_item_id.in_(item_ids))
        .execution_options(populate_existing=True)
    )
    return sorted(status.value for status in rows)


async def _balances(db: AsyncSession, item_ids: list[uuid.UUID]) -> set[BalanceStatus]:
    rows = await db.scalars(
        select(InventoryBalance.status)
        .where(InventoryBalance.item_id.in_(item_ids))
        .execution_options(populate_existing=True)
    )
    return set(rows.all())


async def test_deleteEvent_beforeStartWithOpenExchanges_cancelsReleasesRejectsAndDetaches(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    s = await _scenario(client, "erd1")
    before = await _reservations(db_session, s.item_ids)
    assert len(before) == 4
    assert {r.status.value for r in before} <= OPEN_STATUSES
    page = await client.get(f"/api/events/{s.event_id}", headers=_auth(s.author))
    assert page.json()["open_reservations"] == {"total": 3, "swaps": 2}

    response = await client.delete(f"/api/events/{s.event_id}", headers=_auth(s.author))

    assert response.status_code == 204, response.text
    db_session.expire_all()
    assert await db_session.get(Event, s.event_id) is None
    after = await _reservations(db_session, s.item_ids)
    assert len(after) == 4
    assert {(r.status.value, r.event_id, r.term_id) for r in after} == {("CANCELLED", None, None)}
    assert await _balances(db_session, s.item_ids) == {BalanceStatus.AVAILABLE}
    assert await _proposal_statuses(db_session, s.item_ids) == ["REJECTED", "REJECTED"]


async def test_deleteEvent_beforeStart_notifiesBothPartiesOfEachGiftAndSwap(
    client: AsyncClient,
) -> None:
    s = await _scenario(client, "erd2")
    gift, listed_a, _, listed_c, _ = s.item_ids

    response = await client.delete(f"/api/events/{s.event_id}", headers=_auth(s.author))

    assert response.status_code == 204, response.text
    owner = await _notifications(client, s.owner, "RESERVATION_CANCELLED")
    taker = await _notifications(client, s.taker, "RESERVATION_CANCELLED")
    proposer = await _notifications(client, s.proposer, "RESERVATION_CANCELLED")
    author = await _notifications(client, s.author, "RESERVATION_CANCELLED")
    assert sorted(str(n["link_path"]) for n in owner) == sorted(
        f"/product/{item}" for item in (gift, listed_a, listed_c)
    )
    assert [n["link_path"] for n in taker] == [f"/product/{gift}"]
    assert sorted(str(n["link_path"]) for n in proposer) == sorted(
        f"/product/{item}" for item in (listed_a, listed_c)
    )
    assert author == []
    assert "Rezerwacja „Rower erd2” została anulowana" in str(taker[0]["message"])
    assert all("Piknik wymiany" in str(n["message"]) for n in owner + taker + proposer)
    assert any("Zamiana „Gra erd2” za „Puzzle erd2”" in str(n["message"]) for n in proposer)


async def test_deleteEvent_atOrAfterStartWithOpenReservations_returns409KeepsEverything(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    s = await _scenario(client, "erd3")

    freeze_local_now(s.starts_at)
    response = await client.delete(f"/api/events/{s.event_id}", headers=_auth(s.author))

    assert response.status_code == 409, response.text
    assert response.json()["message"] == STARTED_MESSAGE
    db_session.expire_all()
    assert await db_session.get(Event, s.event_id) is not None
    assert {r.status.value for r in await _reservations(db_session, s.item_ids)} <= OPEN_STATUSES


async def test_deleteEvent_withActiveAttendees_returns409EventHasAttendees(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    s = await _scenario(client, "erd4", withdraw=False)

    response = await client.delete(f"/api/events/{s.event_id}", headers=_auth(s.author))

    assert response.status_code == 409, response.text
    assert response.json()["message"] == "Nie można usunąć wydarzenia, na które ktoś się zapisał."
    assert {r.status.value for r in await _reservations(db_session, s.item_ids)} <= OPEN_STATUSES


async def test_deleteEvent_failureAfterCancellations_rollsBackEverything(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    s = await _scenario(client, "erd5")
    original = groups_acl.cancel_open_event_reservations

    async def cancel_then_fail(*args: Any, **kwargs: Any) -> Any:
        await original(*args, **kwargs)
        raise RuntimeError("injected failure after cancellations")

    monkeypatch.setattr(groups_acl, "cancel_open_event_reservations", cancel_then_fail)

    with pytest.raises(RuntimeError, match="injected failure"):
        await client.delete(f"/api/events/{s.event_id}", headers=_auth(s.author))
    await db_session.rollback()

    assert await db_session.get(Event, s.event_id) is not None
    reservations = await _reservations(db_session, s.item_ids)
    assert len(reservations) == 4
    assert {r.status.value for r in reservations} <= OPEN_STATUSES
    assert {r.event_id for r in reservations} == {s.event_id}
    assert await _proposal_statuses(db_session, s.item_ids) == ["ACCEPTED", "PROPOSED"]
    assert await _notifications(client, s.taker, "RESERVATION_CANCELLED") == []


async def test_getEvent_openReservations_authorOnlyNullForOthers(client: AsyncClient) -> None:
    s = await _scenario(client, "erd6")

    as_author = await client.get(f"/api/events/{s.event_id}", headers=_auth(s.author))
    as_owner = await client.get(f"/api/events/{s.event_id}", headers=_auth(s.owner))
    anonymous = await client.get(f"/api/events/{s.event_id}")

    assert as_author.json()["open_reservations"] == {"total": 3, "swaps": 2}
    assert as_owner.json()["open_reservations"] is None
    assert anonymous.json()["open_reservations"] is None


async def _proposed_swap(client: AsyncClient, prefix: str) -> tuple[uuid.UUID, str, uuid.UUID]:
    """`(proposal id, owner token, listed item)` of one PROPOSED event swap."""
    event_id, _, (owner, proposer) = await _attendees(client, prefix, "owner", "proposer")
    (listed,) = await _listed_items(client, owner, (f"Gitara {prefix}", "SWAP"))
    (offered,) = await _listed_items(client, proposer, (f"Ukulele {prefix}", "SWAP"))
    proposal = await _propose(client, event_id, listed, offered, proposer)
    return uuid.UUID(proposal["id"]), owner, listed


async def _reject_concurrently(db: AsyncSession, proposal_id: uuid.UUID) -> None:
    """What a `delete_event` committed in between does to the proposal; the
    session's loaded copy is left stale, as another transaction would."""
    await db.execute(
        update(SwapProposal)
        .where(SwapProposal.id == proposal_id)
        .values(status=SwapProposalStatus.REJECTED)
        .execution_options(synchronize_session=False)
    )


async def test_acceptSwapProposal_rejectedByDeleteAfterFirstRead_returns409WritesNothing(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    proposal_id, owner, listed = await _proposed_swap(client, "erd7")

    async def load_then_reject(db: AsyncSession, *args: Any, **kwargs: Any) -> Any:
        context = await load_for_reservation(db, *args, **kwargs)
        await _reject_concurrently(db, proposal_id)
        return context

    monkeypatch.setattr(term_item_listings, "load_for_reservation", load_then_reject)

    response = await client.post(f"/api/swap-proposals/{proposal_id}/accept", headers=_auth(owner))

    assert response.status_code == 409, response.text
    assert response.json()["message"] == "Ta propozycja została już rozstrzygnięta"
    await db_session.rollback()
    assert await _reservations(db_session, [listed]) == []


async def test_rejectSwapProposal_rejectedByDeleteAfterFirstRead_returns409(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    proposal_id, owner, _ = await _proposed_swap(client, "erd8")
    original = groups_repository.get_item_listing_preference

    async def read_then_reject(db: AsyncSession, *args: Any, **kwargs: Any) -> Any:
        preference = await original(db, *args, **kwargs)
        await _reject_concurrently(db, proposal_id)
        return preference

    monkeypatch.setattr(groups_repository, "get_item_listing_preference", read_then_reject)

    response = await client.post(f"/api/swap-proposals/{proposal_id}/reject", headers=_auth(owner))

    assert response.status_code == 409, response.text
    assert response.json()["message"] == "Ta propozycja została już rozstrzygnięta"


async def test_acceptEventSwapProposal_commitsOnce_soTheEventLockHoldsThroughout(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    proposal_id, owner, _ = await _proposed_swap(client, "erd9")
    commits = 0
    original = db_session.commit

    async def counting_commit() -> None:
        nonlocal commits
        commits += 1
        await original()

    monkeypatch.setattr(db_session, "commit", counting_commit)

    response = await client.post(f"/api/swap-proposals/{proposal_id}/accept", headers=_auth(owner))

    assert response.status_code == 200, response.text
    assert commits == 1
