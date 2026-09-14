"""`app.category` module tests (implementation/spec.md Core Requirements
#4-5): matrix-resolution for the 2 new `/api/categories` rows, router-level
permission gating (READ for GET, ADMIN for every mutation), and
service-level CRUD/aggregate/reorder behavior.

Category management is ADMIN-only (unlike `app.product`'s EDIT-gated
mutations) — `POST /api/auth/register` only ever grants READ+EDIT
(`app.users.service.create_account`), so router-level ADMIN tests grant the
`ADMIN` permission directly via `user_permissions` after registering, the
same direct-SQL-manipulation approach `test_category_reintroduction.py`
uses for the seeded `admin` dev account.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.category.models import Category
from app.category.service import (
    CategoryHasProductsException,
    delete_category,
    list_categories,
    move_category,
)
from app.core.authorization_matrix import resolve_requirement
from app.core.errors import EntityNotFoundException

ADMIN = ("ADMIN",)
READ = ("READ", "mcp:read")


async def _authed_headers(client: AsyncClient, email: str) -> dict[str, str]:
    """Registers a fresh user (grants `READ`+`EDIT` only, per
    `app/users/service.py`) and returns a `Bearer` auth header."""
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def _grant_admin(db_session: AsyncSession, email: str) -> None:
    await db_session.execute(
        text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, 'ADMIN' FROM users u "
            "JOIN user_profiles p ON p.account_user_id = u.id "
            "WHERE p.email = :email"
        ),
        {"email": email},
    )
    await db_session.commit()


async def _grant_admin_and_relogin(
    client: AsyncClient, db_session: AsyncSession, email: str, password: str
) -> dict[str, str]:
    """Permissions are baked into the JWT at issuance time
    (`app.auth.router.login`/`register` both call `_load_permissions` once
    and encode the result) — granting `ADMIN` via direct SQL doesn't retroactively
    change an already-issued token, so a fresh login is required to obtain
    one carrying the new permission."""
    await _grant_admin(db_session, email)
    response = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_resolveRequirement_getCategories_resolvesToRead() -> None:
    assert resolve_requirement("GET", "/api/categories") == READ
    assert resolve_requirement("GET", "/api/categories/42") == READ


def test_resolveRequirement_mutateCategories_resolvesToAdmin() -> None:
    assert resolve_requirement("POST", "/api/categories") == ADMIN
    assert resolve_requirement("PUT", "/api/categories/42") == ADMIN
    assert resolve_requirement("DELETE", "/api/categories/42") == ADMIN
    assert resolve_requirement("PATCH", "/api/categories/42/move") == ADMIN


async def test_listCategories_readOnlyPrincipal_returns200(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "catread1@example.com")

    response = await client.get("/api/categories", headers=headers)

    assert response.status_code == 200
    assert len(response.json()) >= 5


async def test_createCategory_nonAdminThenAdmin_forbiddenThenCreated(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _authed_headers(client, "catcreate1@example.com")

    forbidden = await client.post("/api/categories", json={"name": "Elektronika"}, headers=headers)
    assert forbidden.status_code == 403

    admin_headers = await _grant_admin_and_relogin(
        client, db_session, "catcreate1@example.com", "secret123"
    )

    created = await client.post(
        "/api/categories", json={"name": "Elektronika"}, headers=admin_headers
    )
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "Elektronika"
    assert body["product_count"] == 0


async def test_deleteCategory_nonAdminPrincipal_returns403(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "catdelete1@example.com")

    response = await client.delete("/api/categories/1", headers=headers)

    assert response.status_code == 403


async def test_deleteCategory_referencedByProducts_raisesWithExactBlockingCount(
    db_session: AsyncSession,
) -> None:
    category = Category(name="Testowa Kategoria", description=None, sort_order=999)
    db_session.add(category)
    await db_session.flush()
    category_id = category.id

    for i in range(2):
        await db_session.execute(
            text(
                "INSERT INTO products (id, name, sku, category_id, created_at, updated_at) "
                "VALUES (nextval('product_seq'), :name, :sku, :category_id, now(), now())"
            ),
            {"name": f"Produkt {i}", "sku": f"SKU-CAT-{i}", "category_id": category_id},
        )
    await db_session.commit()

    with pytest.raises(CategoryHasProductsException) as exc_info:
        await delete_category(db_session, category_id)

    assert "2" in str(exc_info.value)


async def test_listCategories_returnsRowsOrderedBySortOrderWithAggregatedProductCounts(
    db_session: AsyncSession,
) -> None:
    category = Category(name="Zliczana Kategoria", description=None, sort_order=1000)
    db_session.add(category)
    await db_session.flush()
    category_id = category.id
    await db_session.execute(
        text(
            "INSERT INTO products (id, name, sku, category_id, created_at, updated_at) "
            "VALUES (nextval('product_seq'), 'Produkt', 'SKU-CAT-COUNT', "
            ":category_id, now(), now())"
        ),
        {"category_id": category_id},
    )
    await db_session.commit()

    responses = await list_categories(db_session)

    sort_orders = [response.sort_order for response in responses]
    assert sort_orders == sorted(sort_orders)

    match = next(response for response in responses if response.id == category_id)
    assert match.product_count == 1


async def test_moveCategory_up_swapsSortOrderWithAdjacentRowAtomically(
    db_session: AsyncSession,
) -> None:
    first = Category(name="Pierwsza Kategoria", description=None, sort_order=2000)
    second = Category(name="Druga Kategoria", description=None, sort_order=2001)
    db_session.add_all([first, second])
    await db_session.flush()
    first_id, second_id = first.id, second.id
    await db_session.commit()

    await move_category(db_session, second_id, "up")

    refreshed_first = await db_session.get(Category, first_id)
    refreshed_second = await db_session.get(Category, second_id)
    assert refreshed_first is not None
    assert refreshed_second is not None
    assert refreshed_second.sort_order == 2000
    assert refreshed_first.sort_order == 2001


async def test_moveCategory_atBoundary_isNoOpRatherThanError(db_session: AsyncSession) -> None:
    """Gap identified in Task Group 9's review (9.2): every existing
    `move_category` test moves a row with a neighbor on both sides.
    `service.move_category`'s docstring promises a silent no-op (not an
    error) when the row is already at the boundary in the requested
    direction — moving the lowest `sort_order` row `"up"` or the highest
    `sort_order` row `"down"` must leave `sort_order` untouched and must
    not raise, since the router has no other error path to catch a
    `scalar_one_or_none() is None` case here."""
    # Sort orders chosen to sit strictly outside the 5 permanently-seeded
    # categories' range (0-4, per `0025_category_reintroduction`) so this
    # test's rows are the genuine global boundary within its own
    # transaction, regardless of what other tests insert in theirs.
    lowest = Category(name="Skrajnie Pierwsza", description=None, sort_order=-100)
    highest = Category(name="Skrajnie Ostatnia", description=None, sort_order=999_999)
    db_session.add_all([lowest, highest])
    await db_session.flush()
    lowest_id, highest_id = lowest.id, highest.id
    await db_session.commit()

    await move_category(db_session, lowest_id, "up")
    await move_category(db_session, highest_id, "down")

    refreshed_lowest = await db_session.get(Category, lowest_id)
    refreshed_highest = await db_session.get(Category, highest_id)
    assert refreshed_lowest is not None
    assert refreshed_highest is not None
    assert refreshed_lowest.sort_order == -100
    assert refreshed_highest.sort_order == 999_999


async def test_deleteCategory_calledTwiceForSameId_secondCallRaisesNotFoundNotServerError(
    db_session: AsyncSession,
) -> None:
    """Gap identified in Task Group 9's review (9.2): a concurrent-delete
    race (two requests for the same `category_id`, the second arriving
    after the first already committed) is approximated here by two
    sequential calls against the same session/id — the first succeeds,
    and the second must degrade to the ordinary `EntityNotFoundException`
    (-> 404 at the router) rather than a raw `IntegrityError`/500, since
    `_get_category_entity` already re-selects the row before deleting."""
    category = Category(name="Kasowana Dwukrotnie", description=None, sort_order=4000)
    db_session.add(category)
    await db_session.flush()
    category_id = category.id
    await db_session.commit()

    await delete_category(db_session, category_id)

    with pytest.raises(EntityNotFoundException):
        await delete_category(db_session, category_id)


async def test_editorEquivalentPrincipal_categoriesAndProductsEndToEnd_regressionCheck(
    client: AsyncClient,
) -> None:
    """spec.md Success Criteria's primary regression check: a principal
    shaped like the seeded dev `editor` account (`READ`+`EDIT`, no `ADMIN`)
    must still be able to list categories, fetch one by id, and
    create/edit a product referencing a `category_id` after the
    enum -> FK rename.

    Uses a freshly-registered account rather than logging in as the
    literal seeded `editor` username, matching the pattern every other
    test file in this task already uses (`test_plugin_admin_gating.py`,
    `test_product_category_fk_rename.py`) — `POST /api/auth/register`
    grants exactly `READ`+`EDIT`, the same permission shape as `editor`.
    Confirmed separately (see Task Group 9's execution report) that the
    literal seeded `editor`/`viewer`/`admin` accounts from
    `0002_seed_dev_users`/`0010_seed_dev_user_profiles` cannot actually
    authenticate via `POST /api/auth/login` at all — that route resolves
    principals by `user_profiles.email`, which is `NULL` for all three
    seeded dev accounts, so any credential attempt 401s regardless of
    password correctness. That is a pre-existing gap outside this
    test-only group's file scope; this test instead exercises the
    permission shape the regression check actually cares about."""
    headers = await _authed_headers(client, "editor-equivalent@example.com")

    listing = await client.get("/api/categories", headers=headers)
    assert listing.status_code == 200
    categories = listing.json()
    assert len(categories) >= 5
    first_category_id = categories[0]["id"]

    single = await client.get(f"/api/categories/{first_category_id}", headers=headers)
    assert single.status_code == 200
    assert single.json()["id"] == first_category_id

    created = await client.post(
        "/api/products",
        json={
            "name": "Regresyjny Produkt",
            "sku": "CAT-REGRESSION-1",
            "category_id": first_category_id,
        },
        headers=headers,
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    other_category_id = next(c["id"] for c in categories if c["id"] != first_category_id)

    updated = await client.put(
        f"/api/products/{product_id}",
        json={
            "name": "Regresyjny Produkt",
            "sku": "CAT-REGRESSION-1",
            "category_id": other_category_id,
        },
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["category_id"] == other_category_id
