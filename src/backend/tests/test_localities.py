"""Locality dictionary: `fold_polish`, the folding behind `localities.name_search`,
and the `GET /api/localities` search (name prefix or postal-code prefix)."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.locations.localities import fold_polish
from tests.conftest import count_queries


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Kęty", "kety"),
        ("Łódź", "lodz"),
        ("ŁÓDŹ", "lodz"),
        ("Zażółć gęślą jaźń", "zazolc gesla jazn"),
        ("Bielsko-Biała", "bielsko-biala"),
        ("  Nowa \t Wieś  Ełcka ", "nowa wies elcka"),
        ("", ""),
    ],
)
def test_foldPolish_polishName_foldsToAsciiLowercase(raw: str, expected: str) -> None:
    assert fold_polish(raw) == expected


def test_foldPolish_decomposedMarks_stripped() -> None:
    assert fold_polish("Kęty") == fold_polish("Kęty") == "kety"


# --- GET /api/localities -------------------------------------------------

KETY = "0924365"
LOCALITY_KEYS = {"id", "name", "kind", "gmina", "powiat", "voivodeship", "postal_code"}


async def _token(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _search(client: AsyncClient, headers: dict[str, str], **params: Any) -> dict[str, Any]:
    response = await client.get("/api/localities", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


async def test_searchLocalities_foldedName_returnsTownFirstThenExactMatches(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _token(client, "loc.search.name@example.com")

    kety = await _search(client, headers, q="  kety ")
    lodz = await _search(client, headers, q="łódź")
    bor = await _search(client, headers, q="BOR", limit=20)

    assert set(kety) == {"results", "total"}
    assert set(kety["results"][0]) == LOCALITY_KEYS
    assert kety["results"][0] == {
        "id": KETY,
        "name": "Kęty",
        "kind": "TOWN",
        "gmina": "Kęty",
        "powiat": "oświęcimski",
        "voivodeship": "małopolskie",
        "postal_code": None,
    }
    assert lodz["results"][0]["name"] == "Łódź"
    assert lodz["results"][0]["kind"] == "TOWN"
    assert [row["name"] for row in lodz["results"][1:4]] == ["Łódź"] * 3
    # Towns first ("Borek Wielkopolski", "Borne Sulinowo"), then the exact
    # "Bór" villages ahead of longer names such as "Bora".
    names = [(row["name"], row["kind"]) for row in bor["results"]]
    assert names[:2] == [("Borek Wielkopolski", "TOWN"), ("Borne Sulinowo", "TOWN")]
    assert {name for name, _ in names[2:7]} == {"Bór"}
    assert len(names) == 20
    assert bor["total"] > 20


@pytest.mark.parametrize("q", ["32-65", "32650"])
async def test_searchLocalities_postalPrefix_returnsDistinctLocalitiesWithSmallestCode(
    client: AsyncClient, db_session: AsyncSession, q: str
) -> None:
    headers = await _token(client, f"loc.search.postal.{q}@example.com")

    body = await _search(client, headers, q=q)

    ids = [row["id"] for row in body["results"]]
    assert len(ids) == len(set(ids)) == body["total"]
    assert body["results"][0]["id"] == KETY
    assert body["results"][0]["postal_code"] == "32-650"
    assert all(row["postal_code"].startswith("32-65") for row in body["results"])
    if q == "32650":
        assert all(row["postal_code"] == "32-650" for row in body["results"])


@pytest.mark.parametrize(
    ("params", "status_code"),
    [
        ({"q": "_ety"}, 200),
        ({"q": "%ty"}, 200),
        ({"q": "k"}, 200),
        ({"q": " k "}, 200),
        ({"q": "́́"}, 200),
        ({"q": "ḱ"}, 200),
        ({"q": "kety", "limit": 0}, 400),
        ({"q": "kety", "limit": 21}, 400),
    ],
)
async def test_searchLocalities_wildcardsShortQueryOrBadLimit_matchNothingOr400(
    client: AsyncClient, db_session: AsyncSession, params: dict[str, Any], status_code: int
) -> None:
    headers = await _token(client, "loc.search.literal@example.com")

    response = await client.get("/api/localities", params=params, headers=headers)

    assert response.status_code == status_code, response.text
    if status_code == 200:
        assert response.json() == {"results": [], "total": 0}


async def test_searchLocalities_runsTwoStatements_andAnonymousIs401(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    headers = await _token(client, "loc.search.count@example.com")

    with count_queries(engine) as statements:
        await _search(client, headers, q="nowa", limit=20)
    with count_queries(engine) as postal_statements:
        await _search(client, headers, q="32")
    anonymous = await client.get("/api/localities", params={"q": "kety"})

    assert len(statements) == 2, statements
    assert len(postal_statements) == 2, postal_statements
    assert anonymous.status_code == 401
