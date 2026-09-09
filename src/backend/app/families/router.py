"""`/api/families` routes."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups.schemas import MembershipResponse
from app.groups.service import build_membership_responses
from app.users.service import get_profile_by_principal

from . import service
from .schemas import (
    AddGuardianRequest,
    CreateFamilyRequest,
    CreateLightweightMembersBatchRequest,
    CreateOwnFamilyRequest,
    FamilyOut,
    FamilyResponse,
    GuardianResponse,
    UpdateFamilyRequest,
)

router = APIRouter(tags=["families"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.post("/api/families", response_model=FamilyResponse, status_code=status.HTTP_201_CREATED)
async def create_family(
    body: CreateFamilyRequest, db: DbSession, principal: EditPrincipal
) -> FamilyResponse:
    family, _guardian_profile_id = await service.create_family(db, body)
    memberships = await service.list_guardian_memberships(db, cast(int, family.id))
    guardians = await service.build_guardian_responses(db, memberships)
    return FamilyResponse(family=FamilyOut.model_validate(family), guardians=guardians)


@router.get("/api/families/mine", response_model=list[FamilyOut])
async def list_my_families(db: DbSession, principal: ReadPrincipal) -> list[FamilyOut]:
    """Resolves the calling guardian's own Family/Families — replaces the
    old `Person.family_group_id` flat field now that family membership is a
    role + relationship, not a direct FK."""
    profile = await get_profile_by_principal(db, principal)
    families = await service.list_families_for_guardian_party(db, profile.party_id)
    out: list[FamilyOut] = []
    for family in families:
        item = FamilyOut.model_validate(family)
        item.child_count = await service.count_active_child_members(db, cast(int, family.id))
        out.append(item)
    return out


@router.post("/api/families/mine", response_model=FamilyOut, status_code=status.HTTP_201_CREATED)
async def create_own_family(
    body: CreateOwnFamilyRequest, db: DbSession, principal: EditPrincipal
) -> FamilyOut:
    """Idempotent create-own family with a caller-supplied name — a caller
    who already guards a Family gets it back unchanged (rename is `PATCH`).
    Registered ahead of `get_family` per the `/mine`-before-`/{id}`
    convention."""
    profile = await get_profile_by_principal(db, principal)
    family = await service.create_own_family(db, profile.party_id, body.name)
    out = FamilyOut.model_validate(family)
    out.child_count = await service.count_active_child_members(db, cast(int, family.id))
    return out


@router.patch("/api/families/{family_id}", response_model=FamilyOut)
async def rename_family(
    family_id: int, body: UpdateFamilyRequest, db: DbSession, principal: EditPrincipal
) -> FamilyOut:
    """Guardian-only in-place rename. The fine-grained guardian check lives
    in `service.rename_family` (raises `AccessDeniedException` -> 403),
    consistent with the organization precedent."""
    profile = await get_profile_by_principal(db, principal)
    family = await service.rename_family(db, family_id, profile.party_id, body.name)
    out = FamilyOut.model_validate(family)
    out.child_count = await service.count_active_child_members(db, cast(int, family.id))
    return out


@router.post(
    "/api/families/mine/members", response_model=FamilyResponse, status_code=status.HTTP_201_CREATED
)
async def create_lightweight_members(
    body: CreateLightweightMembersBatchRequest, db: DbSession, principal: EditPrincipal
) -> FamilyResponse:
    """Bootstraps the calling guardian's own Family on first call (see
    `service.create_lightweight_members_batch`), then adds every batch
    member (no login of their own) to it."""
    profile = await get_profile_by_principal(db, principal)
    family = await service.create_lightweight_members_batch(db, profile.party_id, body.members)
    memberships = await service.list_guardian_memberships(db, cast(int, family.id))
    guardians = await service.build_guardian_responses(db, memberships)
    return FamilyResponse(family=FamilyOut.model_validate(family), guardians=guardians)


@router.get("/api/families/by-guardian-party/{party_id}", response_model=list[FamilyOut])
async def list_families_for_guardian_party(
    party_id: int, db: DbSession, principal: ReadPrincipal
) -> list[FamilyOut]:
    """Same lookup as `/api/families/mine`, but for an arbitrary party
    (e.g. resolving which Family a fellow Circle member belongs to) rather
    than the calling principal."""
    families = await service.list_families_for_guardian_party(db, party_id)
    return [FamilyOut.model_validate(family) for family in families]


@router.get("/api/families/{family_id}", response_model=FamilyResponse)
async def get_family(family_id: int, db: DbSession, principal: ReadPrincipal) -> FamilyResponse:
    family = await service.get_family(db, family_id)
    memberships = await service.list_guardian_memberships(db, family_id)
    guardians = await service.build_guardian_responses(db, memberships)
    return FamilyResponse(family=FamilyOut.model_validate(family), guardians=guardians)


@router.post(
    "/api/families/{family_id}/guardians",
    response_model=GuardianResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_guardian(
    family_id: int, body: AddGuardianRequest, db: DbSession, principal: EditPrincipal
) -> GuardianResponse:
    new_guardian_profile_id = await service.add_guardian(db, family_id, body)
    memberships = await service.list_guardian_memberships(db, family_id)
    guardians = await service.build_guardian_responses(db, memberships)
    return next(g for g in guardians if g.user_profile_id == new_guardian_profile_id)


@router.get("/api/families/{family_id}/guardians", response_model=list[GuardianResponse])
async def list_guardians(
    family_id: int, db: DbSession, principal: ReadPrincipal
) -> list[GuardianResponse]:
    memberships = await service.list_guardian_memberships(db, family_id)
    return await service.build_guardian_responses(db, memberships)


@router.post(
    "/api/families/{family_id}/guardians/{family_membership_id}/make-primary",
    response_model=list[GuardianResponse],
)
async def make_primary_contact(
    family_id: int, family_membership_id: int, db: DbSession, principal: EditPrincipal
) -> list[GuardianResponse]:
    await service.make_primary_contact(db, family_id, family_membership_id)
    memberships = await service.list_guardian_memberships(db, family_id)
    return await service.build_guardian_responses(db, memberships)


@router.get("/api/families/{family_id}/memberships", response_model=list[MembershipResponse])
async def list_memberships_for_family(
    family_id: int, db: DbSession, principal: ReadPrincipal
) -> list[MembershipResponse]:
    memberships = await service.list_group_memberships_for_family(db, family_id)
    rows = await build_membership_responses(db, memberships)
    return [MembershipResponse(**row) for row in rows]
