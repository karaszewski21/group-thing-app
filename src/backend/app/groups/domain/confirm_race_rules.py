"""Pure, standalone authorization primitive for the confirm-race the future
`confirm_transaction` use case (Group 3) will resolve: whichever party of a
`SwapProposal`/giveaway hits the confirm endpoint first wins the race, and
the other party's later call must be recognized as a no-op rather than a
security violation. No `db`, no ORM queries — same style as
`app.circulation.domain.reservation_rules`.

This is a groups-owned sibling of circulation's `_require_party_to_
reservation`, NOT a call into or modification of it: circulation's rule is
scoped to its own `Reservation`/holder concept, while this rule is scoped
to the feature-level `reserved_by`/holder identities the groups vertical
already has in hand before it ever calls into `circulation_bridge`."""

from __future__ import annotations

from app.core.errors import AccessDeniedException


def _require_race_participant(
    reserved_by_user_id: int, holder_user_id: int, acting_user_id: int
) -> None:
    if acting_user_id not in (reserved_by_user_id, holder_user_id):
        raise AccessDeniedException
