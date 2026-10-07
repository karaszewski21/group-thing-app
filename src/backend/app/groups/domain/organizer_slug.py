"""Pure organizer-slug domain rule: the Circle's public-URL slug and the
stable, URL-safe pseudo-slug used when its organizer has no `Organization`.
No `db`, no cross-context imports."""

from __future__ import annotations

import hashlib
import uuid


def _fallback_organizer_slug(seed: str) -> str:
    """A stable, URL-safe pseudo-slug for the `/<slug>/grupa/<id>/term/<id>`
    public URL when the organizer has not created an `Organization`. Keyed on
    the organizer's party id so every Circle that person leads shares one
    prefix, exactly as a real Organization slug would.

    Not a secret: the slug segment is cosmetic (the backend fetches by
    `group_id` + `term_id` and never validates it) and `group_id`/`term_id`
    are already in the URL — so a plain digest, no pepper, is enough.
    """
    return "k-" + hashlib.blake2s(seed.encode("utf-8"), digest_size=6).hexdigest()


def derive_organizer_slug(
    group_id: uuid.UUID, organizer_party_id: uuid.UUID | None, organization_slug: str | None
) -> str:
    """The Circle's public-URL slug: the organizer's own `Organization` slug
    when they have one, else a hash of the organizer's party id, else (no
    active organizer) a hash of the Circle id. Never empty."""
    if organization_slug is not None:
        return organization_slug
    if organizer_party_id is None:
        return _fallback_organizer_slug(f"group:{group_id}")
    return _fallback_organizer_slug(f"party:{organizer_party_id}")
