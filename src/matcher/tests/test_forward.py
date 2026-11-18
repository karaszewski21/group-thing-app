"""The shared match predicates on the forward path (FR-MR-01), ported from
the backend's `test_wants_matcher.py`: offer mode, category ancestors,
locality and radius, visibility, own and not takeable items, inactive wants,
the top-N cap, how forward pairs are stored, and forward ≡ window; then the
request loop's run of one claimed want: compare-and-clear, `updated_at`
untouched, no outbox row, and two claimers never sharing a want."""

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any

import asyncpg
import pytest

from matcher import clock, requests, rules, statements
from tests import conftest


async def _forward(db: asyncpg.Pool, want_id: uuid.UUID) -> set[uuid.UUID]:
    """The items one forward run stores for the want."""
    pairs = await conftest.match_forward(db, want_id, now=clock.utcnow())
    assert {pair.want_id for pair in pairs} <= {want_id}
    return {pair.item_id for pair in pairs}


async def test_matchForward_categoryAndOfferMode_narrowAndNeverMatchAlone(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    parent = await conftest.category(db, "Zima")
    leaf = await conftest.category(db, "Sanki", parent)
    other_leaf = await conftest.category(db, "Inne")
    gift_in_leaf = await conftest.lists(db, lister, "Sanki drewniane", category_id=leaf)
    swap_elsewhere = await conftest.lists(
        db, lister, "Sanki plastikowe", mode="SWAP", category_id=other_leaf
    )
    await conftest.lists(db, lister, "Wrotki", category_id=leaf)

    async def matched(**fields: Any) -> set[uuid.UUID]:
        return await _forward(db, await conftest.want(db, seeker.party_id, "sanki", **fields))

    assert await matched() == {gift_in_leaf, swap_elsewhere}
    assert await matched(category_id=parent) == {gift_in_leaf}
    assert await matched(category_id=leaf) == {gift_in_leaf}
    assert await matched(category_id=other_leaf) == {swap_elsewhere}
    assert await matched(offer_mode="GIFT") == {gift_in_leaf}
    assert await matched(offer_mode="SWAP") == {swap_elsewhere}
    assert await matched(offer_mode="SWAP", category_id=leaf) == set()


async def test_matchForward_locality_sameLocalityRadiusAndNullPointFallback(
    db: asyncpg.Pool,
) -> None:
    home = await conftest.locality(db, "Dom", lat=50.0, lng=19.0)
    near = await conftest.locality(db, "Blisko", lat=50.0, lng=19.1)  # ~7.2 km
    far = await conftest.locality(db, "Daleko", lat=50.5, lng=19.0)  # ~55.6 km
    pointless = await conftest.locality(db, "Bez punktu")
    lister = await conftest.owner(db, locality_id=home)
    seeker = await conftest.person(db)

    async def listed_in(locality_id: str) -> uuid.UUID:
        place = await conftest.location(db, lister.party_id, locality_id)
        return await conftest.lists(db, lister, "Namiot turystyczny", location_id=place)

    in_home = await conftest.lists(db, lister, "Namiot turystyczny")
    in_near = await listed_in(near)
    in_far = await listed_in(far)
    without_point = await listed_in(pointless)

    async def matched(**fields: Any) -> set[uuid.UUID]:
        return await _forward(db, await conftest.want(db, seeker.party_id, "namiot", **fields))

    assert await matched() == {in_home, in_near, in_far, without_point}
    assert await matched(locality_id=home) == {in_home}
    assert await matched(locality_id=home, radius_km=5) == {in_home}
    assert await matched(locality_id=home, radius_km=10) == {in_home, in_near}
    assert await matched(locality_id=home, radius_km=100) == {in_home, in_near, in_far}
    assert await matched(locality_id=pointless, radius_km=100) == {without_point}


async def test_matchForward_privateListing_onlyForAPeerOfALivePrivateGroup(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    member = await conftest.person(db, "Członek")
    leader = await conftest.person(db, "Organizator")
    public_member = await conftest.person(db, "Członek publicznego")
    former_member = await conftest.person(db, "Były członek")
    stranger = await conftest.person(db, "Obcy")
    private_group = await conftest.group(db, lister.party_id)
    public_group = await conftest.group(db, lister.party_id, visibility="PUBLIC")
    await conftest.join_group(db, lister.party_id, private_group)
    await conftest.join_group(db, lister.party_id, public_group)
    await conftest.join_group(db, member.party_id, private_group)
    await conftest.join_group(db, leader.party_id, private_group, organizer=True)
    await conftest.join_group(db, public_member.party_id, public_group)
    await conftest.join_group(db, former_member.party_id, private_group, ended=True)
    private = await conftest.lists(db, lister, "Sanki drewniane", visibility="PRIVATE")
    public = await conftest.lists(db, lister, "Narty biegowe")

    async def matched(seeker: conftest.Person, name: str) -> set[uuid.UUID]:
        return await _forward(db, await conftest.want(db, seeker.party_id, name))

    assert await matched(member, "sanki") == {private}
    assert await matched(leader, "sanki") == {private}
    assert await matched(public_member, "sanki") == set()
    assert await matched(former_member, "sanki") == set()
    assert await matched(stranger, "sanki") == set()
    assert await matched(stranger, "narty") == {public}
    assert await matched(lister.person, "narty") == set()

    await db.execute(
        "UPDATE groups SET deleted_at = $1 WHERE id = $2", clock.utcnow(), private_group
    )
    assert await matched(member, "sanki") == set()


async def test_matchForward_notTakeableItemOrInactiveWant_noPair(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    await conftest.lists(db, lister, "Rowerek czerwony", balance="RESERVED")
    deleted_item = await conftest.lists(db, lister, "Łyżwy figurowe")
    await db.execute(
        "UPDATE inventory_items SET deleted_at = $1 WHERE id = $2", clock.utcnow(), deleted_item
    )
    other_place = await conftest.location(db, lister.party_id, await conftest.locality(db, "X"))
    await conftest.lists(db, lister, "Narty biegowe", location_id=other_place)
    await db.execute(
        "UPDATE locations SET deleted_at = $1 WHERE id = $2", clock.utcnow(), other_place
    )
    sledge = await conftest.lists(db, lister, "Sanki drewniane")

    async def matched(name: str, **fields: Any) -> set[uuid.UUID]:
        return await _forward(db, await conftest.want(db, seeker.party_id, name, **fields))

    assert await matched("rowerek") == set()
    assert await matched("łyżwy") == set()
    assert await matched("narty") == set()
    assert await matched("sanki", status="WITHDRAWN") == set()
    assert await matched("sanki", expires_at=clock.utcnow() - timedelta(seconds=1)) == set()
    assert await matched("sanki") == {sledge}


async def test_matchForward_moreThanTopNCandidates_bestByScoreThenNewest_nextRunAddsTheRest(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    start = clock.utcnow() - timedelta(hours=1)
    listed_at = (start + timedelta(minutes=n) for n in range(rules.MATCH_TOP_N + 5))
    oldest_exact = await conftest.lists(db, lister, "Rowerek biegowy", listed_at=next(listed_at))
    newer_exact = {
        await conftest.lists(db, lister, "Rowerek biegowy", listed_at=next(listed_at))
        for _ in range(rules.MATCH_TOP_N)
    }
    newest_reordered = {
        await conftest.lists(db, lister, "Biegowy czerwony rowerek", listed_at=next(listed_at))
        for _ in range(4)
    }
    want_id = await conftest.want(db, seeker.party_id, "rowerek biegowy")

    first = await _forward(db, want_id)
    second = await _forward(db, want_id)
    third = await _forward(db, want_id)

    assert first == newer_exact
    assert second == {oldest_exact, *newest_reordered}
    assert third == set()


async def test_matchForward_pairsBornSeenFromTheForwardSource(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    item_id = await conftest.lists(db, lister, "Kurtka zimowa")
    want_id = await conftest.want(db, seeker.party_id, "Kurtka zimowa")
    now = clock.utcnow()

    pairs = await conftest.match_forward(db, want_id, now=now)
    row = (await conftest.stored(db, want_id))[item_id]

    assert pairs == [statements.StoredPair(want_id, item_id, "MATCH")]
    assert row["id"] is not None
    assert (row["created_at"], row["updated_at"], row["seen_at"]) == (now, now, now)
    assert (row["source"], row["tier"], row["missing_words"]) == ("FORWARD", "MATCH", None)
    assert row["score"] == 1.0
    assert row["opened_at"] is None
    assert await db.fetchval("SELECT count(*) FROM outbox_entries") == 0


async def test_matchWindow_samePairsAsForward_unseenFromTheScanSource(db: asyncpg.Pool) -> None:
    home = await conftest.locality(db, "Dom", lat=50.0, lng=19.0)
    near = await conftest.locality(db, "Blisko", lat=50.0, lng=19.1)
    lister = await conftest.owner(db, locality_id=home)
    seeker = await conftest.person(db)
    other_seeker = await conftest.person(db)
    parent = await conftest.category(db, "Sport")
    leaf = await conftest.category(db, "Deski", parent)
    other_leaf = await conftest.category(db, "Inne")
    now = clock.utcnow()
    before = now - timedelta(minutes=10)
    listed = now - timedelta(minutes=5)
    old = await conftest.lists(
        db, lister, "Deskorolka", category_id=leaf, listed_at=before - timedelta(minutes=1)
    )
    board = await conftest.lists(db, lister, "Deskorolka", category_id=leaf, listed_at=listed)
    long_board = await conftest.lists(
        db, lister, "Deskorolka długa", category_id=leaf, listed_at=listed
    )
    await conftest.lists(db, lister, "Kask rowerowy", category_id=leaf, listed_at=listed)
    tractors = {
        await conftest.lists(db, lister, "Traktor bruder Deutz", listed_at=listed) for _ in range(2)
    }
    wants = [
        await conftest.want(db, seeker.party_id, "deskorolka"),
        await conftest.want(db, other_seeker.party_id, "deskorolka", category_id=parent),
        await conftest.want(
            db, other_seeker.party_id, "deskorolka", locality_id=near, radius_km=10
        ),
        await conftest.want(db, other_seeker.party_id, "deskorolka", offer_mode="GIFT"),
        await conftest.want(db, other_seeker.party_id, "deskorolka", category_id=other_leaf),
        await conftest.want(db, other_seeker.party_id, "deskorolka", locality_id=near),
        await conftest.want(db, other_seeker.party_id, "deskorolka", offer_mode="SWAP"),
        await conftest.want(db, other_seeker.party_id, "deskorolka", status="WITHDRAWN"),
        await conftest.want(db, lister.party_id, "deskorolka"),
        await conftest.want(db, seeker.party_id, "Traktor Bruder Claas"),
    ]

    window = set(await conftest.match_window(db, listed_after=before, now=now))
    window_rows = await db.fetch("SELECT source, seen_at, tier FROM want_matches")
    await db.execute("DELETE FROM want_matches")
    forward = {
        pair
        for want_id in wants
        for pair in await conftest.match_forward(db, want_id, now=now)
        if pair.item_id != old
    }

    assert window == forward
    assert {(pair.want_id, pair.item_id) for pair in window if pair.tier == "MATCH"} == {
        (want_id, item_id) for want_id in wants[:4] for item_id in (board, long_board)
    }
    assert {(pair.want_id, pair.item_id) for pair in window if pair.tier == "SUGGESTION"} == {
        (wants[9], item_id) for item_id in tractors
    }
    assert old not in {pair.item_id for pair in window}
    assert {(row["source"], row["seen_at"], row["tier"]) for row in window_rows} == {
        ("SCAN", None, "MATCH"),
        ("SCAN", now, "SUGGESTION"),
    }


# --- the request loop's run of one claimed want (FR-MT-04) ---------------------


async def test_processNext_storesBornSeenClearsTheFlag_updatedAtUntouched_noOutboxRow(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    item_id = await conftest.lists(db, lister, "Kurtka zimowa")
    want_id = await conftest.want(
        db, seeker.party_id, "Kurtka zimowa", match_requested_at=clock.utcnow()
    )
    version = await db.fetchval("SELECT updated_at FROM wants WHERE id = $1", want_id)
    now = clock.utcnow()

    assert await requests.process_next(db, requests.Backoff(), now=now)

    row = await db.fetchrow(
        "SELECT match_requested_at, updated_at FROM wants WHERE id = $1", want_id
    )
    assert row is not None
    assert (row["match_requested_at"], row["updated_at"]) == (None, version)
    assert (await conftest.stored(db, want_id))[item_id]["seen_at"] == now
    assert await db.fetchval("SELECT count(*) FROM outbox_entries") == 0
    assert not await requests.process_next(db, requests.Backoff(), now=now)


async def test_processNext_closedWant_onlyClearsTheFlag(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    await conftest.lists(db, lister, "Kurtka zimowa")
    want_id = await conftest.want(
        db, seeker.party_id, "Kurtka zimowa", status="WITHDRAWN", match_requested_at=clock.utcnow()
    )

    assert await requests.process_next(db, requests.Backoff(), now=clock.utcnow())

    assert await db.fetchval("SELECT match_requested_at FROM wants WHERE id = $1", want_id) is None
    assert await conftest.stored(db, want_id) == {}


async def test_processNext_flagRenewedDuringTheRun_compareAndClearKeepsTheNewerFlag(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeker = await conftest.person(db)
    claimed_at = clock.utcnow()
    renewed_at = claimed_at + timedelta(seconds=1)
    want_id = await conftest.want(
        db, seeker.party_id, "Kurtka zimowa", match_requested_at=claimed_at
    )
    match_forward = statements.match_forward

    async def renewed_meanwhile(
        connection: asyncpg.Connection, want_id: uuid.UUID, *, now: datetime
    ) -> list[statements.StoredPair]:
        await connection.execute(
            "UPDATE wants SET match_requested_at = $2 WHERE id = $1", want_id, renewed_at
        )
        return await match_forward(connection, want_id, now=now)

    monkeypatch.setattr(statements, "match_forward", renewed_meanwhile)

    assert await requests.process_next(db, requests.Backoff(), now=clock.utcnow())

    flag = await db.fetchval("SELECT match_requested_at FROM wants WHERE id = $1", want_id)
    assert flag == renewed_at


async def test_drain_twoConcurrentClaimers_neverProcessOneWantTwice(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    await conftest.lists(db, lister, "Kurtka zimowa")
    wants = {
        await conftest.want(db, seeker.party_id, "Kurtka zimowa", match_requested_at=clock.utcnow())
        for _ in range(6)
    }
    match_forward = statements.match_forward
    processed: list[uuid.UUID] = []

    async def slow(
        connection: asyncpg.Connection, want_id: uuid.UUID, *, now: datetime
    ) -> list[statements.StoredPair]:
        processed.append(want_id)
        await asyncio.sleep(0.05)
        return await match_forward(connection, want_id, now=now)

    monkeypatch.setattr(statements, "match_forward", slow)

    counts = await asyncio.gather(
        requests.drain(db, requests.Backoff()), requests.drain(db, requests.Backoff())
    )

    assert sorted(processed) == sorted(wants)
    assert sum(counts) == len(wants) and min(counts) > 0
    assert await db.fetchval("SELECT count(*) FROM wants WHERE match_requested_at IS NOT NULL") == 0
    assert await db.fetchval("SELECT count(*) FROM want_matches") == len(wants)
