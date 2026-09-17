"""Outbox event-type constants for term-end giveaway/swap resolution. Pure
string constants only, no `db`, no cross-context imports — sibling of
`pledge_events.py`, same contract `app.groups` and `app.notifications`
agree on."""

from __future__ import annotations

TERM_ENDED_GIVEAWAY = "groups.term_ended_giveaway"
TERM_ENDED_SWAP = "groups.term_ended_swap"
