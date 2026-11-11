"""Anti-corruption layer over `app.organizations`: the ONLY `app.pages`
module that imports the organizations vertical. It resolves an
`Organization` by slug and its owner party (slug -> Organization -> owner),
and a party's own `Organization` for the profile link. It must not import
`..schemas`."""

from __future__ import annotations

from app.organizations.models import Organization
from app.organizations.service import (
    get_organization_by_slug,
    get_own_organization,
    get_owner_party_id,
)

__all__ = [
    "Organization",
    "get_organization_by_slug",
    "get_own_organization",
    "get_owner_party_id",
]
