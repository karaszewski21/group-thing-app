"""`/api/item-listing-preferences`, `/api/term-item-listings`,
`/api/swap-proposals` and the `/api/reservations/{id}/confirm-transaction`
routes — the exchange-mechanism HTTP layer over
`application/term_item_listings.py`'s set/list/browse/take/propose/accept/
reject/confirm use cases."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups import service
from app.groups.application.term_item_listings import TermAlreadyResolvedException
from app.groups.schemas import (
    BrowseTermItemListingResponse,
    ConfirmTransactionRequest,
    ConfirmTransactionResponse,
    ItemListingPreferenceResponse,
    ProposeSwapRequest,
    SetItemListingPreferenceRequest,
    SwapProposalResponse,
    TakeTermItemListingRequest,
)
from app.users.service import get_profile_by_principal

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.put(
    "/api/item-listing-preferences/{item_id}",
    response_model=ItemListingPreferenceResponse | None,
)
async def set_item_listing_preference(
    item_id: int, body: SetItemListingPreferenceRequest, db: DbSession, principal: EditPrincipal
) -> ItemListingPreferenceResponse | None:
    preference = await service.set_item_listing_preference(db, principal, item_id, body.mode)
    return ItemListingPreferenceResponse.model_validate(preference) if preference else None


@router.get(
    "/api/item-listing-preferences/mine", response_model=list[ItemListingPreferenceResponse]
)
async def list_my_item_listing_preferences(
    db: DbSession, principal: ReadPrincipal
) -> list[ItemListingPreferenceResponse]:
    preferences = await service.list_my_item_listing_preferences(db, principal)
    return [ItemListingPreferenceResponse.model_validate(p) for p in preferences]


# Declared before `POST /api/term-item-listings/{item_id}/take` so the
# literal `mine`/`browse` segments are not parsed as `item_id: int` — same
# ordering caveat as `pledges.py`'s `list_my_pledges` (see comment there).
@router.get("/api/term-item-listings/mine", response_model=list[BrowseTermItemListingResponse])
async def list_my_term_item_listings(
    term_id: int, db: DbSession, principal: ReadPrincipal
) -> list[BrowseTermItemListingResponse]:
    profile = await get_profile_by_principal(db, principal)
    return await service.list_my_term_item_listings(db, term_id, profile.party_id)


@router.get("/api/term-item-listings/browse", response_model=list[BrowseTermItemListingResponse])
async def list_browsable_term_item_listings(
    term_id: int, db: DbSession, principal: ReadPrincipal
) -> list[BrowseTermItemListingResponse]:
    profile = await get_profile_by_principal(db, principal)
    return await service.list_browsable_term_item_listings(db, term_id, profile.party_id)


@router.post("/api/term-item-listings/{item_id}/take", response_model=BrowseTermItemListingResponse)
async def take_item_listing(
    item_id: int, body: TakeTermItemListingRequest, db: DbSession, principal: EditPrincipal
) -> BrowseTermItemListingResponse:
    return await service.take_item_listing(db, principal, item_id, body)


@router.post("/api/term-item-listings/{item_id}/propose", response_model=SwapProposalResponse)
async def propose_swap(
    item_id: int, body: ProposeSwapRequest, db: DbSession, principal: EditPrincipal
) -> SwapProposalResponse:
    proposal = await service.propose_swap(
        db, principal, item_id, body.offered_item_id, body.term_id
    )
    return SwapProposalResponse.model_validate(proposal)


@router.post("/api/swap-proposals/{proposal_id}/accept", response_model=SwapProposalResponse)
async def accept_swap_proposal(
    proposal_id: int, db: DbSession, principal: EditPrincipal
) -> SwapProposalResponse:
    proposal = await service.accept_swap_proposal(db, principal, proposal_id)
    return SwapProposalResponse.model_validate(proposal)


@router.post("/api/swap-proposals/{proposal_id}/reject", response_model=SwapProposalResponse)
async def reject_swap_proposal(
    proposal_id: int, db: DbSession, principal: EditPrincipal
) -> SwapProposalResponse:
    proposal = await service.reject_swap_proposal(db, principal, proposal_id)
    return SwapProposalResponse.model_validate(proposal)


@router.post(
    "/api/reservations/{reservation_id}/confirm-transaction",
    response_model=ConfirmTransactionResponse,
)
async def confirm_transaction(
    reservation_id: int, body: ConfirmTransactionRequest, db: DbSession, principal: EditPrincipal
) -> ConfirmTransactionResponse | JSONResponse:
    """Maps `TermAlreadyResolvedException` (Group 3's marker for "the other
    party already resolved this transaction") to an explicit 409 body with
    `already_resolved=True` — distinct from the generic `BusinessConflictException`
    409 envelope (e.g. the "term hasn't ended yet" conflict), per spec.md
    Requirement 3 and this group's acceptance criteria."""
    try:
        reservation = await service.confirm_transaction(
            db, principal, reservation_id, body.term_id
        )
    except TermAlreadyResolvedException:
        body_out = ConfirmTransactionResponse(
            reservation_id=reservation_id, status="ALREADY_RESOLVED", already_resolved=True
        )
        return JSONResponse(status_code=409, content=jsonable_encoder(body_out.model_dump()))
    return ConfirmTransactionResponse(
        reservation_id=reservation_id, status=reservation.status.value, already_resolved=False
    )
