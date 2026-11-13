"""Pure ranking constants of the search: the per-field weights added to
`ts_rank` and the meetings match classes.
No `db`, no cross-context imports."""

from __future__ import annotations

# `word_similarity` weight of a matched field: A (a name), B (an owning
# organization's or a category's name), C (a description, a category path or
# a place).
WEIGHT_A = 1.0
WEIGHT_B = 0.4
WEIGHT_C = 0.2

# Meetings sort by match class before date: a group found only by its
# description never ranks above one found by its name.
MATCH_CLASS_NAME = 0
MATCH_CLASS_DESCRIPTION = 1
