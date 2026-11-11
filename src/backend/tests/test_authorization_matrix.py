"""`resolve_requirement` tests for the fine-grained edit/delete rows added
across task groups G2+G3 (implementation/spec.md §4 authorization matrix).

Each new row must resolve to the `("EDIT", "mcp:edit")` permission tuple,
and — because first-match-wins ordering is significant — the pre-existing
`/api/groups/mine/...` and `/api/public/groups/...` rows must keep resolving
to their own requirements despite the new `PATCH /api/groups/{id}` row.
"""

from __future__ import annotations

import time
import uuid

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.authorization_matrix import (
    AUTHORIZATION_MATRIX,
    MatrixEntry,
    resolve_requirement,
)
from app.core.security import decode_base64_hmac_key

EDIT = ("EDIT", "mcp:edit")
READ = ("READ", "mcp:read")


def test_resolveRequirement_patchTerm_resolvesToEdit() -> None:
    assert resolve_requirement("PATCH", "/api/terms/42") == EDIT


def test_resolveRequirement_patchNeededItem_resolvesToEdit() -> None:
    assert resolve_requirement("PATCH", "/api/needed-items/42") == EDIT


def test_resolveRequirement_deleteNeededItem_resolvesToEdit() -> None:
    assert resolve_requirement("DELETE", "/api/needed-items/42") == EDIT


def test_resolveRequirement_patchGroup_resolvesToEdit() -> None:
    assert resolve_requirement("PATCH", "/api/groups/42") == EDIT


def test_resolveRequirement_patchInventoryItem_resolvesToEdit() -> None:
    assert resolve_requirement("PATCH", "/api/inventory-items/42") == EDIT


def test_resolveRequirement_deleteInventoryItem_resolvesToEdit() -> None:
    assert resolve_requirement("DELETE", "/api/inventory-items/42") == EDIT


def test_resolveRequirement_deleteFamilyMember_resolvesToEdit() -> None:
    assert resolve_requirement("DELETE", "/api/families/10/guardians/42") == EDIT


def test_resolveRequirement_patchFamilyGuardian_requiresEdit() -> None:
    assert resolve_requirement("PATCH", "/api/families/x/guardians/y") == EDIT


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
def test_resolveRequirement_organizationMutation_resolvesToEdit(method: str) -> None:
    assert resolve_requirement(method, "/api/organizations/x") == EDIT


def test_resolveRequirement_groupsMineAttendances_notRegressedByGroupsPatchRow() -> None:
    assert resolve_requirement("GET", "/api/groups/mine/attendances") == READ


def test_resolveRequirement_pledgesMine_resolvesToRead() -> None:
    assert resolve_requirement("GET", "/api/pledges/mine") == READ


def test_resolveRequirement_notificationsMine_resolvesToRead() -> None:
    assert resolve_requirement("GET", "/api/notifications/mine") == READ


def test_resolveRequirement_notificationsMarkRead_resolvesToEdit() -> None:
    assert resolve_requirement("POST", "/api/notifications/42/read") == EDIT


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("GET", "/api/conversations", ("READ",)),
        ("GET", "/api/conversations/unread-count", ("READ",)),
        ("POST", "/api/conversations/item", ("EDIT",)),
        ("POST", "/api/conversations/event", ("EDIT",)),
        ("POST", "/api/conversations/42/read", ("EDIT",)),
    ],
)
def test_resolveRequirement_conversationRoutes_resolveToReadOrEditWithoutMcpScopes(
    method: str, path: str, expected: tuple[str, ...]
) -> None:
    assert resolve_requirement(method, path) == expected


def _oauth_token(username: str, scopes: list[str]) -> str:
    """An OAuth2-shaped token: `scopes` instead of `permissions` (no `aud`,
    which `decode_token` does not accept)."""
    issued_at = int(time.time())
    claims = {
        "iss": "http://localhost",
        "sub": username,
        "scopes": scopes,
        "iat": issued_at,
        "exp": issued_at + 300,
    }
    return jwt.encode(claims, key=decode_base64_hmac_key(settings.jwt_secret), algorithm="HS256")


