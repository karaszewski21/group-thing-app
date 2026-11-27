"""POINTS purchases over HTTP (R5–R7): a take posts HOLD, the buyer's
confirm settles it as SALE, a cancel by either party or the event's
deletion gives it back as RELEASE. An `mcp:edit`-only token may neither take
nor confirm for points, and SALE and RELEASE never both happen."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable, Collection
from datetime import date, datetime, timedelta
from typing import Any, cast

import jwt
import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.auth_deps import Principal
from app.events.infrastructure import groups_acl as events_groups_acl
from app.events.models import Event
from app.groups.application import term_end_scan, term_item_listings
from app.groups.domain import swap_events
from app.groups.infrastructure import inventory_bridge
from app.groups.infrastructure import points_acl as groups_points_acl
from app.groups.models import ItemListingPreference
from app.inventory.infrastructure import points_acl as inventory_points_acl
from app.inventory.models import (
    InventoryItem,
    ItemCondition,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.moderation.status import ModerationStatus
from app.notifications.models import Notification
from app.outbox.models import OutboxEntry
from app.points.infrastructure.ledger import (
    PointLine,
    account_balance,
    account_reputation,
    lock_accounts,
    post_points,
    system_account_id,
)
from app.points.models import PointAccountType, PointTransaction, PointTransactionType
from app.product.models import ProductPhoto
from tests import test_points_awards_contexts
from tests.conftest import count_queries, create_location, deadlock
from tests.point_ledger_assertions import (
    assert_point_transactions_balanced,
    point_row_counts,
    transactions_for_party,
)
from tests.test_authorization_matrix import _oauth_token
from tests.test_event_item_reservations import _create_event, _sign_up
from tests.test_points_awards import _end_term, _Person, _person
from tests.test_points_awards_contexts import _purge
from tests.test_term_item_listings import (
    _account_user_id,
    _auth,
    _create_circle_and_term,
    _register,
    _resolve_product,
    _rsvp,
)

PARTY = PointAccountType.PARTY
HELD = PointAccountType.HELD
PERSONAL: dict[str, str] = {"kind": "PERSONAL"}

committed_client = test_points_awards_contexts.committed_client

CHANGED_PRICE = "Cena zmieniła się — odśwież."
SHORT_BALANCE = "Za mało punktów — ktoś był szybszy albo masz inne blokady."


async def _grant(db: AsyncSession, party_id: uuid.UUID, amount: int) -> None:
    accounts = await lock_accounts(db, [(party_id, PARTY)])
    await post_points(
        db,
        transaction_type=PointTransactionType.ATTENDANCE,
        source_id=uuid.uuid4(),
        party_id=party_id,
        counterparty_party_id=None,
        cap_month=date(2026, 11, 1),
        description="Krąg",
        occurred_at=datetime.utcnow(),
        entries=[
            PointLine(await system_account_id(db, PointAccountType.EMISSION), -amount),
            PointLine(accounts[(party_id, PARTY)], amount),
        ],
    )
    await db.commit()


async def _balance(db: AsyncSession, party_id: uuid.UUID, account_type: PointAccountType) -> int:
    accounts = await lock_accounts(db, [(party_id, account_type)])
    return await account_balance(db, accounts[(party_id, account_type)])


async def _points_item(
    client: AsyncClient, db: AsyncSession, seller: _Person, name: str
) -> tuple[uuid.UUID, int]:
    """A POINTS listing of `seller` with an approved own photo; returns the
    item id and its stored price (the clamped suggestion)."""
    product_id = await _resolve_product(client, seller.token, name)
    key = uuid.uuid4().hex
    db.add(
        ProductPhoto(
            product_id=uuid.UUID(product_id),
            storage_key=f"products/{product_id}/{key}",
            width=10,
            height=10,
            size_bytes=100,
            content_sha256=key + key,
            status=ModerationStatus.APPROVED,
            uploaded_by_user_id=await _account_user_id(client, seller.token),
            sort_order=0,
        )
    )
    await db.commit()
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": seller.inventory_id,
            "product_id": product_id,
            "condition": "GOOD",
            "location_id": await create_location(client, seller.headers),
        },
        headers=seller.headers,
    )
    assert item.status_code == 201, item.text
    preference = await client.put(
        f"/api/item-listing-preferences/{item.json()['id']}",
        json={"mode": "POINTS"},
        headers=seller.headers,
    )
    assert preference.status_code == 200, preference.text
    return uuid.UUID(item.json()["id"]), int(preference.json()["points_price"])


async def _take(
    client: AsyncClient,
    headers: dict[str, str],
    item_id: uuid.UUID,
    price: int | None,
    context: dict[str, str] = PERSONAL,
    reservation_type: str = "POINTS",
) -> Response:
    body: dict[str, Any] = {"context": context, "reservation_type": reservation_type}
    if price is not None:
        body["points_price"] = price
    return await client.post(f"/api/items/{item_id}/take", json=body, headers=headers)


async def _reservation(db: AsyncSession, item_id: uuid.UUID) -> Reservation | None:
    return (
        await db.execute(
            select(Reservation)
            .where(Reservation.item_id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _of_type(
    db: AsyncSession, transaction_type: PointTransactionType, source_id: object
) -> list[PointTransaction]:
    return list(
        (
            await db.scalars(
                select(PointTransaction).where(
                    PointTransaction.transaction_type == transaction_type,
                    PointTransaction.source_id == source_id,
                )
            )
        ).all()
    )


def _mcp_headers(token: str) -> dict[str, str]:
    username = jwt.decode(token, options={"verify_signature": False})["sub"]
    return {"Authorization": f"Bearer {_oauth_token(username, ['mcp:read', 'mcp:edit'])}"}


async def _pair(client: AsyncClient, prefix: str) -> tuple[_Person, _Person]:
    """`(seller, buyer)`."""
    seller = await _person(client, f"ppf.{prefix}.seller@example.com")
    buyer = await _person(client, f"ppf.{prefix}.buyer@example.com")
    return seller, buyer


async def test_takePoints_holdsPrice_availableDownHeldUp(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    seller, buyer = await _pair(client, "hold")
    await _grant(db_session, buyer.party_id, 100)
    item_id, price = await _points_item(client, db_session, seller, "Rowerek ppf.hold")

    response = await _take(client, buyer.headers, item_id, price)

    assert response.status_code == 200, response.text
    reservation = await _reservation(db_session, item_id)
    assert reservation is not None
    assert reservation.reservation_type == ReservationType.POINTS
    assert await _balance(db_session, buyer.party_id, PARTY) == 100 - price
    assert await _balance(db_session, buyer.party_id, HELD) == price
    (hold,) = await _of_type(db_session, PointTransactionType.HOLD, reservation.id)
    assert (hold.party_id, hold.counterparty_party_id, hold.description) == (
        buyer.party_id,
        seller.party_id,
        "Rowerek ppf.hold",
    )
    await assert_point_transactions_balanced(db_session)
    messages = (
        await db_session.scalars(
            select(Notification.message).where(
                Notification.party_id.in_([seller.party_id, buyer.party_id])
            )
        )
    ).all()
    assert len(messages) == 2
    assert all(f"„Rowerek ppf.hold” za {price} pkt" in message for message in messages)


@pytest.mark.parametrize("case", ["mismatch", "short", "missing"])
async def test_takePoints_priceMismatchOrShortBalance_returns409NoReservation(
    client: AsyncClient, db_session: AsyncSession, case: str
) -> None:
    seller, buyer = await _pair(client, f"refuse.{case}")
    await _grant(db_session, buyer.party_id, 10 if case == "short" else 100)
    item_id, price = await _points_item(client, db_session, seller, f"Lampa ppf.{case}")
    offered = {"mismatch": price + 10, "short": price, "missing": None}[case]

    response = await _take(client, buyer.headers, item_id, offered)

    if case == "missing":
        assert response.status_code == 400, response.text
        assert "Podaj cenę w punktach." in response.text
    else:
        assert response.status_code == 409, response.text
        assert response.json()["message"] == (
            CHANGED_PRICE if case == "mismatch" else SHORT_BALANCE
        )
    assert await _reservation(db_session, item_id) is None
    holds = await transactions_for_party(db_session, buyer.party_id)
    assert [t.transaction_type for t in holds] == [PointTransactionType.ATTENDANCE]


async def test_takePoints_mcpEditToken_returns403NoHold(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    seller, buyer = await _pair(client, "mcp")
    await _grant(db_session, buyer.party_id, 100)
    item_id, price = await _points_item(client, db_session, seller, "Lampka ppf.mcp")
    mcp = _mcp_headers(buyer.token)

    response = await _take(client, mcp, item_id, price)

    assert response.status_code == 403, response.text
    assert await _reservation(db_session, item_id) is None
    gift_id = await _gift_item(client, seller, "Kubek ppf.mcp")
    gift = await _take(client, mcp, gift_id, None, reservation_type="GIFT")
    assert gift.status_code == 200, gift.text


async def _gift_item(client: AsyncClient, seller: _Person, name: str) -> uuid.UUID:
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": seller.inventory_id,
            "product_id": await _resolve_product(client, seller.token, name),
            "condition": "GOOD",
            "location_id": await create_location(client, seller.headers),
        },
        headers=seller.headers,
    )
    assert item.status_code == 201, item.text
    preference = await client.put(
        f"/api/item-listing-preferences/{item.json()['id']}",
        json={"mode": "GIFT"},
        headers=seller.headers,
    )
    assert preference.status_code == 200, preference.text
    return uuid.UUID(item.json()["id"])


async def _context(
    client: AsyncClient,
    kind: str,
    seller: _Person,
    buyer: _Person,
    freeze_local_now: Callable[[datetime], None],
) -> tuple[dict[str, str], Callable[[AsyncSession], Any]]:
    """The take context of `kind`, and how to let its date come."""
    if kind == "TERM":
        org, _ = await _register(client, "ORGANIZER", "ppf.ctx.org@example.com")
        group_id, term_id = await _create_circle_and_term(client, org, "ppf.ctx")
        for person in (seller, buyer):
            await _rsvp(client, person.token, group_id, term_id)
        return {"kind": "TERM", "id": str(term_id)}, lambda db: _end_term(db, term_id)
    if kind == "EVENT":
        author, _ = await _register(client, "GUEST", "ppf.ctx.author@example.com")
        event_id, starts_at = await _create_event(client, author)
        for person in (seller, buyer):
            await _sign_up(client, event_id, person.token)

        async def _start(db: AsyncSession) -> None:
            freeze_local_now(starts_at)

        return {"kind": "EVENT", "id": str(event_id)}, _start

    async def _now(db: AsyncSession) -> None:
        return None

    return PERSONAL, _now


@pytest.mark.parametrize("kind", ["TERM", "EVENT", "PERSONAL"])
async def test_confirmPoints_sellerForbiddenBuyerSettles(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
    kind: str,
) -> None:
    seller, buyer = await _pair(client, f"confirm.{kind.lower()}")
    await _grant(db_session, buyer.party_id, 100)
    name = f"Hulajnoga ppf.{kind.lower()}"
    item_id, price = await _points_item(client, db_session, seller, name)
    context, come = await _context(client, kind, seller, buyer, freeze_local_now)
    taken = await _take(client, buyer.headers, item_id, price, context)
    assert taken.status_code == 200, taken.text
    await db_session.execute(
        update(ItemListingPreference)
        .where(ItemListingPreference.item_id == item_id)
        .values(points_price=price + 10)
    )
    await db_session.commit()
    await come(db_session)
    reservation = await _reservation(db_session, item_id)
    assert reservation is not None
    url = f"/api/reservations/{reservation.id}/confirm-transaction"

    by_seller = await client.post(url, headers=seller.headers)
    flags = await term_item_listings.transaction_action_flags(
        db_session,
        reservation,
        await _account_user_id(client, seller.token),
        Principal(username="seller", authorities=frozenset({"PERMISSION_EDIT"})),
    )
    by_mcp = await client.post(url, headers=_mcp_headers(buyer.token))
    actions_url = f"/api/public/items/{item_id}/actions"
    mcp_actions = await client.get(actions_url, headers=_mcp_headers(buyer.token))
    login_actions = await client.get(actions_url, headers=buyer.headers)
    assert await _of_type(db_session, PointTransactionType.SALE, reservation.id) == []
    by_buyer = await client.post(url, headers=buyer.headers)

    assert by_seller.status_code == 403, by_seller.text
    assert flags == (False, True)
    assert by_mcp.status_code == 403, by_mcp.text
    assert mcp_actions.status_code == 200, mcp_actions.text
    assert mcp_actions.json()["party_reservation"]["can_confirm"] is False
    assert login_actions.json()["party_reservation"]["can_confirm"] is True
    assert by_buyer.status_code == 200, by_buyer.text
    assert by_buyer.json()["status"] == "FULFILLED"
    (sale,) = await _of_type(db_session, PointTransactionType.SALE, reservation.id)
    assert (sale.party_id, sale.counterparty_party_id) == (seller.party_id, buyer.party_id)
    assert await _balance(db_session, seller.party_id, PARTY) == price
    assert await _balance(db_session, buyer.party_id, HELD) == 0
    assert await _balance(db_session, buyer.party_id, PARTY) == 100 - price
    seller_account = (await lock_accounts(db_session, [(seller.party_id, PARTY)]))[
        (seller.party_id, PARTY)
    ]
    assert await account_reputation(db_session, seller_account) == 0
    assert {
        t.transaction_type for t in await transactions_for_party(db_session, seller.party_id)
    } == {PointTransactionType.SALE}
    item = (
        await db_session.execute(
            select(InventoryItem)
            .where(InventoryItem.id == item_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert str(item.inventory_id) != seller.inventory_id
    await assert_point_transactions_balanced(db_session)


@pytest.mark.parametrize("actor", ["seller", "buyer"])
async def test_cancelPoints_sellerOrBuyer_releases(
    client: AsyncClient, db_session: AsyncSession, actor: str
) -> None:
    seller, buyer = await _pair(client, f"cancel.{actor}")
    await _grant(db_session, buyer.party_id, 100)
    item_id, price = await _points_item(client, db_session, seller, f"Sanki ppf.{actor}")
    taken = await _take(client, buyer.headers, item_id, price)
    assert taken.status_code == 200, taken.text
    reservation = await _reservation(db_session, item_id)
    assert reservation is not None
    headers = seller.headers if actor == "seller" else buyer.headers

    cancelled = await client.post(
        f"/api/reservations/{reservation.id}/cancel-transaction", headers=headers
    )

    assert cancelled.status_code == 200, cancelled.text
    (release,) = await _of_type(db_session, PointTransactionType.RELEASE, reservation.id)
    assert (release.party_id, release.counterparty_party_id) == (buyer.party_id, seller.party_id)
    assert await _balance(db_session, buyer.party_id, PARTY) == 100
    assert await _balance(db_session, buyer.party_id, HELD) == 0
    confirm = await client.post(
        f"/api/reservations/{reservation.id}/confirm-transaction", headers=buyer.headers
    )
    assert confirm.status_code == 409, confirm.text
    assert await _of_type(db_session, PointTransactionType.SALE, reservation.id) == []
    await assert_point_transactions_balanced(db_session)


def _first_lock(statements: list[str], table_name: str) -> int:
    return next(
        i
        for i, statement in enumerate(statements)
        if f"FROM {table_name}" in statement and "FOR UPDATE" in statement
    )


@pytest.mark.parametrize("action", ["cancel", "confirm"])
async def test_settlePoints_locksReservationBeforeAccounts(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine, action: str
) -> None:
    """The `delete_event` order (reservation, then accounts), so a cancel or
    confirm racing an event deletion waits instead of deadlocking."""
    seller, buyer = await _pair(client, f"lockorder.{action}")
    await _grant(db_session, buyer.party_id, 100)
    item_id, price = await _points_item(client, db_session, seller, f"Narty ppf.{action}")
    taken = await _take(client, buyer.headers, item_id, price)
    assert taken.status_code == 200, taken.text
    reservation = await _reservation(db_session, item_id)
    assert reservation is not None

    with count_queries(engine) as statements:
        settled = await client.post(
            f"/api/reservations/{reservation.id}/{action}-transaction", headers=buyer.headers
        )

    assert settled.status_code == 200, settled.text
    assert _first_lock(statements, "reservations") < _first_lock(statements, "point_accounts")


async def test_deleteEvent_twoBuyers_releasesBoth(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    author, _ = await _register(client, "GUEST", "ppf.delete.author@example.com")
    event_id, _ = await _create_event(client, author)
    seller = await _person(client, "ppf.delete.seller@example.com")
    buyers = [await _person(client, f"ppf.delete.buyer{n}@example.com") for n in (1, 2)]
    context = {"kind": "EVENT", "id": str(event_id)}
    reservation_ids = []
    for n, buyer in enumerate(buyers):
        await _grant(db_session, buyer.party_id, 100)
        item_id, price = await _points_item(client, db_session, seller, f"Gra ppf.delete{n}")
        for person in (seller, buyer) if n == 0 else (buyer,):
            await _sign_up(client, event_id, person.token)
        taken = await _take(client, buyer.headers, item_id, price, context)
        assert taken.status_code == 200, taken.text
        reservation = await _reservation(db_session, item_id)
        assert reservation is not None
        reservation_ids.append(reservation.id)
    for person in (seller, *buyers):
        withdrawn = await client.post(
            f"/api/events/{event_id}/attendances/withdraw", headers=person.headers
        )
        assert withdrawn.status_code == 204, withdrawn.text
    locked: list[set[uuid.UUID]] = []
    lock_release_accounts = inventory_points_acl.lock_release_accounts

    async def spy(db: AsyncSession, ids: Collection[uuid.UUID]) -> None:
        locked.append(set(ids))
        await lock_release_accounts(db, ids)

    monkeypatch.setattr(inventory_points_acl, "lock_release_accounts", spy)

    deleted = await client.delete(f"/api/events/{event_id}", headers=_auth(author))

    assert deleted.status_code == 204, deleted.text
    assert locked == [set(reservation_ids)]
    for buyer, reservation_id in zip(buyers, reservation_ids, strict=True):
        assert len(await _of_type(db_session, PointTransactionType.RELEASE, reservation_id)) == 1
        assert await _balance(db_session, buyer.party_id, PARTY) == 100
        assert await _balance(db_session, buyer.party_id, HELD) == 0
    statuses = (
        await db_session.scalars(
            select(Reservation.status)
            .where(Reservation.id.in_(reservation_ids))
            .execution_options(populate_existing=True)
        )
    ).all()
    assert set(statuses) == {ReservationStatus.CANCELLED}
    await assert_point_transactions_balanced(db_session)


async def _committed_purge(engine: AsyncEngine, parties: list[uuid.UUID]) -> None:
    """`_purge` plus what a POINTS listing adds: its preference and photo."""
    async with engine.begin() as conn:
        users = list(
            (
                await conn.execute(
                    text("SELECT account_user_id FROM user_profiles WHERE party_id = ANY(:p)"),
                    {"p": parties},
                )
            ).scalars()
        )
        items = (
            "SELECT i.id FROM inventory_items i JOIN inventories v "
            "ON v.id = i.owner_inventory_id WHERE v.owner_user_id = ANY(:u)"
        )
        await conn.execute(
            text(f"DELETE FROM item_listing_preferences WHERE item_id IN ({items})"), {"u": users}
        )
        await conn.execute(
            text(
                "DELETE FROM product_photos WHERE product_id IN "
                f"(SELECT product_id FROM inventory_items WHERE id IN ({items}))"
            ),
            {"u": users},
        )
    await _purge(engine, parties)


async def _committed_setup(
    client: AsyncClient, engine: AsyncEngine, suffix: str, parties: list[uuid.UUID], items: int
) -> tuple[_Person, _Person, list[tuple[uuid.UUID, int]]]:
    seller = await _person(client, f"ppf.race.seller.{suffix}@example.com")
    parties.append(seller.party_id)
    buyer = await _person(client, f"ppf.race.buyer.{suffix}@example.com")
    parties.append(buyer.party_id)
    listed = []
    async with AsyncSession(engine, expire_on_commit=False) as db:
        for n in range(items):
            listed.append(await _points_item(client, db, seller, f"Narty ppf.{suffix}.{n}"))
        await _grant(db, buyer.party_id, listed[0][1])
    return seller, buyer, listed


async def test_takePoints_parallelTakesOneBalance_oneCreatedOne409(
    committed_client: AsyncClient, engine: AsyncEngine
) -> None:
    client = committed_client
    parties: list[uuid.UUID] = []
    try:
        _, buyer, listed = await _committed_setup(
            client, engine, uuid.uuid4().hex[:10], parties, items=2
        )
        assert listed[0][1] == listed[1][1]

        responses = await asyncio.gather(
            *(_take(client, buyer.headers, item_id, price) for item_id, price in listed)
        )

        assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
        refused = next(r for r in responses if r.status_code == 409)
        assert refused.json()["message"] == SHORT_BALANCE
        async with AsyncSession(engine) as db:
            reservations = [await _reservation(db, item_id) for item_id, _ in listed]
            assert sum(r is not None for r in reservations) == 1
            holds = [
                t
                for t in await transactions_for_party(db, buyer.party_id)
                if t.transaction_type == PointTransactionType.HOLD
            ]
            assert len(holds) == 1
            assert await _balance(db, buyer.party_id, PARTY) == 0
            await db.rollback()
    finally:
        await _committed_purge(engine, parties)
        async with AsyncSession(engine) as db:
            assert await point_row_counts(db) == (0, 0)


async def test_confirmAndCancelPoints_parallel_settleOrReleaseNeverBoth(
    committed_client: AsyncClient, engine: AsyncEngine
) -> None:
    client = committed_client
    parties: list[uuid.UUID] = []
    try:
        seller, buyer, [(item_id, price)] = await _committed_setup(
            client, engine, uuid.uuid4().hex[:10], parties, items=1
        )
        taken = await _take(client, buyer.headers, item_id, price)
        assert taken.status_code == 200, taken.text
        async with AsyncSession(engine) as db:
            reservation = await _reservation(db, item_id)
            assert reservation is not None
            reservation_id = cast(uuid.UUID, reservation.id)

        responses = await asyncio.gather(
            client.post(
                f"/api/reservations/{reservation_id}/confirm-transaction", headers=buyer.headers
            ),
            client.post(
                f"/api/reservations/{reservation_id}/cancel-transaction", headers=seller.headers
            ),
        )

        assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
        async with AsyncSession(engine) as db:
            sales = await _of_type(db, PointTransactionType.SALE, reservation_id)
            releases = await _of_type(db, PointTransactionType.RELEASE, reservation_id)
            assert len(sales) + len(releases) == 1
            reservation = await _reservation(db, item_id)
            assert reservation is not None
            expected = ReservationStatus.FULFILLED if sales else ReservationStatus.CANCELLED
            assert reservation.status == expected
            assert await _balance(db, buyer.party_id, HELD) == 0
            await assert_point_transactions_balanced(db)
            await db.rollback()
    finally:
        await _committed_purge(engine, parties)
        async with AsyncSession(engine) as db:
            assert await point_row_counts(db) == (0, 0)


@pytest.mark.parametrize("kind", ["TERM", "EVENT"])
async def test_termEndScan_openPointsReservation_promptsTheBuyer(
    client: AsyncClient,
    db_session: AsyncSession,
    freeze_local_now: Callable[[datetime], None],
    kind: str,
) -> None:
    seller, buyer = await _pair(client, f"scan.{kind.lower()}")
    await _grant(db_session, buyer.party_id, 100)
    item_id, price = await _points_item(client, db_session, seller, f"Kask ppf.scan.{kind}")
    if kind == "TERM":
        org, _ = await _register(client, "ORGANIZER", "ppf.scan.org@example.com")
        group_id, term_id = await _create_circle_and_term(client, org, "ppf.scan")
        for person in (seller, buyer):
            await _rsvp(client, person.token, group_id, term_id)
        context = {"kind": "TERM", "id": str(term_id)}
    else:
        author, _ = await _register(client, "GUEST", "ppf.scan.author@example.com")
        event_id, starts_at = await _create_event(client, author)
        for person in (seller, buyer):
            await _sign_up(client, event_id, person.token)
        context = {"kind": "EVENT", "id": str(event_id)}
    taken = await _take(client, buyer.headers, item_id, price, context)
    assert taken.status_code == 200, taken.text
    reservation = await _reservation(db_session, item_id)
    assert reservation is not None
    if kind == "TERM":
        await _end_term(db_session, term_id)
    else:
        freeze_local_now(starts_at + term_end_scan.TERM_END_GRACE + timedelta(hours=1))

    await term_end_scan.scan_for_term_ended(db_session)

    payloads = (
        await db_session.scalars(
            select(OutboxEntry.payload).where(
                OutboxEntry.event_type == swap_events.TERM_ENDED_GIVEAWAY
            )
        )
    ).all()
    assert [p["reservation_id"] for p in payloads] == [str(reservation.id)]
    assert payloads[0]["taker_party_id"] == str(buyer.party_id)


TRY_AGAIN = "Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie"


@pytest.mark.parametrize("write", ["patch", "put", "confirm", "cancel", "delete_event"])
async def test_pointsWrites_deadlock_returns409AndWritesNothing(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    write: str,
) -> None:
    seller, buyer = await _pair(client, f"deadlock.{write}")
    await _grant(db_session, buyer.party_id, 100)
    item_id, price = await _points_item(client, db_session, seller, f"Kosz ppf.dl.{write}")
    taken = await _take(client, buyer.headers, item_id, price)
    assert taken.status_code == 200, taken.text
    reservation = await _reservation(db_session, item_id)
    assert reservation is not None
    event_id, _ = await _create_event(client, seller.token)
    counts = await point_row_counts(db_session)
    targets: dict[str, tuple[object, str]] = {
        "patch": (inventory_points_acl, "item_points_value"),
        "put": (inventory_bridge, "get_item_for_update"),
        "confirm": (groups_points_acl, "award_exchange"),
        "cancel": (inventory_bridge, "cancel_exchange"),
        "delete_event": (events_groups_acl, "cancel_open_event_reservations"),
    }
    monkeypatch.setattr(*targets[write], deadlock)

    if write == "patch":
        response = await client.patch(
            f"/api/inventory-items/{item_id}", json={"condition": "POOR"}, headers=seller.headers
        )
    elif write == "put":
        response = await client.put(
            f"/api/item-listing-preferences/{item_id}",
            json={"mode": "POINTS", "points_price": price + 10},
            headers=seller.headers,
        )
    elif write == "delete_event":
        response = await client.delete(f"/api/events/{event_id}", headers=seller.headers)
    else:
        response = await client.post(
            f"/api/reservations/{reservation.id}/{write}-transaction", headers=buyer.headers
        )

    assert response.status_code == 409, response.text
    assert response.json()["message"] == TRY_AGAIN
    assert await point_row_counts(db_session) == counts
    reservation = await _reservation(db_session, item_id)
    assert reservation is not None and reservation.status == ReservationStatus.PENDING
    stored = (
        await db_session.execute(
            select(InventoryItem.condition, ItemListingPreference.points_price)
            .join(ItemListingPreference, ItemListingPreference.item_id == InventoryItem.id)
            .where(InventoryItem.id == item_id)
            .execution_options(populate_existing=True)
        )
    ).one()
    assert tuple(stored) == (ItemCondition.GOOD, price)
    assert await db_session.get(Event, event_id, populate_existing=True) is not None
