"""Pure page-content rules of the public owner pages: the organization page
layout keys and how many rows each page shows.
No `db`, no cross-context imports."""

from __future__ import annotations

from typing import Literal

PageLayout = Literal["CLASSIC", "LINKS", "SCHEDULE", "EXCHANGE"]

UPCOMING_TERMS_LIMIT = 4
CLASSIC_ITEMS_LIMIT = 4
SCHEDULE_GROUPS_LIMIT = 4
EXCHANGE_ITEMS_LIMIT = 8
EXCHANGE_TERM_LINKS_LIMIT = 2
GROUP_TERMS_LIMIT = 50
PROFILE_RECENT_ITEMS = 6
OWNER_MEETINGS_LIMIT = 50
