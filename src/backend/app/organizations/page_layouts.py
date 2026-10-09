"""Allowlist of public organization page layouts (`Organization.page_layout`).

Keep `PAGE_LAYOUT_KEYS` in sync with
`src/frontend/src/pages/organizer/layouts/registry.ts`; parity is enforced by
`organizerKeyParity.test.ts`, which parses the literal below by regex — keep
it a single `frozenset({...})` expression with double-quoted keys.
"""

from __future__ import annotations

PAGE_LAYOUT_KEYS: frozenset[str] = frozenset(
    {"CLASSIC", "CIRCLES", "EXCHANGE", "LINKS", "SCHEDULE"}
)

FALLBACK_PAGE_LAYOUT = "CLASSIC"


def resolve_page_layout(stored: str | None) -> str:
    """The effective layout for a stored key: unknown keys (e.g. a removed
    layout or a future `custom:<uuid>`) degrade to `FALLBACK_PAGE_LAYOUT`."""
    return stored if stored in PAGE_LAYOUT_KEYS else FALLBACK_PAGE_LAYOUT
