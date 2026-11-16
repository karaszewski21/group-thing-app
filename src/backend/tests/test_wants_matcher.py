"""The wants match statement (`app.wants.application.matcher`): the text,
short-word, category, offer-mode and locality rules, what is never matched,
the top-20 cap with its order, and the forward (`match_want`) and reverse
(`match_new_listings`) directions over the same data."""

from __future__ import annotations

import uuid
import warnings
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import String, delete, func, literal, select, update
from sqlalchemy import cast as sql_cast
from sqlalchemy.dialects.postgresql import asyncpg
from sqlalchemy.exc import SAWarning
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from sqlalchemy.sql import compiler

import app.main  # noqa: F401  (registers every table the wants foreign keys point at)
from app.inventory.models import InventoryItem
from app.locations.models import Locality, Location
from app.wants.application import matcher
from app.wants.application.text_queries import short_words_query
from app.wants.domain.limits import (
    MATCH_TOP_N,
    SIMILARITY_THRESHOLD_WITH_CATEGORY,
    SIMILARITY_THRESHOLD_WITHOUT_CATEGORY,
    VALIDITY,
)
from app.wants.domain.status import WantMatchSource, WantStatus
from app.wants.models import Want, WantMatch
from tests.conftest import count_queries, leaf_category_ids
from tests.test_search_location import ANDRYCHOW, BIELSKO, KETY, LODZ, _inventory, _place
from tests.test_term_item_listings import _auth, _register
from tests.test_visible_to import _world


async def _product(
    client: AsyncClient, token: str, name: str, category_id: str | None = None
) -> str:
    response = await client.post(
        "/api/products/resolve",
        json={
            "name": name,
            "category_id": category_id or (await leaf_category_ids(client, _auth(token)))[0],
        },
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return str(response.json()["id"])


async def _listed(
    client: AsyncClient,
    token: str,
    inventory_id: str,
    product_id: str,
    place_id: str,
    mode: str = "GIFT",
) -> uuid.UUID:
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inventory_id,
            "product_id": product_id,
            "condition": "GOOD",
            "location_id": place_id,
        },
        headers=_auth(token),
    )
    assert item.status_code == 201, item.text
    item_id = item.json()["id"]
    preference = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": mode}, headers=_auth(token)
    )
    assert preference.status_code == 200, preference.text
    return uuid.UUID(item_id)


class _Owner:
    """A registered party with one inventory and one place in Kęty."""

    def __init__(self, client: AsyncClient, token: str, inventory_id: str, place_id: str) -> None:
        self._client = client
        self.token = token
        self._inventory_id = inventory_id
        self.place_id = place_id

    @classmethod
    async def create(cls, client: AsyncClient, email: str) -> _Owner:
        token, _ = await _register(client, "GUEST", email)
        return cls(
            client, token, await _inventory(client, token), await _place(client, token, KETY)
        )

    async def lists(
        self,
        name: str,
        *,
        mode: str = "GIFT",
        category_id: str | None = None,
        locality_id: str | None = None,
    ) -> uuid.UUID:
        place_id = (
            await _place(self._client, self.token, locality_id) if locality_id else self.place_id
        )
        product_id = await _product(self._client, self.token, name, category_id)
        return await self.lists_product(product_id, place_id=place_id, mode=mode)

    async def lists_product(
        self, product_id: str, *, place_id: str | None = None, mode: str = "GIFT"
    ) -> uuid.UUID:
        return await _listed(
            self._client,
            self.token,
            self._inventory_id,
            product_id,
            place_id or self.place_id,
            mode,
        )


async def _seeker(client: AsyncClient, email: str) -> uuid.UUID:
    _, party_id = await _register(client, "GUEST", email)
    return party_id


async def _want(
    db: AsyncSession,
    seeker: uuid.UUID,
    name: str,
    *,
    status: WantStatus = WantStatus.ACTIVE,
    expires_in: timedelta = VALIDITY,
    **fields: Any,
) -> uuid.UUID:
    """A want inserted through the ORM, `short_words_query` written in SQL
    as the write path does."""
    now = datetime.utcnow()
    want = Want(
        seeker_party_id=seeker,
        name=name,
        short_words_query=short_words_query(name),
        status=status,
        expires_at=now + expires_in,
        closed_at=None if status == WantStatus.ACTIVE else now,
        **fields,
    )
    db.add(want)
    await db.commit()
    return want.id


