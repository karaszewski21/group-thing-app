"""Anti-corruption layer over `app.moderation`: the ONLY `app.wants` module
that imports the moderation vertical. It exposes the contact-details rule
and the text classifier check with its field names. It must not import
`..schemas`."""

from __future__ import annotations

from app.moderation.rules import ensure_no_contact_info
from app.moderation.text_guard import TextField, check_text

__all__ = ["TextField", "check_text", "ensure_no_contact_info"]
