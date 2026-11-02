"""Reserved items on lists (implementation/spec.md R7-R10): the
`listed_items_with_product_select` read, the pending-proposal guard on
`POST /api/items/{id}/take|propose`, the per-viewer `reservation` badge on
every list and on `/actions`, the organizer/owner counts, the per-principal
cache headers and the term page's constant statement count. Setup reuses
the term fixtures of `test_term_item_listings.py`."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, cast

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.circulation.models import BalanceStatus, InventoryItem, ItemCondition, ReservationType
from app.core import clock
from app.groups import service
from app.groups.infrastructure import circulation_bridge, repository
from app.groups.models import SwapProposal, SwapProposalStatus
from tests.conftest import count_queries
from tests.test_item_visibility import _world as _private_world
from tests.test_organizer_bridges import _register_items
from tests.test_organizer_page import _circle, _in_days, _listed_items, _organization_slug, _term
from tests.test_term_item_listings import (
    _auth,
    _create_circle_and_term,
    _principal,
    _propose_in_term,
    _register,
    _register_personal_item,
    _rsvp,
    _swap_listing,
    _take_in_term,
)

_PENDING_PROPOSAL_MESSAGE = "Ktoś już zaproponował zamianę za tę rzecz"


async def _account_user_id(client: AsyncClient, token: str) -> uuid.UUID:
    me = await client.get("/api/people/me", headers=_auth(token))
    return uuid.UUID(me.json()["account_user_id"])


async def _swap_offer(
    client: AsyncClient,
    db_session: AsyncSession,
    group_id: uuid.UUID,
    term_id: uuid.UUID,
    prefix: str,
) -> tuple[str, uuid.UUID]:
    """Another attendee with one SWAP-moded item to offer."""
    token, _ = await _register(client, "GUEST", f"{prefix}@example.com")
    await _rsvp(client, token, group_id, term_id)
    item_id = await _register_personal_item(client, token, f"Oferta {prefix}")
    await service.set_item_listing_preference(
        db_session, _principal(token), item_id, ReservationType.SWAP
    )
    return token, item_id


async def test_listedItemsSelect_includesReservedAndInTransitWithReserver_excludesDeleted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "rl1.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "rl1")
    lister_token, _ = await _register(client, "GUEST", "rl1.lister@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_ids = await _register_items(
        client,
        lister_token,
        *(f"Rzecz rl1 {name}" for name in ("wolna", "zarezerwowana", "w drodze", "usunieta")),
    )
    available_id, reserved_id, in_transit_id, deleted_id = item_ids
    for item_id in item_ids:
        await service.set_item_listing_preference(
            db_session, _principal(lister_token), item_id, ReservationType.GIFT
        )
    taker_token, _ = await _register(client, "GUEST", "rl1.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    taker_user_id = await _account_user_id(client, taker_token)
    await _take_in_term(db_session, _principal(taker_token), reserved_id, term_id)
    in_transit = await _take_in_term(db_session, _principal(taker_token), in_transit_id, term_id)
    await circulation_bridge.confirm_reservation(
        db_session,
        cast(uuid.UUID, in_transit.resolved_reservation_id),
        await _account_user_id(client, lister_token),
    )
    deleted = (
        await db_session.execute(select(InventoryItem).where(InventoryItem.id == deleted_id))
    ).scalar_one()
    deleted.deleted_at = datetime.utcnow()
    await db_session.flush()

    listed = circulation_bridge.listed_items_with_product_select().subquery()
    rows = (await db_session.execute(select(listed).where(listed.c.item_id.in_(item_ids)))).all()

    by_item = {row.item_id: row for row in rows}
    assert set(by_item) == {available_id, reserved_id, in_transit_id}
    assert set(rows[0]._mapping) == {
        "item_id",
        "product_id",
        "product_name",
        "condition",
        "balance_status",
        "reserved_by_user_id",
    }
    assert (by_item[available_id].balance_status, by_item[available_id].reserved_by_user_id) == (
        BalanceStatus.AVAILABLE,
        None,
    )
    assert (by_item[reserved_id].balance_status, by_item[reserved_id].reserved_by_user_id) == (
        BalanceStatus.RESERVED,
        taker_user_id,
    )
    assert (
        by_item[in_transit_id].balance_status,
        by_item[in_transit_id].reserved_by_user_id,
    ) == (BalanceStatus.IN_TRANSIT, taker_user_id)
    assert by_item[reserved_id].product_name == "Rzecz rl1 zarezerwowana"
    assert by_item[reserved_id].condition == ItemCondition.GOOD


async def test_takeItem_pendingProposal_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, proposer_token, group_id, term_id, listed_item_id, offered_item_id = await _swap_listing(
        client, db_session, "rl2"
    )
    await _propose_in_term(
        db_session, _principal(proposer_token), listed_item_id, offered_item_id, term_id
    )
    rival_token, rival_item_id = await _swap_offer(
        client, db_session, group_id, term_id, "rl2-rival"
    )
    context = {"kind": "TERM", "id": str(term_id)}

    take = await client.post(
        f"/api/items/{listed_item_id}/take",
        json={"context": context, "reservation_type": "SWAP"},
        headers=_auth(rival_token),
    )
    propose = await client.post(
        f"/api/items/{listed_item_id}/propose",
        json={"context": context, "offered_item_id": str(rival_item_id)},
        headers=_auth(rival_token),
    )

    assert take.status_code == 409, take.text
    assert take.json()["message"] == _PENDING_PROPOSAL_MESSAGE
    assert propose.status_code == 409, propose.text
    assert propose.json()["message"] == _PENDING_PROPOSAL_MESSAGE
    balance = await client.get(
        f"/api/inventory-items/{rival_item_id}/balance", headers=_auth(rival_token)
    )
    assert balance.json()["status"] == "AVAILABLE"


async def test_takeAndPropose_concurrent_secondReturns409(
    client: AsyncClient,
    db_session: AsyncSession,
    engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Deterministic stand-in for two concurrent proposals: the first one
    runs to its commit while the second is waiting on the listing
    preference's `FOR UPDATE` lock, so the second must re-check after the
    lock and lose."""
    _, first_token, group_id, term_id, listed_item_id, first_item_id = await _swap_listing(
        client, db_session, "rl3"
    )
    second_token, second_item_id = await _swap_offer(
        client, db_session, group_id, term_id, "rl3-second"
    )
    original_lock = repository.lock_item_listing_preference
    raced = False

    async def lock_after_rival_commits(db: AsyncSession, item_id: uuid.UUID) -> Any:
        nonlocal raced
        if not raced:
            raced = True
            await _propose_in_term(
                db, _principal(first_token), listed_item_id, first_item_id, term_id
            )
        return await original_lock(db, item_id)

    monkeypatch.setattr(repository, "lock_item_listing_preference", lock_after_rival_commits)

    with count_queries(engine) as statements:
        response = await client.post(
            f"/api/items/{listed_item_id}/propose",
            json={
                "context": {"kind": "TERM", "id": str(term_id)},
                "offered_item_id": str(second_item_id),
            },
            headers=_auth(second_token),
        )

    assert response.status_code == 409, response.text
    assert response.json()["message"] == _PENDING_PROPOSAL_MESSAGE
    assert any("FROM item_listing_preferences" in sql and "FOR UPDATE" in sql for sql in statements)
    proposals = (
        (
            await db_session.execute(
                select(SwapProposal).where(SwapProposal.listing_item_id == listed_item_id)
            )
        )
        .scalars()
        .all()
    )
    assert [(p.offered_item_id, p.status) for p in proposals] == [
        (first_item_id, SwapProposalStatus.PROPOSED)
    ]


