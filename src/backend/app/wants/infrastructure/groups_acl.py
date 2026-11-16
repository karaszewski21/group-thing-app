"""Anti-corruption layer over `app.groups`: the ONLY `app.wants` module that
imports the groups vertical. It exposes the listing and swap-proposal
tables, the item visibility predicate, "the item owner shares a group with
a party", the pending-proposer join of the listed items and the public-URL
slug rule of a party. It must not import `..schemas`."""

from __future__ import annotations

from app.groups.domain.organizer_slug import derive_party_slug
from app.groups.models import (
    ItemListingPreference,
    ItemVisibility,
    SwapProposal,
    SwapProposalStatus,
)
from app.groups.service import (
    VisibilityScope,
    items_visible_to,
    owner_shares_group_with,
    with_pending_proposer,
)

__all__ = [
    "ItemListingPreference",
    "ItemVisibility",
    "SwapProposal",
    "SwapProposalStatus",
    "VisibilityScope",
    "derive_party_slug",
    "items_visible_to",
    "owner_shares_group_with",
    "with_pending_proposer",
]
