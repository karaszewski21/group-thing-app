"""Exchange awards posted by `confirm_transaction` (R2): GIVE_FREE for a
gift, EXCHANGE for a swap, the „Szukam” WISHLIST_MATCH bonus, the pair limit,
the family rule and party eligibility. Every case goes through the HTTP
take/propose → confirm flow in a term context; the awards land in the same
commit as the transfer, and a transfer that earns nothing still succeeds."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import cast

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.families.models import FamilyMembership, FamilyRole, FamilyRoleType
from app.groups.models import Term
from app.inventory.models import InventoryItem, Reservation
from app.party.models import Party, PartyType
from app.points import service as points_service
from app.points.infrastructure.ledger import (
    PointLine,
    account_balance,
    account_reputation,
    emission_account_id,
    lock_accounts,
    post_points,
)
from app.points.models import PointAccount, PointTransaction, PointTransactionType
from app.wants.domain.status import WantStatus
from app.wants.models import Want, WantMatchTier
from tests.conftest import _want, create_location, seed_want_matches
from tests.point_ledger_assertions import (
    assert_point_transactions_balanced,
    point_row_counts,
    transactions_for_party,
)
from tests.test_term_item_listings import (
    _account_user_id,
    _auth,
    _create_circle_and_term,
    _register,
    _resolve_product,
    _rsvp,
)


@dataclass(frozen=True)
class _Person:
    token: str
    party_id: uuid.UUID
    inventory_id: str

    @property
    def headers(self) -> dict[str, str]:
        return _auth(self.token)


@dataclass(frozen=True)
class _Setup:
    giver: _Person
    taker: _Person
    term_id: uuid.UUID


async def _person(client: AsyncClient, email: str) -> _Person:
    token, party_id = await _register(client, "GUEST", email)
    inventory = await client.post(
        "/api/inventories", json={"inventory_type": "PERSONAL"}, headers=_auth(token)
    )
    assert inventory.status_code == 201, inventory.text
    return _Person(token, party_id, inventory.json()["id"])


async def _setup(client: AsyncClient, suffix: str) -> _Setup:
    """A giver and a taker, both RSVP'd to an upcoming term."""
    org_token, _ = await _register(client, "ORGANIZER", f"pa.org{suffix}@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, f"pa{suffix}")
    giver = await _person(client, f"pa.giver{suffix}@example.com")
    taker = await _person(client, f"pa.taker{suffix}@example.com")
    for person in (giver, taker):
        await _rsvp(client, person.token, group_id, term_id)
    return _Setup(giver, taker, term_id)


async def _listed_item(client: AsyncClient, owner: _Person, name: str, mode: str) -> uuid.UUID:
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": owner.inventory_id,
            "product_id": await _resolve_product(client, owner.token, name),
            "condition": "GOOD",
            "location_id": await create_location(client, owner.headers),
        },
        headers=owner.headers,
    )
    assert item.status_code == 201, item.text
    preference = await client.put(
        f"/api/item-listing-preferences/{item.json()['id']}",
        json={"mode": mode},
        headers=owner.headers,
    )
    assert preference.status_code == 200, preference.text
    return uuid.UUID(item.json()["id"])


async def _take(
    client: AsyncClient, db: AsyncSession, taker: _Person, item_id: uuid.UUID, term_id: uuid.UUID
) -> Reservation:
    response = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": {"kind": "TERM", "id": str(term_id)}, "reservation_type": "GIFT"},
        headers=taker.headers,
    )
    assert response.status_code == 200, response.text
    return (
        await db.execute(select(Reservation).where(Reservation.item_id == item_id))
    ).scalar_one()


async def _end_term(db: AsyncSession, term_id: uuid.UUID) -> None:
    await db.execute(
        update(Term)
        .where(Term.id == term_id)
        .values(occurs_on=clock.local_now() - timedelta(days=1))
    )
    await db.commit()


