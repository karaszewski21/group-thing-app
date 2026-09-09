"""`resolve_requirement` tests for the fine-grained edit/delete rows added
across task groups G2+G3 (implementation/spec.md §4 authorization matrix).

Each new row must resolve to the `("EDIT", "mcp:edit")` permission tuple,
and — because first-match-wins ordering is significant — the pre-existing
`/api/groups/mine/...` and `/api/groups/public/...` rows must keep resolving
to their own requirements despite the new `PATCH /api/groups/{id}` row.
"""

from __future__ import annotations

from app.core.auth_deps import resolve_requirement

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


def test_resolveRequirement_groupsMineAttendances_notRegressedByGroupsPatchRow() -> None:
    assert resolve_requirement("GET", "/api/groups/mine/attendances") == READ


def test_resolveRequirement_publicGroup_notRegressedByGroupsPatchRow() -> None:
    assert resolve_requirement("GET", "/api/groups/public/some-id") == "PUBLIC"
