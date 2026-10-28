"""Category tree API (spec FR-4..FR-8): the response shape, child creation
under a parent, sibling-scoped duplicate names and moves, and the
children-before-products delete check."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from tests.conftest import count_queries, leaf_category_ids

CATEGORY_KEYS = {
    "id",
    "parent_id",
    "name",
    "description",
    "sort_order",
    "product_count",
    "created_at",
    "updated_at",
}


async def _register(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _admin(client: AsyncClient, db_session: AsyncSession, email: str) -> dict[str, str]:
    """Registration grants READ+EDIT only; ADMIN is inserted directly and a
    fresh login picks it up (permissions are baked into the JWT)."""
    await _register(client, email)
    await db_session.execute(
        text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, 'ADMIN' FROM users u "
            "JOIN user_profiles p ON p.account_user_id = u.id WHERE p.email = :email"
        ),
        {"email": email},
    )
    await db_session.commit()
    response = await client.post("/api/auth/login", json={"email": email, "password": "secret123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _categories(client: AsyncClient, headers: dict[str, str]) -> list[dict[str, Any]]:
    response = await client.get("/api/categories", headers=headers)
    assert response.status_code == 200
    return list(response.json())


def _root(categories: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next(c for c in categories if c["parent_id"] is None and c["name"] == name)


async def test_listCategories_exposesParentIdNotExternalId_inSingleQuery(
    client: AsyncClient, db_session: AsyncSession, engine: AsyncEngine
) -> None:
    headers = await _register(client, "tree-list@example.com")

    with count_queries(engine) as statements:
        categories = await _categories(client, headers)

    assert len(statements) == 1
    assert all(set(category) == CATEGORY_KEYS for category in categories)
    kobiety = _root(categories, "Kobiety")
    assert any(c["parent_id"] == kobiety["id"] for c in categories)


async def test_createCategory_underParent_getsSiblingMaxSortOrderPlusOne(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "tree-create@example.com")
    categories = await _categories(client, headers)
    parent = _root(categories, "Dom")
    sibling_orders = [c["sort_order"] for c in categories if c["parent_id"] == parent["id"]]

    response = await client.post(
        "/api/categories",
        json={"name": "Nowa podkategoria", "parent_id": parent["id"]},
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == CATEGORY_KEYS
    assert body["parent_id"] == parent["id"]
    assert body["sort_order"] == max(sibling_orders) + 1


async def test_createCategory_underLeafWithProducts_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "tree-leafprod@example.com")
    [leaf_id] = await leaf_category_ids(client, headers)
    product = await client.post(
        "/api/products",
        json={"name": "Sweter", "sku": "TREE-LEAF-1", "category_id": leaf_id},
        headers=headers,
    )
    assert product.status_code == 201

    response = await client.post(
        "/api/categories", json={"name": "Dziecko", "parent_id": leaf_id}, headers=headers
    )

    assert response.status_code == 409
    assert response.json()["message"] == "Kategoria ma przypisane rzeczy"


async def test_createAndUpdateCategory_duplicateSiblingName_returns409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "tree-dup@example.com")
    categories = await _categories(client, headers)
    parent = _root(categories, "Sport")
    duplicate_message = "Kategoria o tej nazwie już istnieje na tym poziomie"

    root_duplicate = await client.post("/api/categories", json={"name": "Kobiety"}, headers=headers)
    first = await client.post(
        "/api/categories", json={"name": "Unikalna", "parent_id": parent["id"]}, headers=headers
    )
    second = await client.post(
        "/api/categories", json={"name": "Unikalna", "parent_id": parent["id"]}, headers=headers
    )
    elsewhere = await client.post(
        "/api/categories",
        json={"name": "Unikalna", "parent_id": _root(categories, "Dom")["id"]},
        headers=headers,
    )
    rename = await client.put(
        f"/api/categories/{_root(categories, 'Dom')['id']}",
        json={"name": "Kobiety"},
        headers=headers,
    )

    assert root_duplicate.status_code == 409
    assert root_duplicate.json()["message"] == duplicate_message
    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["message"] == duplicate_message
    assert elsewhere.status_code == 201
    assert rename.status_code == 409
    assert rename.json()["message"] == duplicate_message


async def test_createAndUpdateCategory_paddedDuplicateOrBlankName_returns409Or400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "tree-strip@example.com")
    categories = await _categories(client, headers)
    parent_id = next(c["parent_id"] for c in categories if c["name"] == "Sukienki")

    padded = await client.post(
        "/api/categories", json={"name": " Sukienki ", "parent_id": parent_id}, headers=headers
    )
    padded_rename = await client.put(
        f"/api/categories/{_root(categories, 'Dom')['id']}",
        json={"name": " Kobiety"},
        headers=headers,
    )
    blank = await client.post(
        "/api/categories", json={"name": "   ", "parent_id": parent_id}, headers=headers
    )

    assert padded.status_code == 409
    assert padded_rename.status_code == 409
    assert blank.status_code == 400


async def test_listCategories_acceptsGzip_returnsCompressedBody(client: AsyncClient) -> None:
    headers = await _register(client, "tree-gzip@example.com")

    response = await client.get("/api/categories", headers={**headers, "Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert len(response.json()) > 0


async def test_deleteCategory_parentWithChildren_returns409ChildrenMessage(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "tree-delete@example.com")
    parent = _root(await _categories(client, headers), "Zwierzęta")

    response = await client.delete(f"/api/categories/{parent['id']}", headers=headers)

    assert response.status_code == 409
    assert response.json()["message"] == "Nie można usunąć „Zwierzęta”: kategoria ma podkategorie."


async def test_moveCategory_swapsOnlyWithSiblings_andIsNoOpAtBoundary(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "tree-move@example.com")
    categories = await _categories(client, headers)
    parent = _root(categories, "Dom")
    children = sorted(
        (c for c in categories if c["parent_id"] == parent["id"]), key=lambda c: c["sort_order"]
    )
    first, second = children[0], children[1]

    at_top = await client.patch(
        f"/api/categories/{first['id']}/move", json={"direction": "up"}, headers=headers
    )
    moved = await client.patch(
        f"/api/categories/{second['id']}/move", json={"direction": "up"}, headers=headers
    )

    assert at_top.status_code == 200
    assert at_top.json()["sort_order"] == first["sort_order"]
    assert moved.status_code == 200
    assert moved.json()["sort_order"] == first["sort_order"]
    after = {c["id"]: c for c in await _categories(client, headers)}
    assert after[first["id"]]["sort_order"] == second["sort_order"]
    assert after[parent["id"]]["sort_order"] == parent["sort_order"]


async def test_createCategory_unknownParent_returns404AndCreatesNothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _admin(client, db_session, "tree-unknown-parent@example.com")
    before = await _categories(client, headers)

    response = await client.post(
        "/api/categories",
        json={"name": "Sierota", "parent_id": "00000000-0000-0000-0000-000000000001"},
        headers=headers,
    )

    assert response.status_code == 404, response.text
    assert len(await _categories(client, headers)) == len(before)
