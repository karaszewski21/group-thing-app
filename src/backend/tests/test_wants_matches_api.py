"""The match list of a want (`GET /api/wants/{id}/matches`): the card, its
order and its reservation flags, the read-time filter it shares with the
want's counters, the `matched_item_id` lookup, the "seen" and "opened" marks,
and the statement count of the list."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.groups.models import ItemListingPreference, SwapProposal, SwapProposalStatus
from app.inventory.models import InventoryItem
from app.moderation.status import ModerationStatus
from app.wants.models import Want, WantMatch
from tests.conftest import count_queries
from tests.test_event_item_reservations import _attendees, _listed_items
from tests.test_event_item_reservations import _take as _take_at_event
from tests.test_organizer_bridges import _photo, _uploader_id
from tests.test_organizer_page import _organization_slug
from tests.test_term_item_listings import _auth, _register
from tests.test_wants_api import NOT_FOUND_MESSAGE, WANT_KEYS, _create_want
from tests.test_wants_lifecycle import _is_new_period
from tests.test_wants_matcher import _Owner

CARD_KEYS = {
    "id",
    "title",
    "href",
    "meta",
    "is_new",
    "reserved_by_me",
    "proposed_by_me",
}
META_KEYS = {"mode", "condition", "thumb_url", "reserved", "reserved_until"}
MATCH_NOT_FOUND_MESSAGE = "Nie znaleziono dopasowania."


async def _matches(client: AsyncClient, token: str, want_id: str) -> list[dict[str, Any]]:
    response = await client.get(f"/api/wants/{want_id}/matches", headers=_auth(token))
    assert response.status_code == 200, response.text
    cards: list[dict[str, Any]] = response.json()
    return cards


async def _counters(client: AsyncClient, token: str, want_id: str) -> tuple[int, int]:
    """`(match_count, new_match_count)` of the want, the same from the want
    and from the list of wants."""
    want = (await client.get(f"/api/wants/{want_id}", headers=_auth(token))).json()
    listed = (await client.get("/api/wants", headers=_auth(token))).json()
    counters = (want["match_count"], want["new_match_count"])
    assert counters in [
        (row["match_count"], row["new_match_count"]) for row in listed if row["id"] == want_id
    ]
    return counters


async def _mark_unseen(db: AsyncSession, want_id: str) -> None:
    await db.execute(
        update(WantMatch).where(WantMatch.want_id == uuid.UUID(want_id)).values(seen_at=None)
    )
    await db.commit()


async def _take(client: AsyncClient, token: str, item_id: uuid.UUID) -> None:
    response = await client.post(
        f"/api/items/{item_id}/take",
        json={"context": {"kind": "PERSONAL"}, "reservation_type": "GIFT"},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text


async def _pending_proposal(
    db: AsyncSession, proposer: uuid.UUID, item_id: uuid.UUID, created_at: datetime
) -> None:
    db.add(
        SwapProposal(
            proposer_party_id=proposer,
            listing_item_id=item_id,
            offered_item_id=uuid.uuid4(),
            proposer_reservation_id=uuid.uuid4(),
            status=SwapProposalStatus.PROPOSED,
            created_at=created_at,
        )
    )
    await db.commit()


async def _stored_match(db: AsyncSession, want_id: str, item_id: uuid.UUID) -> Any:
    return (
        await db.execute(
            select(WantMatch.seen_at, WantMatch.opened_at)
            .where(WantMatch.want_id == uuid.UUID(want_id), WantMatch.item_id == item_id)
            .execution_options(populate_existing=True)
        )
    ).one()


async def test_listMatches_storedMatch_returnsExactCardKeySet_foreignOrWithdrawnWant404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wx.card.o@example.com")
    token, _ = await _register(client, "GUEST", "wx.card.s@example.com")
    stranger, _ = await _register(client, "GUEST", "wx.card.x@example.com")
    sledge = await owner.lists("Sanki drewniane")
    want = await _create_want(client, token, "sanki")
    owner_party = await db_session.scalar(
        select(ItemListingPreference.owner_party_id).where(ItemListingPreference.item_id == sledge)
    )

    (card,) = await _matches(client, token, want["id"])

    assert set(card) == CARD_KEYS
    assert set(card["meta"]) == META_KEYS
    assert card == {
        "id": str(sledge),
        "title": "Sanki drewniane",
        "href": f"/{owner_party}/product/{sledge}",
        "meta": {
            "mode": "GIFT",
            "condition": "GOOD",
            "thumb_url": None,
            "reserved": False,
            "reserved_until": None,
        },
        "is_new": False,
        "reserved_by_me": False,
        "proposed_by_me": False,
    }

    foreign = await client.get(f"/api/wants/{want['id']}/matches", headers=_auth(stranger))
    await client.post(
        f"/api/wants/{want['id']}/close", json={"outcome": "WITHDRAWN"}, headers=_auth(token)
    )
    withdrawn = await client.get(f"/api/wants/{want['id']}/matches", headers=_auth(token))
    for response in (foreign, withdrawn):
        assert response.status_code == 404, response.text
        assert response.json()["message"] == NOT_FOUND_MESSAGE


async def test_listMatches_order_availableFirstThenReserved_newFirstThenScore(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wx.order.o@example.com")
    token, _ = await _register(client, "GUEST", "wx.order.s@example.com")
    stranger, _ = await _register(client, "GUEST", "wx.order.x@example.com")
    seen_best = await owner.lists("Narty zjazdowe")
    new_weak = await owner.lists("Narty biegowe")
    new_strong = await owner.lists("Narty dla dzieci")
    reserved_new = await owner.lists("Narty skiturowe")
    reserved_seen = await owner.lists("Narty stare")
    want = await _create_want(client, token, "narty")
    for item_id, score, is_new in (
        (seen_best, 0.9, False),
        (new_weak, 0.5, True),
        (new_strong, 0.8, True),
        (reserved_new, 1.0, True),
        (reserved_seen, 0.95, False),
    ):
        await db_session.execute(
            update(WantMatch)
            .where(WantMatch.item_id == item_id)
            .values(score=score, seen_at=None if is_new else datetime.utcnow())
        )
    await db_session.commit()
    await _take(client, stranger, reserved_new)
    await _take(client, stranger, reserved_seen)

    cards = await _matches(client, token, want["id"])

    assert [card["id"] for card in cards] == [
        str(item_id) for item_id in (new_strong, new_weak, seen_best, reserved_new, reserved_seen)
    ]
    assert [card["is_new"] for card in cards] == [True, True, False, True, False]
    assert [card["meta"]["reserved"] for card in cards] == [False, False, False, True, True]
    assert await _counters(client, token, want["id"]) == (5, 3)


async def test_listMatches_reservationFlags_ownReservationAndOwnProposalThatIsNotTheOldest(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wx.flags.o@example.com")
    token, seeker = await _register(client, "GUEST", "wx.flags.s@example.com")
    stranger, stranger_party = await _register(client, "GUEST", "wx.flags.x@example.com")
    free = await owner.lists("Rower miejski")
    mine = await owner.lists("Rower górski")
    theirs = await owner.lists("Rower szosowy")
    proposed_by_other = await owner.lists("Rower składany", mode="SWAP")
    proposed_by_both = await owner.lists("Rower dziecięcy", mode="SWAP")
    want = await _create_want(client, token, "rower")
    await _take(client, token, mine)
    await _take(client, stranger, theirs)
    now = datetime.utcnow()
    await _pending_proposal(db_session, stranger_party, proposed_by_other, now)
    await _pending_proposal(
        db_session, stranger_party, proposed_by_both, now - timedelta(minutes=5)
    )
    await _pending_proposal(db_session, seeker, proposed_by_both, now)

    cards = {card["id"]: card for card in await _matches(client, token, want["id"])}

    def flags(item_id: uuid.UUID) -> tuple[bool, bool, bool]:
        card = cards[str(item_id)]
        return card["meta"]["reserved"], card["reserved_by_me"], card["proposed_by_me"]

    assert len(cards) == 5
    assert flags(free) == (False, False, False)
    assert flags(mine) == (True, True, False)
    assert flags(theirs) == (True, False, False)
    assert flags(proposed_by_other) == (True, False, False)
    assert flags(proposed_by_both) == (True, False, True)
    assert all(card["meta"]["reserved_until"] is None for card in cards.values())
    assert cards[str(proposed_by_both)]["meta"]["mode"] == "SWAP"
    assert await _counters(client, token, want["id"]) == (5, 0)


async def test_listMatches_organizationsItemWithPhotoReservedForAnEvent_slugHrefThumbAndReservedUntil(  # noqa: E501
    client: AsyncClient, db_session: AsyncSession
) -> None:
    event_id, starts_at, (owner, token) = await _attendees(client, "wx-org", "owner", "seeker")
    slug = await _organization_slug(client, owner, "Wypożyczalnia Sanek Wx")
    (sledge,) = await _listed_items(client, owner, ("Sanki drewniane", "GIFT"))
    product_id = await db_session.scalar(
        select(InventoryItem.product_id).where(InventoryItem.id == sledge)
    )
    assert product_id is not None
    db_session.add(
        _photo(
            product_id,
            await _uploader_id(db_session),
            "wx-org-sanki",
            ModerationStatus.APPROVED,
            0,
        )
    )
    await db_session.commit()
    want = await _create_want(client, token, "sanki")
    status, body = await _take_at_event(client, event_id, sledge, token)
    assert status == 200, body

    (card,) = await _matches(client, token, want["id"])

    assert set(card) == CARD_KEYS
    assert set(card["meta"]) == META_KEYS
    assert card["href"] == f"/{slug}/product/{sledge}"
    assert card["meta"]["thumb_url"] == "https://cdn.test/wx-org-sanki/w400.webp"
    assert card["meta"]["reserved"] is True
    assert datetime.fromisoformat(card["meta"]["reserved_until"]) == starts_at
    assert (card["reserved_by_me"], card["proposed_by_me"]) == (True, False)
    assert await _counters(client, token, want["id"]) == (1, 0)


async def test_listMatches_unlistedHiddenOrNowOwnItem_leftOutAndNotCounted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wx.gone.o@example.com")
    token, seeker = await _register(client, "GUEST", "wx.gone.s@example.com")
    kept = await owner.lists("Wrotki dziecięce")
    unlisted = await owner.lists("Wrotki regulowane")
    hidden = await owner.lists("Wrotki retro")
    handed_over = await owner.lists("Wrotki sportowe")
    want = await _create_want(client, token, "wrotki")
    await _mark_unseen(db_session, want["id"])
    assert len(await _matches(client, token, want["id"])) == 4
    assert await _counters(client, token, want["id"]) == (4, 4)

    for item_id, body in (
        (unlisted, {"mode": None}),
        (hidden, {"mode": "GIFT", "visibility": "PRIVATE"}),
    ):
        changed = await client.put(
            f"/api/item-listing-preferences/{item_id}", json=body, headers=_auth(owner.token)
        )
        assert changed.status_code == 200, changed.text
    # After a hand-over the seeker owns the item and lists it again.
    await db_session.execute(
        update(ItemListingPreference)
        .where(ItemListingPreference.item_id == handed_over)
        .values(owner_party_id=seeker)
    )
    await db_session.commit()

    cards = await _matches(client, token, want["id"])

    assert [card["id"] for card in cards] == [str(kept)]
    assert await _counters(client, token, want["id"]) == (1, 1)
    assert [card["is_new"] for card in cards] == [True]


async def test_listWants_matchedItemId_returnsOnlyActiveWantsHoldingTheItem(
    client: AsyncClient,
) -> None:
    owner = await _Owner.create(client, "wx.item.o@example.com")
    token, _ = await _register(client, "GUEST", "wx.item.s@example.com")
    stranger, _ = await _register(client, "GUEST", "wx.item.x@example.com")
    scooter = await owner.lists("Hulajnoga miejska")
    holding = await _create_want(client, token, "hulajnoga")
    fulfilled = await _create_want(client, token, "hulajnoga miejska")
    await _create_want(client, token, "deskorolka")
    await _create_want(client, stranger, "hulajnoga")
    closed = await client.post(
        f"/api/wants/{fulfilled['id']}/close", json={"outcome": "FULFILLED"}, headers=_auth(token)
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["match_count"] == 1

    found = await client.get(
        "/api/wants", params={"matched_item_id": str(scooter)}, headers=_auth(token)
    )
    unknown = await client.get(
        "/api/wants", params={"matched_item_id": str(uuid.uuid4())}, headers=_auth(token)
    )
    malformed = await client.get(
        "/api/wants", params={"matched_item_id": "sanki"}, headers=_auth(token)
    )
    everything = await client.get("/api/wants", headers=_auth(token))

    assert found.status_code == 200, found.text
    assert [want["id"] for want in found.json()] == [holding["id"]]
    assert set(found.json()[0]) == WANT_KEYS
    assert unknown.json() == []
    assert malformed.status_code == 400, malformed.text
    assert len(everything.json()) == 3


async def test_markMatchesSeen_resetsNewCount_extendsOnlyActiveWantInItsLast30Days(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wx.seen.o@example.com")
    token, _ = await _register(client, "GUEST", "wx.seen.s@example.com")
    stranger, _ = await _register(client, "GUEST", "wx.seen.x@example.com")
    await owner.lists("Rolki męskie")
    await owner.lists("Rolki damskie")
    want = await _create_want(client, token, "rolki")
    want_id = uuid.UUID(want["id"])
    url = f"/api/wants/{want['id']}/matches/seen"

    async def set_expiry(expires_in: timedelta) -> datetime:
        expires_at = datetime.utcnow() + expires_in
        await db_session.execute(
            update(Want)
            .where(Want.id == want_id)
            .values(expires_at=expires_at, reminded_at=datetime.utcnow())
        )
        await db_session.commit()
        await _mark_unseen(db_session, want["id"])
        return expires_at

    async def reminded_at() -> datetime | None:
        return await db_session.scalar(select(Want.reminded_at).where(Want.id == want_id))

    early = await set_expiry(timedelta(days=31))
    assert await _counters(client, token, want["id"]) == (2, 2)
    read_only = await _matches(client, token, want["id"])
    assert [card["is_new"] for card in read_only] == [True, True]
    assert await _counters(client, token, want["id"]) == (2, 2)

    outside = await client.post(url, headers=_auth(token))

    assert outside.status_code == 200, outside.text
    assert set(outside.json()) == WANT_KEYS
    assert (outside.json()["match_count"], outside.json()["new_match_count"]) == (2, 0)
    assert datetime.fromisoformat(outside.json()["expires_at"]) == early
    assert await reminded_at() is not None
    assert [card["is_new"] for card in await _matches(client, token, want["id"])] == [False, False]

    await set_expiry(timedelta(days=29))
    before = datetime.utcnow()
    inside = await client.post(url, headers=_auth(token))

    assert inside.status_code == 200, inside.text
    assert inside.json()["new_match_count"] == 0
    assert _is_new_period(inside.json()["expires_at"], before)
    assert await reminded_at() is None

    late = await set_expiry(timedelta(days=3))
    closed = await client.post(
        f"/api/wants/{want['id']}/close", json={"outcome": "FULFILLED"}, headers=_auth(token)
    )
    assert closed.json()["new_match_count"] == 2
    not_active = await client.post(url, headers=_auth(token))

    assert not_active.status_code == 200, not_active.text
    assert not_active.json()["status"] == "FULFILLED"
    assert (not_active.json()["match_count"], not_active.json()["new_match_count"]) == (2, 0)
    assert datetime.fromisoformat(not_active.json()["expires_at"]) == late

    foreign = await client.post(url, headers=_auth(stranger))
    assert foreign.status_code == 404, foreign.text
    assert foreign.json()["message"] == NOT_FOUND_MESSAGE


async def test_markMatchOpened_firstOpenOnly_unknownPair404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wx.open.o@example.com")
    token, _ = await _register(client, "GUEST", "wx.open.s@example.com")
    stranger, _ = await _register(client, "GUEST", "wx.open.x@example.com")
    tent = await owner.lists("Namiot turystyczny")
    other_item = await owner.lists("Plecak górski")
    want = await _create_want(client, token, "namiot")
    await _mark_unseen(db_session, want["id"])
    url = f"/api/wants/{want['id']}/matches"

    first = await client.post(f"{url}/{tent}/opened", headers=_auth(token))
    opened_at = (await _stored_match(db_session, want["id"], tent)).opened_at
    second = await client.post(f"{url}/{tent}/opened", headers=_auth(token))
    stored = await _stored_match(db_session, want["id"], tent)

    assert first.status_code == 204, first.text
    assert first.content == b""
    assert opened_at is not None
    assert second.status_code == 204, second.text
    assert stored.opened_at == opened_at
    assert stored.seen_at is None

    for item_id in (other_item, uuid.uuid4()):
        unknown = await client.post(f"{url}/{item_id}/opened", headers=_auth(token))
        assert unknown.status_code == 404, unknown.text
        assert unknown.json()["message"] == MATCH_NOT_FOUND_MESSAGE
    foreign = await client.post(f"{url}/{tent}/opened", headers=_auth(stranger))
    assert foreign.status_code == 404, foreign.text
    assert foreign.json()["message"] == NOT_FOUND_MESSAGE


async def test_listMatches_severalMatchesAndOwners_sameStatementCount(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    owner = await _Owner.create(client, "wx.count.o@example.com")
    second_owner = await _Owner.create(client, "wx.count.p@example.com")
    token, _ = await _register(client, "GUEST", "wx.count.s@example.com")
    await owner.lists("Sanki drewniane")
    for name in ("Narty zjazdowe", "Narty biegowe"):
        await owner.lists(name)
    taken = await second_owner.lists("Narty dla dzieci")
    await second_owner.lists("Narty skiturowe")
    one = await _create_want(client, token, "sanki")
    several = await _create_want(client, token, "narty")
    await _take(client, token, taken)

    with count_queries(engine) as one_match:
        one_card = await _matches(client, token, one["id"])
    with count_queries(engine) as several_matches:
        several_cards = await _matches(client, token, several["id"])

    assert (len(one_card), len(several_cards)) == (1, 4)
    assert len(several_matches) == len(one_match)
