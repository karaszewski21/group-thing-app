"""Guards for the domain clock: the groups package reads "now" only through
`app.core.clock`, and accepting a swap is gated on the Term not having
started yet (frozen via the opt-in `freeze_local_now` fixture)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import Reservation, ReservationType
from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import BusinessConflictException
from app.core.security import decode_token
from app.groups import service
from app.groups.models import SwapProposalStatus, Term
from tests.conftest import leaf_category_ids

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"
_GUARDED_DIRS = (_APP_ROOT / "groups" / "application", _APP_ROOT / "groups" / "router")
_FORBIDDEN = ("datetime.now(", "date.today(")


def test_groupsApplicationAndRouter_noHostClockCalls() -> None:
    offenders = [
        f"{path.relative_to(_APP_ROOT)}: {needle}"
        for directory in _GUARDED_DIRS
        for path in sorted(directory.rglob("*.py"))
        for needle in _FORBIDDEN
        if needle in path.read_text(encoding="utf-8")
    ]

    assert offenders == []


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _principal(token: str) -> Principal:
    claims = decode_token(token, settings.jwt_secret)
    return Principal(username=claims["sub"], authorities=frozenset())


async def _register(client: AsyncClient, role: str, email: str) -> str:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return str(r.json()["token"])


async def _register_swap_item(
    client: AsyncClient, db_session: AsyncSession, token: str, product_name: str
) -> uuid.UUID:
    category_id = (await leaf_category_ids(client, _auth(token)))[0]
    product = await client.post(
        "/api/products/resolve",
        json={"name": product_name, "category_id": category_id},
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
    item_id = uuid.UUID(item.json()["id"])
    await service.set_item_listing_preference(
        db_session, _principal(token), item_id, ReservationType.SWAP
    )
    return item_id


async def _proposed_swap(
    client: AsyncClient, db_session: AsyncSession, suffix: str
) -> tuple[str, uuid.UUID, datetime]:
    """A PROPOSED swap on a future Term; returns the lister's token, the
    proposal id and the Term's `occurs_on`."""
    org_token = await _register(client, "ORGANIZER", f"dcg.org{suffix}@example.com")
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg dcg{suffix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    group_id = circle.json()["id"]
    created = await client.post(
        "/api/terms",
        json={"circle_group_id": group_id, "occurs_on": "2099-06-10T16:30:00"},
        headers=_auth(org_token),
    )
    assert created.status_code == 201
    term_id = uuid.UUID(created.json()["id"])

    lister_token = await _register(client, "GUEST", f"dcg.lister{suffix}@example.com")
    proposer_token = await _register(client, "GUEST", f"dcg.proposer{suffix}@example.com")
    for token in (lister_token, proposer_token):
        r = await client.post(
            f"/api/groups/public/{group_id}/rsvp",
            json={"term_id": str(term_id), "guardian_name": "ignored", "child_count": 0},
            headers=_auth(token),
        )
        assert r.status_code == 201

    listed_item_id = await _register_swap_item(client, db_session, lister_token, f"Kask{suffix}")
    offered_item_id = await _register_swap_item(
        client, db_session, proposer_token, f"Rowerek{suffix}"
    )
    proposal = await service.propose_swap(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    term = (await db_session.execute(select(Term).where(Term.id == term_id))).scalar_one()
    return lister_token, proposal.id, term.occurs_on


async def _count_reservations(db_session: AsyncSession) -> int:
    return (await db_session.execute(select(func.count()).select_from(Reservation))).scalar_one()


async def test_acceptSwapProposal_frozenClockAfterTermStart_raisesWithoutReservationWrites(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    lister_token, proposal_id, occurs_on = await _proposed_swap(client, db_session, "1")
    reservations_before = await _count_reservations(db_session)
    freeze_local_now(occurs_on + timedelta(minutes=1))

    with pytest.raises(BusinessConflictException, match="Termin już się odbył"):
        await service.accept_swap_proposal(db_session, _principal(lister_token), proposal_id)

    assert await _count_reservations(db_session) == reservations_before
    paired = await db_session.execute(
        select(Reservation).where(Reservation.paired_reservation_id.is_not(None))
    )
    assert paired.scalars().all() == []


async def test_acceptSwapProposal_frozenClockBeforeTermStart_accepts(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
) -> None:
    lister_token, proposal_id, occurs_on = await _proposed_swap(client, db_session, "2")
    freeze_local_now(occurs_on - timedelta(minutes=1))

    accepted = await service.accept_swap_proposal(
        db_session, _principal(lister_token), proposal_id
    )

    assert accepted.status == SwapProposalStatus.ACCEPTED
