"""Allowlist of public profile page layouts (`UserProfile.page_layout`).

Keep `PROFILE_PAGE_LAYOUT_KEYS` in sync with
`src/frontend/src/features/profile-public/layouts/registry.ts`; parity is
enforced by `organizerKeyParity.test.ts`, which parses the literal below by
regex — keep it a single `frozenset({...})` expression with double-quoted keys.
"""

from __future__ import annotations

PROFILE_PAGE_LAYOUT_KEYS: frozenset[str] = frozenset({"BANNER"})

FALLBACK_PROFILE_PAGE_LAYOUT = "BANNER"


def resolve_profile_page_layout(stored: str | None) -> str:
    """The effective layout for a stored key: `None` and unknown keys (e.g. a
    removed layout) degrade to `FALLBACK_PROFILE_PAGE_LAYOUT`."""
    return stored if stored in PROFILE_PAGE_LAYOUT_KEYS else FALLBACK_PROFILE_PAGE_LAYOUT
