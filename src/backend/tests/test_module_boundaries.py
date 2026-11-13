"""Import boundary of the read-only page modules `app.pages` and
`app.search`: only `app/main.py` imports them, their code outside
`infrastructure/` reaches no other context (`domain/` only itself), and their
ACLs never import their own schemas. Imports are read from the AST, so
docstrings and comments that mention a module do not count."""

from __future__ import annotations

import ast
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"
MODULES = ("pages", "search")


def _module_name(path: Path) -> str:
    parts = path.relative_to(_APP_ROOT.parent).with_suffix("").parts
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def _package_of(path: Path) -> str:
    module = _module_name(path)
    return module if path.name == "__init__.py" else module.rpartition(".")[0]


def _imported_modules(path: Path) -> Iterator[str]:
    package = _package_of(path)
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                anchor = package.rsplit(".", node.level - 1)[0]
                base = f"{anchor}.{base}" if base else anchor
            for alias in node.names:
                yield base if alias.name == "*" else f"{base}.{alias.name}"


def _matches(module: str, package: str) -> bool:
    return module == package or module.startswith(f"{package}.")


def _app_imports(path: Path) -> set[str]:
    return {module for module in _imported_modules(path) if _matches(module, "app")}


@pytest.mark.parametrize("name", MODULES)
def test_appModules_importingModule_onlyMain(name: str) -> None:
    root = _APP_ROOT / name
    importers = sorted(
        str(path.relative_to(_APP_ROOT).as_posix())
        for path in _APP_ROOT.rglob("*.py")
        if not path.is_relative_to(root)
        and any(_matches(module, f"app.{name}") for module in _app_imports(path))
    )

    assert importers == ["main.py"]


@pytest.mark.parametrize("name", MODULES)
def test_moduleCode_outsideInfrastructure_importsOnlyAllowedPackages(name: str) -> None:
    root = _APP_ROOT / name
    offenders = []
    for path in sorted(root.rglob("*.py")):
        if path.is_relative_to(root / "infrastructure"):
            continue
        allowed = (
            (f"app.{name}.domain",)
            if path.is_relative_to(root / "domain")
            else ("app.core", "app.db", "app.storage", f"app.{name}")
        )
        offenders.extend(
            f"{path.relative_to(_APP_ROOT).as_posix()}: {module}"
            for module in sorted(_app_imports(path))
            if not any(_matches(module, package) for package in allowed)
        )

    assert offenders == []


@pytest.mark.parametrize("name", MODULES)
def test_moduleAcls_importingOwnSchemas_none(name: str) -> None:
    offenders = sorted(
        f"{path.relative_to(_APP_ROOT).as_posix()}: {module}"
        for path in (_APP_ROOT / name / "infrastructure").rglob("*.py")
        for module in _app_imports(path)
        if _matches(module, f"app.{name}.schemas")
    )

    assert offenders == []


def test_searchLinks_termAndEventPaths_matchPagesLinks() -> None:
    # The boundary keeps search from importing `app.pages`, so it holds copies.
    from app.pages.domain import links as pages_links
    from app.search.domain import links as search_links

    slug, group_id, term_id, event_id = "zielony-krag", uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    term = search_links.term_path(slug, group_id, term_id)
    event = search_links.event_path(slug, event_id)

    assert term == pages_links.term_path(slug, group_id, term_id)
    assert event == pages_links.event_path(slug, event_id)
