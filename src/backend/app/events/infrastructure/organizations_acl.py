"""Anti-corruption layer over `app.organizations`: the ONLY `app.events`
module that imports the organizations vertical. It resolves an author's
owned `Organization` (the event page's theme, label and slug) and, for
lists, every author's in one statement. It must not import `..schemas`."""

from __future__ import annotations

from app.organizations.service import get_own_organization, get_own_organizations_by_party_ids

__all__ = ["get_own_organization", "get_own_organizations_by_party_ids"]
