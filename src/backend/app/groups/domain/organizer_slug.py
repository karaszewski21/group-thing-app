"""Pure organizer-slug domain helper: the stable, URL-safe pseudo-slug
used for a Circle's public URL when its organizer has no `Organization`.
No `db`, no cross-context imports."""

from __future__ import annotations

import hashlib


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
