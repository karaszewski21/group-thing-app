"""AST guard: "a party is in a group" is defined once, in
`app/groups/infrastructure/membership.py`. Everywhere else in `app/`:

- rule 1: a function that compares `GroupRole.party_id` (`==`, `!=`, `in_`,
  `not_in`) must not also reference `Membership` or `Leadership`;
  projecting the column is fine;
- rule 2: no `Membership.valid_to` / `Leadership.valid_to` `.is_(None)`,
  so "active" lives in the shared clauses only."""

from __future__ import annotations

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
PRIMITIVE = "app/groups/infrastructure/membership.py"
ROLE_ENTITIES = {"Membership", "Leadership"}
ALLOWED = {"app/groups/infrastructure/repository.py::list_groups_for_moderation"}


def _is_group_role_party_id(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and node.attr == "party_id"
        and isinstance(node.value, ast.Name)
        and node.value.id == "GroupRole"
    )


def _compares_group_role_party_id(function: ast.AST) -> bool:
    for node in ast.walk(function):
        if (
            isinstance(node, ast.Compare)
            and any(isinstance(op, ast.Eq | ast.NotEq) for op in node.ops)
            and any(_is_group_role_party_id(side) for side in (node.left, *node.comparators))
        ):
            return True
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in {"in_", "not_in"}
            and _is_group_role_party_id(node.func.value)
        ):
            return True
    return False


def _references_role_entity(function: ast.AST) -> bool:
    return any(
        isinstance(node, ast.Name) and node.id in ROLE_ENTITIES for node in ast.walk(function)
    )


def _is_active_valid_to_check(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "is_"
        and isinstance(node.func.value, ast.Attribute)
        and node.func.value.attr == "valid_to"
        and isinstance(node.func.value.value, ast.Name)
        and node.func.value.value.id in ROLE_ENTITIES
        and len(node.args) == 1
        and isinstance(node.args[0], ast.Constant)
        and node.args[0].value is None
    )


def find_offenders(source: str, path: str) -> list[str]:
    tree = ast.parse(source)
    offenders: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            key = f"{path}::{node.name}"
            if (
                key not in ALLOWED
                and _compares_group_role_party_id(node)
                and _references_role_entity(node)
            ):
                offenders.append(f"rule 1: {key}")
        if _is_active_valid_to_check(node):
            offenders.append(f"rule 2: {path}:{getattr(node, 'lineno', '?')}")
    return offenders


def test_membershipDefinition_appOutsidePrimitive_hasNoOtherDefinition() -> None:
    offenders: list[str] = []
    for file in sorted(APP_ROOT.rglob("*.py")):
        path = file.relative_to(APP_ROOT.parent).as_posix()
        if path == PRIMITIVE:
            continue
        offenders.extend(find_offenders(file.read_text(encoding="utf-8"), path))

    assert offenders == []


def test_membershipDefinitionGuard_plantedSnippets_flagsOnlyDefinitions() -> None:
    comparison = (
        "def f(p):\n    return select(Membership.to_group_id).where(GroupRole.party_id == p)\n"
    )
    reversed_in = (
        "def f(ps):\n    return select(Leadership.to_group_id).where(GroupRole.party_id.in_(ps))\n"
    )
    projection = (
        "def f(gs):\n"
        "    return select(Leadership.to_group_id, GroupRole.party_id).where(\n"
        "        Leadership.to_group_id.in_(gs)\n"
        "    )\n"
    )
    active_check = "q = select(Membership).where(Membership.valid_to.is_(None))\n"
    allowed = (
        "def list_groups_for_moderation():\n"
        "    return select(Leadership).join(\n"
        "        UserProfile, UserProfile.party_id == GroupRole.party_id\n"
        "    )\n"
    )

    assert find_offenders(comparison, "app/x.py") == ["rule 1: app/x.py::f"]
    assert find_offenders(reversed_in, "app/x.py") == ["rule 1: app/x.py::f"]
    assert find_offenders(projection, "app/x.py") == []
    assert find_offenders(active_check, "app/x.py") == ["rule 2: app/x.py:1"]
    assert find_offenders(allowed, "app/groups/infrastructure/repository.py") == []
    assert find_offenders(allowed, "app/x.py") == ["rule 1: app/x.py::list_groups_for_moderation"]