async def test_conversationRoutes_mcpScopeToken_returns403_loginTokenReaches200(
    client: AsyncClient,
) -> None:
    registered = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": "matrix.mcp@example.com", "password": "secret123"},
    )
    assert registered.status_code == 201, registered.text
    login_token = registered.json()["token"]
    username = jwt.decode(login_token, options={"verify_signature": False})["sub"]
    mcp = {"Authorization": f"Bearer {_oauth_token(username, ['mcp:read', 'mcp:edit'])}"}

    inbox = await client.get("/api/conversations", headers=mcp)
    unread = await client.get("/api/conversations/unread-count", headers=mcp)
    send = await client.post(
        f"/api/conversations/{uuid.uuid4()}/messages", json={"body": "Cześć"}, headers=mcp
    )
    allowed = await client.get(
        "/api/conversations", headers={"Authorization": f"Bearer {login_token}"}
    )

    assert inbox.status_code == 403, inbox.text
    assert unread.status_code == 403, unread.text
    assert send.status_code == 403, send.text
    assert allowed.status_code == 200, allowed.text


def test_resolveRequirement_publicGroup_notRegressedByGroupsPatchRow() -> None:
    assert resolve_requirement("GET", "/api/public/groups/some-id") == "PUBLIC"


def test_resolveRequirement_termItemListingsBrowse_andWithdrawAttendance() -> None:
    """Rows for the exchange mechanism (`/api/term-item-listings`,
    `/api/item-listing-preferences`), plus confirmation that
    `POST /api/groups/mine/attendances/{id}/withdraw` needs no new row of
    its own — it falls under the pre-existing blanket
    `POST ^/api/groups(/.*)?$` row (row 27). The term take/propose POSTs
    are gone, so they fall through to the catch-all."""
    assert resolve_requirement("GET", "/api/term-item-listings/browse") == READ
    assert resolve_requirement("POST", "/api/term-item-listings/123/take") == "AUTHENTICATED"
    assert resolve_requirement("PUT", "/api/item-listing-preferences/123") == EDIT
    assert resolve_requirement("POST", "/api/groups/mine/attendances/42/withdraw") == EDIT


def test_resolveRequirement_circulationLedgerRoutes_resolveToExpectedRow() -> None:
    """Row 45 covers only the single-transaction read; the removed points
    routes (`/api/accounts/...`, the transaction list) fall to the
    catch-all."""
    transaction_id = uuid.uuid4()
    assert resolve_requirement("GET", f"/api/circulation-transactions/{transaction_id}") == READ
    assert resolve_requirement("GET", "/api/circulation-transactions") == "AUTHENTICATED"
    assert resolve_requirement("GET", f"/api/accounts/{uuid.uuid4()}/balance") == "AUTHENTICATED"


def test_resolveRequirement_productPhotoAndDescriptionRoutes_resolveToEditOrRead() -> None:
    product_id = uuid.uuid4()
    photo_id = uuid.uuid4()
    assert resolve_requirement("PATCH", f"/api/products/{product_id}/description") == EDIT
    assert resolve_requirement("POST", f"/api/products/{product_id}/photos") == EDIT
    assert resolve_requirement("PUT", f"/api/products/{product_id}/photos/order") == EDIT
    assert resolve_requirement("DELETE", f"/api/products/{product_id}/photos/{photo_id}") == EDIT
    assert resolve_requirement("GET", f"/api/products/{product_id}/photos") == READ


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("POST", "/api/groups/42/join-code/redeem", "AUTHENTICATED"),
        ("GET", "/api/groups/42/join-code", READ),
        ("POST", "/api/groups/42/join-code/regenerate", EDIT),
        ("POST", "/api/groups/42/join", EDIT),
        ("POST", "/api/memberships/42/end", EDIT),
    ],
)
def test_resolveRequirement_joinCodeRoutes_resolveToExpectedRow(
    method: str, path: str, expected: object
) -> None:
    """Redeem has its own AUTHENTICATED row; the organizer read and
    regenerate fall to blanket rows 26/27; the removed `/join` path falls to
    row 27; `/api/memberships/{id}/end` keeps row 31."""
    assert resolve_requirement(method, path) == expected


def test_resolveRequirement_withoutJoinCodeRow_redeemFallsToRow27Edit() -> None:
    """Guards the row's placement: without it the redeem path would demand
    EDIT (row 27), stricter than the route's `require_any()` dependency."""
    path = "/api/groups/42/join-code/redeem"
    remaining = [
        entry for entry in AUTHORIZATION_MATRIX if "join-code" not in entry.pattern.pattern
    ]
    assert len(remaining) == len(AUTHORIZATION_MATRIX) - 1
    first_match = next(
        entry
        for entry in remaining
        if (entry.methods is None or "POST" in entry.methods) and entry.pattern.match(path)
    )
    assert first_match.pattern.pattern == r"^/api/groups(/.*)?$"
    assert first_match.requirement == EDIT


