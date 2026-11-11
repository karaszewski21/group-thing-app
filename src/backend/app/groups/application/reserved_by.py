"""The reserved badge (`ReservedByResponse`) of every item list and of
`/actions`. Reserved state is resolved groups-side because inventory
cannot see `SwapProposal`: an item is reserved while its balance is
RESERVED/IN_TRANSIT (named after its newest active reservation's
`reserved_by_user_id`, the party who would receive it) or a PROPOSED swap
proposal targets it (named after the proposer).

Every logged-in viewer sees the name; an anonymous viewer gets `by_name`
`None`. Names cost at most one profile lookup per id kind (party ids,
account user ids) per response, and none for an anonymous viewer beyond
the caller's own `extra_party_ids`."""

from __future__ import annotations

import uuid
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.users.service import get_profile_by_principal

from ..infrastructure import inventory_bridge, repository
from ..schemas import ReservedByResponse

_IN_FLIGHT = (
    inventory_bridge.BalanceStatus.RESERVED,
    inventory_bridge.BalanceStatus.IN_TRANSIT,
)


async def resolve_viewer_party_id(
    db: AsyncSession, principal: Principal | None
) -> uuid.UUID | None:
    """The caller's party, `None` when anonymous or without a profile."""
    if principal is None:
        return None
    try:
        return (await get_profile_by_principal(db, principal)).party_id
    except EntityNotFoundException:
        return None


@dataclass(frozen=True)
class ReservedByNames:
    """The profile names one response needs, and its viewer."""

    viewer_party_id: uuid.UUID | None
    party_names: dict[uuid.UUID, str]
    # account user id -> (party id, display name)
    reservers: dict[uuid.UUID, tuple[uuid.UUID, str]]

    def reservation(
        self,
        balance_status: inventory_bridge.BalanceStatus,
        reserved_by_user_id: uuid.UUID | None,
        proposer_party_id: uuid.UUID | None,
    ) -> ReservedByResponse | None:
        """`None` for an available item."""
        party_id: uuid.UUID | None = None
        name: str | None = None
        if balance_status in _IN_FLIGHT:
            if reserved_by_user_id is not None and reserved_by_user_id in self.reservers:
                party_id, name = self.reservers[reserved_by_user_id]
        elif proposer_party_id is not None:
            party_id, name = proposer_party_id, self.party_names.get(proposer_party_id)
        else:
            return None
        if self.viewer_party_id is None:
            return ReservedByResponse(by_name=None, by_me=False)
        return ReservedByResponse(by_name=name, by_me=party_id == self.viewer_party_id)

    def row_reservation(self, row: Any) -> ReservedByResponse | None:
        """`reservation` of a `repository.with_pending_proposer` row."""
        return self.reservation(row.balance_status, row.reserved_by_user_id, row.proposer_party_id)


async def load_reserved_by_names(
    db: AsyncSession,
    rows: Iterable[Any],
    viewer_party_id: uuid.UUID | None,
    *,
    extra_party_ids: Collection[uuid.UUID] = (),
) -> ReservedByNames:
    """The names `rows` (`with_pending_proposer` rows) need for this viewer,
    plus `extra_party_ids` (e.g. the listers), in at most two statements."""
    party_ids = set(extra_party_ids)
    user_ids: set[uuid.UUID] = set()
    if viewer_party_id is not None:
        for row in rows:
            if row.balance_status in _IN_FLIGHT and row.reserved_by_user_id is not None:
                user_ids.add(row.reserved_by_user_id)
            elif row.proposer_party_id is not None:
                party_ids.add(row.proposer_party_id)
    party_names = (
        {
            row.party_id: row.display_name
            for row in await repository.list_profile_names_by_party_ids(db, list(party_ids))
        }
        if party_ids
        else {}
    )
    reservers = {
        row.account_user_id: (row.party_id, row.display_name)
        for row in await repository.list_profile_names_by_account_user_ids(db, user_ids)
        if row.account_user_id is not None
    }
    return ReservedByNames(viewer_party_id, party_names, reservers)
