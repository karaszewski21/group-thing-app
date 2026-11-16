"""Anti-corruption layer over `app.organizations`: the ONLY `app.wants`
module that imports the organizations vertical. It exposes the batched
owners' Organizations, whose slugs prefix the item links. It must not import
`..schemas`."""

from __future__ import annotations

from app.organizations.service import get_own_organizations_by_party_ids

__all__ = ["get_own_organizations_by_party_ids"]
