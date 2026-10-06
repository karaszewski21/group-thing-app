"""`/api/terms` and `/api/needed-items` routes."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.core.errors import EntityNotFoundException
from app.core.pagination import Page, Pagination
from app.db import get_db
from app.groups import service
from app.groups.schemas import (
    CreateNeededItemRequest,
    CreateTermRequest,
    ModerationTermResponse,
    NeededItemResponse,
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


# --- Term / NeededItem ----------------------------------------------------------


@router.post("/api/terms", response_model=TermResponse, status_code=status.HTTP_201_CREATED)
async def create_term(
    body: CreateTermRequest, db: DbSession, principal: EditPrincipal
) -> TermResponse:
    term = await service.create_term(db, principal, body)
    return TermResponse.model_validate(term)


@router.get("/api/terms", response_model=list[TermResponse])
async def list_terms(
    circle_group_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> list[TermResponse]:
    """`attendee_count`/`child_count` are filled only for the Circle's active
    organizer; a caller without a profile is treated as a non-organizer."""
    try:
        caller_party_id: uuid.UUID | None = (await get_profile_by_principal(db, principal)).party_id
    except EntityNotFoundException:
        caller_party_id = None

    rows = await service.list_terms_with_counts(db, circle_group_id, caller_party_id)
    responses = []
    for term, attendee_count, child_count in rows:
        response = TermResponse.model_validate(term)
        response.attendee_count = attendee_count
        response.child_count = child_count
        responses.append(response)
    return responses


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
    return TermResponse.model_validate(term)


@router.patch("/api/terms/{term_id}", response_model=TermResponse)
async def update_term(
    term_id: uuid.UUID, body: UpdateTermRequest, db: DbSession, principal: EditPrincipal
) -> TermResponse:
    profile = await get_profile_by_principal(db, principal)
    term = await service.update_term(db, term_id, profile.party_id, body)
    return TermResponse.model_validate(term)


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
    term_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> list[NeededItemResponse]:
    views = await service.list_needed_item_views(db, term_id)
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
