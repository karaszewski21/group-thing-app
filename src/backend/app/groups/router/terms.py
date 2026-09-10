"""`/api/terms` and `/api/needed-items` routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups import service
from app.groups.schemas import (
    CreateNeededItemRequest,
    CreateTermRequest,
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


@router.patch("/api/terms/{term_id}", response_model=TermResponse)
async def update_term(
    term_id: int, body: UpdateTermRequest, db: DbSession, principal: EditPrincipal
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


@router.patch("/api/needed-items/{needed_item_id}", response_model=NeededItemResponse)
async def update_needed_item(
    needed_item_id: int,
    body: UpdateNeededItemRequest,
    db: DbSession,
    principal: EditPrincipal,
) -> NeededItemResponse:
    profile = await get_profile_by_principal(db, principal)
    needed_item = await service.update_needed_item(db, needed_item_id, profile.party_id, body)
    return NeededItemResponse.model_validate(needed_item)


@router.delete("/api/needed-items/{needed_item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_needed_item(needed_item_id: int, db: DbSession, principal: EditPrincipal) -> None:
    profile = await get_profile_by_principal(db, principal)
    await service.soft_delete_needed_item(db, needed_item_id, profile.party_id)
    return None
