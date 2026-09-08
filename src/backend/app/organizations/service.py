"""`app.organizations` business logic: Organization CRUD and the
self-service "create my organization" flow. Ownership checks the coarse
`AUTHORIZATION_MATRIX` can't express (only the owning party may update
their own Organization) live here, raising `AccessDeniedException` — per
`standards/backend/security.md`'s guidance."""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.party.models import PartyType
from app.party.service import create_party

from .models import Organization, OrganizationMembership, OrganizationRole, OrganizationRoleType
from .schemas import CreateOwnOrganizationRequest, UpdateOrganizationRequest
from .slugs import RESERVED_SLUGS, slugify

# --- Organizations -------------------------------------------------------------


async def _slug_taken(db: AsyncSession, slug: str) -> bool:
    result = await db.execute(select(Organization.id).where(Organization.slug == slug))
    return result.scalar_one_or_none() is not None


async def _generate_unique_slug(db: AsyncSession, name: str) -> str:
    """Derives a slug from `name`, appending `-2`, `-3`, ... until it is
    neither reserved (`RESERVED_SLUGS`) nor already taken by another
    Organization — this is the whitelist enforcement point: an organizer
    can never end up with `/panel`, `/login`, etc. as their page, they
    silently get `panel-2` instead rather than a rejected save."""
    base = slugify(name)
    candidate = base
    suffix = 2
    while candidate in RESERVED_SLUGS or await _slug_taken(db, candidate):
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


async def create_organization(db: AsyncSession, name: str) -> Organization:
    party = await create_party(db, PartyType.ORGANIZATION)
    slug = await _generate_unique_slug(db, name)
    organization = Organization(party_id=cast(int, party.id), name=name, slug=slug)
    db.add(organization)
    await db.commit()
    await db.refresh(organization)
    return organization


async def get_organization(db: AsyncSession, organization_id: int) -> Organization:
    organization = await db.get(Organization, organization_id)
    if organization is None:
        raise EntityNotFoundException("Organization", organization_id)
    return organization


async def get_organization_by_slug(db: AsyncSession, slug: str) -> Organization | None:
    """Public lookup for the `/<slug>` page — `None` (not an exception) so
    the router can turn a miss into a 404 with the slug in the message."""
    return (
        await db.execute(select(Organization).where(Organization.slug == slug))
    ).scalar_one_or_none()


async def get_own_organization(db: AsyncSession, owner_party_id: int) -> Organization | None:
    """`None` (not an exception) when the caller has no Organization yet —
    callers decide whether that's a 404 (`GET /me`) or a "go ahead and
    create one" signal (`POST /mine`)."""
    membership = (
        await db.execute(
            select(OrganizationMembership)
            .join(OrganizationRole, OrganizationRole.id == OrganizationMembership.from_role_id)
            .where(
                OrganizationRole.party_id == owner_party_id,
                OrganizationRole.role_type == OrganizationRoleType.OWNER,
                OrganizationMembership.valid_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        return None
    return await get_organization(db, cast(int, membership.to_organization_id))


async def create_own_organization(
    db: AsyncSession, owner_party_id: int, data: CreateOwnOrganizationRequest
) -> Organization:
    """Self-service "create my organization": idempotent by design (per
    this module's 1:1 cardinality decision — see model docstrings) — a
    caller who already owns one gets that same Organization back rather
    than a second one, so the onboarding wizard's mandatory step can call
    this safely even on a retry/resume."""
    existing = await get_own_organization(db, owner_party_id)
    if existing is not None:
        return existing

    organization = await create_organization(db, data.name)
    role = await get_or_create_active_organization_role(
        db, owner_party_id, OrganizationRoleType.OWNER
    )
    membership = OrganizationMembership(
        from_role_id=cast(int, role.id),
        to_organization_id=cast(int, organization.id),
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(membership)
    await db.commit()
    return organization


async def update_organization(
    db: AsyncSession, organization_id: int, owner_party_id: int, data: UpdateOrganizationRequest
) -> Organization:
    """Only the Organization's own OWNER may update it — enforced here,
    not by the coarse matrix, per `standards/backend/security.md`."""
    organization = await get_organization(db, organization_id)
    own = await get_own_organization(db, owner_party_id)
    if own is None or own.id != organization.id:
        raise AccessDeniedException("You do not own this Organization")

    if data.name is not None:
        organization.name = data.name
    if data.primary_color is not None:
        organization.primary_color = data.primary_color
    if data.accent_color is not None:
        organization.accent_color = data.accent_color
    await db.commit()
    await db.refresh(organization)
    return organization


# --- OrganizationRole ------------------------------------------------------------


async def get_or_create_active_organization_role(
    db: AsyncSession, party_id: int, role_type: OrganizationRoleType
) -> OrganizationRole:
    """The same active role instance is reused across repeat grants for the
    same party — a role is a standing capacity, not a per-Organization
    record (mirrors `app.groups.service.get_or_create_active_group_role`)."""
    existing = (
        await db.execute(
            select(OrganizationRole).where(
                OrganizationRole.party_id == party_id,
                OrganizationRole.role_type == role_type,
                OrganizationRole.valid_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    role = OrganizationRole(
        party_id=party_id, role_type=role_type, valid_from=date.today(), valid_to=None
    )
    db.add(role)
    await db.flush()
    return role
