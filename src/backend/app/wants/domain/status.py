"""Stored enum values of `wants.status` and `want_matches.source`."""

from __future__ import annotations

import enum


class WantStatus(enum.StrEnum):
    ACTIVE = "ACTIVE"
    FULFILLED = "FULFILLED"
    WITHDRAWN = "WITHDRAWN"
    EXPIRED = "EXPIRED"


class WantMatchSource(enum.StrEnum):
    """`FORWARD`: found when the want was created or changed; `SCAN`: found
    by the periodic scan of new listings."""

    FORWARD = "FORWARD"
    SCAN = "SCAN"
