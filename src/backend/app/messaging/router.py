"""`/api/conversations` routes. Get-or-create answers 201 for a new
conversation and 200 for an existing one; access and read-only state are
resolved per request in `application/access.py`."""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db

from . import service
from .schemas import (
    ConversationResponse,
    InboxRowResponse,
    MarkReadRequest,
    MessagePage,
    MessageResponse,
    OpenGroupConversationRequest,
    OpenItemConversationRequest,
    OpenTermConversationRequest,
    SendMessageRequest,
    UnreadCountResponse,
)

router = APIRouter(prefix="/api/conversations", tags=["messaging"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
# Private chats are for logged-in users only: the OAuth `mcp:read`/`mcp:edit`
# scopes are deliberately not accepted here (authorization matrix rows 53-54).
ReadPrincipal = Annotated[Principal, Depends(require_any("READ"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT"))]

_EXISTING: dict[int | str, dict[str, Any]] = {
    200: {"model": ConversationResponse, "description": "Existing conversation"}
}


def _respond(response: Response, result: tuple[ConversationResponse, bool]) -> ConversationResponse:
    conversation, created = result
    if not created:
        response.status_code = status.HTTP_200_OK
    return conversation


# The literal paths are declared before the `/{conversation_id}` routes.
@router.get("", response_model=list[InboxRowResponse])
async def list_inbox(db: DbSession, principal: ReadPrincipal) -> list[InboxRowResponse]:
    return await service.list_inbox(db, principal)


@router.get("/unread-count", response_model=UnreadCountResponse)
async def count_unread(db: DbSession, principal: ReadPrincipal) -> UnreadCountResponse:
    return await service.count_unread(db, principal)


@router.post(
    "/item",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_EXISTING,
)
async def open_item_conversation(
    body: OpenItemConversationRequest, response: Response, db: DbSession, principal: EditPrincipal
) -> ConversationResponse:
    return _respond(response, await service.open_item_conversation(db, principal, body.item_id))


@router.post(
    "/group",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_EXISTING,
)
async def open_group_conversation(
    body: OpenGroupConversationRequest, response: Response, db: DbSession, principal: EditPrincipal
) -> ConversationResponse:
    return _respond(response, await service.open_group_conversation(db, principal, body.group_id))


@router.post(
    "/term",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_EXISTING,
)
async def open_term_conversation(
    body: OpenTermConversationRequest, response: Response, db: DbSession, principal: EditPrincipal
) -> ConversationResponse:
    return _respond(response, await service.open_term_conversation(db, principal, body.term_id))


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> ConversationResponse:
    return await service.get_conversation(db, principal, conversation_id)


@router.get("/{conversation_id}/messages", response_model=MessagePage)
async def list_messages(
    conversation_id: uuid.UUID,
    db: DbSession,
    principal: ReadPrincipal,
    before: uuid.UUID | None = None,
    after: uuid.UUID | None = None,
) -> MessagePage:
    return await service.list_messages(db, principal, conversation_id, before, after)


@router.post(
    "/{conversation_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    conversation_id: uuid.UUID, body: SendMessageRequest, db: DbSession, principal: EditPrincipal
) -> MessageResponse:
    return await service.send_message(db, principal, conversation_id, body.body)


@router.post("/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    conversation_id: uuid.UUID, body: MarkReadRequest, db: DbSession, principal: EditPrincipal
) -> None:
    await service.mark_read(db, principal, conversation_id, body.message_id)
