"""`GET /api/public/search` near a locality (`locality`, `radius`): items by
their place's locality, meetings by the exact point of the address or else
the locality's point, the validation (400), and the public locality reads
(`/api/public/localities`) the filter is picked with."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import count_queries
from tests.test_organizer_page import _circle, _in_days, _organization_slug
from tests.test_search_api import _search
from tests.test_term_item_listings import _auth, _register, _resolve_product

# Distances from Kęty: Andrychów 8.8 km, Bielsko-Biała 14.4 km, Łódź 209 km.
KETY = "0924365"
ANDRYCHOW = "0924023"
BIELSKO = "0923584"
LODZ = "0957650"


async def _place(client: AsyncClient, token: str, locality_id: str, **address: Any) -> str:
    response = await client.post(
        "/api/locations", json={"locality_id": locality_id, **address}, headers=_auth(token)
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _inventory(client: AsyncClient, token: str) -> str:
    inventory = await client.post(
        "/api/inventories",
        json={"inventory_type": "PERSONAL", "location": None},
        headers=_auth(token),
    )
    assert inventory.status_code == 201, inventory.text
    return str(inventory.json()["id"])


async def _listed_item(
    client: AsyncClient, token: str, inventory_id: str, name: str, locality_id: str
) -> str:
    item = await client.post(
        "/api/inventory-items",
        json={
            "inventory_id": inventory_id,
            "product_id": await _resolve_product(client, token, name),
            "condition": "GOOD",
            "location_id": await _place(client, token, locality_id),
        },
        headers=_auth(token),
    )
    assert item.status_code == 201, item.text
    item_id = str(item.json()["id"])
    preference = await client.put(
        f"/api/item-listing-preferences/{item_id}", json={"mode": "GIFT"}, headers=_auth(token)
    )
    assert preference.status_code == 200, preference.text
    return item_id


async def _term_at(client: AsyncClient, token: str, group_id: uuid.UUID, place_id: str) -> str:
    term = await client.post(
        "/api/terms",
        json={
            "location_id": place_id,
            "group_id": str(group_id),
            "occurs_on": _in_days(3).isoformat(),
        },
        headers=_auth(token),
    )
    assert term.status_code == 201, term.text
    return str(term.json()["id"])


async def _event_at(client: AsyncClient, token: str, name: str, place_id: str) -> str:
    event = await client.post(
        "/api/events",
        json={
            "location_id": place_id,
            "name": name,
            "starts_at": _in_days(5).replace(second=0).isoformat(),
        },
        headers=_auth(token),
    )
    assert event.status_code == 201, event.text
    return str(event.json()["id"])


def _ids(body: dict[str, Any]) -> set[str]:
    return {str(result["id"]) for result in body["items"]}


async def test_search_itemsNearLocality_localityOnlyThenWithinRadius(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    owner, _ = await _register(client, "GUEST", "s.loc.items@example.com")
    inventory = await _inventory(client, owner)
    in_kety = await _listed_item(client, owner, inventory, "Hulajnoga lokalna", KETY)
    in_andrychow = await _listed_item(client, owner, inventory, "Hulajnoga sąsiednia", ANDRYCHOW)
    await _listed_item(client, owner, inventory, "Hulajnoga daleka", LODZ)

    with count_queries(engine) as plain:
        everywhere = await _search(client, q="hulajnoga")
    with count_queries(engine) as located:
        exact = await _search(client, q="hulajnoga", locality=KETY)
    near = await _search(client, q="hulajnoga", locality=KETY, radius=10)
    tight = await _search(client, q="hulajnoga", locality=KETY, radius=5)

    assert everywhere["total"] == 3
    assert _ids(exact) == {in_kety} and exact["total"] == 1
    assert _ids(near) == {in_kety, in_andrychow} and near["total"] == 2
    assert _ids(tight) == {in_kety}
    # The origin locality is one more statement, whatever the result size.
    assert len(located) == len(plain) + 1


async def test_search_meetingsNearLocality_exactPointBeatsLocalityAndOnlyPlacedKinds(
    client: AsyncClient,
) -> None:
    owner, _ = await _register(client, "ORGANIZER", "s.loc.meet@example.com")
    await _organization_slug(client, owner, "Fundacja Okolicznik")
    group_id = await _circle(client, owner, "Okolicznik dzieci")
    term_id = await _term_at(client, owner, group_id, await _place(client, owner, KETY))
    in_andrychow = await _event_at(
        client, owner, "Okolicznik piknik", await _place(client, owner, ANDRYCHOW)
    )
    # Bielsko-Biała is 14 km away, this address about 27 km.
    far_address = await _place(
        client,
        owner,
        BIELSKO,
        formatted_address="Górska 1",
        source="GOOGLE",
        google_place_id="ChIJ-okolicznik",
        lat=49.75,
        lng=18.9,
    )
    far_event = await _event_at(client, owner, "Okolicznik wycieczka", far_address)
    await _listed_item(client, owner, await _inventory(client, owner), "Okolicznik plecak", KETY)

    everywhere = await _search(client, q="okolicznik", mode="events")
    near = await _search(client, q="okolicznik", mode="events", locality=KETY, radius=20)
    wide = await _search(client, q="okolicznik", mode="events", locality=KETY, radius=30)
    exact = await _search(client, q="okolicznik", mode="events", locality=KETY)
    browse = await _search(client, mode="events", locality=KETY, radius=20)

    assert {result["kind"] for result in everywhere["items"]} == {
        "term",
        "event",
        "group",
        "organization",
    }
    assert _ids(near) == {term_id, in_andrychow}
    assert {result["kind"] for result in near["items"]} == {"term", "event"}
    assert _ids(wide) == {term_id, in_andrychow, far_event}
    assert _ids(exact) == {term_id}
    assert {term_id, in_andrychow} <= _ids(browse) and far_event not in _ids(browse)
    # The other mode is counted around the same locality.
    assert near["other_mode_count"] == 1
    assert (await _search(client, q="okolicznik", locality=LODZ, radius=20))["total"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"radius": 10},
        {"locality": "123"},
        {"locality": "0000000"},
        {"locality": KETY, "radius": -1},
        {"locality": KETY, "radius": 101},
    ],
)
async def test_search_invalidLocation_returns400(
    client: AsyncClient, params: dict[str, Any]
) -> None:
    response = await client.get("/api/public/search", params={"q": "rower", **params})

    assert response.status_code == 400, response.text


async def test_publicLocalities_anonymous_searchAndGetById(client: AsyncClient) -> None:
    found = await client.get("/api/public/localities", params={"q": "Kęty", "limit": 3})
    one = await client.get(f"/api/public/localities/{KETY}")
    unknown = await client.get("/api/public/localities/0000000")
    private = await client.get("/api/localities", params={"q": "Kęty"})

    assert found.status_code == 200, found.text
    assert set(found.json()) == {"results", "total"}
    assert found.json()["results"][0]["id"] == KETY
    assert one.status_code == 200, one.text
    assert one.json() == {
        "id": KETY,
        "name": "Kęty",
        "kind": "TOWN",
        "gmina": "Kęty",
        "powiat": "oświęcimski",
        "voivodeship": "małopolskie",
    }
    assert unknown.status_code == 404
    assert private.status_code == 401


async def test_publicLocalities_major_citiesWithCountyRightsByVoivodeship(
    client: AsyncClient,
) -> None:
    response = await client.get("/api/public/localities/major")

    assert response.status_code == 200, response.text
    towns = response.json()
    assert len(towns) == 66
    assert set(towns[0]) == {"id", "name", "kind", "gmina", "powiat", "voivodeship"}
    assert {town["kind"] for town in towns} == {"TOWN"}
    assert len({town["voivodeship"] for town in towns}) == 16
    assert [town["name"] for town in towns if town["voivodeship"] == "małopolskie"] == [
        "Kraków",
        "Nowy Sącz",
        "Tarnów",
    ]
    assert KETY not in {town["id"] for town in towns}
