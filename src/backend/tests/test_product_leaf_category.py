"""Leaf-only product writes (spec FR-9): resolve, create and update reject a
category that has children with 409, and an unknown category with 404."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import leaf_category_ids

NOT_LEAF_MESSAGE = "Wybierz najbardziej szczegółową kategorię (bez podkategorii)."


async def _register(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _root_category_id(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.get("/api/categories", headers=headers)
    assert response.status_code == 200
    return str(next(c["id"] for c in response.json() if c["parent_id"] is None))


async def test_productWrites_nonLeafCategory_return409(client: AsyncClient) -> None:
    headers = await _register(client, "leaf-nonleaf@example.com")
    root_id = await _root_category_id(client, headers)
    [leaf_id] = await leaf_category_ids(client, headers)
    product = await client.post(
        "/api/products",
        json={"name": "Kurtka", "sku": "LEAF-1", "category_id": leaf_id},
        headers=headers,
    )
    assert product.status_code == 201

    resolved = await client.post(
        "/api/products/resolve", json={"name": "Kurtka", "category_id": root_id}, headers=headers
    )
    created = await client.post(
        "/api/products",
        json={"name": "Płaszcz", "sku": "LEAF-2", "category_id": root_id},
        headers=headers,
    )
    updated = await client.put(
        f"/api/products/{product.json()['id']}",
        json={"name": "Kurtka", "sku": "LEAF-1", "category_id": root_id},
        headers=headers,
    )

    for response in (resolved, created, updated):
        assert response.status_code == 409
        assert response.json()["message"] == NOT_LEAF_MESSAGE


async def test_productWrites_unknownCategory_return404(client: AsyncClient) -> None:
    headers = await _register(client, "leaf-unknown@example.com")
    unknown_id = str(uuid.uuid4())

    resolved = await client.post(
        "/api/products/resolve", json={"name": "Coś", "category_id": unknown_id}, headers=headers
    )
    created = await client.post(
        "/api/products",
        json={"name": "Coś", "sku": "LEAF-404", "category_id": unknown_id},
        headers=headers,
    )

    assert resolved.status_code == 404
    assert created.status_code == 404


async def test_updateProduct_unchangedInnerNodeCategory_renameSucceeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A product left on an inner node (the accepted leaf race) can still be
    renamed: the leaf check runs only when `category_id` changes."""
    headers = await _register(client, "leaf-race@example.com")
    root_id = await _root_category_id(client, headers)
    [leaf_id] = await leaf_category_ids(client, headers)
    product = await client.post(
        "/api/products",
        json={"name": "Sweter", "sku": "LEAF-RACE", "category_id": leaf_id},
        headers=headers,
    )
    assert product.status_code == 201, product.text
    await db_session.execute(
        text("UPDATE products SET category_id = :root WHERE id = :id"),
        {"root": uuid.UUID(root_id), "id": uuid.UUID(product.json()["id"])},
    )
    await db_session.commit()
    db_session.expire_all()

    renamed = await client.put(
        f"/api/products/{product.json()['id']}",
        json={"name": "Sweter wełniany", "sku": "LEAF-RACE", "category_id": root_id},
        headers=headers,
    )

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Sweter wełniany"
    assert renamed.json()["category_id"] == root_id
