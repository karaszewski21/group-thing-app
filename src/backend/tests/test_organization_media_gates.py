"""Structural gates for organization media: the organizations package must not
depend on the moderation service (the dependency runs the other way, via the
moderation subject map), and the public read model must validate from a bare
ORM `Organization` with empty media defaults."""

from __future__ import annotations

import ast
import uuid
from pathlib import Path

from app.organizations.models import Organization
from app.organizations.schemas import PublicOrganizationResponse
from tests.conftest import BACKEND_ROOT

ORGANIZATIONS_PACKAGE = BACKEND_ROOT / "app" / "organizations"
FORBIDDEN_MODULE = "app.moderation.service"


def _imported_modules(source: Path) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules.add(node.module)
            modules.update(f"{node.module}.{alias.name}" for alias in node.names)
    return modules


def test_organizationsModule_doesNotImportModerationService() -> None:
    offenders = {
        path.name
        for path in ORGANIZATIONS_PACKAGE.glob("*.py")
        if FORBIDDEN_MODULE in _imported_modules(path)
    }

    assert (ORGANIZATIONS_PACKAGE / "media.py").exists()
    assert offenders == set()


def test_publicOrganizationResponse_modelValidateOrm_defaultsMedia() -> None:
    organization = Organization(
        party_id=uuid.uuid4(),
        slug="gates-org",
        name="Gates Org",
        page_layout="CLASSIC",
    )

    response = PublicOrganizationResponse.model_validate(organization)

    assert response.logo is None
    assert response.cover is None
    assert response.gallery == []
