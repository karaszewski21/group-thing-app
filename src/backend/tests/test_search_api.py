"""`GET /api/public/search`: the response shape of every result kind, the
parameter validation (400), the cache headers, the statement-timeout 503, the
"Moje grupy" / "Wszędzie" split of items and the constant statement count."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.search.application import search as search_service
from tests.conftest import count_queries
from tests.test_event_item_reservations import _listed_items
from tests.test_membership_characterisation import _add_member
from tests.test_organizer_page import _circle, _event, _in_days, _organization_slug, _term
from tests.test_term_item_listings import _auth, _register

PAGE_KEYS = {"items", "total", "page", "size", "other_mode_count"}
RESULT_KEYS = {"kind", "id", "title", "subtitle", "href", "meta"}
META_KEYS = {
    "product": {"mode", "condition", "thumb_url", "reserved", "reserved_until"},
    "term": {"starts_at", "place", "in_my_groups"},
    "event": {"starts_at", "place"},
    "group": {"description", "next_starts_at", "in_my_groups"},
    "organization": {"slug"},
}


async def _search(client: AsyncClient, token: str | None = None, **params: Any) -> dict[str, Any]:
    response = await client.get(
        "/api/public/search", params=params, headers=_auth(token) if token else {}
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert set(body) == PAGE_KEYS
    for result in body["items"]:
        assert set(result) == RESULT_KEYS
        assert set(result["meta"]) == META_KEYS[result["kind"]]
    return body


async def test_search_itemsAsGuest_productShapeAndOtherModeCount(client: AsyncClient) -> None:
    owner, owner_party = await _register(client, "GUEST", "s.items.o@example.com")
    (item_id,) = await _listed_items(client, owner, ("Kwiatolik ogrodowy", "SWAP"))

    body = await _search(client, q="kwiatolik", mode="items")

    assert body["total"] == 1
    assert body["page"] == 1
    assert body["size"] == 20
    assert body["other_mode_count"] == 0
    (result,) = body["items"]
    assert result["kind"] == "product"
    assert result["id"] == str(item_id)
    assert result["title"] == "Kwiatolik ogrodowy"
    assert result["subtitle"] is None
    assert result["href"] == f"/{owner_party}/product/{item_id}"
    assert result["meta"] == {
        "mode": "SWAP",
        "condition": "GOOD",
        "thumb_url": None,
        "reserved": False,
        "reserved_until": None,
    }


async def test_search_meetingsAsGuest_eachKindShapeAndHref(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "s.meet.o@example.com")
    slug = await _organization_slug(client, owner, "Fundacja Zebrafon")
    group_id = await _circle(client, owner, "Zebrafon dzieci")
    term_on = _in_days(3)
    term_id = await _term(client, owner, group_id, term_on)
    event_id = await _event(client, owner, "Piknik Zebrafon", 5)

    with count_queries(engine) as statements:
        body = await _search(client, q="zebrafon", mode="events", scope="all")

    by_kind = {result["kind"]: result for result in body["items"]}
    assert set(by_kind) == {"term", "event", "group", "organization"}
    assert body["total"] == 4
    assert [result["kind"] for result in body["items"]][-1] == "organization"
    term = by_kind["term"]
    assert term["id"] == str(term_id)
    assert term["title"] == "Zebrafon dzieci"
    assert term["subtitle"] == "Fundacja Zebrafon"
    assert term["href"] == f"/{slug}/group/{group_id}/term/{term_id}"
    assert term["meta"]["in_my_groups"] is False
    assert term["meta"]["place"]
    event = by_kind["event"]
    assert event["href"] == f"/{slug}/event/{event_id}"
    assert event["subtitle"] == "Fundacja Zebrafon"
    group = by_kind["group"]
    assert group["href"] == f"/{slug}/group/{group_id}/terms"
    assert group["subtitle"] == "Fundacja Zebrafon"
    assert group["meta"]["next_starts_at"] is None
    assert by_kind["organization"]["href"] == f"/{slug}"
    assert by_kind["organization"]["meta"] == {"slug": slug}
    # Guest: no viewer lookup; rows, total, other-mode count, organizations,
    # display names and places.
    assert len(statements) <= 7


@pytest.mark.parametrize(
    "params",
    [
        {"q": "a"},
        {"q": "  ą "},
        {"q": "rower", "mode": "people"},
        {"q": "rower", "scope": "everywhere"},
        {"q": "rower", "mode": "events", "condition": "GOOD"},
        {"q": "rower", "mode": "events", "offer_type": "GIFT"},
        {"q": "rower", "mode": "events", "category": str(uuid.uuid4())},
        {"q": "rower", "mode": "items", "date_from": "2030-01-01"},
        {"q": "rower", "mode": "events", "date_from": "2030-01-05", "date_to": "2030-01-04"},
        {"q": "rower", "mode": "items", "category": str(uuid.uuid4())},
        {"q": "rower", "offer_type": "LEND"},
        {"q": "rower", "page": 0},
        {"q": "rower", "page": 51},
        {"q": "rower", "size": 101},
    ],
)
async def test_search_invalidParameter_returns400(
    client: AsyncClient, params: dict[str, Any]
) -> None:
    response = await client.get("/api/public/search", params=params)

    assert response.status_code == 400, response.text


async def test_search_cacheHeaders_differForAnonymousAndLoggedIn(client: AsyncClient) -> None:
    viewer, _ = await _register(client, "GUEST", "s.cache.v@example.com")

    anonymous = await client.get("/api/public/search", params={"q": "rower"})
    logged_in = await client.get("/api/public/search", params={"q": "rower"}, headers=_auth(viewer))

    assert anonymous.headers["cache-control"] == "public, max-age=0, s-maxage=60"
    assert logged_in.headers["cache-control"] == "private, no-store"
    assert anonymous.headers["vary"] == logged_in.headers["vary"] == "Authorization, Cookie"


class _PgError(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__("canceling statement")
        self.sqlstate = sqlstate


def _failing_read(sqlstate: str) -> Any:
    async def read(*args: Any, **kwargs: Any) -> Any:
        raise OperationalError("SELECT", {}, _PgError(sqlstate))

    return read


async def test_search_statementTimeout_returns503WithoutCacheHeaders(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    viewer, _ = await _register(client, "GUEST", "s.timeout.v@example.com")
    monkeypatch.setattr(search_service, "search_items", _failing_read("57014"))

    for headers in ({}, _auth(viewer)):
        response = await client.get("/api/public/search", params={"q": "rower"}, headers=headers)

        assert response.status_code == 503, response.text
        assert response.json()["message"] == (
            "Wyszukiwanie trwa zbyt długo. Spróbuj zawęzić zapytanie."
        )
        assert "cache-control" not in response.headers
        assert "vary" not in response.headers


async def test_search_otherDatabaseError_isNotMappedTo503(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(search_service, "search_items", _failing_read("40001"))

    with pytest.raises(OperationalError):
        await client.get("/api/public/search", params={"q": "rower"})


async def test_search_loggedInScopes_mineOnlyThroughGroupsOwnItemsNever(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    organizer, _ = await _register(client, "ORGANIZER", "s.scope.o@example.com")
    viewer, viewer_party = await _register(client, "GUEST", "s.scope.v@example.com")
    stranger, _ = await _register(client, "GUEST", "s.scope.s@example.com")
    group_id = await _circle(client, organizer, "Krąg Plumko")
    term_id = await _term(client, organizer, group_id, _in_days(2))
    await _add_member(db_session, group_id, viewer_party)
    (co_member_item,) = await _listed_items(client, organizer, ("Plumko rowerek", "GIFT"))
    (stranger_item,) = await _listed_items(client, stranger, ("Plumko kask", "GIFT"))
    await _listed_items(client, viewer, ("Plumko sanki", "GIFT"))
    await _event(client, stranger, "Plumko festyn", 4)

    mine = await _search(client, viewer, q="plumko", scope="mine")
    everywhere = await _search(client, viewer, q="plumko", scope="all")
    with count_queries(engine) as statements:
        mine_meetings = await _search(client, viewer, q="plumko", mode="events", scope="mine")

    assert [result["id"] for result in mine["items"]] == [str(co_member_item)]
    assert [result["id"] for result in everywhere["items"]] == [
        str(co_member_item),
        str(stranger_item),
    ]
    # Person-run group: linked to its nearest term. No events in "Moje grupy".
    assert {result["kind"] for result in mine_meetings["items"]} == {"term", "group"}
    group = next(result for result in mine_meetings["items"] if result["kind"] == "group")
    assert group["href"].endswith(f"/group/{group_id}/term/{term_id}")
    assert group["meta"]["next_starts_at"] is not None
    assert group["meta"]["in_my_groups"] is True
    assert mine["other_mode_count"] == mine_meetings["total"] == 2
    assert everywhere["other_mode_count"] == 3
    # Viewer, rows, total, other-mode count, display names, places.
    assert len(statements) <= 7
