"""`/api/groups` routes — circles, their public-page views, RSVP, anonymous
profile merge, the caller's own attendances, and per-circle leadership /
membership listings.

Handler declaration order is load-bearing: `/api/groups/mine/attendances`,
`/api/groups/public/{group_id}`, `POST .../public/{group_id}/rsvp`,
`POST .../public/merge` and `PATCH /api/groups/{group_id}` are declared
BEFORE `GET /api/groups/{group_id}` so FastAPI (which matches in
registration order) does not swallow the literal segments into
`{group_id}: int`.
"""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import OptionalPrincipal, Principal, require_any
from app.core.security import encode_login_token
from app.db import get_db
from app.groups import service
from app.groups.schemas import (
    CreateCircleRequest,
    CreateOwnCircleRequest,
    CreateRsvpRequest,
    FamilyExchangeDetailResponse,
    FormalizeGroupFromTermRequest,
    GroupAccessResponse,
    GroupExchangeSummaryResponse,
    GroupResponse,
    JoinGroupRequest,
    JoinGroupResponse,
    LeadershipResponse,
    MembershipResponse,
    MergeAnonymousProfileRequest,
    MergeAnonymousProfileResponse,
    ModerationGroupResponse,
    MyAttendanceResponse,
    PublicCircleResponse,
    RsvpResponse,
    TermAttendeeResponse,
    UpdateGroupRequest,
    WithdrawAttendanceResponse,
)
from app.users.service import get_profile_by_principal

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
ModerationPrincipal = Annotated[Principal, Depends(require_any("ADMIN"))]


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
    """Idempotent 'become an Organizer' — a caller who already leads a
    Circle gets that same Circle back. Used by the one-time first-circle
    flows (`FirstTermStepperGuest`, onboarding); NOT for the Panel's
    "+ Dodaj grupę" (see `create_additional_my_circle` below)."""
    profile = await get_profile_by_principal(db, principal)
    circle = await service.create_own_circle(db, profile.party_id, body.name)
    response = GroupResponse.model_validate(circle)
    response.organizer_slug = await service.resolve_organizer_slug(db, cast(int, circle.id))
    return response


@router.post(
    "/api/groups/mine/new", response_model=GroupResponse, status_code=status.HTTP_201_CREATED
)
async def create_additional_my_circle(
    body: CreateOwnCircleRequest, db: DbSession, principal: EditPrincipal
) -> GroupResponse:
    """Non-idempotent — always creates a brand new Circle led by the caller.
    The Panel's "+ Dodaj grupę" button (adding another Circle to an
    organizer who already leads one or more) targets this, never
    `/api/groups/mine` above, whose idempotency would make that button a
    silent no-op for a repeat organizer."""
    profile = await get_profile_by_principal(db, principal)
    circle = await service.create_additional_circle(
        db, profile.party_id, body.name, body.visibility
    )
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


@router.get("/api/groups/public/{group_id}/access", response_model=GroupAccessResponse)
async def get_group_access(
    group_id: int, db: DbSession, principal: OptionalPrincipal = None, term_id: int | None = None
) -> GroupAccessResponse:
    """Unauthenticated-friendly (mirrors `get_public_circle` above — same
    `PUBLIC` matrix row, `/access` is an extra path segment so it never
    collides with `/public/{group_id}`'s match). A valid session token is
    optionally honoured to resolve `access.is_member`/`access.is_organizer`;
    a missing/malformed/expired token degrades to both `False`, never a 401
    — replaces the frontend's previous "any auth token = member view"
    heuristic with a real, server-resolved relationship."""
    return await service.get_group_access(db, group_id, term_id, principal)


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


