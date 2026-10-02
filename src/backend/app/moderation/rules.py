"""Synchronous, model-free moderation rules run inside the write request.
Listings must not carry contact details: exchanges are arranged inside the
app, so a phone number, e-mail, link or messenger handle in a product name
or description is rejected with a Polish message (a 400, like any other
input validation)."""

from __future__ import annotations

import re

CONTACT_INFO_MESSAGE = (
    "Nazwa i opis nie mogą zawierać danych kontaktowych "
    "(numeru telefonu, e-maila, linków ani komunikatorów)"
)

_CONTACT_PATTERNS = (
    # Polish phone numbers, optionally +48: a 9-digit run, a mobile 3-3-3 group
    # (first digit 4-9, so clothing sizes like "104-110-116" pass) or a 2-3-2-2 landline.
    re.compile(r"(?<!\d)(?:\+?48[\s-]?)?\d{9}(?!\d)"),
    re.compile(r"(?<!\d)(?:\+?48[\s-]?)?[4-9]\d{2}[\s-]\d{3}[\s-]\d{3}(?!\d)"),
    re.compile(r"(?<!\d)(?:\+?48[\s-]?)?\d{2}[\s-]\d{3}[\s-]\d{2}[\s-]\d{2}(?!\d)"),
    re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),
    re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE),
    re.compile(r"\b[\w-]+\.(?:pl|com|eu|net|org|me|io|info)(?:/\S*)?\b", re.IGNORECASE),
    re.compile(r"\b(?:whats\s?app|telegram|viber|messenger|signal)\b", re.IGNORECASE),
    re.compile(r"\b(?:na|pisz|napisz)\s+(?:na\s+)?priv\w*", re.IGNORECASE),
)


def contains_contact_info(text: str) -> bool:
    return any(pattern.search(text) for pattern in _CONTACT_PATTERNS)


def ensure_no_contact_info(*texts: str | None) -> None:
    if any(text and contains_contact_info(text) for text in texts):
        raise ValueError(CONTACT_INFO_MESSAGE)
