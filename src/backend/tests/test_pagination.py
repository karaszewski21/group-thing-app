"""`?page=&size=` pagination of the admin list endpoints (`app.core.
pagination`): page slicing with a stable order, the total, and the bounds
on `page`/`size`."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization_matrix import resolve_requirement
from tests.test_groups_moderation import _authed_headers, _grant_admin_and_relogin


async def test_pageProducts_searchSortedByName_slicesPagesAndReportsTotal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _authed_headers(client, "page.products@example.com")
    category_id = (
        await db_session.execute(text("SELECT id FROM categories WHERE name = 'Zabawka'"))
    ).scalar_one()
    for name, sku in [
        ("Stronicowany C", "PAGE-C"),
        ("Stronicowany A", "PAGE-A"),
        ("Stronicowany B", "PAGE-B"),
    ]:
        created = await client.post(
            "/api/products",
            json={"name": name, "sku": sku, "category_id": str(category_id)},
            headers=headers,
        )
        assert created.status_code == 201, created.text
    query = {"search": "Stronicowany", "sort": "name,asc", "size": 2}

    first = await client.get("/api/products/page", params={**query, "page": 1}, headers=headers)
    second = await client.get("/api/products/page", params={**query, "page": 2}, headers=headers)
    legacy = await client.get("/api/products", params={"search": "Stronicowany"}, headers=headers)

    assert first.status_code == 200, first.text
    assert [p["name"] for p in first.json()["items"]] == ["Stronicowany A", "Stronicowany B"]
    assert (first.json()["total"], first.json()["page"], first.json()["size"]) == (3, 1, 2)
    assert [p["name"] for p in second.json()["items"]] == ["Stronicowany C"]
    assert isinstance(legacy.json(), list) and len(legacy.json()) == 3


async def test_adminLists_outOfRangePaging_rejectedAndDefaultsApplied(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed_headers(client, "page.bounds@example.com")
    admin = await _grant_admin_and_relogin(
        client, db_session, "page.bounds@example.com", "secret123"
    )

    too_big = await client.get("/api/moderation/photos?size=101", headers=admin)
    page_zero = await client.get("/api/terms/moderation?page=0", headers=admin)
    defaults = await client.get("/api/groups/moderation", headers=admin)

    assert too_big.status_code == 400
    assert page_zero.status_code == 400
    assert defaults.status_code == 200
    assert (defaults.json()["page"], defaults.json()["size"]) == (1, 20)
    assert len(defaults.json()["items"]) <= 20


def test_resolveRequirement_productsPage_isReadGated() -> None:
    assert resolve_requirement("GET", "/api/products/page") == ("READ", "mcp:read")
