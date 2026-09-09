"""`/api/groups`, `/api/leaderships`, `/api/memberships`, `/api/terms`,
`/api/needed-items` and `/api/pledges` routes."""

from __future__ import annotations

from datetime import date
from typing import Annotated, cast

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import OptionalPrincipal, Principal, require_any
from app.core.security import encode_login_token
from app.db import get_db
from app.users.service import get_profile_by_principal

from . import service
from .schemas import (
    AssignLeadershipRequest,
    CreateCircleRequest,
    CreateMembershipRequest,
    CreateNeededItemRequest,
    CreateOwnCircleRequest,
    CreatePledgeRequest,
    CreateRsvpRequest,
    CreateTermRequest,
    FulfillPledgeRequest,
    GroupResponse,
    LeadershipResponse,
    MembershipResponse,
    MergeAnonymousProfileRequest,
    MergeAnonymousProfileResponse,
    MyAttendanceResponse,
    NeededItemResponse,
    PledgeResponse,
    PublicCircleResponse,
    RsvpResponse,
    TermResponse,
)

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


# --- Groups (Circles) --------------------------------------------------------


@router.post("/api/groups", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_circle(
    body: CreateCircleRequest, db: DbSession, principal: EditPrincipal
) -> GroupResponse:
    group = await service.create_circle(db, body)
    response = GroupResponse.model_validate(group)
    response.organizer_slug = await service.resolve_organizer_slug(db, cast(int, group.id))
    return response


@router.post("/api/groups/mine", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_my_circle(
    body: CreateOwnCircleRequest, db: DbSession, principal: EditPrincipal
) -> GroupResponse:
    profile = await get_profile_by_principal(db, principal)
    circle = await service.create_own_circle(db, profile.party_id, body.name)
    response = GroupResponse.model_validate(circle)
    response.organizer_slug = await service.resolve_organizer_slug(db, cast(int, circle.id))
    return response


@router.get("/api/groups", response_model=list[GroupResponse])
async def list_groups(db: DbSession, principal: ReadPrincipal) -> list[GroupResponse]:
    groups = await service.list_groups(db)
    return [GroupResponse.model_validate(group) for group in groups]


@router.get("/api/groups/public/{group_id}", response_model=PublicCircleResponse)
async def get_public_circle(
    group_id: int, db: DbSession, term_id: int | None = None
) -> PublicCircleResponse:
    """Unauthenticated — the page a shared `/<slug>/grupa/<groupId>/term/<termId>`
    (or term-less `/<slug>/grupa/<groupId>`) link resolves to. Still matched
    by the unchanged `^/api/groups/public/[^/]+$` PUBLIC row in
    `AUTHORIZATION_MATRIX` (declared ahead of the blanket `/api/groups` READ
    row) — `term_id` is a query parameter, not a path segment, so the path
    match is unaffected and no new matrix row / `Depends` / route-order
    change is needed. Must be registered ahead of `get_group` below, since
    `/public/{id}` would otherwise be swallowed by `{group_id}: int` and
    fail path-param conversion instead of matching here.

    `term_id` given: that exact Term drives the view (404 if it does not
    exist or belongs to another Circle). `term_id` omitted: the nearest
    upcoming Term is picked (else the most recent past Term)."""
    return await service.get_public_circle_view(db, group_id, term_id)


@router.post(
    "/api/groups/public/{group_id}/rsvp",
    response_model=RsvpResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_rsvp(
    group_id: int, body: CreateRsvpRequest, db: DbSession, principal: OptionalPrincipal = None
) -> RsvpResponse:
    """Unauthenticated — anyone with the public circle-page link may RSVP
    without an account (no `Depends(require_any(...))`; stays PUBLIC in
    `AUTHORIZATION_MATRIX`). A valid session token is optionally honoured
    via `get_current_principal`: it attaches the `TermAttendance` to the
    caller's existing party (idempotent per `(party, term)`) instead of
    minting a new anonymous profile. A missing / malformed / expired token
    degrades silently to the anonymous path — never a 401."""
    return await service.create_rsvp(
        db, group_id, body.term_id, body.guardian_name, body.child_count, principal
    )


@router.post("/api/groups/public/merge", response_model=MergeAnonymousProfileResponse)
async def merge_anonymous_profile(
    body: MergeAnonymousProfileRequest, db: DbSession
) -> MergeAnonymousProfileResponse:
    """Unauthenticated — merges an anonymous RSVP's `UserProfile` into a
    newly-created account. Builds the response the same way
    `register()`'s router does (`app/users/router.py`); ownership/identity
    conflict checks live in `service.merge_anonymous_profile`, not here."""
    user, profile = await service.merge_anonymous_profile(
        db, body.user_profile_id, body.email, body.password
    )
    token = encode_login_token(
        user.username, ["READ", "EDIT"], settings.jwt_secret, settings.jwt_expiration_ms
    )
    return MergeAnonymousProfileResponse(token=token, party_id=profile.party_id)


@router.get("/api/groups/mine/attendances", response_model=list[MyAttendanceResponse])
async def list_my_attendances(
    db: DbSession, principal: ReadPrincipal
) -> list[MyAttendanceResponse]:
    """The caller's own Term RSVPs (R10). Registered ahead of `get_group`
    below so the literal `mine/attendances` segments aren't consumed by
    `{group_id}: int` path conversion. Caller's party is derived from the
    principal — no ownership check beyond authentication + READ."""
    profile = await get_profile_by_principal(db, principal)
    return await service.list_my_attendances(db, profile.party_id)


@router.get("/api/groups/{group_id}", response_model=GroupResponse)
async def get_group(group_id: int, db: DbSession, principal: ReadPrincipal) -> GroupResponse:
    group = await service.get_group(db, group_id)
    response = GroupResponse.model_validate(group)
    response.organizer_slug = await service.resolve_organizer_slug(db, group_id)
    return response


@router.get("/api/groups/{group_id}/leadership", response_model=LeadershipResponse | None)
async def get_current_leadership(
    group_id: int, db: DbSession, principal: ReadPrincipal
) -> LeadershipResponse | None:
    leadership = await service.get_current_leadership(db, group_id)
    if leadership is None:
        return None
    rows = await service.build_leadership_responses(db, [leadership])
    return LeadershipResponse(**rows[0])


@router.get("/api/groups/{group_id}/leaderships", response_model=list[LeadershipResponse])
async def list_leaderships(
    group_id: int, db: DbSession, principal: ReadPrincipal
) -> list[LeadershipResponse]:
    leaderships = await service.list_leaderships(db, group_id)
    rows = await service.build_leadership_responses(db, leaderships)
    return [LeadershipResponse(**row) for row in rows]


@router.get("/api/groups/{group_id}/memberships", response_model=list[MembershipResponse])
async def list_memberships_for_circle(
    group_id: int, db: DbSession, principal: ReadPrincipal
) -> list[MembershipResponse]:
    memberships = await service.list_memberships_for_circle(db, group_id)
    rows = await service.build_membership_responses(db, memberships)
    return [MembershipResponse(**row) for row in rows]


# --- Leadership ---------------------------------------------------------------


@router.post(
    "/api/leaderships", response_model=LeadershipResponse, status_code=status.HTTP_201_CREATED
)
async def assign_leadership(
    body: AssignLeadershipRequest, db: DbSession, principal: EditPrincipal
) -> LeadershipResponse:
    leadership = await service.assign_leadership(
        db, body.group_id, body.organizer_party_id, body.valid_from
    )
    rows = await service.build_leadership_responses(db, [leadership])
    return LeadershipResponse(**rows[0])


@router.post("/api/leaderships/{leadership_id}/end", response_model=LeadershipResponse)
async def remove_leadership(
    leadership_id: int, db: DbSession, principal: EditPrincipal, valid_to: date | None = None
) -> LeadershipResponse:
    leadership = await service.remove_leadership(db, leadership_id, valid_to or date.today())
    rows = await service.build_leadership_responses(db, [leadership])
    return LeadershipResponse(**rows[0])


# --- Membership ----------------------------------------------------------------


@router.post(
    "/api/memberships", response_model=MembershipResponse, status_code=status.HTTP_201_CREATED
)
async def create_membership(
    body: CreateMembershipRequest, db: DbSession, principal: EditPrincipal
) -> MembershipResponse:
    membership = await service.create_membership(db, principal, body)
    rows = await service.build_membership_responses(db, [membership])
    return MembershipResponse(**rows[0])


@router.post("/api/memberships/{membership_id}/end", response_model=MembershipResponse)
async def end_membership(
    membership_id: int, db: DbSession, principal: EditPrincipal, valid_to: date | None = None
) -> MembershipResponse:
    membership = await service.end_membership(
        db, principal, membership_id, valid_to or date.today()
    )
    rows = await service.build_membership_responses(db, [membership])
    return MembershipResponse(**rows[0])


# --- Term / NeededItem ----------------------------------------------------------


@router.post("/api/terms", response_model=TermResponse, status_code=status.HTTP_201_CREATED)
async def create_term(
    body: CreateTermRequest, db: DbSession, principal: EditPrincipal
) -> TermResponse:
    term = await service.create_term(db, principal, body)
    return TermResponse.model_validate(term)


@router.get("/api/terms", response_model=list[TermResponse])
async def list_terms(
    circle_group_id: int, db: DbSession, principal: ReadPrincipal
) -> list[TermResponse]:
    terms = await service.list_terms(db, circle_group_id)
    return [TermResponse.model_validate(term) for term in terms]


@router.get("/api/terms/{term_id}", response_model=TermResponse)
async def get_term(term_id: int, db: DbSession, principal: ReadPrincipal) -> TermResponse:
    term = await service.get_term(db, term_id)
    return TermResponse.model_validate(term)


@router.post(
    "/api/needed-items", response_model=NeededItemResponse, status_code=status.HTTP_201_CREATED
)
async def create_needed_item(
    body: CreateNeededItemRequest, db: DbSession, principal: EditPrincipal
) -> NeededItemResponse:
    needed_item = await service.create_needed_item(db, principal, body)
    return NeededItemResponse.model_validate(needed_item)


@router.get("/api/needed-items", response_model=list[NeededItemResponse])
async def list_needed_items(
    term_id: int, db: DbSession, principal: ReadPrincipal
) -> list[NeededItemResponse]:
    needed_items = await service.list_needed_items(db, term_id)
    return [NeededItemResponse.model_validate(needed_item) for needed_item in needed_items]


@router.get("/api/needed-items/{needed_item_id}", response_model=NeededItemResponse)
async def get_needed_item(
    needed_item_id: int, db: DbSession, principal: ReadPrincipal
) -> NeededItemResponse:
    needed_item = await service.get_needed_item(db, needed_item_id)
    return NeededItemResponse.model_validate(needed_item)


# --- Pledge --------------------------------------------------------------------


@router.post("/api/pledges", response_model=PledgeResponse, status_code=status.HTTP_201_CREATED)
async def create_pledge(
    body: CreatePledgeRequest, db: DbSession, principal: EditPrincipal
) -> PledgeResponse:
    pledge = await service.create_pledge(db, principal, body.needed_item_id)
    return PledgeResponse.model_validate(pledge)


@router.get("/api/pledges", response_model=list[PledgeResponse])
async def list_pledges(
    needed_item_id: int, db: DbSession, principal: ReadPrincipal
) -> list[PledgeResponse]:
    pledges = await service.list_pledges(db, needed_item_id)
    return [PledgeResponse.model_validate(pledge) for pledge in pledges]


@router.get("/api/pledges/{pledge_id}", response_model=PledgeResponse)
async def get_pledge(pledge_id: int, db: DbSession, principal: ReadPrincipal) -> PledgeResponse:
    pledge = await service.get_pledge(db, pledge_id)
    return PledgeResponse.model_validate(pledge)


@router.post("/api/pledges/{pledge_id}/withdraw", response_model=PledgeResponse)
async def withdraw_pledge(
    pledge_id: int, db: DbSession, principal: EditPrincipal
) -> PledgeResponse:
    pledge = await service.withdraw_pledge(db, principal, pledge_id)
    return PledgeResponse.model_validate(pledge)


@router.post("/api/pledges/{pledge_id}/fulfill", response_model=PledgeResponse)
async def fulfill_pledge(
    pledge_id: int, body: FulfillPledgeRequest, db: DbSession, principal: EditPrincipal
) -> PledgeResponse:
    pledge = await service.fulfill_pledge(db, principal, pledge_id, body)
    return PledgeResponse.model_validate(pledge)


@router.post("/api/pledges/{pledge_id}/sync", response_model=PledgeResponse)
async def sync_pledge_fulfillment(
    pledge_id: int, db: DbSession, principal: EditPrincipal
) -> PledgeResponse:
    pledge = await service.sync_pledge_fulfillment(db, pledge_id)
    return PledgeResponse.model_validate(pledge)
