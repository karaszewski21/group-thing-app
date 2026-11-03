"""Pure organizer-slug domain rule: the Circle's public-URL slug — the
organizer's `Organization` slug or party id, a pseudo-slug only for a Circle
with no organizer.
No `db`, no cross-context imports."""

from __future__ import annotations

import hashlib
import uuid


def _fallback_organizer_slug(seed: str) -> str:
    """A stable, URL-safe pseudo-slug for the `/<slug>/group/<id>/term/<id>`
    public URL of a Circle with no active organizer.

    Not a secret: the slug segment is cosmetic (the backend fetches by
    `group_id` + `term_id` and never validates it) and `group_id`/`term_id`
    are already in the URL — so a plain digest, no pepper, is enough.
    """
    return "k-" + hashlib.blake2s(seed.encode("utf-8"), digest_size=6).hexdigest()


def derive_organizer_slug(
    group_id: uuid.UUID, organizer_party_id: uuid.UUID | None, organization_slug: str | None
) -> str:
    """The Circle's public-URL slug: the organizer's own `Organization` slug
    when they have one, else the organizer's party id, else (no active
    organizer) a hash of the Circle id. Never empty."""
    if organizer_party_id is not None:
        return derive_party_slug(organizer_party_id, organization_slug)
    if organization_slug is not None:
        return organization_slug
    return _fallback_organizer_slug(f"group:{group_id}")


def derive_party_slug(party_id: uuid.UUID, organization_slug: str | None) -> str:
    """A party's public-URL prefix: its own `Organization` slug, else its
    party id — the same `/<party-id>` its person profile lives at — so an
    organizer's event, term and item URLs share one prefix."""
    if organization_slug is not None:
        return organization_slug
    return str(party_id)
