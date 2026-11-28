"""`/api/email` routes, mounted by `app.main`. The Mailgun webhook and the
one-click unsubscribe are PUBLIC (no auth dependency): the webhook is
authenticated by its HMAC signature in `webhooks.py`, the unsubscribe by its
signed token in `links.py`. The preference routes are login-only (`READ` /
`EDIT`, no `mcp:*`). No route here returns 401 for a bad token."""

from __future__ import annotations

import json
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import Principal, require_any
from app.core.errors import ErrorResponse
from app.db import get_db

from . import links, rules, service, webhooks
from .infrastructure import users_acl
from .models import EmailCategory
from .schemas import (
    EmailCategoryPreference,
    EmailPreferencesResponse,
    PreferenceUpdateRequest,
    UnsubscribeRequest,
    UnsubscribeResponse,
)

router = APIRouter(prefix="/api/email", tags=["email"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT"))]

# Route-local `reason → (status, error, Polish message)`, as `_GOOGLE_ERRORS`
# in `auth/router.py`.
_EMAIL_ERRORS: dict[str, tuple[int, str, str]] = {
    "unknown_category": (400, "Bad Request", "Nieznana kategoria powiadomień."),
    "bad_body": (400, "Bad Request", "Nieprawidłowe żądanie."),
    "no_profile": (404, "Not Found", "Nie znaleziono profilu."),
    "unknown_link": (404, "Not Found", "Nie rozpoznajemy tego linku."),
}

_EDITABLE_CATEGORIES = frozenset((EmailCategory.ALL, *rules.VISIBLE_CATEGORIES))


@router.post("/webhooks/mailgun")
async def mailgun_webhook(request: Request, db: DbSession) -> Response:
    """200 `{}` also for an unknown message; 400 for a body that is not a
    JSON object; 401 or 503 with an empty body."""
    try:
        await webhooks.handle_mailgun_webhook(db, await request.body())
    except webhooks.WebhookPayloadError:
        return Response(status_code=400)
    except webhooks.WebhookRejectedError:
        return Response(status_code=401)
    except webhooks.WebhookUnavailableError:
        return Response(status_code=503)
    return JSONResponse({})


def _email_error(reason: str) -> JSONResponse:
    status, error, message = _EMAIL_ERRORS[reason]
    envelope = ErrorResponse(status=status, error=error, message=message)
    return JSONResponse(
        status_code=status, content=jsonable_encoder(envelope.model_dump(by_alias=True))
    )


async def _preferences_response(
    db: AsyncSession, address: users_acl.OwnAddress
) -> EmailPreferencesResponse:
    stored = await service.read_preferences(db, address.party_id)
    return EmailPreferencesResponse(
        email=address.email,
        email_verified=(
            address.email_verified_at is not None
            if settings.email_enabled and address.email
            else None
        ),
        suppression=await service.find_suppression(db, address.email),
        support_address=settings.email_reply_to_address,
        notifications_live=settings.email_enabled and settings.email_notifications_enabled,
        all_enabled=stored.get(EmailCategory.ALL) is not False,
        categories=[
            EmailCategoryPreference(
                category=category,
                enabled=stored.get(category, rules.CATEGORY_DEFAULTS[category]),
            )
            for category in rules.VISIBLE_CATEGORIES
        ],
    )


@router.get("/preferences", response_model=EmailPreferencesResponse)
async def get_preferences(
    db: DbSession, principal: ReadPrincipal
) -> EmailPreferencesResponse | JSONResponse:
    address = await users_acl.find_own_address(db, principal.username)
    if address is None:
        return _email_error("no_profile")
    return await _preferences_response(db, address)


@router.put("/preferences", response_model=EmailPreferencesResponse)
async def update_preference(
    body: PreferenceUpdateRequest, db: DbSession, principal: EditPrincipal
) -> EmailPreferencesResponse | JSONResponse:
    """Allowed while unverified or suppressed; switching a category on never
    lifts a COMPLAINT suppression (only support does)."""
    if body.category not in _EDITABLE_CATEGORIES:
        return _email_error("unknown_category")
    address = await users_acl.find_own_address(db, principal.username)
    if address is None:
        return _email_error("no_profile")
    await service.set_preference(db, address.party_id, EmailCategory(body.category), body.enabled)
    await db.commit()
    return await _preferences_response(db, address)


async def _unsubscribe_scope(request: Request) -> UnsubscribeRequest | None:
    """The page's JSON `{scope}`; a form/multipart body (RFC 8058
    `List-Unsubscribe=One-Click`) or an empty one is scope `category`.
    None for a malformed JSON body."""
    content_type = request.headers.get("content-type", "")
    raw = await request.body()
    if not raw.strip() or not content_type.lower().startswith("application/json"):
        return UnsubscribeRequest()
    try:
        return UnsubscribeRequest.model_validate(json.loads(raw))
    except (ValueError, ValidationError):
        return None


@router.get("/unsubscribe/{token}", response_model=None)
async def unsubscribe_link(token: str) -> Response:
    """A mail client that opens the `List-Unsubscribe` URL with GET lands on
    the page, which asks before it unsubscribes. Side-effect free: any token,
    even an invalid one, is passed on for the page to judge. Never log it."""
    base_url = (settings.app_public_base_url or "").rstrip("/")
    return RedirectResponse(
        f"{base_url}/unsubscribe?token={quote(token, safe='')}",
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@router.post("/unsubscribe/{token}", response_model=UnsubscribeResponse)
async def unsubscribe(
    token: str, request: Request, db: DbSession
) -> UnsubscribeResponse | JSONResponse:
    """200 with no redirect; idempotent. Never log the token."""
    target = links.verify_unsubscribe(token)
    if target is None:
        return _email_error("unknown_link")
    body = await _unsubscribe_scope(request)
    if body is None:
        return _email_error("bad_body")
    category = EmailCategory.ALL if body.scope == "all" else target.category
    await service.set_preference(db, target.party_id, category, False)
    await db.commit()
    return UnsubscribeResponse(category=target.category, scope=body.scope)
