"""Anti-corruption layer over `app.locations`: the ONLY `app.search` module
that imports the locations vertical. It exposes the places and localities
tables a meeting is matched on, the batched place loader for the result
labels, and the folding and minimum length a query is validated with. It
must not import `..schemas`."""

from __future__ import annotations

from app.locations.localities import MIN_QUERY_LENGTH, fold_polish
from app.locations.models import Locality, Location
from app.locations.service import load_locations_by_ids

__all__ = ["MIN_QUERY_LENGTH", "Locality", "Location", "fold_polish", "load_locations_by_ids"]
