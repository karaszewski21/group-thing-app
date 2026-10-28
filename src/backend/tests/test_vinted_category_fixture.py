"""Shape checks for the Vinted category fixture seeded by revision 0069 (pure, no DB)."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

FIXTURE_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "data" / "vinted_categories_pl.json"
)

EXPECTED_ROOTS = [
    "Kobiety",
    "Mężczyźni",
    "Dzieci",
    "Dom",
    "Elektronika",
    "Rozrywka",
    "Hobby i kolekcje",
    "Sport",
    "Zwierzęta",
]


def _load() -> list[dict[str, Any]]:
    with FIXTURE_PATH.open(encoding="utf-8") as fixture:
        return json.load(fixture)


def _walk(nodes: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for node in nodes:
        yield node
        yield from _walk(node.get("children", []))


def _sibling_lists(nodes: list[dict[str, Any]]) -> Iterator[list[dict[str, Any]]]:
    yield nodes
    for node in nodes:
        yield from _sibling_lists(node.get("children", []))


def test_fixture_roots_matchVintedOrder() -> None:
    assert [root["name"] for root in _load()] == EXPECTED_ROOTS


def test_fixture_nodes_haveTrimmedNamesAndOnlyKnownKeys() -> None:
    for node in _walk(_load()):
        assert set(node.keys()) <= {"name", "external_id", "children"}, node
        name = node["name"]
        assert isinstance(name, str), node
        assert name == name.strip(), name
        assert 1 <= len(name) <= 100, name
        assert isinstance(node.get("children", []), list), name


def test_fixture_siblingNames_areUnique() -> None:
    for siblings in _sibling_lists(_load()):
        names = [node["name"] for node in siblings]
        assert len(names) == len(set(names)), names


def test_fixture_externalIds_areIntsAndGloballyUnique() -> None:
    ids = [node.get("external_id") for node in _walk(_load())]
    non_null = [external_id for external_id in ids if external_id is not None]
    for external_id in non_null:
        assert type(external_id) is int, external_id
    assert len(non_null) == len(set(non_null))
