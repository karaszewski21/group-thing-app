"""`app.plugin` router ADMIN-coexistence gating tests (implementation
plan Task Group 4 / spec.md Core Requirement #6): `ManagementPrincipal`
becomes `require_any("PLUGIN_MANAGEMENT", "ADMIN")` on the 3 previously
`PLUGIN_MANAGEMENT`-only routes (manifest PUT, enabled PATCH, descriptor
DELETE). Purely additive gating — no other plugin behavior changes.

`POST /api/auth/register` only ever grants READ+EDIT
(`app.users.service.create_account`), so a `PLUGIN_MANAGEMENT`-only or
ADMIN-only principal is built the same direct-SQL-then-relogin way
`test_category_module.py` builds its ADMIN principal (permissions are
baked into the JWT at issuance time, so a fresh login is required after
granting). The seeded dev `admin` account has BOTH `PLUGIN_MANAGEMENT` and
`ADMIN` (Group 1's migration) so it can't be used to catch a real
regression here — each test below grants exactly one permission to a
freshly registered account.
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def _authed_headers(client: AsyncClient, email: str) -> dict[str, str]:
    """Registers a fresh user (grants `READ`+`EDIT` only) and returns a
    `Bearer` auth header — neither `PLUGIN_MANAGEMENT` nor `ADMIN`."""
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def _grant_permission_and_relogin(
    client: AsyncClient, db_session: AsyncSession, email: str, password: str, permission: str
) -> dict[str, str]:
    """Grants exactly `permission` (in addition to the READ+EDIT already
    granted at registration) via direct SQL, then re-logs-in to obtain a
    fresh token carrying it — permissions are baked into the JWT at
    issuance time, so granting via SQL alone doesn't retroactively update
    an already-issued token."""
    await db_session.execute(
        text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, :permission FROM users u "
            "JOIN user_profiles p ON p.account_user_id = u.id "
            "WHERE p.email = :email"
        ),
        {"email": email, "permission": permission},
    )
    await db_session.commit()
    response = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


async def _exercise_management_routes(client: AsyncClient, headers: dict[str, str], plugin_id: str) -> None:
    """Runs all 3 `ManagementPrincipal`-gated routes end to end (manifest
    PUT creates, enabled PATCH toggles, descriptor DELETE removes) and
    asserts each succeeds."""
    put_response = await client.put(
        f"/api/plugins/{plugin_id}/manifest",
        json={"name": "Test Plugin"},
        headers=headers,
    )
    assert put_response.status_code == 200, put_response.text

    patch_response = await client.patch(
        f"/api/plugins/{plugin_id}/enabled",
        json={"enabled": False},
        headers=headers,
    )
    assert patch_response.status_code == 200, patch_response.text
    assert patch_response.json()["enabled"] is False

    delete_response = await client.delete(f"/api/plugins/{plugin_id}", headers=headers)
    assert delete_response.status_code == 204, delete_response.text


async def test_managementRoutes_pluginManagementOnlyPrincipal_succeed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression check: a principal with only `PLUGIN_MANAGEMENT` (not the
    seeded `admin`, which now also has `ADMIN`) must keep reaching all 3
    previously-gated routes unchanged."""
    email = "pluginmgmt-only@example.com"
    await _authed_headers(client, email)
    headers = await _grant_permission_and_relogin(
        client, db_session, email, "secret123", "PLUGIN_MANAGEMENT"
    )

    await _exercise_management_routes(client, headers, "test-plugin-mgmt-only")


async def test_managementRoutes_adminOnlyPrincipal_succeed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An `ADMIN`-only principal (no `PLUGIN_MANAGEMENT`) can also reach
    all 3 routes, since `ADMIN` is now an additive alternative."""
    email = "admin-only-plugin@example.com"
    await _authed_headers(client, email)
    headers = await _grant_permission_and_relogin(client, db_session, email, "secret123", "ADMIN")

    await _exercise_management_routes(client, headers, "test-plugin-admin-only")


async def test_managementRoutes_neitherPermissionPrincipal_returns403(
    client: AsyncClient,
) -> None:
    """A principal with neither `PLUGIN_MANAGEMENT` nor `ADMIN` (plain
    READ+EDIT from registration) is forbidden from all 3 routes."""
    headers = await _authed_headers(client, "neither-plugin-perm@example.com")

    put_response = await client.put(
        "/api/plugins/test-plugin-neither/manifest",
        json={"name": "Test Plugin"},
        headers=headers,
    )
    assert put_response.status_code == 403

    patch_response = await client.patch(
        "/api/plugins/test-plugin-neither/enabled",
        json={"enabled": False},
        headers=headers,
    )
    assert patch_response.status_code == 403

    delete_response = await client.delete("/api/plugins/test-plugin-neither", headers=headers)
    assert delete_response.status_code == 403
