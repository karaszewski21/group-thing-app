"""`POST /api/auth/login` — the only route in this module (spec.md's Auth
section). Public; validates the request body is non-blank via Pydantic,
then checks credentials against `users.password_hash` (bcrypt)."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.errors import ErrorResponse
from app.core.security import encode_login_token, verify_password
from app.db import get_db

from .models import User, user_permissions

router = APIRouter(prefix="/api/auth", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    token: str


async def _load_permissions(db: AsyncSession, user_id: int) -> list[str]:
    result = await db.execute(
        select(user_permissions.c.permission).where(user_permissions.c.user_id == user_id)
    )
    return [row[0] for row in result]


@router.post("/login", response_model=None)
async def login(body: LoginRequest, db: DbSession) -> LoginResponse | JSONResponse:
    user = (
        await db.execute(select(User).where(User.username == body.username))
    ).scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
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

    permissions = await _load_permissions(db, cast(int, user.id))
    token = encode_login_token(
        user.username, permissions, settings.jwt_secret, settings.jwt_expiration_ms
    )
    return LoginResponse(token=token)