_PUBLIC_CACHE = "public, max-age=0, s-maxage=60"
_PRIVATE_CACHE = "private, no-store"
_RESERVATION_KEYS = {"by_name", "by_me"}


def _headers(token: str | None) -> dict[str, str]:
    return _auth(token) if token is not None else {}


async def _display_name(client: AsyncClient, token: str) -> str:
    me = await client.get("/api/people/me", headers=_auth(token))
    return str(me.json()["display_name"])


def _reservations(items: list[dict[str, Any]]) -> dict[uuid.UUID, Any]:
    for item in items:
        if item["reservation"] is not None:
            assert set(item["reservation"]) == _RESERVATION_KEYS
    return {uuid.UUID(item["item_id"]): item["reservation"] for item in items}


async def _access_listings(
    client: AsyncClient, group_id: uuid.UUID, term_id: uuid.UUID, token: str | None
) -> dict[uuid.UUID, Any]:
    response = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}", headers=_headers(token)
    )
    assert response.status_code == 200, response.text
    return _reservations(response.json()["group"]["term"]["item_listings"])


async def _owner_world(
    client: AsyncClient, db_session: AsyncSession, prefix: str, *extra: tuple[str, str]
) -> dict[str, Any]:
    """An organization owner leading a PUBLIC circle with one upcoming term
    and authoring one upcoming event, listing a free and a taken GIFT item
    (the taker took the second in the term) plus the `extra` listings."""
    owner_token, _ = await _register(client, "ORGANIZER", f"{prefix}.owner@example.com")
    slug = await _organization_slug(client, owner_token, f"Rezerwacje {prefix}")
    group_id = await _circle(client, owner_token, f"Krąg {prefix}")
    term_id = await _term(client, owner_token, group_id, _in_days(5))
    starts_at = (clock.local_now() + timedelta(days=10)).replace(microsecond=0)
    event = await client.post(
        "/api/events",
        json={"name": f"Wymiana {prefix}", "starts_at": starts_at.isoformat()},
        headers=_auth(owner_token),
    )
    assert event.status_code == 201, event.text
    free_id, taken_id, *extra_ids = await _listed_items(
        client, owner_token, (f"{prefix} wolna", "GIFT"), (f"{prefix} wzięta", "GIFT"), *extra
    )
    taker_token, _ = await _register(client, "GUEST", f"{prefix}.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    await _take_in_term(db_session, _principal(taker_token), taken_id, term_id)
    third_token, _ = await _register(client, "GUEST", f"{prefix}.third@example.com")
    return {
        "owner": owner_token,
        "taker": taker_token,
        "third": third_token,
        "slug": slug,
        "group_id": group_id,
        "term_id": term_id,
        "event_id": event.json()["id"],
        "free_id": free_id,
        "taken_id": taken_id,
        "extra_ids": extra_ids,
    }


async def _route_reservations(
    client: AsyncClient, route: str, world: dict[str, Any], token: str | None
) -> dict[uuid.UUID, Any]:
    if route == "access":
        return await _access_listings(client, world["group_id"], world["term_id"], token)
    if route == "event":
        url = f"/api/events/{world['event_id']}"
    elif route == "organizer":
        url = f"/api/groups/public/organizers/{world['slug']}"
    else:
        url = f"/api/groups/public/organizers/{world['slug']}/items"
    response = await client.get(url, headers=_headers(token))
    assert response.status_code == 200, response.text
    body = response.json()
    if route == "event":
        return _reservations(body["participants"][0]["items"])
    if route == "organizer":
        exchange = _reservations(body["exchange"]["items"])
        assert _reservations(body["recent_items"]) == exchange
        return exchange
    return _reservations(body["items"])


@pytest.mark.parametrize("route", ["access", "event", "organizer", "owner_items"])
async def test_reservedBy_perViewer_anonymousNullLoggedInNameRecipientByMe(
    client: AsyncClient, db_session: AsyncSession, route: str
) -> None:
    world = await _owner_world(client, db_session, f"rb-{route}")
    taker_name = await _display_name(client, world["taker"])
    free_id, taken_id = world["free_id"], world["taken_id"]

    views = {
        viewer: await _route_reservations(client, route, world, world.get(viewer))
        for viewer in ("anonymous", "taker", "third", "owner")
    }

    assert views == {
        "anonymous": {free_id: None, taken_id: {"by_name": None, "by_me": False}},
        "taker": {free_id: None, taken_id: {"by_name": taker_name, "by_me": True}},
        "third": {free_id: None, taken_id: {"by_name": taker_name, "by_me": False}},
        "owner": {free_id: None, taken_id: {"by_name": taker_name, "by_me": False}},
    }


async def test_reservedBy_offeredItem_labelsListingOwner_pendingProposalLabelsProposer(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    lister_token, proposer_token, group_id, term_id, listed_id, offered_id = await _swap_listing(
        client, db_session, "rb-swap"
    )
    await _propose_in_term(db_session, _principal(proposer_token), listed_id, offered_id, term_id)
    third_token, _ = await _register(client, "GUEST", "rb-swap.third@example.com")
    lister_name = await _display_name(client, lister_token)
    proposer_name = await _display_name(client, proposer_token)

    third = await _access_listings(client, group_id, term_id, third_token)
    proposer = await _access_listings(client, group_id, term_id, proposer_token)
    lister = await _access_listings(client, group_id, term_id, lister_token)

    assert third == {
        listed_id: {"by_name": proposer_name, "by_me": False},
        offered_id: {"by_name": lister_name, "by_me": False},
    }
    assert proposer == {
        listed_id: {"by_name": proposer_name, "by_me": True},
        offered_id: {"by_name": lister_name, "by_me": False},
    }
    assert lister == {
        listed_id: {"by_name": proposer_name, "by_me": False},
        offered_id: {"by_name": lister_name, "by_me": True},
    }


async def test_counts_organizerAvailableOnlyPlusReserved_ownerIncludesReservedEqualsItemsTotal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _owner_world(client, db_session, "rb-counts", ("rb-counts zamiana", "SWAP"))
    [swap_id] = world["extra_ids"]
    base = f"/api/groups/public/organizers/{world['slug']}"

    exchange = (await client.get(base)).json()["exchange"]
    owner_items = (await client.get(f"{base}/items")).json()
    gifts = (await client.get(f"{base}/items?mode=GIFT")).json()
    actions = (await client.get(f"/api/items/{swap_id}/actions")).json()

    assert exchange["counts"] == {"GIFT": 1, "SWAP": 1, "RESERVED": 1}
    assert {uuid.UUID(item["item_id"]) for item in exchange["items"]} == {
        world["free_id"],
        world["taken_id"],
        swap_id,
    }
    assert owner_items["counts"] == {"GIFT": 2, "SWAP": 1}
    assert (owner_items["total"], len(owner_items["items"])) == (3, 3)
    assert (gifts["total"], len(gifts["items"])) == (2, 2)
    assert actions["owner"]["items_total"] == 3


@pytest.mark.parametrize("route", ["organizer", "organizer_items", "party_items"])
async def test_cacheHeaders_anonymousPublic_authenticatedPrivateNoStore_invalidTokenPublic_varyAuthorization(  # noqa: E501
    client: AsyncClient, route: str
) -> None:
    owner_token, owner_party_id = await _register(
        client, "ORGANIZER", f"rb-cache-{route}@example.com"
    )
    slug = await _organization_slug(client, owner_token, f"Nagłówki {route}")
    await _listed_items(client, owner_token, (f"rb-cache {route}", "GIFT"))
    url = {
        "organizer": f"/api/groups/public/organizers/{slug}",
        "organizer_items": f"/api/groups/public/organizers/{slug}/items",
        "party_items": f"/api/groups/public/parties/{owner_party_id}/items",
    }[route]

    anonymous = await client.get(url)
    authenticated = await client.get(url, headers=_auth(owner_token))
    invalid = await client.get(url, headers={"Authorization": "Bearer not-a-token"})

    for response, cache_control in (
        (anonymous, _PUBLIC_CACHE),
        (authenticated, _PRIVATE_CACHE),
        (invalid, _PUBLIC_CACHE),
    ):
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == cache_control
        assert response.headers["vary"] == "Authorization"


@pytest.mark.parametrize("route", ["actions", "details", "event", "access"])
async def test_personalisedReads_cacheHeaders_principalPrivateNoStore_anonymousPublic_varyAuthorization(  # noqa: E501
    client: AsyncClient, route: str
) -> None:
    owner_token, _ = await _register(client, "ORGANIZER", f"rb-pcache-{route}@example.com")
    group_id = await _circle(client, owner_token, f"Nagłówki {route}")
    await _term(client, owner_token, group_id, _in_days(5))
    [item_id] = await _listed_items(client, owner_token, (f"rb-pcache {route}", "GIFT"))
    event = await client.post(
        "/api/events",
        json={"name": f"Wymiana {route}", "starts_at": _in_days(6).isoformat()},
        headers=_auth(owner_token),
    )
    assert event.status_code == 201, event.text
    url = {
        "actions": f"/api/items/{item_id}/actions",
        "details": f"/api/inventory-items/{item_id}/details",
        "event": f"/api/events/{event.json()['id']}",
        "access": f"/api/groups/public/{group_id}/access",
    }[route]

    anonymous = await client.get(url)
    authenticated = await client.get(url, headers=_auth(owner_token))
    invalid = await client.get(url, headers={"Authorization": "Bearer not-a-token"})

    for response, cache_control in (
        (anonymous, _PUBLIC_CACHE),
        (authenticated, _PRIVATE_CACHE),
        (invalid, _PUBLIC_CACHE),
    ):
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == cache_control
        assert response.headers["vary"] == "Authorization"


async def _term_with_reserved_listings(
    client: AsyncClient, db_session: AsyncSession, prefix: str, listing_count: int
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """A term whose attendee lists `listing_count` GIFT items, the first
    taken by another attendee; returns a third viewer's token too."""
    org_token, _ = await _register(client, "ORGANIZER", f"{prefix}.org@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, prefix)
    lister_token, _ = await _register(client, "GUEST", f"{prefix}.lister@example.com")
    await _rsvp(client, lister_token, group_id, term_id)
    item_ids = await _listed_items(
        client, lister_token, *((f"{prefix} rzecz {i}", "GIFT") for i in range(listing_count))
    )
    taker_token, _ = await _register(client, "GUEST", f"{prefix}.taker@example.com")
    await _rsvp(client, taker_token, group_id, term_id)
    await _take_in_term(db_session, _principal(taker_token), item_ids[0], term_id)
    viewer_token, _ = await _register(client, "GUEST", f"{prefix}.viewer@example.com")
    return group_id, term_id, viewer_token


async def test_access_termListings_statementCount_oneVsFiveIncludingReservedEqual(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    counts = []
    for prefix, listing_count in (("rb-sc-one", 1), ("rb-sc-five", 5)):
        group_id, term_id, viewer_token = await _term_with_reserved_listings(
            client, db_session, prefix, listing_count
        )
        with count_queries(engine) as statements:
            listings = await _access_listings(client, group_id, term_id, viewer_token)
        assert len(listings) == listing_count
        assert sum(reservation is not None for reservation in listings.values()) == 1
        counts.append(len(statements))

    assert counts[0] == counts[1], counts


async def test_getItemActions_pendingProposal_unavailableWithReservation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, proposer_token, _, term_id, listed_id, offered_id = await _swap_listing(
        client, db_session, "rb-actions"
    )
    await _propose_in_term(db_session, _principal(proposer_token), listed_id, offered_id, term_id)
    third_token, _ = await _register(client, "GUEST", "rb-actions.third@example.com")
    proposer_name = await _display_name(client, proposer_token)

    views = {}
    for viewer, token in (
        ("anonymous", None),
        ("third", third_token),
        ("proposer", proposer_token),
    ):
        response = await client.get(f"/api/items/{listed_id}/actions", headers=_headers(token))
        assert response.status_code == 200, response.text
        views[viewer] = (response.json()["available"], response.json()["reservation"])

    assert views == {
        "anonymous": (False, {"by_name": None, "by_me": False}),
        "third": (False, {"by_name": proposer_name, "by_me": False}),
        "proposer": (False, {"by_name": proposer_name, "by_me": True}),
    }


async def test_reservedBy_privateItemOnPrivateTerm_memberAndOwnerSeeReserverName(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    world = await _private_world(client, db_session, "rb-private")
    counterparty_name = await _display_name(client, world.counterparty)
    expected = {
        world.reserved: {"by_name": counterparty_name, "by_me": False},
        world.free: None,
        world.public: None,
    }

    member = await _access_listings(client, world.private_circle, world.private_term, world.member)
    owner = await _access_listings(client, world.private_circle, world.private_term, world.owner)

    assert member == expected
    assert owner == expected
