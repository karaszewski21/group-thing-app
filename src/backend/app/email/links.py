"""The signed one-click unsubscribe token
`1.<CATEGORY>.<party_id>.<base64url(HMAC-SHA256(secret, "1|<CATEGORY>|<party_id>"))>`.

It never expires. Only the categories of `KIND_RULES` get a token; there is
no `ALL` token (switching everything off is `scope=all` on a category
token). Never log a token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from typing import NamedTuple

from app.config import settings
from app.email.models import EmailCategory
from app.email.rules import KIND_RULES

_VERSION = "1"
_TOKEN_CATEGORIES = frozenset(rule.category for rule in KIND_RULES.values())


class UnsubscribeTarget(NamedTuple):
    party_id: uuid.UUID
    category: EmailCategory


def _signature(secret: str, category: str, party_id: str) -> str:
    message = f"{_VERSION}|{category}|{party_id}".encode()
    digest = hmac.digest(secret.encode(), message, hashlib.sha256)
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def sign_unsubscribe(party_id: uuid.UUID, category: EmailCategory) -> str:
    if category not in _TOKEN_CATEGORIES:
        raise ValueError("no unsubscribe token for this category")
    secret = settings.email_link_signing_secret
    if not secret:
        raise RuntimeError("EMAIL_LINK_SIGNING_SECRET is not set")
    canonical = str(party_id)
    return (
        f"{_VERSION}.{category.value}.{canonical}.{_signature(secret, category.value, canonical)}"
    )


def verify_unsubscribe(token: str) -> UnsubscribeTarget | None:
    """The token's target, or None for any malformed, unknown or forged token
    and while the secret is missing."""
    secret = settings.email_link_signing_secret
    if not secret:
        return None
    parts = token.split(".")
    if len(parts) != 4 or parts[0] != _VERSION:
        return None
    _, raw_category, raw_party_id, signature = parts
    try:
        category = EmailCategory(raw_category)
        party_id = uuid.UUID(raw_party_id)
    except ValueError:
        return None
    if category not in _TOKEN_CATEGORIES or str(party_id) != raw_party_id:
        return None
    expected = _signature(secret, category.value, raw_party_id)
    if not hmac.compare_digest(expected.encode(), signature.encode()):
        return None
    return UnsubscribeTarget(party_id, category)
