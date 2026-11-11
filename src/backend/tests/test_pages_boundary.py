"""Import boundary of `app.pages`: only `app/main.py` imports it, page code
outside `infrastructure/` reaches no other context, and the pages ACLs never
import the pages schemas. Imports are read from the AST, so docstrings and
comments that mention a module do not count."""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"
_PAGES_ROOT = _APP_ROOT / "pages"
_PAGES_ALLOWED = ("app.core", "app.db", "app.storage", "app.pages")


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


def test_appModules_importingPages_onlyMain() -> None:
    importers = sorted(
        str(path.relative_to(_APP_ROOT).as_posix())
        for path in _APP_ROOT.rglob("*.py")
        if not path.is_relative_to(_PAGES_ROOT)
        and any(_matches(module, "app.pages") for module in _app_imports(path))
    )

    assert importers == ["main.py"]


def test_pagesModules_outsideInfrastructure_importOnlyAllowedPackages() -> None:
    offenders = []
    for path in sorted(_PAGES_ROOT.rglob("*.py")):
        if path.is_relative_to(_PAGES_ROOT / "infrastructure"):
            continue
        allowed = (
            ("app.pages.domain",) if path.is_relative_to(_PAGES_ROOT / "domain") else _PAGES_ALLOWED
        )
        offenders.extend(
            f"{path.relative_to(_APP_ROOT).as_posix()}: {module}"
            for module in sorted(_app_imports(path))
            if not any(_matches(module, package) for package in allowed)
        )

    assert offenders == []


def test_pagesAcls_importingPagesSchemas_none() -> None:
    offenders = sorted(
        f"{path.relative_to(_APP_ROOT).as_posix()}: {module}"
        for path in (_PAGES_ROOT / "infrastructure").rglob("*.py")
        for module in _app_imports(path)
        if _matches(module, "app.pages.schemas")
    )

    assert offenders == []