@pytest.mark.parametrize(
    "path",
    ["/api/public/organizations/x/layout/CLASSIC", "/api/public/organizations/x/groups/y/terms"],
)
def test_resolveRequirement_getOrganizerPage_resolvesToPublic(path: str) -> None:
    assert resolve_requirement("GET", path) == "PUBLIC"


def test_resolveRequirement_postOrganizerPage_isNotPublic() -> None:
    assert resolve_requirement("POST", "/api/public/organizers/x") != "PUBLIC"


@pytest.mark.parametrize("suffix", ["", "/access"])
def test_resolveRequirement_publicCircleRoutes_notRegressedByOrganizerRow(suffix: str) -> None:
    assert resolve_requirement("GET", f"/api/public/groups/{uuid.uuid4()}{suffix}") == "PUBLIC"


def test_resolveRequirement_getGroupById_stillResolvesToRow26Read() -> None:
    assert resolve_requirement("GET", f"/api/groups/{uuid.uuid4()}") == READ


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/organizations/x/media"),
        ("PATCH", "/api/organizations/x/media/order"),
        ("DELETE", "/api/organizations/x/media/y"),
    ],
)
def test_resolveRequirement_mediaPostPatchDelete_requireEdit(method: str, path: str) -> None:
    assert resolve_requirement(method, path) == EDIT


def test_resolveRequirement_publicOrganizationSlug_staysPublic() -> None:
    assert resolve_requirement("GET", "/api/public/organizations/some-slug") == "PUBLIC"


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("DELETE", "/api/groups/x", EDIT),
        ("PATCH", "/api/groups/x", EDIT),
        ("POST", "/api/groups/x/restore", ("ADMIN",)),
        ("POST", "/api/leaderships", ("ADMIN",)),
        ("POST", "/api/leaderships/x/end", EDIT),
        ("GET", "/api/groups/x", READ),
        ("GET", "/api/groups/mine/attendances", READ),
        ("GET", "/api/groups/mine/terms", READ),
        ("GET", "/api/groups/x/terms", READ),
        ("GET", "/api/public/groups/x", "PUBLIC"),
        ("POST", "/api/groups/x/rsvp", EDIT),
    ],
)
def test_resolveRequirement_groupSoftDeleteAndLeadershipRows_resolveToExpectedRow(
    method: str, path: str, expected: object
) -> None:
    assert resolve_requirement(method, path) == expected


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("GET", "/api/locations/mine", READ),
        ("POST", "/api/locations", EDIT),
        ("PUT", "/api/locations/x", EDIT),
        ("DELETE", "/api/locations/x", EDIT),
        ("GET", "/api/localities", READ),
        ("GET", "/api/events/mine", READ),
        ("GET", "/api/events/attending", READ),
        ("GET", "/api/public/events/x", "PUBLIC"),
        ("PATCH", "/api/events/x", EDIT),
        ("DELETE", "/api/events/x", EDIT),
        ("POST", "/api/events", EDIT),
        ("POST", "/api/events/x/banner", EDIT),
        ("POST", "/api/events/x/attendances", EDIT),
        ("POST", "/api/events/x/attendances/withdraw", EDIT),
    ],
)
def test_resolveRequirement_locationRows_resolveToExpectedRowNotCatchAll(
    method: str, path: str, expected: object
) -> None:
    requirement = resolve_requirement(method, path)
    assert requirement == expected
    assert requirement != "AUTHENTICATED"


def test_matrix_inventoryLocationRow_isRemoved() -> None:
    assert not any("mine/location" in entry.pattern.pattern for entry in AUTHORIZATION_MATRIX)


async def test_adminLoginToken_carriesEdit(client: AsyncClient, db_session: AsyncSession) -> None:
    """An ADMIN deletes any Circle through the EDIT-gated DELETE route, so
    the ADMIN login token must also carry EDIT."""
    email = "matrix.admin@example.com"
    registered = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": "secret123"}
    )
    assert registered.status_code == 201
    await db_session.execute(
        text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, 'ADMIN' FROM users u "
            "JOIN user_profiles p ON p.account_user_id = u.id WHERE p.email = :email"
        ),
        {"email": email},
    )
    await db_session.commit()

    login = await client.post("/api/auth/login", json={"email": email, "password": "secret123"})

    claims = jwt.decode(login.json()["token"], options={"verify_signature": False})
    assert {"ADMIN", "EDIT"} <= set(claims["permissions"])