async def _confirm(client: AsyncClient, person: _Person, reservation_id: object) -> None:
    response = await client.post(
        f"/api/reservations/{reservation_id}/confirm-transaction", headers=person.headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "FULFILLED"


async def _points_value(db: AsyncSession, item_id: uuid.UUID) -> int:
    value = (
        await db.execute(select(InventoryItem.points_value).where(InventoryItem.id == item_id))
    ).scalar_one()
    assert value is not None
    return value


async def _account_id(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID:
    return (
        await db.execute(select(PointAccount.id).where(PointAccount.party_id == party_id))
    ).scalar_one()


async def _gift_confirmed(
    client: AsyncClient, db: AsyncSession, setup: _Setup, name: str
) -> tuple[uuid.UUID, Reservation]:
    item_id = await _listed_item(client, setup.giver, name, "GIFT")
    reservation = await _take(client, db, setup.taker, item_id, setup.term_id)
    await _end_term(db, setup.term_id)
    await _confirm(client, setup.taker, reservation.id)
    return item_id, reservation


def _lines(transaction: PointTransaction) -> list[tuple[uuid.UUID, int]]:
    return sorted((entry.account_id, entry.amount) for entry in transaction.entries)


async def test_confirmGift_eligibleParties_postsGiveFreeAndRaisesBalanceAndReputation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    setup = await _setup(client, "1")

    item_id, reservation = await _gift_confirmed(client, db_session, setup, "Rowerek biegowy")

    value = await _points_value(db_session, item_id)
    (gift,) = await transactions_for_party(db_session, setup.giver.party_id)
    giver_account = await _account_id(db_session, setup.giver.party_id)
    assert gift.transaction_type == PointTransactionType.GIVE_FREE
    assert (gift.source_id, gift.party_id, gift.counterparty_party_id) == (
        cast(uuid.UUID, reservation.id),
        setup.giver.party_id,
        setup.taker.party_id,
    )
    assert gift.description == "Rowerek biegowy"
    assert _lines(gift) == sorted(
        [(await emission_account_id(db_session), -value), (giver_account, value)]
    )
    assert await account_balance(db_session, giver_account) == value
    assert await account_reputation(db_session, giver_account) == value
    assert await transactions_for_party(db_session, setup.taker.party_id) == []
    await assert_point_transactions_balanced(db_session)


async def test_confirmSwap_eligibleParties_postsOneExchangeWithSwapAwardEach(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    setup = await _setup(client, "2")
    listed = await _listed_item(client, setup.giver, "Monopoly", "SWAP")
    offered = await _listed_item(client, setup.taker, "Scrabble", "SWAP")
    proposal = await client.post(
        f"/api/items/{listed}/propose",
        json={
            "context": {"kind": "TERM", "id": str(setup.term_id)},
            "offered_item_id": str(offered),
        },
        headers=setup.taker.headers,
    )
    assert proposal.status_code == 200, proposal.text
    accepted = await client.post(
        f"/api/swap-proposals/{proposal.json()['id']}/accept", headers=setup.giver.headers
    )
    assert accepted.status_code == 200, accepted.text
    await _end_term(db_session, setup.term_id)

    await _confirm(client, setup.taker, proposal.json()["proposer_reservation_id"])

    legs = sorted(
        (
            await db_session.execute(
                select(Reservation.id, Reservation.item_id).where(
                    Reservation.item_id.in_([listed, offered])
                )
            )
        )
        .tuples()
        .all()
    )
    names = {listed: "Monopoly", offered: "Scrabble"}
    (exchange,) = await transactions_for_party(db_session, setup.giver.party_id)
    swap_award = 10
    lower, higher = sorted([setup.giver.party_id, setup.taker.party_id])
    assert exchange.transaction_type == PointTransactionType.EXCHANGE
    assert (exchange.source_id, exchange.party_id, exchange.counterparty_party_id) == (
        legs[0][0],
        lower,
        higher,
    )
    assert exchange.description == " ↔ ".join(names[item_id] for _leg, item_id in legs)
    assert _lines(exchange) == sorted(
        [
            (await emission_account_id(db_session), -2 * swap_award),
            (await _account_id(db_session, setup.giver.party_id), swap_award),
            (await _account_id(db_session, setup.taker.party_id), swap_award),
        ]
    )
    assert await transactions_for_party(db_session, setup.taker.party_id) == [exchange]
    assert (
        await account_reputation(db_session, await _account_id(db_session, setup.giver.party_id))
        == 0
    )


async def test_confirmSwap_proposerWantsListedItem_postsWishlistBonusOnThatLegOnly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    setup = await _setup(client, "2w")
    listed = await _listed_item(client, setup.giver, "Monopoly", "SWAP")
    offered = await _listed_item(client, setup.taker, "Scrabble", "SWAP")
    want_id = await _want(db_session, setup.taker.party_id, "monopoly")
    await seed_want_matches(db_session, want_id, [listed])
    proposal = await client.post(
        f"/api/items/{listed}/propose",
        json={
            "context": {"kind": "TERM", "id": str(setup.term_id)},
            "offered_item_id": str(offered),
        },
        headers=setup.taker.headers,
    )
    assert proposal.status_code == 200, proposal.text
    accepted = await client.post(
        f"/api/swap-proposals/{proposal.json()['id']}/accept", headers=setup.giver.headers
    )
    assert accepted.status_code == 200, accepted.text
    await _end_term(db_session, setup.term_id)

    await _confirm(client, setup.taker, proposal.json()["proposer_reservation_id"])

    listed_leg = (
        await db_session.execute(select(Reservation.id).where(Reservation.item_id == listed))
    ).scalar_one()
    exchange, bonus = sorted(
        await transactions_for_party(db_session, setup.giver.party_id),
        key=lambda t: t.transaction_type,
    )
    assert (exchange.transaction_type, bonus.transaction_type) == (
        PointTransactionType.EXCHANGE,
        PointTransactionType.WISHLIST_MATCH,
    )
    assert (bonus.source_id, bonus.party_id, bonus.counterparty_party_id) == (
        listed_leg,
        setup.giver.party_id,
        setup.taker.party_id,
    )
    assert [
        t.transaction_type for t in await transactions_for_party(db_session, setup.taker.party_id)
    ] == [PointTransactionType.EXCHANGE]
    await assert_point_transactions_balanced(db_session)


async def _wanted_gift_types(
    client: AsyncClient,
    db: AsyncSession,
    suffix: str,
    *,
    tier: WantMatchTier = WantMatchTier.MATCH,
    status_after_take: WantStatus | None = None,
    closed_before_take: bool = False,
    created_after_take: bool = False,
) -> list[tuple[PointTransactionType, int]]:
    """Confirms a gift of an item the taker wants (a want with a `tier` row
    for the item, created before the take) and returns the giver's
    `(type, amount)` posted for the gift leg, by type (both share one
    `occurred_at`). `status_after_take`
    closes the want between the take and the confirm, at the moment or,
    with `closed_before_take`, a second before the reservation;
    `created_after_take` dates the want a second after the reservation."""
    setup = await _setup(client, suffix)
    item_id = await _listed_item(client, setup.giver, "Sanki drewniane", "GIFT")
    want_id = await _want(db, setup.taker.party_id, "sanki")
    await seed_want_matches(
        db,
        want_id,
        [item_id],
        tier=tier,
        missing_words=["drewniane"] if tier == WantMatchTier.SUGGESTION else None,
    )
    reservation = await _take(client, db, setup.taker, item_id, setup.term_id)
    if created_after_take:
        await db.execute(
            update(Want)
            .where(Want.id == want_id)
            .values(created_at=reservation.created_at + timedelta(seconds=1))
        )
    if status_after_take is not None:
        closed_at = (
            reservation.created_at - timedelta(seconds=1)
            if closed_before_take
            else datetime.utcnow()
        )
        await db.execute(
            update(Want)
            .where(Want.id == want_id)
            .values(status=status_after_take, closed_at=closed_at)
        )
    await _end_term(db, setup.term_id)

    await _confirm(client, setup.taker, reservation.id)

    giver_account = await _account_id(db, setup.giver.party_id)
    return sorted(
        (
            transaction.transaction_type,
            next(e.amount for e in transaction.entries if e.account_id == giver_account),
        )
        for transaction in await transactions_for_party(db, setup.giver.party_id)
        if transaction.source_id == reservation.id
    )


async def test_confirmGift_recipientActiveWantMatch_postsWishlistBonusToGiver(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    posted = await _wanted_gift_types(client, db_session, "3")

    assert [t for t, _amount in posted] == [
        PointTransactionType.GIVE_FREE,
        PointTransactionType.WISHLIST_MATCH,
    ]
    assert posted[1][1] == 10


async def test_confirmGift_wantFulfilledAfterTake_stillPostsWishlistBonus(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    posted = await _wanted_gift_types(
        client, db_session, "4", status_after_take=WantStatus.FULFILLED
    )

    assert [t for t, _amount in posted] == [
        PointTransactionType.GIVE_FREE,
        PointTransactionType.WISHLIST_MATCH,
    ]


@pytest.mark.parametrize(
    ("suffix", "tier", "status_after_take", "closed_before_take", "created_after_take"),
    [
        ("5a", WantMatchTier.MATCH, WantStatus.WITHDRAWN, False, False),
        ("5b", WantMatchTier.MATCH, WantStatus.FULFILLED, True, False),
        ("5c", WantMatchTier.SUGGESTION, None, False, False),
        ("5d", WantMatchTier.SIMILAR, None, False, False),
        ("5e", WantMatchTier.MATCH, None, False, True),
    ],
    ids=["withdrawn", "fulfilledBeforeTake", "suggestion", "similar", "createdAfterTake"],
)
async def test_confirmGift_wantNotQualifying_postsNoWishlistBonus(
    client: AsyncClient,
    db_session: AsyncSession,
    suffix: str,
    tier: WantMatchTier,
    status_after_take: WantStatus | None,
    closed_before_take: bool,
    created_after_take: bool,
) -> None:
    posted = await _wanted_gift_types(
        client,
        db_session,
        suffix,
        tier=tier,
        status_after_take=status_after_take,
        closed_before_take=closed_before_take,
        created_after_take=created_after_take,
    )

    assert [t for t, _amount in posted] == [PointTransactionType.GIVE_FREE]


async def _seed_pair_awards(
    db: AsyncSession, giver: uuid.UUID, taker: uuid.UUID, ages_days: list[int]
) -> list[uuid.UUID]:
    """GIVE_FREE awards between the pair, in alternating directions, posted
    `ages_days` ago; returns their transaction ids."""
    accounts = await lock_accounts(db, [giver, taker])
    emission = await emission_account_id(db)
    ids = []
    for index, age in enumerate(ages_days):
        beneficiary, counterparty = (giver, taker) if index % 2 == 0 else (taker, giver)
        transaction = await post_points(
            db,
            transaction_type=PointTransactionType.GIVE_FREE,
            source_id=uuid.uuid4(),
            party_id=beneficiary,
            counterparty_party_id=counterparty,
            cap_month=None,
            description="Wcześniejsze oddanie",
            occurred_at=datetime.utcnow() - timedelta(days=age),
            entries=[PointLine(emission, -20), PointLine(accounts[beneficiary], 20)],
        )
        ids.append(cast(uuid.UUID, transaction.id))
    await db.commit()
    return ids


async def test_confirmGift_pairLimitReached_postsNothingUntilOldestLeavesWindow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    setup = await _setup(client, "6")
    seeded = await _seed_pair_awards(
        db_session, setup.giver.party_id, setup.taker.party_id, [29, 2, 1]
    )
    first = await _listed_item(client, setup.giver, "Puzzle", "GIFT")
    second = await _listed_item(client, setup.giver, "Lalka", "GIFT")
    first_leg = await _take(client, db_session, setup.taker, first, setup.term_id)
    second_leg = await _take(client, db_session, setup.taker, second, setup.term_id)
    await _end_term(db_session, setup.term_id)

    await _confirm(client, setup.taker, first_leg.id)
    assert await point_row_counts(db_session) == (3, 6)

    await db_session.execute(
        update(PointTransaction)
        .where(PointTransaction.id == seeded[0])
        .values(occurred_at=datetime.utcnow() - timedelta(days=31))
    )
    await _confirm(client, setup.taker, second_leg.id)

    sources = [t.source_id for t in await transactions_for_party(db_session, setup.giver.party_id)]
    assert second_leg.id in sources
    assert first_leg.id not in sources


async def test_confirmGift_sameFamily_postsNothingAndTransfers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    setup = await _setup(client, "7")
    family = await client.post(
        "/api/families/mine", json={"name": "Rodzina"}, headers=setup.giver.headers
    )
    assert family.status_code == 201, family.text
    today = clock.local_now().date()
    role = FamilyRole(
        party_id=setup.taker.party_id, role_type=FamilyRoleType.GUARDIAN, valid_from=today
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(
        FamilyMembership(
            from_role_id=role.id, to_family_id=uuid.UUID(family.json()["id"]), valid_from=today
        )
    )
    await db_session.commit()

    await _gift_confirmed(client, db_session, setup, "Hulajnoga")

    assert await point_row_counts(db_session) == (0, 0)


@pytest.mark.parametrize("organization", ["giver", "taker"])
async def test_confirmGift_ineligibleParty_postsNothingAndTransfers(
    client: AsyncClient, db_session: AsyncSession, organization: str
) -> None:
    setup = await _setup(client, f"8{organization}")
    party_id = setup.giver.party_id if organization == "giver" else setup.taker.party_id
    await db_session.execute(
        update(Party).where(Party.id == party_id).values(party_type=PartyType.ORGANIZATION)
    )
    await db_session.commit()

    item_id, _reservation = await _gift_confirmed(client, db_session, setup, "Kask")

    assert await point_row_counts(db_session) == (0, 0)
    holder = (
        await db_session.execute(
            select(InventoryItem.inventory_id)
            .where(InventoryItem.id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert str(holder) != setup.giver.inventory_id

    # The same eligible person on both sides of a leg earns nothing either.
    eligible = setup.taker if organization == "giver" else setup.giver
    user_id = await _account_user_id(client, eligible.token)
    await points_service.award_exchange(
        db_session,
        [
            points_service.ExchangeLeg(
                reservation_id=uuid.uuid4(),
                created_at=datetime.utcnow(),
                reservation_type="GIFT",
                item_id=item_id,
                giver_user_id=user_id,
                recipient_user_id=user_id,
            )
        ],
    )
    assert await point_row_counts(db_session) == (0, 0)
