"""Pure public-link paths of the search results: the frontend paths of an
item, a term, an event, a group's terms page and an organization page under
an owner's slug. The slug rules themselves are the groups rules, reached
through `infrastructure/groups_acl.py`; the term and event paths mirror
`app.pages.domain.links`, which no other module may import.
No `db`, no cross-context imports."""

from __future__ import annotations

import uuid


def product_path(slug: str, item_id: uuid.UUID) -> str:
    """The item page: `/<slug>/product/<item-id>`."""
    return f"/{slug}/product/{item_id}"


def term_path(slug: str, group_id: uuid.UUID, term_id: uuid.UUID) -> str:
    """The public term page: `/<slug>/group/<group-id>/term/<term-id>`."""
    return f"/{slug}/group/{group_id}/term/{term_id}"


def event_path(slug: str, event_id: uuid.UUID) -> str:
    """The public event page: `/<slug>/event/<event-id>`."""
    return f"/{slug}/event/{event_id}"


def group_terms_path(organization_slug: str, group_id: uuid.UUID) -> str:
    """An organization group's terms page: `/<org-slug>/group/<id>/terms`."""
    return f"/{organization_slug}/group/{group_id}/terms"


def organization_path(slug: str) -> str:
    """The organization page: `/<slug>`."""
    return f"/{slug}"
