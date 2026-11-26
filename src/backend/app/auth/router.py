"""`POST /api/auth/login` (spec.md's Auth section): public; validates the
request body is non-blank via Pydantic, resolves `UserProfile` by `email` ->
`auth.User` via `account_user_id` (spec.md Core Requirement 6), then checks
credentials against `users.password_hash` (bcrypt).

`POST /api/auth/google/nonce` and `POST /api/auth/google`: Google sign-in.
Public; every response the sign-in route builds clears the nonce cookie."""

from __future__ import annotations

import logging
import secrets
import uuid
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from app.config import settings
from app.core.errors import ErrorResponse
from app.core.security import encode_login_token, hash_password, verify_password
from app.db import get_db
from app.users.models import UserProfile
from app.users.schemas import normalize_email
from app.users.service import DuplicateEmailException

from .google import (
    GOOGLE_UNAVAILABLE_COPY,
    NONCE_COOKIE_NAME,
    GoogleKeysUnavailable,
    GoogleTokenInvalid,
    GoogleTokenVerifier,
    clear_nonce_cookie,
    encode_nonce_cookie,
    get_google_verifier,
    new_nonce,
    read_nonce_cookie,
    set_nonce_cookie,
)
from .models import User
from .service import (
    GoogleEmailTaken,
    GoogleEmailUnverified,
    GoogleSignInFailed,
    load_permissions,
    sign_in_with_google,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(16))


class LoginRequest(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        # Same canonical form registration stores — a login must not fail
        # just because the user typed a different casing (mobile keyboards
        # auto-capitalize the first letter).
        return normalize_email(value)


class LoginResponse(BaseModel):
    token: str


@router.post("/login", response_model=None)
async def login(body: LoginRequest, db: DbSession) -> LoginResponse | JSONResponse:
    profile = (
        await db.execute(select(UserProfile).where(UserProfile.email == body.email))
    ).scalar_one_or_none()

    # A `UserProfile` with `account_user_id IS NULL` (a lightweight family
    # member — spec.md Core Requirement 8) has no login credentials and
    # must fail the same way as an unknown email.
    user: User | None = None
    if profile is not None and profile.account_user_id is not None:
        user = await db.get(User, profile.account_user_id)

    # An unknown email or an account created through Google (NULL hash)
    # still runs one bcrypt check against a dummy hash, so it fails exactly
    # like a wrong password, in the same time and with no hint of the provider.
    password_hash = user.password_hash if user is not None else None
    password_ok = verify_password(body.password, password_hash or _DUMMY_PASSWORD_HASH)
    if user is None or password_hash is None or not password_ok:
        # Manually constructed here (not via a registered exception
        # handler) — bypasses the generic exception-handler path entirely.
        # Only this specific bad-credentials case gets this explicit
        # branch; any other auth failure would fall through to the
        # catch-all 500 handler, unchanged from the Java source.
        error = ErrorResponse(
            status=401, error="Unauthorized", message="Invalid username or password"
        )
        return JSONResponse(
            status_code=401, content=jsonable_encoder(error.model_dump(by_alias=True))
        )

    permissions = await load_permissions(db, cast(uuid.UUID, user.id))
    token = encode_login_token(
        user.username, permissions, settings.jwt_secret, settings.jwt_expiration_ms
    )
    return LoginResponse(token=token)


_GOOGLE_ERRORS: dict[int, tuple[str, str]] = {
    401: ("Unauthorized", "Nie udało się zalogować przez Google. Spróbuj ponownie."),
    403: (
        "Forbidden",
        "Ten adres w Google nie jest potwierdzony. Potwierdź go w Google albo załóż konto emailem.",
    ),
    409: ("Conflict", "Konto z tym adresem już istnieje — zaloguj się hasłem."),
    503: ("Service Unavailable", GOOGLE_UNAVAILABLE_COPY),
}


class GoogleNonceRequest(BaseModel):
    """A required empty JSON object: a cross-site form post cannot send it
    without a CORS preflight, so it cannot overwrite the cookie."""

    model_config = ConfigDict(extra="forbid")


class GoogleNonceResponse(BaseModel):
    nonce: str


class GoogleSignInRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=4096)


class GoogleSignInResponse(BaseModel):
    token: str
    created: bool
    party_id: uuid.UUID


def _google_json(status: int, content: Any, *, clear_cookie: bool) -> JSONResponse:
    response = JSONResponse(status_code=status, content=jsonable_encoder(content))
    if clear_cookie:
        clear_nonce_cookie(response)
    return response


def _google_error(status: int, *, clear_cookie: bool = True) -> JSONResponse:
    error, message = _GOOGLE_ERRORS[status]
    envelope = ErrorResponse(status=status, error=error, message=message)
    return _google_json(status, envelope.model_dump(by_alias=True), clear_cookie=clear_cookie)


def _google_rejected(reason: str) -> JSONResponse:
    logger.info("google sign-in rejected: reason=%s", reason)
    return _google_error(401)


@router.post("/google/nonce", response_model=None)
async def google_nonce(body: GoogleNonceRequest) -> JSONResponse:
    if not settings.google_login_configured:
        return _google_error(503, clear_cookie=False)
    nonce = new_nonce()
    response = _google_json(200, GoogleNonceResponse(nonce=nonce).model_dump(), clear_cookie=False)
    response.headers["Cache-Control"] = "no-store"
    set_nonce_cookie(response, encode_nonce_cookie(nonce))
    return response


@router.post("/google", response_model=None)
async def google_sign_in(
    body: GoogleSignInRequest,
    request: Request,
    db: DbSession,
    verifier: Annotated[GoogleTokenVerifier, Depends(get_google_verifier)],
) -> JSONResponse:
    if not settings.google_login_configured:
        return _google_error(503)
    try:
        nonce = read_nonce_cookie(request.cookies.get(NONCE_COOKIE_NAME))
        claims = await verifier.verify(body.credential, nonce)
        signed_in = await sign_in_with_google(db, claims)
    except GoogleTokenInvalid as exc:
        return _google_rejected(exc.reason)
    except GoogleSignInFailed:
        return _google_rejected("bootstrap_conflict")
    except StaleDataError:
        await db.rollback()
        return _google_rejected("stale_identity")
    except GoogleKeysUnavailable:
        return _google_error(503)
    except GoogleEmailUnverified:
        logger.info("google sign-in rejected: reason=email_unverified")
        return _google_error(403)
    except (GoogleEmailTaken, DuplicateEmailException):
        logger.info("google sign-in rejected: reason=email_taken")
        return _google_error(409)

    logger.info("google sign-in ok: created=%s", signed_in.created)
    user = signed_in.user
    permissions = await load_permissions(db, cast(uuid.UUID, user.id))
    token = encode_login_token(
        user.username, permissions, settings.jwt_secret, settings.jwt_expiration_ms
    )
    result = GoogleSignInResponse(
        token=token, created=signed_in.created, party_id=signed_in.party_id
    )
    return _google_json(201 if signed_in.created else 200, result.model_dump(), clear_cookie=True)