def _first_match_without(method: str, path: str, removed_pattern: str) -> MatrixEntry:
    remaining = [e for e in AUTHORIZATION_MATRIX if e.pattern.pattern != removed_pattern]
    assert len(remaining) == len(AUTHORIZATION_MATRIX) - 1
    return next(
        e for e in remaining if (e.methods is None or method in e.methods) and e.pattern.match(path)
    )


@pytest.mark.parametrize(
    "path",
    [
        "/api/public/organizers/x/items",
        f"/api/public/parties/{uuid.uuid4()}/items",
        f"/api/public/parties/{uuid.uuid4()}",
        "/api/public/organizers/x/meetings",
        f"/api/public/parties/{uuid.uuid4()}/meetings",
        f"/api/public/items/{uuid.uuid4()}/details",
        f"/api/public/items/{uuid.uuid4()}/actions",
    ],
)
def test_resolveRequirement_itemsPageReadRoutes_resolveToPublic(path: str) -> None:
    assert resolve_requirement("GET", path) == "PUBLIC"


def test_matrix_removedReservationRows_absent() -> None:
    """The old term/event take/propose rows are gone; the GET term-item-listings
    rows and the swap-proposal/reservation action rows stay."""
    patterns = {(entry.methods, entry.pattern.pattern) for entry in AUTHORIZATION_MATRIX}
    for removed in (
        r"^/api/term-item-listings(/.*)?$",
        r"^/api/term-item-listings/[^/]+/propose$",
        r"^/api/events/[^/]+/items/[^/]+/(take|propose)$",
    ):
        assert not any(
            pattern == removed and methods is not None and "POST" in methods
            for methods, pattern in patterns
        ), removed
    for action in ("take", "propose"):
        event_path = f"/api/events/{uuid.uuid4()}/items/{uuid.uuid4()}/{action}"
        assert resolve_requirement("POST", event_path) == "AUTHENTICATED"
        assert resolve_requirement("POST", f"/api/term-item-listings/x/{action}") == "AUTHENTICATED"
    assert resolve_requirement("GET", "/api/term-item-listings/x/swap-proposals") == READ
    assert resolve_requirement("POST", "/api/swap-proposals/x/accept") == EDIT
    assert resolve_requirement("POST", "/api/swap-proposals/x/reject") == EDIT
    assert resolve_requirement("POST", "/api/reservations/x/confirm-transaction") == EDIT
    assert resolve_requirement("POST", "/api/reservations/x/cancel-transaction") == EDIT
    assert resolve_requirement("POST", f"/api/events/{uuid.uuid4()}/attendances") == EDIT


def test_resolveRequirement_withoutPublicPrefixRow_publicReadsNeedLogin() -> None:
    """Guards placement: the single `/api/public/` row is what keeps these
    reads anonymous; without it they fall to the catch-all."""
    first_match = _first_match_without("GET", "/api/public/parties/p1/items", r"^/api/public/.*$")
    assert first_match.requirement == "AUTHENTICATED"


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/inventory-items/i1", READ),
        ("/api/inventory-items/i1/details", READ),
        ("/api/inventory-items/mine", READ),
        ("/api/groups/public/x", READ),
        ("/api/groups/public/organizers/x", READ),
        ("/api/organizations/public/x", READ),
        ("/api/events/x", "AUTHENTICATED"),
        ("/api/items/i1/actions", "AUTHENTICATED"),
    ],
)
def test_resolveRequirement_oldPublicPaths_areNoLongerPublic(path: str, expected: object) -> None:
    assert resolve_requirement("GET", path) == expected


@pytest.mark.parametrize("action", ["take", "propose"])
def test_resolveRequirement_itemTakeOrPropose_requiresEdit(action: str) -> None:
    assert resolve_requirement("POST", f"/api/items/{uuid.uuid4()}/{action}") == EDIT
    assert resolve_requirement("POST", f"/api/items/{uuid.uuid4()}/{action}/x") == "AUTHENTICATED"


def test_resolveRequirement_postItemsPageReadRoutes_areNotPublic() -> None:
    assert resolve_requirement("POST", "/api/public/organizers/x/items") != "PUBLIC"
    assert resolve_requirement("POST", "/api/public/items/i1/details") != "PUBLIC"
    assert resolve_requirement("POST", "/api/public/items/i1/actions") != "PUBLIC"