async def _forward(db: AsyncSession, want_id: uuid.UUID) -> set[uuid.UUID]:
    """The items one forward run stores for the want."""
    pairs = await matcher.match_want(db, want_id, now=datetime.utcnow())
    await db.commit()
    assert {pair_want for pair_want, _ in pairs} <= {want_id}
    return {item_id for _, item_id in pairs}


async def _similarity(db: AsyncSession, want_name: str, product_name: str) -> float:
    return float(
        await db.scalar(
            select(
                func.word_similarity(
                    func.fold_pl(literal(want_name)), func.fold_pl(literal(product_name))
                )
            )
        )
        or 0.0
    )


async def test_matchWant_text_fullTextOrTrigramAboveTheCategoryDependentThreshold(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wm.text.o@example.com")
    seeker = await _seeker(client, "wm.text.s@example.com")
    (category_id,) = await leaf_category_ids(client, _auth(owner.token))
    full_text = await owner.lists("Zielona deskorolka miejska", category_id=category_id)
    close = await owner.lists("Deskorolki", category_id=category_id)
    loose = await owner.lists("Deskoroza", category_id=category_id)
    await owner.lists("Deskowanie", category_id=category_id)
    await owner.lists("Hulajnoga", category_id=category_id)
    assert await _similarity(db_session, "deskorolka", "Deskorolki") >= 0.75
    assert 0.62 <= await _similarity(db_session, "deskorolka", "Deskoroza") <= 0.68
    assert await _similarity(db_session, "deskorolka", "Deskowanie") < 0.58

    without_category = await _forward(db_session, await _want(db_session, seeker, "Deskorolka"))
    with_category = await _forward(
        db_session,
        await _want(db_session, seeker, "deskorolka", category_id=uuid.UUID(category_id)),
    )
    statement = str(
        matcher.match_statement(
            now=datetime.utcnow(), source=WantMatchSource.FORWARD, seen_at=None
        ).compile(dialect=asyncpg.dialect())
    )

    assert (SIMILARITY_THRESHOLD_WITHOUT_CATEGORY, SIMILARITY_THRESHOLD_WITH_CATEGORY) == (
        0.70,
        0.60,
    )
    assert without_category == {full_text, close}
    assert with_category == {full_text, close, loose}
    assert "wants.name_folded <% fold_pl(products.name)" in statement
    assert "word_similarity(wants.name_folded, fold_pl(products.name)) >= CASE" in statement
    assert "products.search_vector @@ wants.name_query" in statement
    assert "DISTINCT" not in statement


async def test_matchWant_shortWords_neverByTrigramAlone_hyphenatedNameMatchesIdentical(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wm.short.o@example.com")
    seeker = await _seeker(client, "wm.short.s@example.com")
    tv = await owner.lists("Telewizor TV LG 43 cale")
    await owner.lists("TV LG 48")
    jacket = await owner.lists("Kurtka 3-5 lat")
    jackets = await owner.lists("Kurtki 3-5 lat")
    await owner.lists("Kurtki 3-5 lata")
    assert await _similarity(db_session, "TV LG 43", "TV LG 48") >= 0.70
    assert await _similarity(db_session, "kurtka 3-5 lat", "Kurtki 3-5 lat") >= 0.70
    assert await _similarity(db_session, "kurtka 3-5 lat", "Kurtki 3-5 lata") >= 0.70

    tv_want = await _want(db_session, seeker, "TV LG 43")
    jacket_want = await _want(db_session, seeker, "kurtka 3-5 lat")
    long_words_want = await _want(db_session, seeker, "Kurtka zimowa")
    stored = dict(
        (
            await db_session.execute(
                select(Want.id, sql_cast(Want.short_words_query, String)).where(
                    Want.seeker_party_id == seeker
                )
            )
        ).all()
    )

    assert stored == {
        tv_want: "'43' & 'lg' & 'tv'",
        jacket_want: "'-5' & '3' & 'lat'",
        long_words_want: None,
    }
    assert await _forward(db_session, tv_want) == {tv}
    assert await _forward(db_session, jacket_want) == {jacket, jackets}


async def test_matchWant_categoryAndOfferMode_narrowAndNeverMatchAlone(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wm.cat.o@example.com")
    seeker = await _seeker(client, "wm.cat.s@example.com")
    categories = (await client.get("/api/categories", headers=_auth(owner.token))).json()
    parent_of = {str(row["id"]): row["parent_id"] and str(row["parent_id"]) for row in categories}
    leaves = await leaf_category_ids(client, _auth(owner.token), n=100)
    leaf = next(category_id for category_id in leaves if parent_of[category_id])
    parent = parent_of[leaf]
    other_leaf = next(category_id for category_id in leaves if parent_of[category_id] != parent)
    assert parent is not None and other_leaf != parent
    gift_in_leaf = await owner.lists("Sanki drewniane", category_id=leaf)
    swap_elsewhere = await owner.lists("Sanki plastikowe", mode="SWAP", category_id=other_leaf)
    await owner.lists("Wrotki", category_id=leaf)

    async def matched(**fields: Any) -> set[uuid.UUID]:
        return await _forward(db_session, await _want(db_session, seeker, "sanki", **fields))

    assert await matched() == {gift_in_leaf, swap_elsewhere}
    assert await matched(category_id=uuid.UUID(parent)) == {gift_in_leaf}
    assert await matched(category_id=uuid.UUID(leaf)) == {gift_in_leaf}
    assert await matched(category_id=uuid.UUID(other_leaf)) == {swap_elsewhere}
    assert await matched(offer_mode="GIFT") == {gift_in_leaf}
    assert await matched(offer_mode="SWAP") == {swap_elsewhere}
    assert await matched(offer_mode="SWAP", category_id=uuid.UUID(leaf)) == set()


async def test_matchWant_locality_sameLocalityRadiusAndNullPointFallback(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wm.loc.o@example.com")
    seeker = await _seeker(client, "wm.loc.s@example.com")
    pointless = await db_session.scalar(
        select(Locality.id).where(Locality.lat.is_(None)).order_by(Locality.id).limit(1)
    )
    assert pointless is not None
    in_kety = await owner.lists("Namiot turystyczny")
    in_andrychow = await owner.lists("Namiot turystyczny", locality_id=ANDRYCHOW)
    in_bielsko = await owner.lists("Namiot turystyczny", locality_id=BIELSKO)
    in_lodz = await owner.lists("Namiot turystyczny", locality_id=LODZ)
    without_point = await owner.lists("Namiot turystyczny", locality_id=pointless)

    async def matched(**fields: Any) -> set[uuid.UUID]:
        return await _forward(db_session, await _want(db_session, seeker, "namiot", **fields))

    assert await matched() == {in_kety, in_andrychow, in_bielsko, in_lodz, without_point}
    assert await matched(locality_id=KETY) == {in_kety}
    assert await matched(locality_id=KETY, radius_km=5) == {in_kety}
    assert await matched(locality_id=KETY, radius_km=10) == {in_kety, in_andrychow}
    assert await matched(locality_id=KETY, radius_km=14) == {in_kety, in_andrychow}
    assert await matched(locality_id=KETY, radius_km=100) == {in_kety, in_andrychow, in_bielsko}
    assert await matched(locality_id=pointless, radius_km=100) == {without_point}


async def test_matchWant_ownHiddenOrNotTakeableItemAndInactiveWant_noPair(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    w = await _world(client, db_session, "wm-no")

    async def matched(seeker: uuid.UUID, name: str, **fields: Any) -> set[uuid.UUID]:
        return await _forward(
            db_session, await _want(db_session, seeker, f"{name} wm-no", **fields)
        )

    # Own item; PRIVATE: only a co-member of a live PRIVATE group.
    assert await matched(w.owner, "Narty") == set()
    assert await matched(w.member, "Sanki") == {w.private}
    assert await matched(w.public_member, "Sanki") == set()
    assert await matched(w.rsvp_only, "Sanki") == set()
    assert await matched(w.stranger, "Sanki") == set()
    # Reserved, and under a pending swap proposal (both visible to the member).
    assert await matched(w.member, "Rowerek") == set()
    assert await matched(w.member, "Łyżwy") == set()
    # Only ACTIVE, unexpired wants.
    assert await matched(w.member, "Narty", status=WantStatus.WITHDRAWN) == set()
    assert await matched(w.member, "Narty", expires_in=timedelta(seconds=-1)) == set()
    assert await matched(w.member, "Narty") == {w.public}
    # A soft-deleted pickup place.
    place_id = select(InventoryItem.location_id).where(InventoryItem.id == w.public)
    await db_session.execute(
        update(Location)
        .where(Location.id == place_id.scalar_subquery())
        .values(deleted_at=datetime.utcnow())
    )
    await db_session.commit()
    assert await matched(w.stranger, "Narty") == set()


async def test_matchWant_moreThanTwentyCandidates_bestByScoreThenNewest_nextRunAddsTheRest(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _Owner.create(client, "wm.top.o@example.com")
    seeker = await _seeker(client, "wm.top.s@example.com")
    exact = await _product(client, owner.token, "Rowerek biegowy")
    reordered = await _product(client, owner.token, "Biegowy czerwony rowerek")

    async def lists(product_id: str, count: int) -> list[uuid.UUID]:
        return [await owner.lists_product(product_id) for _ in range(count)]

    (oldest_exact,) = await lists(exact, 1)
    newer_exact = await lists(exact, MATCH_TOP_N)
    newest_reordered = await lists(reordered, 4)
    assert await _similarity(db_session, "rowerek biegowy", "Biegowy czerwony rowerek") < 1.0
    want_id = await _want(db_session, seeker, "rowerek biegowy")

    first = await _forward(db_session, want_id)
    second = await _forward(db_session, want_id)
    third = await _forward(db_session, want_id)
    rows = (
        await db_session.execute(
            select(WantMatch.id, WantMatch.source, WantMatch.seen_at, WantMatch.score).where(
                WantMatch.want_id == want_id
            )
        )
    ).all()

    assert first == set(newer_exact)
    assert second == {oldest_exact, *newest_reordered}
    assert third == set()
    assert len({row.id for row in rows}) == MATCH_TOP_N + 5
    assert {row.source for row in rows} == {WantMatchSource.FORWARD}
    assert all(row.seen_at is not None for row in rows)
    assert sorted(row.score for row in rows)[4:] == [1.0] * (MATCH_TOP_N + 1)


async def test_matchNewListings_window_samePairsAsForwardInOneStatement(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    before_listing = datetime.utcnow()
    owner = await _Owner.create(client, "wm.rev.o@example.com")
    first_seeker = await _seeker(client, "wm.rev.s1@example.com")
    second_seeker = await _seeker(client, "wm.rev.s2@example.com")
    categories = (await client.get("/api/categories", headers=_auth(owner.token))).json()
    parent_of = {str(row["id"]): row["parent_id"] and str(row["parent_id"]) for row in categories}
    leaves = await leaf_category_ids(client, _auth(owner.token), n=100)
    leaf = next(category_id for category_id in leaves if parent_of[category_id])
    other_leaf = next(category_id for category_id in leaves if category_id != leaf)
    board = await owner.lists("Deskorolka", category_id=leaf)
    first_want = await _want(db_session, first_seeker, "deskorolka")
    listed = datetime.utcnow()
    hour = timedelta(hours=1)

    async def reverse(listed_after: datetime, now: datetime) -> tuple[set[Any], int]:
        with count_queries(engine) as statements:
            pairs = await matcher.match_new_listings(db_session, listed_after=listed_after, now=now)
        await db_session.commit()
        return set(pairs), len(statements)

    too_early, _ = await reverse(before_listing - hour, before_listing)
    too_late, _ = await reverse(listed, listed + hour)
    one_want, one_want_statements = await reverse(before_listing, listed)
    unseen = (await db_session.execute(select(WantMatch.source, WantMatch.seen_at))).all()
    await db_session.execute(delete(WantMatch))
    helmet = await owner.lists("Kask rowerowy", category_id=leaf)
    long_board = await owner.lists("Deskorolka długa", category_id=leaf)

    async def narrowed(**fields: Any) -> uuid.UUID:
        return await _want(db_session, second_seeker, "deskorolka", **fields)

    wants = [
        first_want,
        await _want(db_session, second_seeker, "deskorolka"),
        await _want(db_session, second_seeker, "kask"),
        await _want(db_session, second_seeker, "kask", status=WantStatus.WITHDRAWN),
        await narrowed(category_id=uuid.UUID(parent_of[leaf])),
        await narrowed(locality_id=ANDRYCHOW, radius_km=10),
        await narrowed(offer_mode="GIFT"),
        await narrowed(category_id=uuid.UUID(other_leaf)),
        await narrowed(locality_id=LODZ),
        await narrowed(offer_mode="SWAP"),
    ]
    several_wants, several_wants_statements = await reverse(before_listing, datetime.utcnow())
    await db_session.execute(delete(WantMatch))
    forward = {
        (want_id, item_id) for want_id in wants for item_id in await _forward(db_session, want_id)
    }

    assert too_early == set() and too_late == set()
    assert one_want == {(first_want, board)}
    assert unseen == [(WantMatchSource.SCAN, None)]
    assert several_wants == {
        (wants[0], board),
        (wants[0], long_board),
        (wants[1], board),
        (wants[1], long_board),
        (wants[2], helmet),
        *((want_id, item_id) for want_id in wants[4:7] for item_id in (board, long_board)),
    }
    assert forward == several_wants
    assert one_want_statements == several_wants_statements == 1


def test_matchStatement_bothDirections_noCartesianProductWarning() -> None:
    """Compiled with the linting an engine applies on first execution; the
    compiled cache would hide a warning from a test that only executes."""
    now = datetime.utcnow()
    statements = [
        matcher.match_statement(
            now=now, source=WantMatchSource.FORWARD, seen_at=now, want_id=uuid.uuid4()
        ),
        matcher.match_statement(
            now=now, source=WantMatchSource.SCAN, seen_at=None, listed_after=now
        ),
    ]

    with warnings.catch_warnings():
        warnings.simplefilter("error", SAWarning)
        for statement in statements:
            statement.compile(
                dialect=asyncpg.dialect(),
                linting=compiler.COLLECT_CARTESIAN_PRODUCTS | compiler.WARN_LINTING,
            )


async def test_matchNewListings_ownHiddenOrNotTakeableItemAndInactiveWant_noPair(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    before_listing = datetime.utcnow()
    w = await _world(client, db_session, "wm-rv")

    async def want(seeker: uuid.UUID, name: str, **fields: Any) -> uuid.UUID:
        return await _want(db_session, seeker, f"{name} wm-rv", **fields)

    async def reverse() -> set[Any]:
        pairs = await matcher.match_new_listings(
            db_session, listed_after=before_listing, now=datetime.utcnow()
        )
        await db_session.commit()
        return set(pairs)

    # Own item; PRIVATE: only a co-member of a live PRIVATE group.
    await want(w.owner, "Narty")
    member_private = await want(w.member, "Sanki")
    for outsider in (w.public_member, w.rsvp_only, w.stranger):
        await want(outsider, "Sanki")
    # Reserved, and under a pending swap proposal (both visible to the member).
    await want(w.member, "Rowerek")
    await want(w.member, "Łyżwy")
    # Only ACTIVE, unexpired wants.
    await want(w.member, "Narty", status=WantStatus.WITHDRAWN)
    await want(w.member, "Narty", expires_in=timedelta(seconds=-1))
    stranger_public = await want(w.stranger, "Narty")

    assert await reverse() == {(member_private, w.private), (stranger_public, w.public)}

    # A soft-deleted pickup place.
    await db_session.execute(delete(WantMatch))
    place_id = select(InventoryItem.location_id).where(InventoryItem.id == w.public)
    await db_session.execute(
        update(Location)
        .where(Location.id == place_id.scalar_subquery())
        .values(deleted_at=datetime.utcnow())
    )
    await db_session.commit()

    assert await reverse() == {(member_private, w.private)}
