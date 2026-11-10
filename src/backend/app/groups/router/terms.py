"""`/api/terms`, `/api/groups/{mine,{group_id}}/terms` and `/api/needed-items` routes."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.core.errors import EntityNotFoundException
from app.core.pagination import Page, Pagination
from app.db import get_db
from app.groups import service
from app.groups.models import Term
from app.groups.schemas import (
    CreateNeededItemRequest,
    CreateTermRequest,
    ModerationTermResponse,
    MyTermResponse,
    MyTermRole,
    NeededItemResponse,
    TermPeriod,
    TermResponse,
    UpdateNeededItemRequest,
    UpdateTermRequest,
)
from app.users.service import get_profile_by_principal

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
ModerationPrincipal = Annotated[Principal, Depends(require_any("ADMIN"))]

MAX_NEEDED_ITEMS_TERM_IDS = 100


# --- Term / NeededItem ----------------------------------------------------------


async def _term_response(db: AsyncSession, term: Term) -> TermResponse:
    """A single `TermResponse` with its place (soft-deleted rows included)."""
    response = TermResponse.model_validate(term)
    response.location = service.location_ref_response(
        await service.get_location(db, term.location_id)
    )
    return response


@router.post("/api/terms", response_model=TermResponse, status_code=status.HTTP_201_CREATED)
async def create_term(
    body: CreateTermRequest, db: DbSession, principal: EditPrincipal
) -> TermResponse:
    term = await service.create_term(db, principal, body)
    return await _term_response(db, term)


async def _caller_party_id(db: AsyncSession, principal: Principal) -> uuid.UUID | None:
    """`None` for a caller without a profile (e.g. an OAuth client)."""
    try:
        return (await get_profile_by_principal(db, principal)).party_id
    except EntityNotFoundException:
        return None


@router.get("/api/groups/mine/terms", response_model=Page[MyTermResponse])
async def list_my_terms(
    role: MyTermRole, db: DbSession, principal: ReadPrincipal, pagination: Pagination
) -> Page[MyTermResponse]:
    """The caller's terms for the panel, latest date first, one page at a
    time. Registered (with this router) ahead of the `/api/groups/{group_id}/...`
    routes."""
    profile = await get_profile_by_principal(db, principal)
    return await service.list_my_terms_page(db, profile.party_id, role, pagination)


@router.get("/api/groups/{group_id}/terms", response_model=Page[TermResponse])
async def list_group_terms(
    group_id: uuid.UUID,
    db: DbSession,
    principal: ReadPrincipal,
    pagination: Pagination,
    period: TermPeriod | None = None,
) -> Page[TermResponse]:
    """A Circle's terms, one page at a time; without `period` every term,
    latest first. `attendee_count`/`child_count` are filled only for the
    Circle's active organizer."""
    caller_party_id = await _caller_party_id(db, principal)
    return await service.list_group_terms_page(db, group_id, caller_party_id, period, pagination)


@router.get("/api/terms/moderation", response_model=Page[ModerationTermResponse])
async def list_terms_for_moderation(
    db: DbSession, principal: ModerationPrincipal, pagination: Pagination
) -> Page[ModerationTermResponse]:
    """ADMIN-only: the latest Terms of every Circle. Registered ahead of
    `get_term` so `moderation` isn't parsed as a `{term_id}`."""
    terms, total = await service.list_terms_for_moderation(db, pagination)
    return Page(items=terms, total=total, page=pagination.page, size=pagination.size)


@router.get("/api/terms/{term_id}", response_model=TermResponse)
async def get_term(term_id: uuid.UUID, db: DbSession, principal: ReadPrincipal) -> TermResponse:
    term = await service.get_term(db, term_id)
    return await _term_response(db, term)


@router.patch("/api/terms/{term_id}", response_model=TermResponse)
async def update_term(
    term_id: uuid.UUID, body: UpdateTermRequest, db: DbSession, principal: EditPrincipal
) -> TermResponse:
    profile = await get_profile_by_principal(db, principal)
    term = await service.update_term(db, term_id, profile.party_id, body)
    return await _term_response(db, term)


@router.post(
    "/api/needed-items", response_model=NeededItemResponse, status_code=status.HTTP_201_CREATED
)
async def create_needed_item(
    body: CreateNeededItemRequest, db: DbSession, principal: EditPrincipal
) -> NeededItemResponse:
    view = await service.create_needed_item(db, principal, body)
    return NeededItemResponse.model_validate(view)


@router.get("/api/needed-items", response_model=list[NeededItemResponse])
async def list_needed_items(
    term_id: Annotated[list[uuid.UUID], Query(min_length=1, max_length=MAX_NEEDED_ITEMS_TERM_IDS)],
    db: DbSession,
    principal: ReadPrincipal,
) -> list[NeededItemResponse]:
    """`term_id` repeats (`?term_id=a&term_id=b`) to read the needs of
    several Terms in one request, ordered by term; unknown terms are skipped
    unless only one is asked for (then 404)."""
    views = await service.list_needed_item_views_for_terms(db, term_id)
    return [NeededItemResponse.model_validate(view) for view in views]


@router.get("/api/needed-items/{needed_item_id}", response_model=NeededItemResponse)
async def get_needed_item(
    needed_item_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> NeededItemResponse:
    view = await service.get_needed_item_view(db, needed_item_id)
    return NeededItemResponse.model_validate(view)


@router.patch("/api/needed-items/{needed_item_id}", response_model=NeededItemResponse)
async def update_needed_item(
    needed_item_id: uuid.UUID,
    body: UpdateNeededItemRequest,
    db: DbSession,
    principal: EditPrincipal,
) -> NeededItemResponse:
    profile = await get_profile_by_principal(db, principal)
    view = await service.update_needed_item(db, needed_item_id, profile.party_id, body)
    return NeededItemResponse.model_validate(view)


@router.delete("/api/needed-items/{needed_item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_needed_item(needed_item_id: uuid.UUID, db: DbSession, principal: EditPrincipal) -> None:
    profile = await get_profile_by_principal(db, principal)
    await service.soft_delete_needed_item(db, needed_item_id, profile.party_id)
    return None
