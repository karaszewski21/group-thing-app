"""`resolve_requirement` tests for the fine-grained edit/delete rows added
across task groups G2+G3 (implementation/spec.md §4 authorization matrix).

Each new row must resolve to the `("EDIT", "mcp:edit")` permission tuple,
and — because first-match-wins ordering is significant — the pre-existing
`/api/groups/mine/...` and `/api/groups/public/...` rows must keep resolving
to their own requirements despite the new `PATCH /api/groups/{id}` row.
"""

from __future__ import annotations

import pytest

from app.core.authorization_matrix import resolve_requirement

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


def test_resolveRequirement_groupsMineAttendances_notRegressedByGroupsPatchRow() -> None:
    assert resolve_requirement("GET", "/api/groups/mine/attendances") == READ


def test_resolveRequirement_pledgesMine_resolvesToRead() -> None:
    assert resolve_requirement("GET", "/api/pledges/mine") == READ


def test_resolveRequirement_notificationsMine_resolvesToRead() -> None:
    assert resolve_requirement("GET", "/api/notifications/mine") == READ


def test_resolveRequirement_notificationsMarkRead_resolvesToEdit() -> None:
    assert resolve_requirement("POST", "/api/notifications/42/read") == EDIT


def test_resolveRequirement_publicGroup_notRegressedByGroupsPatchRow() -> None:
    assert resolve_requirement("GET", "/api/groups/public/some-id") == "PUBLIC"


def test_resolveRequirement_termItemListingsBrowseAndTake_andWithdrawAttendance() -> None:
    """Rows for the exchange mechanism (`/api/term-item-listings`,
    `/api/item-listing-preferences`), plus confirmation that
    `POST /api/groups/mine/attendances/{id}/withdraw` needs no new row of
    its own — it falls under the pre-existing blanket
    `POST ^/api/groups(/.*)?$` row (row 27)."""
    assert resolve_requirement("GET", "/api/term-item-listings/browse") == READ
    assert resolve_requirement("POST", "/api/term-item-listings/123/take") == EDIT
    assert resolve_requirement("PUT", "/api/item-listing-preferences/123") == EDIT
    assert resolve_requirement("POST", "/api/groups/mine/attendances/42/withdraw") == EDIT


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("POST", "/api/groups/public/42/join-requests", "AUTHENTICATED"),
        ("POST", "/api/groups/public/42/join-requests/7/withdraw", "AUTHENTICATED"),
        ("GET", "/api/groups/mine/join-requests", READ),
        ("GET", "/api/groups/42/join-requests", READ),
        ("POST", "/api/groups/42/join-requests/7/approve", EDIT),
        ("POST", "/api/groups/42/join-requests/7/reject", EDIT),
        ("POST", "/api/groups/public/42/join", EDIT),
        ("POST", "/api/memberships/42/end", EDIT),
    ],
)
def test_resolveRequirement_joinRequestRoutes_resolveToExpectedRow(
    method: str, path: str, expected: object
) -> None:
    """The create/withdraw row precedes blanket row 27 (which would demand
    EDIT); the organizer list/decision routes fall to blanket rows 26/27; the
    removed `/join` path falls to row 27; `/api/memberships/{id}/end` keeps
    row 31."""
    assert resolve_requirement(method, path) == expected
