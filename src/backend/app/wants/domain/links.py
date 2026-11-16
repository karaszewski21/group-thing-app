"""Pure frontend paths used in want notifications and match cards.
`product_path` mirrors `app.search.domain.links`, which no other module may
import."""

from __future__ import annotations

import uuid


def product_path(slug: str, item_id: uuid.UUID) -> str:
    """The item page: `/<slug>/product/<item-id>`."""
    return f"/{slug}/product/{item_id}"


def want_path(want_id: uuid.UUID) -> str:
    """The match list of a want: `/wanted/<want-id>`."""
    return f"/wanted/{want_id}"