@router.post(
    "/api/groups/public/{group_id}/join",
    response_model=JoinGroupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def join_private_group(
    group_id: int,
    body: JoinGroupRequest,
    db: DbSession,
    principal: Annotated[Principal, Depends(require_any())],
) -> JoinGroupResponse:
    """Authenticated-only — the group-level "join on a standing basis" link
    for a `PRIVATE` group (404 if `group_id` isn't currently `PRIVATE`).
    Unlike `create_rsvp`, an unauthenticated caller is rejected with a 401
    (via `Depends(require_any())`, "just authenticated", matching row 25's
    `"AUTHENTICATED"` matrix catch-all) before `service.join_private_group`
    ever runs — no anonymous join path exists for standing membership of a
    `PRIVATE` group."""
    return await service.join_private_group(
        db, group_id, body.guardian_name, body.child_count, principal
    )


@router.get(
    "/api/groups/{group_id}/terms/{term_id}/attendees",
    response_model=list[TermAttendeeResponse],
)
async def list_term_attendees(
    group_id: int, term_id: int, db: DbSession, principal: EditPrincipal
) -> list[TermAttendeeResponse]:
    """Candidate list for the organizer's "formalize standing members"
    picker — covered by row 27's blanket `GET ^/api/groups(/.*)?$` READ/EDIT
    rows, no new matrix row needed. Organizer-only check happens inside
    `service.list_term_attendees_for_formalization`."""
    return await service.list_term_attendees_for_formalization(db, principal, group_id, term_id)


@router.post(
    "/api/groups/{group_id}/terms/{term_id}/formalize",
    response_model=GroupResponse,
)
async def formalize_group_from_term(
    group_id: int,
    term_id: int,
    body: FormalizeGroupFromTermRequest,
    db: DbSession,
    principal: EditPrincipal,
) -> GroupResponse:
    """Turns the selected term attendees into standing `Membership`s —
    covered by row 27's blanket `POST ^/api/groups(/.*)?$` EDIT row, no new
    matrix row needed. Organizer-ownership check happens inside
    `service.formalize_group_from_term`; no visibility involvement."""
    group = await service.formalize_group_from_term(
        db, principal, group_id, term_id, body.party_ids
    )
    response = GroupResponse.model_validate(group)
    response.organizer_slug = await service.resolve_organizer_slug(db, group_id)
    return response


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


@router.post(
    "/api/groups/mine/attendances/{attendance_id}/withdraw",
    response_model=WithdrawAttendanceResponse,
)
async def withdraw_attendance(
    attendance_id: int, db: DbSession, principal: EditPrincipal
) -> WithdrawAttendanceResponse:
    """Idempotent withdrawal of the caller's own Term RSVP. Registered
    among the other literal `/mine/...` routes above, ahead of `get_group`
    below, for the same route-ordering reason as `list_my_attendances`.
    Covered by row 27's blanket `POST ^/api/groups(/.*)?$` EDIT row — no
    new matrix row needed (see `test_authorization_matrix.py`)."""
    attendance = await service.withdraw_attendance(db, principal, attendance_id)
    return WithdrawAttendanceResponse.model_validate(attendance)


@router.get("/api/groups/moderation", response_model=list[ModerationGroupResponse])
async def list_groups_for_moderation(
    db: DbSession, principal: ModerationPrincipal
) -> list[ModerationGroupResponse]:
    """ADMIN-only: every Circle in the system with its current organizer and
    member/term counts. Registered ahead of `get_group` below so the
    literal `moderation` segment isn't consumed by `{group_id}: int` path
    conversion — same reasoning as `list_my_attendances` above."""
    return await service.list_groups_for_moderation(db)


@router.patch("/api/groups/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: int, body: UpdateGroupRequest, db: DbSession, principal: EditPrincipal
) -> GroupResponse:
    profile = await get_profile_by_principal(db, principal)
    group = await service.update_group(
        db, group_id, profile.party_id, body.name, body.layout_mode, body.visibility
    )
    response = GroupResponse.model_validate(group)
    response.organizer_slug = await service.resolve_organizer_slug(db, group_id)
    return response


@router.get("/api/groups/{group_id}", response_model=GroupResponse)
async def get_group(group_id: int, db: DbSession, principal: ReadPrincipal) -> GroupResponse:
    group = await service.get_group(db, group_id)
    response = GroupResponse.model_validate(group)
    response.organizer_slug = await service.resolve_organizer_slug(db, group_id)
    return response


@router.get(
    "/api/groups/{group_id}/exchange-summary", response_model=GroupExchangeSummaryResponse
)
async def get_exchange_summary(
    group_id: int, db: DbSession, principal: ReadPrincipal
) -> GroupExchangeSummaryResponse:
    """`shares_item`/`brings_item` per family currently in `group_id`.
    Membership/leadership check happens inside `service.get_group_exchange_summary`
    (raises `AccessDeniedException` -> 403 via the global exception handler) —
    no additional check needed here, covered by row 26's blanket
    `GET ^/api/groups(/.*)?$` READ row."""
    profile = await get_profile_by_principal(db, principal)
    return await service.get_group_exchange_summary(db, group_id, profile.party_id)


@router.get(
    "/api/groups/{group_id}/families/{family_id}/exchange-offers",
    response_model=FamilyExchangeDetailResponse,
)
async def get_family_exchange_offers(
    group_id: int, family_id: int, db: DbSession, principal: ReadPrincipal
) -> FamilyExchangeDetailResponse:
    """Every active exchange-mechanism offer from any guardian of
    `family_id`, for `group_id`'s current Term. Membership/leadership and
    family-in-group checks happen inside `service.get_family_exchange_offers`
    (raises `AccessDeniedException` -> 403 / `EntityNotFoundException` -> 404
    via the global exception handlers) — covered by row 26's blanket
    `GET ^/api/groups(/.*)?$` READ row, no additional matrix row needed."""
    profile = await get_profile_by_principal(db, principal)
    return await service.get_family_exchange_offers(db, group_id, family_id, profile.party_id)


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
