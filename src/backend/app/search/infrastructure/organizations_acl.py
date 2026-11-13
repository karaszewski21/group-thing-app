"""Anti-corruption layer over `app.organizations`: the ONLY `app.search`
module that imports the organizations vertical. It exposes the
`organizations` table, the Organization a party owns as a LATERAL (the
"org-run" derivation of `get_own_organization`), the "has an owner" check
and the batched owners' Organizations. It must not import `..schemas`."""

from __future__ import annotations

import uuid

from sqlalchemy import ColumnElement, SQLColumnExpression, and_, exists, select
from sqlalchemy.sql.selectable import LateralFromClause

from app.organizations.models import (
    Organization,
    OrganizationMembership,
    OrganizationRole,
    OrganizationRoleType,
)
from app.organizations.service import get_own_organizations_by_party_ids

__all__ = [
    "Organization",
    "get_own_organizations_by_party_ids",
    "has_owner",
    "owned_organization",
]


def _active_ownership() -> ColumnElement[bool]:
    return and_(
        OrganizationRole.id == OrganizationMembership.from_role_id,
        OrganizationRole.role_type == OrganizationRoleType.OWNER,
        OrganizationMembership.valid_to.is_(None),
    )


def owned_organization(party_id: SQLColumnExpression[uuid.UUID]) -> LateralFromClause:
    """LATERAL `(name, slug)` of the Organization `party_id` owns, no row
    without one; the earliest ownership wins."""
    return (
        select(Organization.name.label("name"), Organization.slug.label("slug"))
        .join(OrganizationMembership, OrganizationMembership.to_organization_id == Organization.id)
        .join(OrganizationRole, _active_ownership())
        .where(OrganizationRole.party_id == party_id)
        .order_by(OrganizationMembership.created_at, OrganizationMembership.id)
        .limit(1)
        .lateral("organization")
    )


def has_owner(organization_id: SQLColumnExpression[uuid.UUID]) -> ColumnElement[bool]:
    """The Organization has an active owner, so its `/<slug>` page exists."""
    return exists().where(
        OrganizationMembership.to_organization_id == organization_id, _active_ownership()
    )
