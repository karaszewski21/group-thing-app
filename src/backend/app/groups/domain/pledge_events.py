"""Outbox event-type constants for pledge state changes. Pure string
constants only, no `db`, no cross-context imports — this is the whole
contract `app.groups` and `app.notifications` agree on."""

from __future__ import annotations

PLEDGE_CLAIMED = "groups.pledge_claimed"
PLEDGE_WITHDRAWN = "groups.pledge_withdrawn"
