"""Request and response bodies of the `/api/email` preference and
unsubscribe routes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .models import EmailCategory, SuppressionReason

UnsubscribeScope = Literal["category", "all"]


class EmailCategoryPreference(BaseModel):
    category: EmailCategory
    enabled: bool


class EmailPreferencesResponse(BaseModel):
    """`email_verified` follows the `/api/people/me` rule: null while email
    is off or the profile has no address."""

    email: str | None
    email_verified: bool | None
    suppression: SuppressionReason | None
    support_address: str | None
    notifications_live: bool
    all_enabled: bool
    categories: list[EmailCategoryPreference]


class PreferenceUpdateRequest(BaseModel):
    """`category` is a plain string checked by the handler, so an unknown
    value gets the Polish 400 instead of the generic validation one."""

    category: str
    enabled: bool


class UnsubscribeRequest(BaseModel):
    scope: UnsubscribeScope = "category"


class UnsubscribeResponse(BaseModel):
    category: EmailCategory
    scope: UnsubscribeScope
