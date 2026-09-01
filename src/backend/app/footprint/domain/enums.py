"""Small enums shared across the footprint calculation engine."""

from __future__ import annotations

from enum import StrEnum


class Strictness(StrEnum):
    """How the tree builder reacts to a missing emission factor."""

    STRICT = "STRICT"
    LENIENT = "LENIENT"


class Normalisation(StrEnum):
    """The unit a calculated breakdown is expressed in."""

    TOTAL = "TOTAL"
    PER_100G = "PER_100G"
