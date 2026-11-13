"""The spec's search acceptance criteria end to end through `GET
/api/public/search`: what a guest and a "Moje grupy" viewer see, the
search halves of U1–U3, listed-only (R12), `other_mode_count` against the
switched mode's `total`, past meetings never shown, the meetings date range
(groups by their next term in it), the category subtree and condition
filters, the reservation date of an event reservation (logged-in viewers
only), a constant statement count for 1 vs 5 rows of each kind, and the
group description's moderation outage (503, nothing written)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core import clock
from app.events.models import Event
from app.groups.models import Membership, Term
from app.moderation import text_guard
from tests.conftest import count_queries, leaf_category_ids
from tests.test_event_item_reservations import _attendees, _listed_items
from tests.test_event_item_reservations import _take as _take_at_event
from tests.test_membership_characterisation import _add_member, _set_group
from tests.test_organizer_page import _circle, _event, _in_days, _organization_slug, _term
from tests.test_personal_pickup import _reservations, _take
from tests.test_search_api import _search
from tests.test_search_ranking import _category, _listed_in
from tests.test_term_item_listings import _auth, _register, _register_personal_item
from tests.test_text_moderation_org_group_term import (
    UNAVAILABLE_MESSAGE,
    FakeTextClassifier,
    classifier,  # noqa: F401
)
from tests.test_visible_to import _preference


def _ids(body: dict[str, Any]) -> set[str]:
    return {result["id"] for result in body["items"]}


def _kinds(body: dict[str, Any]) -> set[str]:
    return {result["kind"] for result in body["items"]}


async def test_search_guest_onlyPublicItemsMeetingsAndOrganizations_scopeMineForcedToAll(
    client: AsyncClient,
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sa-guest.o@example.com")
    slug = await _organization_slug(client, organizer, "Fundacja Wiklinowo")
    public_group = await _circle(client, organizer, "Wiklinowo Otwarte")
    private_group = await _circle(client, organizer, "Wiklinowo Zamknięte", "PRIVATE")
    public_term = await _term(client, organizer, public_group, _in_days(3))
    await _term(client, organizer, private_group, _in_days(4))
    event_id = await _event(client, organizer, "Wiklinowo festyn", 5)
    public_item, private_item = await _listed_items(
        client, organizer, ("Wiklinowo kosz", "GIFT"), ("Wiklinowo krzesło", "GIFT")
    )
    await _preference(client, organizer, private_item, "PRIVATE")
    (leaf,) = await leaf_category_ids(client, _auth(organizer))

    for scope in ("mine", "all"):
        items = await _search(client, q="wiklinowo", mode="items", scope=scope)
        meetings = await _search(client, q="wiklinowo", mode="events", scope=scope)

        assert _ids(items) == {str(public_item)}
        (organization,) = [r for r in meetings["items"] if r["kind"] == "organization"]
        assert organization["href"] == f"/{slug}"
        assert _ids(meetings) - {organization["id"]} == {
            str(public_term),
            event_id,
            str(public_group),
        }
    by_category = await _search(client, q="wiklinowo", mode="items", category=leaf)
    assert _ids(by_category) == {str(public_item)}


async def test_search_loggedInMine_nothingOutsideOwnGroupsExceptCounterpartyItems(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sa-mine.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "sa-mine.v@example.com")
    stranger, _ = await _register(client, "GUEST", "sa-mine.s@example.com")
    await _organization_slug(client, organizer, "Fundacja Pelikan")
    own_group = await _circle(client, organizer, "Pelikan Klub")
    other_group = await _circle(client, organizer, "Pelikan Drugi")
    own_term = await _term(client, organizer, own_group, _in_days(3))
    await _term(client, organizer, other_group, _in_days(4))
    await _add_member(db_session, own_group, viewer_party)
    await _event(client, stranger, "Pelikan festyn", 5)
    (co_member_item,) = await _listed_items(client, organizer, ("Pelikan rower", "GIFT"))
    stranger_item, taken_item = await _listed_items(
        client, stranger, ("Pelikan kask", "GIFT"), ("Pelikan hulajnoga", "GIFT")
    )
    (own_item,) = await _listed_items(client, viewer, ("Pelikan sanki", "GIFT"))
    status, body = await _take(client, taken_item, viewer)
    assert status == 200, body

    mine_items = await _search(client, viewer, q="pelikan", mode="items", scope="mine")
    mine_meetings = await _search(client, viewer, q="pelikan", mode="events", scope="mine")
    all_items = await _search(client, viewer, q="pelikan", mode="items", scope="all")
    all_meetings = await _search(client, viewer, q="pelikan", mode="events", scope="all")

    # The counterparty item shows in both scopes; own items never.
    assert _ids(mine_items) == {str(co_member_item), str(taken_item)}
    assert _ids(all_items) == {str(co_member_item), str(taken_item), str(stranger_item)}
    assert str(own_item) not in _ids(all_items)
    assert _ids(mine_meetings) == {str(own_term), str(own_group)}
    assert _kinds(all_meetings) == {"term", "event", "group", "organization"}
    assert str(other_group) in _ids(all_meetings)


async def test_search_U1_onlySharedGroupDeleted_privateGonePublicOnlyEverywhereTermsGone(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "sa-u1.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "sa-u1.v@example.com")
    circle = await _circle(client, owner, "Bocianowo Krąg", "PRIVATE")
    term = await _term(client, owner, circle, _in_days(3))
    await _add_member(db_session, circle, viewer_party)
    private, public = await _listed_items(
        client, owner, ("Bocianowo sanki", "GIFT"), ("Bocianowo narty", "GIFT")
    )
    await _preference(client, owner, private, "PRIVATE")
    before = await _search(client, viewer, q="bocianowo", mode="items", scope="mine")
    assert _ids(before) == {str(private), str(public)}

    await _set_group(db_session, circle, deleted_at=datetime.utcnow())

    mine = await _search(client, viewer, q="bocianowo", mode="items", scope="mine")
    everywhere = await _search(client, viewer, q="bocianowo", mode="items", scope="all")
    assert _ids(mine) == set()
    assert _ids(everywhere) == {str(public)}
    for scope in ("mine", "all"):
        meetings = await _search(client, viewer, q="bocianowo", mode="events", scope=scope)
        assert str(term) not in _ids(meetings)
        assert str(circle) not in _ids(meetings)


async def test_search_U2_sharedGroupTurnedPublic_privateItemGoneUntilAnotherPrivateGroup(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "sa-u2.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "sa-u2.v@example.com")
    first = await _circle(client, owner, "Pierwszy sa-u2", "PRIVATE")
    second = await _circle(client, owner, "Drugi sa-u2", "PRIVATE")
    await _add_member(db_session, first, viewer_party)
    (item,) = await _listed_items(client, owner, ("Żurawinka sanki", "GIFT"))
    await _preference(client, owner, item, "PRIVATE")

    async def found() -> dict[str, bool]:
        return {
            scope: str(item)
            in _ids(await _search(client, viewer, q="żurawinka", mode="items", scope=scope))
            for scope in ("mine", "all")
        }

    assert await found() == {"mine": True, "all": True}
    patched = await client.patch(
        f"/api/groups/{first}",
        json={"name": "Pierwszy sa-u2", "visibility": "PUBLIC"},
        headers=_auth(owner),
    )
    assert patched.status_code == 200, patched.text
    assert await found() == {"mine": False, "all": False}

    await _add_member(db_session, second, viewer_party)
    assert await found() == {"mine": True, "all": True}


async def test_search_U3_counterpartyAfterLeaving_foundAndPageUntilCancelled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "sa-u3.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "sa-u3.v@example.com")
    circle = await _circle(client, owner, "Krąg sa-u3", "PRIVATE")
    await _add_member(db_session, circle, viewer_party)
    (item,) = await _listed_items(client, owner, ("Czaplinek sanki", "GIFT"))
    await _preference(client, owner, item, "PRIVATE")
    status, body = await _take(client, item, viewer)
    assert status == 200, body
    await db_session.execute(
        update(Membership)
        .where(Membership.to_group_id == circle, Membership.valid_to.is_(None))
        .values(valid_to=_in_days(0).date())
    )
    await db_session.commit()
    page = f"/api/public/items/{item}/details"

    for scope in ("mine", "all"):
        found = await _search(client, viewer, q="czaplinek", mode="items", scope=scope)
        assert _ids(found) == {str(item)}
        assert found["items"][0]["meta"]["reserved"] is True
    assert (await client.get(page, headers=_auth(viewer))).status_code == 200

    (reservation,) = await _reservations(db_session, item)
    cancelled = await client.post(
        f"/api/reservations/{reservation.id}/cancel-transaction", headers=_auth(owner)
    )
    assert cancelled.status_code == 200, cancelled.text

    for scope in ("mine", "all"):
        gone = await _search(client, viewer, q="czaplinek", mode="items", scope=scope)
        assert gone["total"] == 0
    assert (await client.get(page, headers=_auth(viewer))).status_code == 404


async def test_search_R12_draftAndGivenAwayItems_absent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "GUEST", "sa-r12.o@example.com")
    taker, _ = await _register(client, "GUEST", "sa-r12.t@example.com")
    viewer, _ = await _register(client, "GUEST", "sa-r12.v@example.com")
    given, listed = await _listed_items(
        client, owner, ("Gołębnik rower", "GIFT"), ("Gołębnik kask", "GIFT")
    )
    await _register_personal_item(client, taker, "Gołębnik sanki")  # a DRAFT
    status, body = await _take(client, given, taker)
    assert status == 200, body
    (reservation,) = await _reservations(db_session, given)
    confirmed = await client.post(
        f"/api/reservations/{reservation.id}/confirm-transaction", headers=_auth(taker)
    )
    assert confirmed.status_code == 200, confirmed.text

    for token in (None, viewer):
        body = await _search(client, token, q="gołębnik", mode="items", scope="all")
        assert _ids(body) == {str(listed)}


async def test_search_otherModeCount_equalsTotalAfterSwitchingBothWays(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sa-other.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "sa-other.v@example.com")
    stranger, _ = await _register(client, "GUEST", "sa-other.s@example.com")
    group_id = await _circle(client, organizer, "Dudkowo Klub")
    await _term(client, organizer, group_id, _in_days(2))
    await _add_member(db_session, group_id, viewer_party)
    await _event(client, stranger, "Dudkowo festyn", 3)
    await _listed_items(client, organizer, ("Dudkowo rower", "GIFT"), ("Dudkowo lalka", "SWAP"))
    await _listed_items(client, stranger, ("Dudkowo kask", "GIFT"))
    today = _in_days(0).date().isoformat()

    for token in (None, viewer):
        for scope in ("mine", "all"):
            items = await _search(client, token, q="dudkowo", mode="items", scope=scope)
            meetings = await _search(client, token, q="dudkowo", mode="events", scope=scope)
            filtered_items = await _search(
                client, token, q="dudkowo", mode="items", scope=scope, offer_type="SWAP"
            )
            filtered_meetings = await _search(
                client, token, q="dudkowo", mode="events", scope=scope, date_from=today
            )

            assert items["total"] > 0 and meetings["total"] > 0
            assert items["other_mode_count"] == meetings["total"]
            assert meetings["other_mode_count"] == items["total"]
            # Filters belong to one mode: the counter ignores them.
            assert filtered_items["total"] < items["total"]
            assert filtered_items["other_mode_count"] == meetings["total"]
            assert filtered_meetings["other_mode_count"] == items["total"]


async def test_search_pastTermsAndEvents_neverShown(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sa-past.o@example.com")
    await _organization_slug(client, organizer, "Fundacja Sikorkowo")
    group_id = await _circle(client, organizer, "Sikorkowo Klub")
    past_term = await _term(client, organizer, group_id, _in_days(2))
    upcoming_term = await _term(client, organizer, group_id, _in_days(6))
    running_event = await _event(client, organizer, "Sikorkowo festyn", 2)
    upcoming_event = await _event(client, organizer, "Sikorkowo piknik", 7)
    now = clock.local_now()
    await db_session.execute(
        update(Term).where(Term.id == past_term).values(occurs_on=now - timedelta(days=1))
    )
    await db_session.execute(
        update(Event)
        .where(Event.id == uuid.UUID(running_event))
        .values(starts_at=now - timedelta(hours=1))
    )
    await db_session.commit()
    last_week = (now - timedelta(days=7)).date().isoformat()

    for params in ({}, {"date_from": last_week}):
        body = await _search(client, q="sikorkowo", mode="events", scope="all", **params)

        terms = {r["id"] for r in body["items"] if r["kind"] == "term"}
        events = {r["id"] for r in body["items"] if r["kind"] == "event"}
        assert terms == {str(upcoming_term)}
        assert events == {upcoming_event}


async def _meetings_and_items(client: AsyncClient, word: str, n: int) -> None:
    """`n` org-run and `n` person-run groups with one term each, `n` events
    of each kind of author, `n` organizations and `n` listed items of `n`
    organization owners, all named with `word`."""
    for index in range(n):
        organizer, _ = await _register(client, "ORGANIZER", f"sa-count.{word}.o{index}@example.com")
        person, _ = await _register(client, "ORGANIZER", f"sa-count.{word}.p{index}@example.com")
        await _organization_slug(client, organizer, f"Fundacja {word} {index}")
        for token, name in ((organizer, "Klub"), (person, "Krąg")):
            group_id = await _circle(client, token, f"{word} {name} {index}")
            await _term(client, token, group_id, _in_days(index + 1))
            await _event(client, token, f"{word} piknik {name} {index}", index + 2)
        await _listed_items(client, organizer, (f"{word} rower {index}", "GIFT"))


async def test_search_statementCount_constantForOneVsFiveRowsAtMostEight(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    viewer, _ = await _register(client, "GUEST", "sa-count.v@example.com")
    (leaf,) = await leaf_category_ids(client, _auth(viewer))
    counts: dict[str, list[int]] = {"items": [], "events": []}

    for word, n in (("Brzdąkacz", 1), ("Gwizdołek", 5)):
        await _meetings_and_items(client, word, n)
        for mode in ("items", "events"):
            params: dict[str, Any] = {"category": leaf} if mode == "items" else {}
            with count_queries(engine) as statements:
                body = await _search(client, viewer, q=word, mode=mode, scope="all", **params)
            assert body["total"] == (n if mode == "items" else 7 * n)
            counts[mode].append(len(statements))

    for mode, (one, five) in counts.items():
        assert one == five, (mode, counts)
        assert five <= 8, (mode, counts)


async def test_search_meetingsDateRange_inclusiveWarsawDays_termsAndEventsOnly(
    client: AsyncClient,
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sa-dates.o@example.com")
    group_id = await _circle(client, organizer, "Szczygłowo Klub")
    term_day = _in_days(3)
    term = await _term(client, organizer, group_id, term_day)
    event = await _event(client, organizer, "Szczygłowo festyn", 5)
    day = term_day.date()

    async def found(**dates: str) -> set[str]:
        body = await _search(client, q="szczygłowo", mode="events", scope="all", **dates)
        return {r["id"] for r in body["items"] if r["kind"] in ("term", "event")}

    assert await found() == {str(term), event}
    assert await found(date_from=day.isoformat(), date_to=day.isoformat()) == {str(term)}
    assert await found(date_to=(day - timedelta(days=1)).isoformat()) == set()
    assert await found(date_from=(day + timedelta(days=1)).isoformat()) == {event}
    assert await found(date_from=(day + timedelta(days=3)).isoformat()) == set()


async def test_search_meetingsDateRange_narrowsGroupsToNextTermInWindow(
    client: AsyncClient,
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sa-gdates.o@example.com")
    person, _ = await _register(client, "ORGANIZER", "sa-gdates.p@example.com")
    await _organization_slug(client, organizer, "Fundacja Czaplowo")
    org_group = await _circle(client, organizer, "Czaplowo Klub")
    person_group = await _circle(client, person, "Czaplowo Krąg")
    term_day = _in_days(3)
    person_term = await _term(client, person, person_group, term_day)
    day = term_day.date()

    async def groups(**dates: str) -> dict[str, Any]:
        body = await _search(client, q="czaplowo", mode="events", scope="all", **dates)
        assert body["total"] == len(body["items"])
        return {r["id"]: r for r in body["items"] if r["kind"] == "group"}

    # Without a window the org-run group links to its terms page, no term needed.
    assert set(await groups()) == {str(org_group), str(person_group)}
    in_window = await groups(date_from=day.isoformat(), date_to=day.isoformat())
    assert set(in_window) == {str(person_group)}
    assert in_window[str(person_group)]["href"].endswith(
        f"/group/{person_group}/term/{person_term}"
    )
    assert await groups(date_to=(day - timedelta(days=1)).isoformat()) == {}
    assert await groups(date_from=(day + timedelta(days=1)).isoformat()) == {}


async def test_search_qOver100Characters_returns400(client: AsyncClient) -> None:
    accepted = await client.get("/api/public/search", params={"q": "ż" * 100})
    rejected = await client.get("/api/public/search", params={"q": "ż" * 101})

    assert accepted.status_code == 200, accepted.text
    assert rejected.status_code == 400, rejected.text


async def test_search_categoryFilter_parentMatchesDescendants_conditionFilters(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner, _ = await _register(client, "GUEST", "sa-subtree.o@example.com")
    root = await _category(db_session, "Kormoranowo")
    leaf = await _category(db_session, "Kormoranowo sanki", root)
    inner = await _category(db_session, "Kormoranowo zima", root)
    deep_leaf = await _category(db_session, "Kormoranowo narty", inner)
    await db_session.commit()
    on_leaf, on_deep_leaf = await _listed_in(
        client, owner, ("Kormoranek sanki", leaf), ("Kormoranek narty", deep_leaf)
    )

    async def found(**filters: str) -> set[str]:
        return _ids(await _search(client, q="kormoranek", mode="items", **filters))

    assert await found(category=str(root)) == {str(on_leaf), str(on_deep_leaf)}
    assert await found(category=str(inner)) == {str(on_deep_leaf)}
    # `_listed_in` lists every item in condition GOOD.
    assert await found(condition="GOOD") == {str(on_leaf), str(on_deep_leaf)}
    assert await found(condition="NEW") == set()


async def test_search_eventReservation_reservedUntilIsEventStartOnlyForLoggedIn(
    client: AsyncClient,
) -> None:
    event_id, starts_at, (owner, taker) = await _attendees(client, "sa-until", "owner", "taker")
    stranger, _ = await _register(client, "GUEST", "sa-until.s@example.com")
    (item_id,) = await _listed_items(client, owner, ("Mewkowo rowerek", "GIFT"))
    status, body = await _take_at_event(client, event_id, item_id, taker)
    assert status == 200, body

    for token in (None, stranger, taker):
        found = await _search(client, token, q="mewkowo", mode="items", scope="all")
        (result,) = found["items"]
        assert result["id"] == str(item_id)
        assert result["meta"]["reserved"] is True
        if token is None:
            # A guest learns that the item is reserved, never for which day.
            assert result["meta"]["reserved_until"] is None
        else:
            assert datetime.fromisoformat(result["meta"]["reserved_until"]) == starts_at


async def test_updateGroup_descriptionModerationUnavailable_returns503AndKeepsDescription(
    client: AsyncClient,
    classifier: FakeTextClassifier,  # noqa: F811
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "sa-mod503.o@example.com")
    created = await client.post(
        "/api/groups/mine/new",
        json={"name": "Krąg Czajkowo", "description": "Spotykamy się w parku."},
        headers=_auth(organizer),
    )
    assert created.status_code == 201, created.text
    url = f"/api/groups/{created.json()['id']}"
    text_guard.set_classifier(FakeTextClassifier(fail=True))

    # The unchanged name is not scored, so the outage comes from the description.
    response = await client.patch(
        url,
        json={"name": "Krąg Czajkowo", "description": "Spotykamy się w świetlicy."},
        headers=_auth(organizer),
    )

    assert response.status_code == 503, response.text
    assert response.json()["message"] == UNAVAILABLE_MESSAGE
    kept = await client.get(url, headers=_auth(organizer))
    assert kept.json()["description"] == "Spotykamy się w parku."
